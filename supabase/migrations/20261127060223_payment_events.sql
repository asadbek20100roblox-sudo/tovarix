create table commerce_private.billing_orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  plan text not null references public.plan_catalog(id) check(plan<>'FREE'),
  months integer not null check(months in (1,12)),
  amount_uzs bigint not null check(amount_uzs>=0),
  provider text not null check(provider ~ '^[a-z0-9_-]{2,32}$'),
  provider_order text not null check(char_length(provider_order) between 1 and 128),
  expires_at timestamptz not null,
  paid_at timestamptz,
  unique(provider,provider_order)
);
create table commerce_private.billing_events (
  provider text not null,
  event_id text not null,
  order_id uuid not null unique references commerce_private.billing_orders(id),
  amount_uzs bigint not null,
  captured_at timestamptz not null default now(),
  primary key(provider,event_id)
);
alter table commerce_private.billing_orders enable row level security;
alter table commerce_private.billing_events enable row level security;

create function commerce_private.open_billing_order(p_business uuid,p_plan text,p_months integer,p_provider text,p_order text)
returns bigint language plpgsql security definer set search_path='' as $$
declare v_amount bigint;
begin
  if p_months is null or p_months not in (1,12) then raise exception 'invalid billing cycle'; end if;
  select case p_months when 1 then monthly_uzs else annual_uzs end into v_amount
    from public.plan_catalog where id=p_plan and id<>'FREE';
  if not found then raise exception 'invalid plan'; end if;
  insert into commerce_private.billing_orders(business_id,plan,months,amount_uzs,provider,provider_order,expires_at)
    values(p_business,p_plan,p_months,v_amount,p_provider,p_order,now()+interval '1 hour');
  return v_amount;
end
$$;
create function public.open_billing_order(p_business uuid,p_plan text,p_months integer,p_provider text,p_order text)
returns bigint language sql set search_path='' as $$
  select commerce_private.open_billing_order(p_business,p_plan,p_months,p_provider,p_order)
$$;

create function commerce_private.capture_payment(p_provider text,p_event text,p_order text,p_amount bigint,p_currency text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_order commerce_private.billing_orders; v_event commerce_private.billing_events;
begin
  if p_currency is distinct from 'UZS' or p_amount is null or p_amount<=0 or p_event is null
    or char_length(p_event) not between 1 and 128 then raise exception 'invalid payment'; end if;
  perform pg_advisory_xact_lock(hashtextextended(coalesce(p_provider,'') || ':' || p_event,3));
  select * into v_order from commerce_private.billing_orders where provider=p_provider and provider_order=p_order for update;
  if not found or v_order.amount_uzs<>p_amount then raise exception 'payment order mismatch'; end if;
  select * into v_event from commerce_private.billing_events where provider=p_provider and event_id=p_event;
  if found then
    if v_event.order_id<>v_order.id or v_event.amount_uzs<>p_amount then raise exception 'event replay mismatch'; end if;
    return false;
  end if;
  if v_order.paid_at is not null or v_order.expires_at<=now() then raise exception 'order already paid or expired'; end if;
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
create function public.capture_payment(p_provider text,p_event text,p_order text,p_amount bigint,p_currency text)
returns boolean language sql set search_path='' as $$
  select commerce_private.capture_payment(p_provider,p_event,p_order,p_amount,p_currency)
$$;

revoke execute on function commerce_private.open_billing_order(uuid,text,integer,text,text),
  public.open_billing_order(uuid,text,integer,text,text),
  commerce_private.capture_payment(text,text,text,bigint,text),public.capture_payment(text,text,text,bigint,text)
  from public,anon,authenticated;
grant execute on function commerce_private.open_billing_order(uuid,text,integer,text,text),
  public.open_billing_order(uuid,text,integer,text,text),
  commerce_private.capture_payment(text,text,text,bigint,text),public.capture_payment(text,text,text,bigint,text)
  to service_role;
