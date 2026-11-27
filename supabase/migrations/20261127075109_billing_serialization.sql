create or replace function commerce_private.capture_payment(p_provider text,p_event text,p_order text,p_amount bigint,p_currency text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_order commerce_private.billing_orders; v_event commerce_private.billing_events;
begin
  if p_currency is distinct from 'UZS' or p_amount is null or p_amount<=0 or p_event is null
    or char_length(p_event) not between 1 and 128 then raise exception 'invalid payment'; end if;
  perform pg_advisory_xact_lock(hashtextextended(coalesce(p_provider,'') || ':' || p_event,3));
  select * into v_order from commerce_private.billing_orders where provider=p_provider and provider_order=p_order;
  if v_order.promo_code is not null then
    perform 1 from commerce_private.promo_claims where code=v_order.promo_code and user_id=v_order.promo_user for update;
  end if;
  select * into v_order from commerce_private.billing_orders where provider=p_provider and provider_order=p_order for update;
  if not found or v_order.amount_uzs<>p_amount then raise exception 'payment order mismatch'; end if;
  select * into v_event from commerce_private.billing_events where provider=p_provider and event_id=p_event;
  if found then
    if v_event.order_id<>v_order.id or v_event.amount_uzs<>p_amount then raise exception 'event replay mismatch'; end if;
    return false;
  end if;
  if v_order.paid_at is not null or v_order.expires_at<=clock_timestamp() then raise exception 'order already paid or expired'; end if;
  insert into commerce_private.billing_events(provider,event_id,order_id,amount_uzs)
    values(p_provider,p_event,v_order.id,p_amount);
  update commerce_private.billing_orders set paid_at=now() where id=v_order.id;
  update public.subscriptions set
    paid_until=case when plan=v_order.plan then greatest(paid_until,now()) else now() end+make_interval(months=>v_order.months),
    plan=v_order.plan where business_id=v_order.business_id;
  if not found then raise exception 'subscription missing'; end if;
  return true;
end
$$;
