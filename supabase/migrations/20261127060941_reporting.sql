create index sales_business_date on public.sales(business_id,created_at desc);

create function public.sales_report(p_business uuid,p_from date,p_until date)
returns jsonb language plpgsql stable set search_path=''
as $$
declare result jsonb;
begin
  if not commerce_private.can_access(p_business,'analytics') then raise exception 'permission denied' using errcode='42501'; end if;
  if p_from is null or p_until is null or p_until-p_from not between 1 and 93 then raise exception 'invalid report period'; end if;
  with posted as materialized (
    select s.* from public.sales s where s.business_id=p_business
      and s.created_at>=p_from::timestamp at time zone 'Asia/Tashkent'
      and s.created_at<p_until::timestamp at time zone 'Asia/Tashkent'
      and not exists(select 1 from public.sale_returns r where r.sale_id=s.id)
  ), totals as (
    select count(*) as sales,coalesce(sum(total),0) as revenue,coalesce(sum(total-cost),0) as profit,
      coalesce(sum(cash),0) as cash,coalesce(sum(card),0) as card from posted
  ), branches as (
    select l.id,l.name,count(p.id) as sales,coalesce(sum(p.total),0) as revenue
      from public.stores l left join posted p on p.store_id=l.id
      where l.business_id=p_business group by l.id,l.name order by revenue desc,l.id limit 100
  ), operators as (
    select operator_id,count(*) as sales,sum(total) as revenue from posted group by operator_id order by revenue desc,operator_id limit 100
  ), sold as (
    select i.product_id,sum(i.quantity) as units from posted p
      cross join lateral jsonb_to_recordset(p.items) as i(product_id uuid,quantity numeric)
      group by i.product_id
  ), catalog as (
    select p.id,p.name,coalesce(s.units,0) as units from public.products p left join sold s on s.product_id=p.id
      where p.business_id=p_business
  ), popular as (select * from catalog order by units desc,id limit 10),
  slow as (select * from catalog order by units,id limit 10),
  days as (
    select (created_at at time zone 'Asia/Tashkent')::date as day,sum(total) as revenue
      from posted group by 1 order by 1
  )
  select jsonb_build_object(
    'totals',(select to_jsonb(t) from totals t),
    'branches',coalesce((select jsonb_agg(to_jsonb(b) order by b.revenue desc,b.id) from branches b),'[]'),
    'operators',coalesce((select jsonb_agg(to_jsonb(o) order by o.revenue desc,o.operator_id) from operators o),'[]'),
    'popular',coalesce((select jsonb_agg(to_jsonb(p) order by p.units desc,p.id) from popular p),'[]'),
    'slow',coalesce((select jsonb_agg(to_jsonb(s) order by s.units,s.id) from slow s),'[]'),
    'days',coalesce((select jsonb_agg(to_jsonb(d) order by d.day) from days d),'[]')
  ) into result;
  return result;
end
$$;
revoke execute on function public.sales_report(uuid,date,date) from public,anon;
grant execute on function public.sales_report(uuid,date,date) to authenticated;

create or replace function commerce_private.ai_context(p_business uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_summary jsonb; v_products jsonb; v_day date:=(now() at time zone 'Asia/Tashkent')::date;
begin
  if not commerce_private.can_access(p_business,'ai') or not commerce_private.has_feature(p_business,'ai')
    then raise exception 'permission denied' using errcode='42501'; end if;
  insert into commerce_private.ai_usage as usage (business_id,day) values(p_business,v_day)
    on conflict (business_id,day) do update set count=usage.count+1 where usage.count<20;
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
