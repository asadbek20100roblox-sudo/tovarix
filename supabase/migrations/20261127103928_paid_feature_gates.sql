insert into commerce_private.entitlements(plan,feature)
select plan.id, feature.code from public.plan_catalog plan
cross join (values('expenses'),('suppliers'),('purchases')) feature(code)
where plan.id<>'FREE' on conflict do nothing;

create or replace function commerce_private.has_feature(p_business uuid,p_feature text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from commerce_private.entitlements
    where plan=commerce_private.effective_plan(p_business) and feature=p_feature)
$$;
-- Predicates also execute inside the supplier RLS policy.
grant execute on function commerce_private.has_feature(uuid,text) to authenticated;
create policy supplier_plan_write on public.contacts as restrictive for insert to authenticated
  with check (kind<>'supplier' or commerce_private.has_feature(business_id,'suppliers'));

alter table public.stores add column created_at timestamptz not null default now();
create index stores_entitlement_order on public.stores(business_id,created_at,id);
create function commerce_private.branch_enabled(p_business uuid,p_store uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from (
    select id from public.stores where business_id=p_business order by created_at,id
    limit (select coalesce(branch_limit,1000) from public.plan_catalog where id=commerce_private.effective_plan(p_business))
  ) enabled where id=p_store)
$$;
revoke all on function commerce_private.branch_enabled(uuid,uuid) from public,anon,authenticated;

create function public.workspace_features(p_business uuid)
returns jsonb language plpgsql stable set search_path='' as $$
begin
  if not commerce_private.can_access(p_business,'read') then raise exception 'permission denied' using errcode='42501'; end if;
  return jsonb_build_object('expenses',commerce_private.has_feature(p_business,'expenses'),
    'purchases',commerce_private.has_feature(p_business,'purchases'),
    'suppliers',commerce_private.has_feature(p_business,'suppliers'));
end
$$;
revoke all on function public.workspace_features(uuid) from public,anon;
grant execute on function public.workspace_features(uuid) to authenticated;

create or replace function commerce_private.record_expense(p_business uuid,p_store uuid,p_amount bigint,p_description text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if not exists(select 1 from public.businesses where id=p_business and owner_id=auth.uid()) then
    raise exception 'permission denied' using errcode='42501';
  end if;
  if not commerce_private.has_feature(p_business,'expenses') then raise exception 'plan feature unavailable'; end if;
  insert into public.expenses(business_id,store_id,author_id,amount,description)
    values(p_business,p_store,auth.uid(),p_amount,trim(p_description)) returning id into v_id;
  insert into public.audit_log(business_id,actor_id,action,detail)
    values(p_business,auth.uid(),'expense.record',jsonb_build_object('expense',v_id,'amount',p_amount,'store',p_store));
  return v_id;
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
  if not commerce_private.has_feature(p_business,'purchases') then raise exception 'plan feature unavailable'; end if;
  insert into public.purchases(business_id,store_id,product_id,supplier_id,operator_id,quantity,total_uzs,reference)
    values(p_business,p_store,p_product,p_supplier,auth.uid(),p_quantity,p_total,trim(p_reference)) returning id into v_purchase;
  perform commerce_private.adjust_stock(p_business,p_store,p_product,p_quantity,'Purchase ' || v_purchase);
  return v_purchase;
end
$$;

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
  if not commerce_private.branch_enabled(p_business,p_store) then raise exception 'branch unavailable on current plan'; end if;
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

create or replace function commerce_private.change_shift(p_business uuid,p_store uuid,p_cash bigint,p_close boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_shift uuid;
begin
  if not commerce_private.in_store(p_business,p_store) then
    raise exception 'permission denied' using errcode='42501';
  end if;
  if not commerce_private.can_access(p_business,'sell') then raise exception 'permission denied' using errcode='42501'; end if;
  if p_cash is null or p_close is null then raise exception 'invalid shift'; end if;
  if not p_close and not commerce_private.branch_enabled(p_business,p_store) then raise exception 'branch unavailable on current plan'; end if;
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
