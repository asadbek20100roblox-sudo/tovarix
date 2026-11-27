alter table commerce_private.billing_orders
  add column promo_code text,
  add column promo_user uuid,
  add column grant_applied_at timestamptz,
  add foreign key(promo_code,promo_user) references commerce_private.promo_claims(code,user_id) match full;
create index billing_orders_claim on commerce_private.billing_orders(promo_code,promo_user)
  where promo_code is not null;

create function commerce_private.open_promo_order(p_business uuid,p_plan text,p_months integer,p_provider text,p_order text,p_code text)
returns bigint language plpgsql security definer set search_path='' as $$
declare
  v_amount bigint;
  v_code text:=upper(trim(p_code));
  v_owner uuid;
  v_discount integer;
  v_expiry timestamptz;
begin
  if p_months is null or p_months not in (1,12) then raise exception 'invalid billing cycle'; end if;
  select owner_id into v_owner from public.businesses where id=p_business;
  select p.discount_percent,p.expires_at into v_discount,v_expiry
    from commerce_private.promo_claims c join commerce_private.promos p using(code)
    where c.code=v_code and c.user_id=v_owner and c.business_id=p_business and p.expires_at>now()
    for update of c;
  if not found then raise exception 'promo claim unavailable'; end if;
  if exists(select 1 from commerce_private.billing_orders where promo_code=v_code and promo_user=v_owner
    and (paid_at is not null or grant_applied_at is not null or expires_at>now())) then
    raise exception 'promo claim already assigned';
  end if;
  select case p_months when 1 then monthly_uzs else annual_uzs end into v_amount
    from public.plan_catalog where id=p_plan and id<>'FREE';
  if not found then raise exception 'invalid plan'; end if;
  v_amount := v_amount - (v_amount*v_discount / 100);
  insert into commerce_private.billing_orders(business_id,plan,months,amount_uzs,provider,provider_order,expires_at,
    promo_code,promo_user,grant_applied_at)
    values(p_business,p_plan,p_months,v_amount,p_provider,p_order,least(v_expiry,now()+interval '1 hour'),
      v_code,v_owner,case when v_amount=0 then now() end);
  if v_amount=0 then
    update public.subscriptions set
      paid_until=case when plan=p_plan then greatest(paid_until,now()) else now() end+make_interval(months=>p_months),
      plan=p_plan where business_id=p_business;
    if not found then raise exception 'subscription missing'; end if;
    insert into public.audit_log(business_id,actor_id,action,detail)
      values(p_business,v_owner,'promo.grant',jsonb_build_object('code',v_code,'plan',p_plan,'months',p_months));
  end if;
  return v_amount;
end
$$;
create function public.open_promo_order(p_business uuid,p_plan text,p_months integer,p_provider text,p_order text,p_code text)
returns bigint language sql set search_path='' as $$
  select commerce_private.open_promo_order(p_business,p_plan,p_months,p_provider,p_order,p_code)
$$;
revoke execute on function commerce_private.open_promo_order(uuid,text,integer,text,text,text),
  public.open_promo_order(uuid,text,integer,text,text,text) from public,anon,authenticated;
grant execute on function commerce_private.open_promo_order(uuid,text,integer,text,text,text),
  public.open_promo_order(uuid,text,integer,text,text,text) to service_role;
