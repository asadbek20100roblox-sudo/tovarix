alter table public.sales add column credit boolean not null default false;
grant select(credit) on public.sales to authenticated;
create or replace view public.sales_access with(security_invoker=true) as
  select id,business_id,store_id,operator_id,created_at,total,receipt_items as items,
    commerce_private.visible_sale_cost(id) as cost,credit from public.sales;

create function commerce_private.checkout_with_debt(p_business uuid,p_store uuid,p_request uuid,p_lines jsonb,
  p_cash bigint,p_card bigint,p_discount bigint,p_expected bigint,p_customer uuid,p_due date)
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
  v_debt uuid;
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
  if p_customer is not null then
    if not commerce_private.debt_allowed(p_business) or not exists(select 1 from public.contacts
      where id=p_customer and business_id=p_business and kind='customer') then raise exception 'permission denied' using errcode='42501'; end if;
    if p_due is null or not isfinite(p_due) or p_cash<>0 or p_card<>0 or p_expected not between 1 and 1000000000000 then
      raise exception 'invalid credit sale';
    end if;
  elsif p_due is not null then raise exception 'invalid credit sale'; end if;
  v_payload := jsonb_build_array(p_store,p_lines,p_cash,p_card,p_discount,p_expected);
  if p_customer is not null then v_payload:=v_payload||jsonb_build_array(p_customer,p_due); end if;
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
  if v_subtotal-p_discount<>p_expected or (p_customer is null and p_cash+p_card<>p_expected) then
    raise exception 'sale total or tender changed';
  end if;
  insert into public.sales(business_id,store_id,operator_id,request_id,payload,items,total,cost,cash,card,credit)
    values(p_business,p_store,auth.uid(),p_request,v_payload,v_items,p_expected,v_cost,p_cash,p_card,p_customer is not null)
    returning id into v_sale;
  if p_customer is not null then
    v_debt:=commerce_private.write_debt(p_business,v_sale,p_expected,'POS',p_customer,p_due,null);
    update commerce_private.customer_debts set sale_id=v_sale where id=v_debt and business_id=p_business;
  end if;
  insert into public.audit_log(business_id,actor_id,action,detail)
    values(p_business,auth.uid(),'sale.checkout',jsonb_build_object('sale',v_sale));
  return v_sale;
end
$$;

create or replace function commerce_private.checkout(p_business uuid,p_store uuid,p_request uuid,p_lines jsonb,
 p_cash bigint,p_card bigint,p_discount bigint,p_expected bigint)
returns uuid language sql security definer set search_path=''
return commerce_private.checkout_with_debt(p_business,p_store,p_request,p_lines,p_cash,p_card,p_discount,p_expected,null,null);
revoke all on function commerce_private.checkout_with_debt(uuid,uuid,uuid,jsonb,bigint,bigint,bigint,bigint,uuid,date)
 from public,anon,authenticated;

create function commerce_private.checkout_on_account(p_business uuid,p_store uuid,p_request uuid,p_lines jsonb,
 p_cash bigint,p_card bigint,p_discount bigint,p_expected bigint,p_customer uuid,p_due date)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  if p_customer is null then raise exception 'customer required'; end if;
  return commerce_private.checkout_with_debt(p_business,p_store,p_request,p_lines,p_cash,p_card,p_discount,p_expected,p_customer,p_due);
end
$$;
create function public.checkout_on_account(p_business uuid,p_store uuid,p_request uuid,p_lines jsonb,
 p_cash bigint,p_card bigint,p_discount bigint,p_expected bigint,p_customer uuid,p_due date)
returns uuid language sql security invoker set search_path=''
return commerce_private.checkout_on_account(p_business,p_store,p_request,p_lines,p_cash,p_card,p_discount,p_expected,p_customer,p_due);
revoke all on function public.checkout_on_account(uuid,uuid,uuid,jsonb,bigint,bigint,bigint,bigint,uuid,date),
 commerce_private.checkout_on_account(uuid,uuid,uuid,jsonb,bigint,bigint,bigint,bigint,uuid,date) from public,anon;
grant execute on function public.checkout_on_account(uuid,uuid,uuid,jsonb,bigint,bigint,bigint,bigint,uuid,date),
 commerce_private.checkout_on_account(uuid,uuid,uuid,jsonb,bigint,bigint,bigint,bigint,uuid,date) to authenticated;

-- Cash/card refund routines cannot reverse a receivable. Their previous writes roll back on this guard.
create function commerce_private.prevent_credit_sale_cash_refund()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from commerce_private.customer_debts where sale_id=new.sale_id) then
    raise exception 'credit sale requires a receivable reversal' using errcode='P0001';
  end if;
  return new;
end
$$;
revoke all on function commerce_private.prevent_credit_sale_cash_refund() from public,anon,authenticated;
create trigger credit_full_return_guard before insert on public.sale_returns for each row execute function commerce_private.prevent_credit_sale_cash_refund();
create trigger credit_partial_return_guard before insert on public.partial_returns for each row execute function commerce_private.prevent_credit_sale_cash_refund();

create function commerce_private.cancel_manual_debt(p_business uuid,p_debt uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare account commerce_private.customer_debts;
begin
  if not commerce_private.debt_allowed(p_business) then raise exception 'permission denied' using errcode='42501'; end if;
  if p_reason is null or length(trim(p_reason)) not between 4 and 300 then raise exception 'reason required'; end if;
  select d.* into account from commerce_private.customer_debts d join public.contacts c on c.id=d.customer_id
    where d.business_id=p_business and d.id=p_debt and (c.kind='customer' or commerce_private.can_access(p_business,'supplier')) for update of d;
  if not found then raise exception 'debt unavailable'; end if;
  if account.cancelled_at is not null then return; end if;
  if account.sale_id is not null or exists(select 1 from commerce_private.debt_entries
    where business_id=p_business and debt_id=p_debt and kind='repayment') then raise exception 'debt requires financial reversal'; end if;
  update commerce_private.customer_debts set cancelled_at=now() where business_id=p_business and id=p_debt;
  insert into public.audit_log(business_id,actor_id,action,detail) values(p_business,auth.uid(),'debt.cancel',
    jsonb_build_object('debt',p_debt,'reason',trim(p_reason)));
end
$$;
create function public.cancel_manual_debt(p_business uuid,p_debt uuid,p_reason text)
returns void language sql security invoker set search_path=''
return commerce_private.cancel_manual_debt(p_business,p_debt,p_reason);
revoke all on function public.cancel_manual_debt(uuid,uuid,text),commerce_private.cancel_manual_debt(uuid,uuid,text) from public,anon;
grant execute on function public.cancel_manual_debt(uuid,uuid,text),commerce_private.cancel_manual_debt(uuid,uuid,text) to authenticated;
