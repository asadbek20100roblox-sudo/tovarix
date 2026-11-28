-- Amounts are booked in whole UZS. A return allocates discounts and tender cumulatively.
create table public.partial_returns (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id),
  business_id uuid not null references public.businesses(id),
  operator_id uuid not null references auth.users(id),
  request_id uuid not null,
  shift_id uuid not null references public.shifts(id),
  product_id uuid not null references public.products(id),
  quantity numeric(15,3) not null check(quantity>0),
  total bigint not null check(total>=0),
  cash bigint not null check(cash between 0 and total),
  cost bigint not null check(cost>=0),
  reason text not null,
  created_at timestamptz not null default now(),
  unique(sale_id,request_id)
);
create index partial_returns_sale on public.partial_returns(sale_id,product_id);
alter table public.partial_returns enable row level security;
revoke all on public.partial_returns from public,anon,authenticated;
grant select on public.partial_returns to authenticated;
create policy partial_return_read on public.partial_returns for select to authenticated
  using(exists(select 1 from public.sales s where s.id=sale_id));

create function commerce_private.partial_return(p_business uuid,p_sale uuid,p_request uuid,p_product uuid,p_quantity numeric,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_sale public.sales;
  v_old public.partial_returns;
  v_item record;
  v_shift uuid;
  v_id uuid;
  v_previous numeric;
  v_subtotal numeric;
  v_return_gross numeric;
  v_return_total bigint;
  v_return_cash bigint;
  v_cost bigint;
begin
  if not commerce_private.can_access(p_business,'returns') then raise exception 'permission denied' using errcode='42501'; end if;
  if p_request is null or p_quantity is null or p_quantity not between 0.001 and 1000000 or p_quantity<>round(p_quantity,3)
    or p_reason is null or char_length(trim(p_reason)) not between 1 and 500 then raise exception 'invalid partial return'; end if;
  select * into v_sale from public.sales where business_id=p_business and id=p_sale for update;
  if not found or not commerce_private.in_store(p_business,v_sale.store_id) then raise exception 'sale unavailable'; end if;
  select * into v_old from public.partial_returns where sale_id=p_sale and request_id=p_request;
  if found then
    if v_old.operator_id<>auth.uid() or v_old.product_id<>p_product or v_old.quantity<>p_quantity or v_old.reason<>trim(p_reason)
      then raise exception 'different return payload'; end if;
    return v_old.id;
  end if;
  if exists(select 1 from public.sale_returns where sale_id=p_sale) then raise exception 'already returned'; end if;
  select * into v_item from jsonb_to_recordset(v_sale.items) as i(product_id uuid,quantity numeric,price bigint,unit_cost bigint,weighted boolean)
    where product_id=p_product;
  if not found then raise exception 'product unavailable'; end if;
  if v_item.unit_cost is null then raise exception 'partial returns require a sale with item cost snapshots'; end if;
  if not v_item.weighted and p_quantity<>trunc(p_quantity) then raise exception 'invalid piece quantity'; end if;
  select coalesce(sum(quantity),0) into v_previous from public.partial_returns where sale_id=p_sale and product_id=p_product;
  if v_previous+p_quantity>v_item.quantity then raise exception 'return exceeds sold quantity'; end if;
  select sum(round(i.price*i.quantity)),sum(round(i.price*(coalesce(r.quantity,0)+case when i.product_id=p_product then p_quantity else 0 end)))
    into v_subtotal,v_return_gross from jsonb_to_recordset(v_sale.items) as i(product_id uuid,quantity numeric,price bigint)
    left join lateral (select sum(quantity) as quantity from public.partial_returns where sale_id=p_sale and product_id=i.product_id) r on true;
  select coalesce(round(v_sale.total*v_return_gross/nullif(v_subtotal,0)),0)-coalesce(sum(total),0)
    into v_return_total from public.partial_returns where sale_id=p_sale;
  -- Floor tender allocation against cumulative refund UZS to ensure each line's cash never exceeds its refund.
  select case when v_sale.total=0 then 0 else
    floor(v_sale.cash::numeric*(coalesce(sum(total),0)+v_return_total)/v_sale.total)-coalesce(sum(cash),0)
    end into v_return_cash from public.partial_returns where sale_id=p_sale;
  v_cost:=round(v_item.unit_cost*(v_previous+p_quantity))-round(v_item.unit_cost*v_previous);
  update public.stock set quantity=quantity+p_quantity
    where business_id=p_business and store_id=v_sale.store_id and product_id=p_product;
  if not found then raise exception 'stock record missing'; end if;
  select id into v_shift from public.shifts where business_id=p_business and store_id=v_sale.store_id
    and operator_id=auth.uid() and closed_at is null for share;
  if not found then raise exception 'no open shift'; end if;
  insert into public.partial_returns(sale_id,business_id,operator_id,request_id,shift_id,product_id,quantity,total,cash,cost,reason)
    values(p_sale,p_business,auth.uid(),p_request,v_shift,p_product,p_quantity,v_return_total,v_return_cash,v_cost,trim(p_reason))
    returning id into v_id;
  insert into public.audit_log(business_id,actor_id,action,detail)
    values(p_business,auth.uid(),'sale.partial_return',jsonb_build_object('sale',p_sale,'return',v_id));
  return v_id;
end
$$;
create function public.partial_return(p_business uuid,p_sale uuid,p_request uuid,p_product uuid,p_quantity numeric,p_reason text)
returns uuid language sql set search_path='' as $$
  select commerce_private.partial_return(p_business,p_sale,p_request,p_product,p_quantity,p_reason)
$$;
revoke all on function commerce_private.partial_return(uuid,uuid,uuid,uuid,numeric,text),
  public.partial_return(uuid,uuid,uuid,uuid,numeric,text) from public,anon;
grant execute on function commerce_private.partial_return(uuid,uuid,uuid,uuid,numeric,text),
  public.partial_return(uuid,uuid,uuid,uuid,numeric,text) to authenticated;

create or replace function commerce_private.checkout(p_business uuid,p_store uuid,p_request uuid,p_lines jsonb,
  p_cash bigint,p_card bigint,p_discount bigint,p_expected bigint)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_payload jsonb;
  v_existing public.sales;
  v_items jsonb := '[]';
  v_line record;
  v_product public.products;
  v_subtotal bigint := 0;
  v_cost bigint := 0;
  v_sale uuid;
begin
  if not commerce_private.in_store(p_business,p_store) then
    raise exception 'permission denied' using errcode='42501';
  end if;
  if not commerce_private.can_access(p_business,'sell') then raise exception 'permission denied' using errcode='42501'; end if;
  if p_request is null or p_store is null or p_cash is null or p_card is null or p_discount is null
    or p_expected is null or least(p_cash,p_card,p_discount,p_expected)<0
    or greatest(p_cash,p_card,p_discount,p_expected)>9007199254740991
    or jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'invalid sale'; end if;
  if jsonb_array_length(p_lines) not between 1 and 100 then raise exception 'invalid cart size'; end if;
  if exists (select 1 from jsonb_to_recordset(p_lines) as t(operator_id uuid)
    where operator_id is not null and operator_id<>auth.uid()) then
    raise exception 'incorrect sale operator' using errcode='42501';
  end if;
  v_payload := jsonb_build_array(p_store,p_lines,p_cash,p_card,p_discount,p_expected);
  perform pg_advisory_xact_lock(hashtextextended(p_business::text || auth.uid()::text || p_request::text,0));
  select * into v_existing from public.sales where business_id=p_business and operator_id=auth.uid() and request_id=p_request;
  if found then
    if v_existing.payload <> v_payload then raise exception 'different payload for request'; end if;
    return v_existing.id;
  end if;
  if p_discount>0 and not commerce_private.can_access(p_business,'discount') then
    raise exception 'discount permission denied' using errcode='42501';
  end if;
  if (select count(distinct product_id) from jsonb_to_recordset(p_lines) as t(product_id uuid)) <> jsonb_array_length(p_lines)
    then raise exception 'duplicate or missing product'; end if;
  for v_line in select * from jsonb_to_recordset(p_lines) as t(product_id uuid,quantity numeric,expected_price bigint,operator_id uuid) order by product_id loop
    if v_line.quantity is null or v_line.quantity not between 0.001 and 1000000
      or v_line.quantity<>round(v_line.quantity,3) then raise exception 'invalid quantity'; end if;
    select * into v_product from public.products where business_id=p_business and id=v_line.product_id for share;
    if not found then raise exception 'product unavailable'; end if;
    if v_line.quantity<>trunc(v_line.quantity) and lower(trim(coalesce(v_product.attributes->>'unit','')))<>'kg' then
      raise exception 'fractional quantity requires a weight product';
    end if;
    if v_line.expected_price is not null and v_line.expected_price<>v_product.price then
      raise exception 'product price changed';
    end if;
    update public.stock set quantity=quantity-v_line.quantity
      where business_id=p_business and store_id=p_store and product_id=v_product.id and quantity>=v_line.quantity;
    if not found then raise exception 'insufficient stock'; end if;
    v_subtotal := v_subtotal+round(v_product.price::numeric*v_line.quantity);
    v_cost := v_cost+round(v_product.cost::numeric*v_line.quantity);
    v_items := v_items || jsonb_build_array(jsonb_build_object('product_id',v_product.id,
      'name',v_product.name,'quantity',v_line.quantity,'price',v_product.price,'unit_cost',v_product.cost,'weighted',lower(trim(coalesce(v_product.attributes->>'unit','')))='kg'));
  end loop;
  if greatest(v_subtotal,v_cost)>9007199254740991 then raise exception 'sale amount too large'; end if;
  if v_subtotal-p_discount<>p_expected or p_cash+p_card<>p_expected then
    raise exception 'sale total or tender changed';
  end if;
  insert into public.sales(business_id,store_id,operator_id,request_id,payload,items,total,cost,cash,card)
    values(p_business,p_store,auth.uid(),p_request,v_payload,v_items,p_expected,v_cost,p_cash,p_card)
    returning id into v_sale;
  insert into public.audit_log(business_id,actor_id,action,detail)
    values(p_business,auth.uid(),'sale.checkout',jsonb_build_object('sale',v_sale));
  return v_sale;
end
$$;

create or replace function commerce_private.return_sale(p_business uuid,p_sale uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare v_sale public.sales; v_shift uuid; v_line record;
begin
  if not commerce_private.can_access(p_business,'returns') then raise exception 'permission denied' using errcode='42501'; end if;
  if p_reason is null or char_length(trim(p_reason)) not between 1 and 500 then raise exception 'invalid return reason'; end if;
  select * into v_sale from public.sales where business_id=p_business and id=p_sale for update;
  if not found then raise exception 'sale unavailable'; end if;
  if not commerce_private.in_store(p_business,v_sale.store_id) then
    raise exception 'permission denied' using errcode='42501';
  end if;
  if exists(select 1 from public.partial_returns where sale_id=p_sale) then raise exception 'use partial return for remaining items'; end if;
  if exists(select 1 from public.sale_returns where sale_id=p_sale) then raise exception 'already returned'; end if;
  for v_line in select * from jsonb_to_recordset(v_sale.items) as t(product_id uuid,quantity numeric) order by product_id loop
    update public.stock set quantity=quantity+v_line.quantity
      where business_id=p_business and store_id=v_sale.store_id and product_id=v_line.product_id;
    if not found then raise exception 'stock record missing'; end if;
  end loop;
  select id into v_shift from public.shifts where business_id=p_business and store_id=v_sale.store_id
    and operator_id=auth.uid() and closed_at is null for share;
  if not found then raise exception 'no open shift'; end if;
  insert into public.sale_returns(sale_id,business_id,operator_id,shift_id,reason)
    values(p_sale,p_business,auth.uid(),v_shift,trim(p_reason));
  insert into public.audit_log(business_id,actor_id,action,detail)
    values(p_business,auth.uid(),'sale.return',jsonb_build_object('sale',p_sale,'reason',trim(p_reason)));
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
    select s.id,s.store_id,s.operator_id,s.created_at,s.items,
      s.total-coalesce(r.total,0) as total,s.cost-coalesce(r.cost,0) as cost,
      s.cash-coalesce(r.cash,0) as cash,s.card-coalesce(r.card,0) as card
    from public.sales s left join lateral (select sum(total) as total,sum(cost) as cost,
      sum(cash) as cash,sum(total-cash) as card from public.partial_returns where sale_id=s.id) r on true
    where s.business_id=p_business
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
