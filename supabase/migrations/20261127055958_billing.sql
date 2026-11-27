create table public.plan_catalog (
  id text primary key,
  monthly_uzs bigint not null,
  annual_uzs bigint not null,
  employees integer,
  technical_employee_limit integer not null
);
insert into public.plan_catalog values
  ('FREE',0,0,0,0),('START',39000,449000,0,0),('STANDARD',119000,1299000,3,3),
  ('PLUS',249000,2599000,10,10),('PRO',599000,5999000,50,50),('PREMIUM',1219000,10999000,null,500);
create table public.subscriptions (
  business_id uuid primary key references public.businesses(id),
  plan text not null default 'FREE' references public.plan_catalog(id),
  paid_until timestamptz,
  trial_until timestamptz not null
);
create table commerce_private.entitlements (
  plan text not null references public.plan_catalog(id),
  feature text not null,
  primary key (plan,feature)
);
create table commerce_private.trial_features (feature text primary key);
create table commerce_private.promos (
  code text primary key check (code ~ '^[A-Z0-9]{6,40}$'),
  discount_percent integer not null check (discount_percent between 1 and 100),
  month date not null,
  slot integer not null check (slot between 1 and 2),
  expires_at timestamptz not null,
  use_count integer not null default 0 check (use_count between 0 and 3),
  unique(month,slot)
);
create table commerce_private.promo_claims (
  code text not null references commerce_private.promos(code),
  user_id uuid not null references auth.users(id),
  business_id uuid not null references public.businesses(id),
  primary key(code,user_id)
);
alter table public.plan_catalog enable row level security;
alter table public.subscriptions enable row level security;
alter table commerce_private.entitlements enable row level security;
alter table commerce_private.trial_features enable row level security;
alter table commerce_private.promos enable row level security;
alter table commerce_private.promo_claims enable row level security;
revoke all on public.plan_catalog,public.subscriptions from public,anon,authenticated;
grant select on public.plan_catalog,public.subscriptions to authenticated;
create policy plan_read on public.plan_catalog for select to authenticated using(true);
create policy subscription_read on public.subscriptions for select to authenticated using(commerce_private.can_access(business_id,'billing'));

insert into public.subscriptions(business_id,trial_until)
select id, now()+interval '1 month' from public.businesses;
create function commerce_private.initialize_subscription()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.subscriptions(business_id,trial_until) values(new.id,now()+interval '1 month');
  return new;
end
$$;
revoke execute on function commerce_private.initialize_subscription() from public,anon,authenticated;
create trigger initialize_subscription after insert on public.businesses
  for each row execute function commerce_private.initialize_subscription();

create function commerce_private.has_feature(p_business uuid,p_feature text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.subscriptions s where business_id=p_business and (
      exists(select 1 from commerce_private.entitlements e where e.feature=p_feature
        and e.plan=case when s.paid_until>now() then s.plan else 'FREE' end)
      or (s.trial_until>now() and exists(select 1 from commerce_private.trial_features where feature=p_feature))
    )
  )
$$;
revoke execute on function commerce_private.has_feature(uuid,text) from public,anon,authenticated;

create function commerce_private.set_staff(p_business uuid,p_user uuid,p_role text,p_permissions text[])
returns void language plpgsql security definer set search_path='' as $$
declare v_owner uuid; v_limit integer;
begin
  select owner_id into v_owner from public.businesses where id=p_business for update;
  if auth.uid() is null or v_owner is distinct from auth.uid() then raise exception 'permission denied' using errcode='42501'; end if;
  if p_user is null or p_user=v_owner then raise exception 'invalid employee'; end if;
  if p_role is null then
    delete from public.members where business_id=p_business and user_id=p_user;
  else
    if p_role not in ('cashier','manager','warehouse') or p_permissions is null
      or not (p_permissions <@ array['sell','discount','inventory','catalog','stores','analytics','audit','staff','supplier','customer','ai','returns'])
      then raise exception 'invalid employee permissions'; end if;
    select p.technical_employee_limit into v_limit from public.subscriptions s join public.plan_catalog p
      on p.id=case when s.paid_until>now() then s.plan else 'FREE' end
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
create function public.set_staff(p_business uuid,p_user uuid,p_role text,p_permissions text[])
returns void language sql set search_path='' as $$
  select commerce_private.set_staff(p_business,p_user,p_role,p_permissions)
$$;
revoke execute on function commerce_private.set_staff(uuid,uuid,text,text[]),public.set_staff(uuid,uuid,text,text[]) from public,anon;
grant execute on function commerce_private.set_staff(uuid,uuid,text,text[]),public.set_staff(uuid,uuid,text,text[]) to authenticated;

create function commerce_private.issue_promo(p_code text,p_discount integer,p_expires timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare v_month date:=date_trunc('month',now() at time zone 'Asia/Tashkent')::date; v_slot integer;
begin
  if p_expires is null or p_expires<=now() then raise exception 'invalid expiry'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_month::text,2));
  select n into v_slot from generate_series(1,2) n where not exists(
    select 1 from commerce_private.promos where month=v_month and slot=n
  ) order by n limit 1;
  if v_slot is null then raise exception 'monthly promo limit reached'; end if;
  insert into commerce_private.promos(code,discount_percent,month,slot,expires_at)
    values(upper(trim(p_code)),p_discount,v_month,v_slot,p_expires);
end
$$;
create function public.issue_promo(p_code text,p_discount integer,p_expires timestamptz)
returns void language sql set search_path='' as $$
  select commerce_private.issue_promo(p_code,p_discount,p_expires)
$$;
grant usage on schema commerce_private to service_role;
revoke execute on function commerce_private.issue_promo(text,integer,timestamptz),
  public.issue_promo(text,integer,timestamptz) from public,anon,authenticated;
grant execute on function commerce_private.issue_promo(text,integer,timestamptz),
  public.issue_promo(text,integer,timestamptz) to service_role;

create function commerce_private.redeem_promo(p_business uuid,p_code text)
returns integer language plpgsql security definer set search_path='' as $$
declare v_code text:=upper(trim(p_code)); v_discount integer;
begin
  if auth.uid() is null or not exists (select 1 from public.businesses where id=p_business and owner_id=auth.uid())
    then raise exception 'permission denied' using errcode='42501'; end if;
  update commerce_private.promos set use_count=use_count+1 where code=v_code and expires_at>now() and use_count<3
    returning discount_percent into v_discount;
  if not found then raise exception 'promo unavailable'; end if;
  insert into commerce_private.promo_claims(code,user_id,business_id) values(v_code,auth.uid(),p_business)
    on conflict do nothing;
  if not found then raise exception 'promo already used'; end if;
  return v_discount;
end
$$;
create function public.redeem_promo(p_business uuid,p_code text)
returns integer language sql set search_path='' as $$
  select commerce_private.redeem_promo(p_business,p_code)
$$;
revoke execute on function commerce_private.redeem_promo(uuid,text),public.redeem_promo(uuid,text) from public,anon;
grant execute on function commerce_private.redeem_promo(uuid,text),public.redeem_promo(uuid,text) to authenticated;
