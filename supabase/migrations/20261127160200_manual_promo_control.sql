alter table commerce_private.promos add column enabled boolean not null default true,
  add column plan text references public.plan_catalog(id) check(plan<>'FREE');
alter table commerce_private.subscription_requests
  add column promo_code text,
  add column promo_user uuid,
  add constraint subscription_request_promo_fk foreign key(promo_code,promo_user) references commerce_private.promo_claims(code,user_id),
  add constraint subscription_request_promo_unique unique(promo_code,promo_user);

create or replace function commerce_private.redeem_promo(p_business uuid,p_code text)
returns integer language plpgsql security definer set search_path='' as $$
declare v_code text:=upper(trim(p_code)); v_discount integer;
begin
  if auth.uid() is null or not exists (select 1 from public.businesses where id=p_business and owner_id=auth.uid())
    then raise exception 'permission denied' using errcode='42501'; end if;
  update commerce_private.promos set use_count=use_count+1 where code=v_code and enabled and expires_at>now() and use_count<3
    returning discount_percent into v_discount;
  if not found then raise exception 'promo unavailable'; end if;
  insert into commerce_private.promo_claims(code,user_id,business_id) values(v_code,auth.uid(),p_business)
    on conflict do nothing;
  if not found then raise exception 'promo already used'; end if;
  return v_discount;
end
$$;
create or replace function commerce_private.manage_manual_subscription(p_business uuid,p_action text default 'list',
  p_id uuid default null,p_plan text default null,p_months integer default null,p_detail text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_admin boolean;
  v_owner boolean;
  v_handle text;
  v_request commerce_private.subscription_requests;
  v_amount bigint;
  v_code text;
  v_promo commerce_private.promos;
  v_claim commerce_private.promo_claims;
begin
  v_admin := coalesce(auth.jwt()->>'aal'='aal2',false) and exists (
    select 1 from commerce_private.platform_admins a join auth.users u on u.id=a.user_id
    where a.user_id=auth.uid() and a.role='SUPER_ADMIN' and u.email_confirmed_at is not null);
  v_owner := p_business is not null and exists (
    select 1 from public.businesses where id=p_business and owner_id=auth.uid());
  if not (v_admin or v_owner) then
    raise exception 'permission denied' using errcode='42501';
  end if;
  if p_action='create' and v_owner then
    if p_id is null or p_months is null or p_months not in (1,12) then raise exception 'invalid request'; end if;
    v_code := nullif(upper(trim(p_detail)),'');
    perform pg_advisory_xact_lock(hashtextextended(p_business::text||p_id::text,15));
    select * into v_request from commerce_private.subscription_requests where business_id=p_business and request_key=p_id;
    if found then
      if (v_request.plan,v_request.months,v_request.promo_code) is distinct from (p_plan,p_months,v_code) then
        raise exception 'request mismatch';
      end if;
    else
      select case when p_months=1 then monthly_uzs else annual_uzs end into v_amount
        from public.plan_catalog where id=p_plan and id<>'FREE';
      if not found then raise exception 'invalid plan'; end if;
      if v_code is not null then
        select * into v_promo from commerce_private.promos where code=v_code and enabled and expires_at>now() for update;
        if not found or (v_promo.plan is not null and v_promo.plan<>p_plan) or v_promo.discount_percent>=100 then
          raise exception 'promo unavailable for this request';
        end if;
        select * into v_claim from commerce_private.promo_claims where code=v_code and user_id=auth.uid();
        if found then
          if v_claim.business_id<>p_business or exists(select 1 from commerce_private.billing_orders where promo_code=v_code and promo_user=auth.uid()) then
            raise exception 'promo already used';
          end if;
        else
          perform commerce_private.redeem_promo(p_business,v_code);
        end if;
        v_amount:=v_amount - v_amount*v_promo.discount_percent/100;
      end if;
      insert into commerce_private.subscription_requests(business_id,request_key,plan,months,amount_uzs,promo_code,promo_user)
        values(p_business,p_id,p_plan,p_months,v_amount,v_code,case when v_code is not null then auth.uid() end)
        returning * into v_request;
    end if;
  elsif p_action='telegram' and v_admin and p_business is null then
    if p_detail is null or p_detail !~ '^[A-Za-z0-9_]{5,32}$' then raise exception 'invalid Telegram handle'; end if;
    update commerce_private.platform_settings set telegram_handle=p_detail;
    insert into commerce_private.platform_audit(actor,action,detail)
      values(auth.uid(),'subscription.telegram',jsonb_build_object('handle',p_detail));
  elsif p_action<>'list' then
    select * into v_request from commerce_private.subscription_requests
      where id=p_id and ((v_owner and business_id=p_business) or (v_admin and p_business is null)) for update;
    if not found then raise exception 'request unavailable' using errcode='42501'; end if;
    if (p_action='CANCELLED' and v_owner and v_request.status in ('PENDING','CONTACTED','AWAITING_PAYMENT'))
      or (v_admin and p_business is null and (
        (v_request.status,p_action) in (('PENDING','CONTACTED'),('CONTACTED','AWAITING_PAYMENT'),
          ('AWAITING_PAYMENT','PAYMENT_VERIFIED'),('PAYMENT_VERIFIED','ACTIVATED'))
        or (p_action='REJECTED' and v_request.status in ('PENDING','CONTACTED','AWAITING_PAYMENT')))) then
      if p_action='PAYMENT_VERIFIED' and (p_detail is null or length(trim(p_detail)) not between 4 and 120) then
        raise exception 'payment reference required';
      end if;
      if p_action='ACTIVATED' then
        update public.subscriptions set
          paid_until=(case when plan=v_request.plan then greatest(paid_until,now()) else now() end)
            +make_interval(months=>v_request.months),
          plan=v_request.plan where business_id=v_request.business_id;
        if not found then raise exception 'subscription missing'; end if;
      end if;
      update commerce_private.subscription_requests set status=p_action,
        payment_ref=case when p_action='PAYMENT_VERIFIED' then lower(trim(p_detail)) else payment_ref end
        where id=v_request.id;
      insert into public.audit_log(business_id,actor_id,action,detail)
        values(v_request.business_id,auth.uid(),'subscription.manual',jsonb_build_object('request',v_request.id,'status',p_action));
      if v_admin and p_business is null then
        insert into commerce_private.platform_audit(actor,action,detail)
          values(auth.uid(),'subscription.manual',jsonb_build_object('request',v_request.id,'status',p_action));
      end if;
    elsif v_request.status<>p_action or (p_action='PAYMENT_VERIFIED' and v_request.payment_ref is distinct from lower(trim(p_detail))) then
      raise exception 'invalid transition';
    end if;
  end if;
  select telegram_handle into v_handle from commerce_private.platform_settings;
  return jsonb_build_object('handle',v_handle,'created',v_request.id,'rows',coalesce((
    select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id) from (
      select id,business_id,plan,months,amount_uzs,status,created_at
      from commerce_private.subscription_requests
      where (v_owner and business_id=p_business) or (v_admin and p_business is null)
      order by created_at desc,id limit 50
    ) r),'[]'));
