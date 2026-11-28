alter table commerce_private.platform_admins add column role text not null default 'ADMIN'
  check(role in ('ADMIN','SUPER_ADMIN'));
alter table commerce_private.platform_settings add column telegram_handle text not null default 'uzPixelForge'
  check(telegram_handle ~ '^[A-Za-z0-9_]{5,32}$');
alter table commerce_private.platform_audit add column detail jsonb;

-- Keep the provider adapters dormant. Only a future explicit migration can restore these grants.
revoke execute on function public.capture_payment(text,text,text,bigint,text),
  commerce_private.capture_payment(text,text,text,bigint,text),
  public.open_billing_order(uuid,text,integer,text,text),
  commerce_private.open_billing_order(uuid,text,integer,text,text),
  public.open_promo_order(uuid,text,integer,text,text,text),
  commerce_private.open_promo_order(uuid,text,integer,text,text,text) from service_role;
create table commerce_private.subscription_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  request_key uuid not null,
  plan text not null references public.plan_catalog(id) check(plan<>'FREE'),
  months integer not null check(months in (1,12)),
  amount_uzs bigint not null check(amount_uzs>0),
  status text not null default 'PENDING' check(status in
    ('PENDING','CONTACTED','AWAITING_PAYMENT','PAYMENT_VERIFIED','ACTIVATED','REJECTED','CANCELLED')),
  payment_ref text unique,
  created_at timestamptz not null default now(),
  unique(business_id,request_key)
);
alter table commerce_private.subscription_requests enable row level security;
create index subscription_requests_recent on commerce_private.subscription_requests(created_at desc,id);

create function commerce_private.manage_manual_subscription(p_business uuid,p_action text default 'list',
  p_id uuid default null,p_plan text default null,p_months integer default null,p_detail text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_admin boolean;
  v_owner boolean;
  v_handle text;
  v_request commerce_private.subscription_requests;
  v_amount bigint;
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
    select case when p_months=1 then monthly_uzs else annual_uzs end into v_amount
      from public.plan_catalog where id=p_plan and id<>'FREE';
    if not found then raise exception 'invalid plan'; end if;
    insert into commerce_private.subscription_requests(business_id,request_key,plan,months,amount_uzs)
      values(p_business,p_id,p_plan,p_months,v_amount) on conflict(business_id,request_key) do nothing;
    select * into v_request from commerce_private.subscription_requests where business_id=p_business and request_key=p_id;
    if (v_request.plan,v_request.months) is distinct from (p_plan,p_months) then raise exception 'request mismatch'; end if;
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
create function public.manage_manual_subscription(p_business uuid,p_action text default 'list',
  p_id uuid default null,p_plan text default null,p_months integer default null,p_detail text default null)
returns jsonb language sql set search_path='' as $$
  select commerce_private.manage_manual_subscription(p_business,p_action,p_id,p_plan,p_months,p_detail)
$$;
revoke all on function public.manage_manual_subscription(uuid,text,uuid,text,integer,text),
  commerce_private.manage_manual_subscription(uuid,text,uuid,text,integer,text) from public,anon;
grant execute on function public.manage_manual_subscription(uuid,text,uuid,text,integer,text),
  commerce_private.manage_manual_subscription(uuid,text,uuid,text,integer,text) to authenticated;
