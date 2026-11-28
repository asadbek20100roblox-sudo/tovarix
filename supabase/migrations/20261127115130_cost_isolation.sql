create function commerce_private.receipt_items(items jsonb)
returns jsonb language sql immutable strict set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id',value->'product_id','name',value->'name',
    'quantity',value->'quantity','price',value->'price','weighted',value->'weighted',
    'partial_returnable',value->>'unit_cost' is not null
  ) order by position),'[]'::jsonb)
  from jsonb_array_elements(items) with ordinality i(value,position)
$$;

alter table public.sales add column receipt_items jsonb
  generated always as (commerce_private.receipt_items(items)) stored;

revoke select on public.products,public.sales,public.partial_returns,public.purchases from public,anon,authenticated;
grant select(id,business_id,name,barcode,price,attributes) on public.products to authenticated;
grant select(id,business_id,store_id,operator_id,request_id,receipt_items,total,cash,card,created_at,shift_id)
  on public.sales to authenticated;
grant select(id,sale_id,business_id,operator_id,request_id,shift_id,product_id,quantity,total,cash,reason,created_at)
  on public.partial_returns to authenticated;
grant select(id,business_id,store_id,supplier_id,product_id,operator_id,quantity,reference,created_at)
  on public.purchases to authenticated;

create function commerce_private.visible_product_cost(p_product uuid)
returns bigint language sql stable security definer set search_path='' as $$
  select cost from public.products where id=p_product and commerce_private.can_access(business_id,'cost')
$$;

create function commerce_private.visible_sale_cost(p_sale uuid)
returns bigint language sql stable security definer set search_path='' as $$
  select s.cost-coalesce((select sum(cost) from public.partial_returns where sale_id=s.id),0)
  from public.sales s where s.id=p_sale and commerce_private.in_store(s.business_id,s.store_id)
    and commerce_private.can_access(s.business_id,'cost')
    and (commerce_private.can_access(s.business_id,'analytics')
      or (s.operator_id=auth.uid() and commerce_private.can_access(s.business_id,'sell')))
$$;

create function commerce_private.visible_purchase_total(p_purchase uuid)
returns bigint language sql stable security definer set search_path='' as $$
  select total_uzs from public.purchases where id=p_purchase and commerce_private.in_store(business_id,store_id)
    and commerce_private.can_access(business_id,'inventory') and commerce_private.can_access(business_id,'cost')
$$;

create function commerce_private.visible_period_profit(p_business uuid,p_from date,p_until date)
returns numeric language sql stable security definer set search_path='' as $$
  select case when commerce_private.can_access(p_business,'analytics') and commerce_private.can_access(p_business,'profit')
    then (select coalesce(sum(s.total-s.cost-coalesce((select sum(r.total-r.cost)
      from public.partial_returns r where r.sale_id=s.id),0)),0)
      from public.sales s where s.business_id=p_business and commerce_private.in_store(s.business_id,s.store_id)
        and p_until-p_from between 1 and 93
        and s.created_at>=p_from::timestamp at time zone 'Asia/Tashkent'
        and s.created_at<p_until::timestamp at time zone 'Asia/Tashkent'
        and not exists(select 1 from public.sale_returns r where r.sale_id=s.id))
  end
$$;

revoke all on function commerce_private.receipt_items(jsonb),
  commerce_private.visible_product_cost(uuid),commerce_private.visible_sale_cost(uuid),
  commerce_private.visible_purchase_total(uuid),commerce_private.visible_period_profit(uuid,date,date)
  from public,anon,authenticated;
grant execute on function commerce_private.visible_product_cost(uuid),commerce_private.visible_sale_cost(uuid),
  commerce_private.visible_purchase_total(uuid),commerce_private.visible_period_profit(uuid,date,date) to authenticated;

create view public.catalog_access with(security_invoker=true) as
  select id,business_id,name,barcode,price,attributes,commerce_private.visible_product_cost(id) as cost from public.products;
create view public.sales_access with(security_invoker=true) as
  select id,business_id,store_id,operator_id,created_at,total,receipt_items as items,
    commerce_private.visible_sale_cost(id) as cost from public.sales;
create view public.purchase_access with(security_invoker=true) as
  select id,business_id,store_id,product_id,quantity,reference,created_at,
    commerce_private.visible_purchase_total(id) as total_uzs from public.purchases;
revoke all on public.catalog_access,public.sales_access,public.purchase_access from public,anon,authenticated;
grant select on public.catalog_access,public.sales_access,public.purchase_access to authenticated;

create function public.financial_access(p_business uuid)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('cost',commerce_private.can_access(p_business,'cost'),'profit',commerce_private.can_access(p_business,'profit'))
$$;
revoke all on function public.financial_access(uuid) from public,anon;
grant execute on function public.financial_access(uuid) to authenticated;

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
      or not (p_permissions <@ array['sell','discount','inventory','catalog','stores','analytics','audit','staff','supplier','customer','ai','returns','cost','profit'])
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

create or replace function public.sales_report(p_business uuid,p_from date,p_until date)
returns jsonb language plpgsql stable set search_path=''
as $$
declare result jsonb;
begin
  if not commerce_private.can_access(p_business,'analytics') then raise exception 'permission denied' using errcode='42501'; end if;
  if p_from is null or p_until is null or p_until-p_from not between 1 and 93 then raise exception 'invalid report period'; end if;
  with posted as materialized (
    select s.id,s.store_id,s.operator_id,s.created_at,s.receipt_items as items,
      s.total-coalesce(r.total,0) as total,
      s.cash-coalesce(r.cash,0) as cash,s.card-coalesce(r.card,0) as card
    from public.sales s left join lateral (select sum(total) as total,
      sum(cash) as cash,sum(total-cash) as card from public.partial_returns where sale_id=s.id) r on true
    where s.business_id=p_business
      and s.created_at>=p_from::timestamp at time zone 'Asia/Tashkent'
      and s.created_at<p_until::timestamp at time zone 'Asia/Tashkent'
      and not exists(select 1 from public.sale_returns r where r.sale_id=s.id)
  ), totals as (
    select count(*) as sales,coalesce(sum(total),0) as revenue,commerce_private.visible_period_profit(p_business,p_from,p_until) as profit,
      coalesce(sum(cash),0) as cash,coalesce(sum(card),0) as card from posted
  ), branches as (
    select l.id,l.name,count(p.id) as sales,coalesce(sum(p.total),0) as revenue
      from public.stores l left join posted p on p.store_id=l.id
      where l.business_id=p_business group by l.id,l.name order by revenue desc,l.id limit 100
  ), operators as (
    select operator_id,count(*) as sales,sum(total) as revenue from posted group by operator_id order by revenue desc,operator_id limit 100
  ), sold as (
    select i.product_id,sum(i.quantity-coalesce(r.quantity,0)) as units from posted p
      cross join lateral jsonb_to_recordset(p.items) as i(product_id uuid,quantity numeric)
      left join lateral (select sum(quantity) as quantity from public.partial_returns
        where sale_id=p.id and product_id=i.product_id) r on true
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
      sum(total) as revenue_uzs, case when commerce_private.can_access(p_business,'profit') then sum(total-cost) end as gross_profit_uzs
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