end
$$;

create function commerce_private.control_promos(p_action text,p_code text,p_plan text,p_discount integer,p_expires timestamptz,p_offset integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_code text:=upper(trim(p_code));
begin
  if not commerce_private.is_super_admin() then raise exception 'permission denied' using errcode='42501'; end if;
  if p_offset is null or p_offset not between 0 and 50000 then raise exception 'invalid offset'; end if;
  case p_action
    when 'list' then null;
    when 'issue' then
      if p_plan is null or p_plan='FREE' or p_discount is null or p_discount not between 1 and 99 then raise exception 'invalid promo'; end if;
      perform commerce_private.issue_promo(v_code,p_discount,p_expires);
      update commerce_private.promos set plan=p_plan where code=v_code;
    when 'enable','disable' then
      update commerce_private.promos set enabled=(p_action='enable') where code=v_code;
      if not found then raise exception 'promo unavailable'; end if;
    else raise exception 'invalid action';
  end case;
  if p_action<>'list' then
    insert into commerce_private.platform_audit(actor,action,detail) values(auth.uid(),'promo.'||p_action,jsonb_build_object('code',v_code));
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(r) order by month desc,slot desc),'[]') from (
    select p.code,p.discount_percent,p.month,p.slot,p.use_count,p.expires_at,p.plan,p.enabled,
      (select coalesce(jsonb_agg(jsonb_build_object('business',c.business_id,'request',r.id)), '[]')
        from commerce_private.promo_claims c left join commerce_private.subscription_requests r
          on r.promo_code=c.code and r.promo_user=c.user_id where c.code=p.code) uses
    from commerce_private.promos p order by month desc,slot desc limit 26 offset p_offset
  ) r);
end
$$;
create function public.control_promos(p_action text default 'list',p_code text default null,p_plan text default null,
  p_discount integer default null,p_expires timestamptz default null,p_offset integer default 0)
returns jsonb language sql security invoker set search_path=''
return commerce_private.control_promos(p_action,p_code,p_plan,p_discount,p_expires,p_offset);
revoke all on function public.control_promos(text,text,text,integer,timestamptz,integer),
  commerce_private.control_promos(text,text,text,integer,timestamptz,integer) from public,anon;
grant execute on function public.control_promos(text,text,text,integer,timestamptz,integer),
  commerce_private.control_promos(text,text,text,integer,timestamptz,integer) to authenticated;
