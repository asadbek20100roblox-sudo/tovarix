create function commerce_private.count_stock(p_business uuid,p_store uuid,p_product uuid,p_expected numeric,p_count numeric,p_reason text)
returns numeric language plpgsql security definer set search_path='' as $$
declare v_stock numeric;
begin
  if not commerce_private.can_access(p_business,'inventory') or not commerce_private.in_store(p_business,p_store) then
    raise exception 'permission denied' using errcode='42501';
  end if;
  if p_expected is null or p_count is null or p_count not between 0 and 1000000000
    or p_count<>round(p_count,3) or p_reason is null or char_length(trim(p_reason)) not between 1 and 400 then
    raise exception 'invalid stock count';
  end if;
  insert into public.stock(business_id,store_id,product_id,quantity)
    values(p_business,p_store,p_product,0) on conflict(store_id,product_id) do nothing;
  select quantity into v_stock from public.stock
    where business_id=p_business and store_id=p_store and product_id=p_product for update;
  if not found or v_stock<>p_expected then raise exception 'stock changed since count began'; end if;
  update public.stock set quantity=p_count where business_id=p_business and store_id=p_store and product_id=p_product;
  insert into public.audit_log(business_id,actor_id,action,detail) values
    (p_business,auth.uid(),'stock.count',jsonb_build_object('store',p_store,'product',p_product,
      'previous',v_stock,'count',p_count,'reason',trim(p_reason)));
  return p_count;
end
$$;
create function public.count_stock(p_business uuid,p_store uuid,p_product uuid,p_expected numeric,p_count numeric,p_reason text)
returns numeric language sql set search_path='' as $$
  select commerce_private.count_stock(p_business,p_store,p_product,p_expected,p_count,p_reason)
$$;
revoke all on function commerce_private.count_stock(uuid,uuid,uuid,numeric,numeric,text),
  public.count_stock(uuid,uuid,uuid,numeric,numeric,text) from public,anon;
grant execute on function commerce_private.count_stock(uuid,uuid,uuid,numeric,numeric,text),
  public.count_stock(uuid,uuid,uuid,numeric,numeric,text) to authenticated;
