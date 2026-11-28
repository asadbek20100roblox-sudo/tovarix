alter table public.plan_catalog
  add column product_limit integer,
  add column branch_limit integer,
  add constraint plan_product_limit check(product_limit is null or product_limit > 0),
  add constraint plan_branch_limit check(branch_limit is null or branch_limit > 0);
update public.plan_catalog set
  product_limit=case id when 'FREE' then 100 when 'START' then 500 when 'STANDARD' then 2000 when 'PLUS' then 10000 when 'PRO' then 50000 end,
  branch_limit=case id when 'FREE' then 1 when 'START' then 1 when 'STANDARD' then 1 when 'PLUS' then 3 when 'PRO' then 10 end;
update commerce_private.ai_plan_limits set daily_requests=case plan when 'FREE' then 5 when 'START' then 15 when 'STANDARD' then 30 when 'PLUS' then 60 when 'PRO' then 150 when 'PREMIUM' then 300 end;

alter table public.subscriptions add column trial_started_at timestamptz;
alter table public.subscriptions alter column trial_until drop not null;

create table commerce_private.trial_history (
  owner_id uuid primary key references auth.users(id),
  verified_email_digest bytea not null unique,
  business_id uuid not null unique references public.businesses(id),
  started_at timestamptz not null,
  ends_at timestamptz not null check(ends_at=started_at+interval '720 hours')
);
alter table commerce_private.trial_history enable row level security;
create index businesses_by_owner on public.businesses(owner_id);

create or replace function commerce_private.initialize_subscription()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  email_digest bytea;
  claimed uuid;
  started timestamptz:=statement_timestamp();
begin
  perform pg_advisory_xact_lock(hashtextextended('trial:'||new.owner_id,0));
  select sha256(convert_to(lower(trim(email)),'UTF8')) into email_digest
  from auth.users where id=new.owner_id and email_confirmed_at is not null and nullif(trim(email),'') is not null;
  if email_digest is not null and not exists(
    select 1 from public.businesses where owner_id=new.owner_id and id<>new.id
  ) then
    insert into commerce_private.trial_history(owner_id,verified_email_digest,business_id,started_at,ends_at)
      values(new.owner_id,email_digest,new.id,started,started+interval '720 hours')
      on conflict do nothing returning owner_id into claimed;
  end if;
  insert into public.subscriptions(business_id,trial_started_at,trial_until)
    values(new.id,case when claimed is not null then started end,
      case when claimed is not null then started+interval '720 hours' end);
  return new;
end
$$;

create function commerce_private.effective_plan(p_business uuid)
returns text language sql stable set search_path='' as $$
  select coalesce((select case when s.trial_started_at is not null and s.trial_until>now() then 'PREMIUM'
    when s.paid_until>now() then s.plan else 'FREE' end
    from public.subscriptions s where s.business_id=p_business),'FREE')
$$;
revoke all on function commerce_private.effective_plan(uuid) from public,anon,authenticated;

create function commerce_private.guard_catalog_limit()
returns trigger language plpgsql security definer set search_path='' as $$
declare permitted integer; used bigint;
begin
  if not commerce_private.can_access(new.business_id,case when tg_table_name='stores' then 'stores' else 'catalog' end) then
    raise exception 'permission denied' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(tg_table_name||':'||new.business_id,0));
  if tg_table_name='stores' then
    select coalesce(branch_limit,1000) into permitted from public.plan_catalog
      where id=commerce_private.effective_plan(new.business_id);
    select count(*) into used from public.stores where business_id=new.business_id;
  else
    select coalesce(product_limit,250000) into permitted from public.plan_catalog
      where id=commerce_private.effective_plan(new.business_id);
    select count(*) into used from public.products where business_id=new.business_id;
  end if;
  if used>=permitted then raise exception 'plan resource limit reached'; end if;
  return new;
end
$$;
revoke all on function commerce_private.guard_catalog_limit() from public,anon,authenticated;
create trigger check_product_limit before insert on public.products for each row execute function commerce_private.guard_catalog_limit();
create trigger check_branch_limit before insert on public.stores for each row execute function commerce_private.guard_catalog_limit();

