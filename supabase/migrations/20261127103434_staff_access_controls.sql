alter table public.members drop constraint members_role_check;
alter table public.members add constraint members_role_check
  check(role in ('admin','manager','cashier','warehouse','accountant'));
alter table public.members add column blocked_at timestamptz;

create function commerce_private.suspend_staff(p_business uuid,p_user uuid,p_blocked boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_blocked is null or not exists(select 1 from public.businesses where id=p_business and owner_id=auth.uid()) then
    raise exception 'permission denied' using errcode='42501';
  end if;
  perform 1 from public.businesses where id=p_business for update;
  update public.members set blocked_at=case when p_blocked then coalesce(blocked_at,now()) end
    where business_id=p_business and user_id=p_user;
  if not found then raise exception 'employee unavailable'; end if;
  insert into public.audit_log(business_id,actor_id,action,detail)
    values(p_business,auth.uid(),'staff.suspension',jsonb_build_object('user',p_user,'blocked',p_blocked));
end
$$;
create function public.suspend_staff(p_business uuid,p_user uuid,p_blocked boolean)
returns void language sql set search_path='' as $$ select commerce_private.suspend_staff(p_business,p_user,p_blocked) $$;
revoke all on function commerce_private.suspend_staff(uuid,uuid,boolean),public.suspend_staff(uuid,uuid,boolean) from public,anon;
grant execute on function commerce_private.suspend_staff(uuid,uuid,boolean),public.suspend_staff(uuid,uuid,boolean) to authenticated;

create or replace function commerce_private.can_access(p_business uuid,p_permission text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.businesses where id=p_business and owner_id=auth.uid())
    or exists (
      select 1 from public.subscriptions s join public.plan_catalog p
        on p.id=commerce_private.effective_plan(p_business)
      cross join lateral (
        select m.user_id,m.permissions from public.members m where m.business_id=p_business and m.blocked_at is null
        order by m.user_id limit p.technical_employee_limit
      ) active
      where s.business_id=p_business and active.user_id=auth.uid()
        and (p_permission='read' or p_permission=any(active.permissions))
    )
$$;

create or replace function commerce_private.set_staff(p_business uuid,p_user uuid,p_role text,p_permissions text[])
returns void language plpgsql security definer set search_path='' as $$
declare v_owner uuid; v_limit integer;
begin
  select owner_id into v_owner from public.businesses where id=p_business for update;
  if auth.uid() is null or v_owner is distinct from auth.uid() then raise exception 'permission denied' using errcode='42501'; end if;
  if p_user is null or p_user=v_owner then raise exception 'invalid employee'; end if;
  if p_role is null then
    delete from public.members where business_id=p_business and user_id=p_user;
  else
    if p_role not in ('admin','cashier','manager','warehouse','accountant') or p_permissions is null
      or not (p_permissions <@ array['sell','discount','inventory','catalog','stores','analytics','audit','staff','supplier','customer','ai','returns'])
      then raise exception 'invalid employee permissions'; end if;
    select p.technical_employee_limit into v_limit from public.subscriptions s join public.plan_catalog p
      on p.id=commerce_private.effective_plan(s.business_id)
      where s.business_id=p_business for share of s;
    if not exists(select 1 from public.members where business_id=p_business and user_id=p_user)
      and (select count(*) from public.members where business_id=p_business)>=coalesce(v_limit,0) then
      raise exception 'employee limit reached';
    end if;
    insert into public.members(business_id,user_id,role,permissions) values(p_business,p_user,p_role,p_permissions)
      on conflict(business_id,user_id) do update set role=excluded.role,permissions=excluded.permissions;
  end if;
  insert into public.audit_log(business_id,actor_id,action,detail) values
    (p_business,auth.uid(),'staff.change',jsonb_build_object('user',p_user,'role',p_role,'permissions',p_permissions));
end
$$;

create or replace function commerce_private.in_store(p_business uuid,p_store uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.businesses where id=p_business and owner_id=auth.uid())
    or exists(select 1 from public.members where business_id=p_business and user_id=auth.uid() and blocked_at is null
      and (store_scope is null or p_store=any(store_scope)))
$$;
