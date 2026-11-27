create table commerce_private.ai_pending_prices (
  id uuid primary key references public.ai_history(id) on delete cascade,
  business_id uuid not null references public.businesses(id),
  user_id uuid not null references auth.users(id),
  product_id uuid not null references public.products(id),
  product_name text not null,
  old_price bigint not null,
  new_price bigint not null check(new_price between 0 and 1000000000000),
  status text not null default 'pending' check(status in ('pending','applied','cancelled')),
  expires_at timestamptz not null default(now()+interval '15 minutes')
);
alter table commerce_private.ai_pending_prices enable row level security;
revoke all on commerce_private.ai_pending_prices from public,anon,authenticated;

create function public.propose_ai_price(p_turn uuid,p_name text,p_price bigint)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_turn public.ai_history; v_product public.products;
begin
  if p_price is null or p_price not between 0 and 1000000000000
    or p_name is null or char_length(trim(p_name)) not between 1 and 200 then return false; end if;
  select * into v_turn from public.ai_history where id=p_turn and conversation_id is not null;
  if not found then return false; end if;
  begin
    select * into strict v_product from public.products where business_id=v_turn.business_id and name=trim(p_name);
  exception when no_data_found or too_many_rows then return false;
  end;
  if v_product.price=p_price then return false; end if;
  insert into commerce_private.ai_pending_prices(id,business_id,user_id,product_id,product_name,old_price,new_price)
    values(p_turn,v_turn.business_id,v_turn.user_id,v_product.id,v_product.name,v_product.price,p_price) on conflict(id) do nothing;
  return found;
end
$$;

create function public.ai_price_action(p_business uuid,p_turn uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_action commerce_private.ai_pending_prices;
begin
  if not commerce_private.in_store(p_business,null) or not commerce_private.can_access(p_business,'ai')
    or not commerce_private.can_access(p_business,'catalog') or not commerce_private.has_feature(p_business,'ai') then
    raise exception 'permission denied' using errcode='42501';
  end if;
  select * into v_action from commerce_private.ai_pending_prices
    where id=p_turn and business_id=p_business and user_id=auth.uid() for update;
  if not found then return null; end if;
  if p_action='confirm' and v_action.status='pending' then
    if v_action.expires_at<=clock_timestamp() then raise exception 'proposal expired'; end if;
    update public.products set price=v_action.new_price
      where id=v_action.product_id and business_id=p_business and price=v_action.old_price and name=v_action.product_name;
    if not found then raise exception 'product changed'; end if;
    update commerce_private.ai_pending_prices set status='applied' where id=p_turn returning * into v_action;
    insert into public.audit_log(business_id,actor_id,action,detail) values(p_business,auth.uid(),'ai.price.confirm',
      jsonb_build_object('proposal',p_turn,'product',v_action.product_id,'old_price',v_action.old_price,'new_price',v_action.new_price));
  elsif p_action='cancel' and v_action.status='pending' then
    update commerce_private.ai_pending_prices set status='cancelled' where id=p_turn returning * into v_action;
    insert into public.audit_log(business_id,actor_id,action,detail) values(p_business,auth.uid(),'ai.price.cancel',jsonb_build_object('proposal',p_turn));
  elsif not coalesce(p_action='get' or (p_action='confirm' and v_action.status='applied')
    or (p_action='cancel' and v_action.status='cancelled'),false) then raise exception 'proposal unavailable'; end if;
  return jsonb_build_object('id',v_action.id,'name',v_action.product_name,'old_price',v_action.old_price,
    'new_price',v_action.new_price,'status',case when v_action.status='pending' and v_action.expires_at<=clock_timestamp()
      then 'expired' else v_action.status end);
end
$$;
revoke all on function public.propose_ai_price(uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.propose_ai_price(uuid,text,bigint) to service_role;
revoke all on function public.ai_price_action(uuid,uuid,text) from public,anon;
grant execute on function public.ai_price_action(uuid,uuid,text) to authenticated;
