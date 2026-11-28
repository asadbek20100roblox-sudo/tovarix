alter table public.members add column store_scope uuid[];

create function commerce_private.in_store(p_business uuid,p_store uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.businesses where id=p_business and owner_id=auth.uid())
    or exists(select 1 from public.members where business_id=p_business and user_id=auth.uid()
      and (store_scope is null or p_store=any(store_scope)))
$$;
revoke all on function commerce_private.in_store(uuid,uuid) from public,anon;
grant execute on function commerce_private.in_store(uuid,uuid) to authenticated;

create function commerce_private.set_store_scope(p_business uuid,p_user uuid,p_stores uuid[])
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.businesses where id=p_business and owner_id=auth.uid()) then
    raise exception 'permission denied' using errcode='42501';
  end if;
  if cardinality(p_stores)>500 or exists(select 1 from unnest(p_stores) s(id)
    where not exists(select 1 from public.stores where business_id=p_business and id=s.id)) then
    raise exception 'invalid branch list';
  end if;
  update public.members set store_scope=p_stores where business_id=p_business and user_id=p_user;
  if not found then raise exception 'employee unavailable'; end if;
  insert into public.audit_log(business_id,actor_id,action,detail)
    values(p_business,auth.uid(),'staff.branch_scope',jsonb_build_object('user',p_user,'stores',p_stores));
end
$$;
create function public.set_store_scope(p_business uuid,p_user uuid,p_stores uuid[])
returns void language sql set search_path='' as $$
  select commerce_private.set_store_scope(p_business,p_user,p_stores)
$$;
revoke all on function commerce_private.set_store_scope(uuid,uuid,uuid[]),public.set_store_scope(uuid,uuid,uuid[]) from public,anon;
grant execute on function commerce_private.set_store_scope(uuid,uuid,uuid[]),public.set_store_scope(uuid,uuid,uuid[]) to authenticated;

create policy store_scope on public.stores as restrictive for select to authenticated using(commerce_private.in_store(business_id,id));
create policy stock_scope on public.stock as restrictive for select to authenticated using(commerce_private.in_store(business_id,store_id));
create policy sales_scope on public.sales as restrictive for select to authenticated using(commerce_private.in_store(business_id,store_id));
create policy shifts_scope on public.shifts as restrictive for select to authenticated using(commerce_private.in_store(business_id,store_id));
create policy purchases_scope on public.purchases as restrictive for select to authenticated using(commerce_private.in_store(business_id,store_id));
create policy return_scope on public.sale_returns as restrictive for select to authenticated
  using(exists(select 1 from public.sales where id=sale_id));
create policy audit_scope on public.audit_log as restrictive for select to authenticated
  using(commerce_private.in_store(business_id,null));

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
      'name',v_product.name,'quantity',v_line.quantity,'price',v_product.price));
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

create or replace function commerce_private.adjust_stock(p_business uuid,p_store uuid,p_product uuid,p_delta numeric,p_reason text)
returns numeric language plpgsql security definer set search_path = ''
as $$
declare v_quantity numeric;
begin
  if not commerce_private.in_store(p_business,p_store) then
    raise exception 'permission denied' using errcode='42501';
  end if;
  if not commerce_private.can_access(p_business,'inventory') then raise exception 'permission denied' using errcode='42501'; end if;
  if p_delta is null or p_delta=0 or abs(p_delta)>1000000000 or p_delta<>round(p_delta,3)
     or p_reason is null or char_length(trim(p_reason)) not between 1 and 500 then
    raise exception 'invalid stock adjustment';
  end if;
  insert into public.stock(business_id,store_id,product_id,quantity)
    values(p_business,p_store,p_product,0) on conflict (store_id,product_id) do nothing;
  update public.stock set quantity=quantity+p_delta
    where business_id=p_business and store_id=p_store and product_id=p_product
      and quantity+p_delta>=0 returning quantity into v_quantity;
  if not found then raise exception 'insufficient stock'; end if;
  insert into public.audit_log(business_id,actor_id,action,detail) values
    (p_business,auth.uid(),'stock.adjust',jsonb_build_object('store',p_store,'product',p_product,'delta',p_delta,'reason',trim(p_reason)));
  return v_quantity;
end
$$;

create or replace function commerce_private.change_shift(p_business uuid,p_store uuid,p_cash bigint,p_close boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_shift uuid;
begin
  if not commerce_private.in_store(p_business,p_store) then
    raise exception 'permission denied' using errcode='42501';
  end if;
  if not commerce_private.can_access(p_business,'sell') then raise exception 'permission denied' using errcode='42501'; end if;
  if p_cash is null or p_close is null then raise exception 'invalid shift'; end if;
  if p_close then
    update public.shifts set closing_cash=p_cash,closed_at=now()
      where business_id=p_business and store_id=p_store and operator_id=auth.uid() and closed_at is null returning id into v_shift;
    if not found then raise exception 'no open shift'; end if;
  else
    insert into public.shifts(business_id,store_id,operator_id,opening_cash)
      values(p_business,p_store,auth.uid(),p_cash) returning id into v_shift;
  end if;
  insert into public.audit_log(business_id,actor_id,action,detail)
    values(p_business,auth.uid(),case when p_close then 'shift.close' else 'shift.open' end,jsonb_build_object('shift',v_shift,'cash',p_cash));
  return v_shift;
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

create or replace function commerce_private.receive_purchase(p_business uuid,p_store uuid,p_product uuid,p_supplier uuid,
  p_quantity numeric,p_total bigint,p_reference text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_purchase uuid;
begin
  if not commerce_private.in_store(p_business,p_store) then
    raise exception 'permission denied' using errcode='42501';
  end if;
  if not commerce_private.can_access(p_business,'inventory') then raise exception 'permission denied' using errcode='42501'; end if;
  if p_quantity is null or p_quantity<=0 or p_quantity<>round(p_quantity,3) then raise exception 'invalid quantity'; end if;
  if p_supplier is not null and not exists(select 1 from public.contacts
      where id=p_supplier and business_id=p_business and kind='supplier') then raise exception 'supplier unavailable'; end if;
  insert into public.purchases(business_id,store_id,product_id,supplier_id,operator_id,quantity,total_uzs,reference)
    values(p_business,p_store,p_product,p_supplier,auth.uid(),p_quantity,p_total,trim(p_reference)) returning id into v_purchase;
  perform commerce_private.adjust_stock(p_business,p_store,p_product,p_quantity,'Purchase ' || v_purchase);
  return v_purchase;
end
$$;

create or replace function commerce_private.ai_context(p_business uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_summary jsonb; v_products jsonb; v_day date:=(now() at time zone 'Asia/Tashkent')::date;
begin
  if not commerce_private.in_store(p_business,null) then
    raise exception 'permission denied' using errcode='42501';
  end if;
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
