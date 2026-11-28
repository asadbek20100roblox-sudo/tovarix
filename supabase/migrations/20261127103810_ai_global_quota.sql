alter table commerce_private.platform_settings add column ai_daily_budget integer not null default 1000
  check(ai_daily_budget between 0 and 1000000);

create table commerce_private.ai_global_usage (
  day date primary key,
  count integer not null check(count>0)
);
alter table commerce_private.ai_global_usage enable row level security;

create function commerce_private.ai_remaining(p_business uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare enabled boolean; allowance integer; consumed integer; v_day date:=(now() at time zone 'Asia/Tashkent')::date;
begin
  if not commerce_private.can_access(p_business,'ai') or not commerce_private.in_store(p_business,null) then
    raise exception 'permission denied' using errcode='42501';
  end if;
  select ai_enabled and ai_daily_budget>0 into enabled from commerce_private.platform_settings where singleton;
  select daily_requests into allowance from commerce_private.ai_plan_limits where plan=commerce_private.effective_plan(p_business);
  select count into consumed from commerce_private.ai_usage where business_id=p_business and day=v_day;
  return jsonb_build_object('enabled',coalesce(enabled,false),'remaining',greatest(0,coalesce(allowance,0)-coalesce(consumed,0)));
end
$$;
create function public.ai_remaining(p_business uuid)
returns jsonb language sql stable set search_path='' as $$ select commerce_private.ai_remaining(p_business) $$;
revoke all on function commerce_private.ai_remaining(uuid),public.ai_remaining(uuid) from public,anon;
grant execute on function commerce_private.ai_remaining(uuid),public.ai_remaining(uuid) to authenticated;

create or replace function commerce_private.ai_context(p_business uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare global_limit integer; v_limit integer; v_summary jsonb; v_products jsonb; v_day date:=(now() at time zone 'Asia/Tashkent')::date;
begin
  select ai_daily_budget into global_limit from commerce_private.platform_settings where singleton and ai_enabled;
  if coalesce(global_limit,0)=0 then
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
  insert into commerce_private.ai_global_usage as daily(day,count) values(v_day,1)
    on conflict(day) do update set count=daily.count+1 where daily.count<global_limit;
  if not found then raise exception 'AI global quota exceeded'; end if;
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
