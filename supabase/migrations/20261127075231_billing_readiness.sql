-- Existing memberships remain stored after expiration or downgrade.
create or replace function commerce_private.can_access(p_business uuid,p_permission text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.businesses where id=p_business and owner_id=auth.uid())
    or exists (
      select 1 from public.subscriptions s join public.plan_catalog p
        on p.id=case when s.paid_until>now() then s.plan else 'FREE' end
      cross join lateral (
        select m.user_id,m.permissions from public.members m where m.business_id=p_business
        order by m.user_id limit p.technical_employee_limit
      ) active
      where s.business_id=p_business and active.user_id=auth.uid()
        and (p_permission='read' or p_permission=any(active.permissions))
    )
$$;

create table commerce_private.ai_plan_limits (
  plan text primary key references public.plan_catalog(id),
  daily_requests integer not null check(daily_requests between 0 and 100000)
);
alter table commerce_private.ai_plan_limits enable row level security;
-- Preserve the existing default for AI-enabled businesses until policy is configured.
insert into commerce_private.ai_plan_limits select id,20 from public.plan_catalog;

create function commerce_private.billing_overview(p_business uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare answer jsonb;
begin
  if not exists(select 1 from public.businesses where id=p_business and owner_id=auth.uid()) then
    raise exception 'permission denied' using errcode='42501';
  end if;
  select jsonb_build_object(
    'plan',case when s.paid_until>now() then s.plan else 'FREE' end,
    'paid_until',s.paid_until,'trial_until',s.trial_until,
    'payments',(select coalesce(jsonb_agg(to_jsonb(p) order by captured_at desc),'[]') from (
      select e.amount_uzs,e.captured_at,o.provider,o.plan,o.months
      from commerce_private.billing_orders o join commerce_private.billing_events e on e.order_id=o.id
      where o.business_id=p_business order by e.captured_at desc limit 50
    ) p)
  ) into answer from public.subscriptions s where business_id=p_business;
  return answer;
end
$$;
create function public.billing_overview(p_business uuid)
returns jsonb language sql stable set search_path='' as $$
  select commerce_private.billing_overview(p_business)
$$;
revoke all on function commerce_private.billing_overview(uuid),public.billing_overview(uuid) from public,anon;
grant execute on function commerce_private.billing_overview(uuid),public.billing_overview(uuid) to authenticated;

create or replace function commerce_private.ai_context(p_business uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_limit integer; v_summary jsonb; v_products jsonb; v_day date:=(now() at time zone 'Asia/Tashkent')::date;
begin
  if not commerce_private.in_store(p_business,null) then
    raise exception 'permission denied' using errcode='42501';
  end if;
  if not commerce_private.can_access(p_business,'ai') or not commerce_private.has_feature(p_business,'ai')
    then raise exception 'permission denied' using errcode='42501'; end if;
  select l.daily_requests into v_limit from public.subscriptions s join commerce_private.ai_plan_limits l
    on l.plan=case when s.paid_until>now() then s.plan else 'FREE' end where s.business_id=p_business;
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