create table commerce_private.platform_settings (
  singleton boolean primary key default true check(singleton),
  ai_enabled boolean not null default false
);
alter table commerce_private.platform_settings enable row level security;
insert into commerce_private.platform_settings default values;
insert into commerce_private.entitlements(plan,feature)
  select id,'ai' from public.plan_catalog on conflict do nothing;

create or replace function commerce_private.can_access(p_business uuid,p_permission text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.businesses where id=p_business and owner_id=auth.uid())
    or exists (
      select 1 from public.subscriptions s join public.plan_catalog p
        on p.id=commerce_private.effective_plan(p_business)
      cross join lateral (
        select m.user_id,m.permissions from public.members m where m.business_id=p_business
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
    if p_role not in ('cashier','manager','warehouse') or p_permissions is null
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

create or replace function commerce_private.billing_overview(p_business uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare answer jsonb;
begin
  if not exists(select 1 from public.businesses where id=p_business and owner_id=auth.uid()) then
    raise exception 'permission denied' using errcode='42501';
  end if;
  select jsonb_build_object(
    'plan',commerce_private.effective_plan(s.business_id),
    'paid_until',s.paid_until,'trial_until',s.trial_until,'trial_started_at',s.trial_started_at,
    'payments',(select coalesce(jsonb_agg(to_jsonb(p) order by captured_at desc),'[]') from (
      select e.amount_uzs,e.captured_at,o.provider,o.plan,o.months
      from commerce_private.billing_orders o join commerce_private.billing_events e on e.order_id=o.id
      where o.business_id=p_business order by e.captured_at desc limit 50
    ) p)
  ) into answer from public.subscriptions s where business_id=p_business;
  return answer;
end
$$;

create or replace function commerce_private.ai_context(p_business uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_limit integer; v_summary jsonb; v_products jsonb; v_day date:=(now() at time zone 'Asia/Tashkent')::date;
begin
  if not exists(select 1 from commerce_private.platform_settings where singleton and ai_enabled) then
    raise exception 'AI disabled';
  end if;
  if not commerce_private.in_store(p_business,null) then
    raise exception 'permission denied' using errcode='42501';
  end if;
  if not commerce_private.can_access(p_business,'ai') or not exists(select 1 from commerce_private.entitlements
      where plan=commerce_private.effective_plan(p_business) and feature='ai')
    then raise exception 'permission denied' using errcode='42501'; end if;
  select l.daily_requests into v_limit from public.subscriptions s join commerce_private.ai_plan_limits l
    on l.plan=commerce_private.effective_plan(s.business_id) where s.business_id=p_business;
  if coalesce(v_limit,0)=0 then raise exception 'AI quota exceeded'; end if;
  insert into commerce_private.ai_usage as usage (business_id,day) values(p_business,v_day)
    on conflict (business_id,day) do update set count=usage.count+1 where usage.count<v_limit;
  if not found then raise exception 'AI quota exceeded'; end if;
  select coalesce(jsonb_agg(to_jsonb(daily) order by day), '[]') into v_summary from (
    select (created_at at time zone 'Asia/Tashkent')::date as day, count(*) as sales,
      sum(total) as revenue_uzs, sum(total-cost) as gross_profit_uzs
    from public.sales s where business_id=p_business and created_at>=now()-interval '30 days'
      and not exists(select 1 from public.sale_returns r where r.sale_id=s.id)
    group by 1
  ) daily;
  with sold as (
    select i.product_id,sum(i.quantity) as units from public.sales s
      cross join lateral jsonb_to_recordset(s.items) as i(product_id uuid,quantity numeric)
    where s.business_id=p_business and s.created_at>=now()-interval '30 days'
      and not exists(select 1 from public.sale_returns r where r.sale_id=s.id)
    group by i.product_id
  ), inventory as (
    select product_id,sum(quantity) as units from public.stock where business_id=p_business group by product_id
  )
  select coalesce(jsonb_agg(to_jsonb(items)), '[]') into v_products from (
    select p.name,coalesce(s.units,0) as sold_30d,coalesce(i.units,0) as on_hand
      from public.products p left join sold s on s.product_id=p.id left join inventory i on i.product_id=p.id
      where p.business_id=p_business order by i.units asc nulls first,s.units desc nulls last,p.id limit 100
  ) items;
  return jsonb_build_object('daily_sales',v_summary,'product_snapshot',v_products,'product_limit',100);
end
$$;
