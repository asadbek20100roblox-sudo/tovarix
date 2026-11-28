insert into commerce_private.entitlements(plan,feature)
select id,'debts' from public.plan_catalog where id<>'FREE' on conflict do nothing;

create table commerce_private.customer_debts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  customer_id uuid not null references public.contacts(id),
  due_on date not null,
  created_at timestamptz not null default now(),
  unique(business_id,id)
);
create index customer_debts_business on commerce_private.customer_debts(business_id,due_on,id);
create table commerce_private.debt_entries (
  business_id uuid not null,
  debt_id uuid not null,
  request_id uuid not null,
  actor_id uuid not null references auth.users(id),
  kind text not null check(kind in ('opening','repayment')),
  amount bigint not null check(amount between 1 and 1000000000000),
  note text not null check(char_length(note)<=300),
  created_at timestamptz not null default now(),
  primary key(business_id,request_id),
  foreign key(business_id,debt_id) references commerce_private.customer_debts(business_id,id)
);
create index debt_entry_account on commerce_private.debt_entries(business_id,debt_id,created_at);
create unique index debt_single_opening on commerce_private.debt_entries(business_id,debt_id) where kind='opening';
alter table commerce_private.customer_debts enable row level security;
alter table commerce_private.debt_entries enable row level security;
revoke all on commerce_private.customer_debts,commerce_private.debt_entries from public,anon,authenticated;

create function commerce_private.debt_allowed(p_business uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select commerce_private.can_access(p_business,'customer') and commerce_private.in_store(p_business,null)
$$;

create function commerce_private.write_debt(
  p_business uuid,p_request uuid,p_amount bigint,p_note text,
  p_customer uuid,p_due date,p_debt uuid
)
returns uuid language plpgsql security definer set search_path='' as $$
declare entry commerce_private.debt_entries; account commerce_private.customer_debts; balance bigint; note text:=trim(coalesce(p_note,'')); id_new uuid;
begin
  if not commerce_private.debt_allowed(p_business) then raise exception 'permission denied' using errcode='42501'; end if;
  if p_request is null or p_amount is null or p_amount not between 1 and 1000000000000 or char_length(note)>300
    or (p_debt is null and (p_customer is null or p_due is null or not isfinite(p_due)))
    or (p_debt is not null and (p_customer is not null or p_due is not null)) then raise exception 'invalid debt operation'; end if;
  perform pg_advisory_xact_lock(hashtextextended('debt:'||p_business||':'||p_request,0));
  select * into entry from commerce_private.debt_entries where business_id=p_business and request_id=p_request;
  if found then
    if entry.actor_id<>auth.uid() or entry.amount<>p_amount or entry.note<>note then raise exception 'request mismatch'; end if;
    if p_debt is not null then
      if entry.kind<>'repayment' or entry.debt_id<>p_debt then raise exception 'request mismatch'; end if;
    else
      select * into account from commerce_private.customer_debts where business_id=p_business and id=entry.debt_id;
      if entry.kind<>'opening' or account.customer_id<>p_customer or account.due_on<>p_due then raise exception 'request mismatch'; end if;
    end if;
    return entry.debt_id;
  end if;
  if p_debt is null then
    if not commerce_private.has_feature(p_business,'debts') then raise exception 'plan feature unavailable'; end if;
    if not exists(select 1 from public.contacts where id=p_customer and business_id=p_business and kind='customer') then
      raise exception 'customer unavailable';
    end if;
    insert into commerce_private.customer_debts(business_id,customer_id,due_on) values(p_business,p_customer,p_due) returning id into id_new;
  else
    select id into id_new from commerce_private.customer_debts where business_id=p_business and id=p_debt for update;
    if not found then raise exception 'debt unavailable'; end if;
    select sum(case when kind='opening' then amount else -amount end) into balance
      from commerce_private.debt_entries where business_id=p_business and debt_id=p_debt;
    if balance is null or p_amount>balance then raise exception 'repayment exceeds balance'; end if;
  end if;
  insert into commerce_private.debt_entries values(p_business,id_new,p_request,auth.uid(),
    case when p_debt is null then 'opening' else 'repayment' end,p_amount,note,now());
  insert into public.audit_log(business_id,actor_id,action,detail) values(p_business,auth.uid(),
    case when p_debt is null then 'debt.open' else 'debt.repay' end,jsonb_build_object('debt',id_new,'request',p_request));
  return id_new;
end
$$;

create function commerce_private.debt_overview(p_business uuid,p_search text,p_status text,p_offset integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare response jsonb; today date:=(now() at time zone 'Asia/Tashkent')::date;
begin
  if not commerce_private.debt_allowed(p_business) then raise exception 'permission denied' using errcode='42501'; end if;
  if p_offset is null or p_offset not between 0 and 100000 or p_status is null
    or p_status not in ('all','overdue','today','active','paid') then raise exception 'invalid filter'; end if;
  with records as materialized (
    select d.id,d.due_on,d.customer_id,c.name,c.phone,
      sum(case when e.kind='opening' then e.amount else -e.amount end)::bigint as balance
    from commerce_private.customer_debts d join public.contacts c on c.id=d.customer_id and c.business_id=d.business_id
      join commerce_private.debt_entries e on e.business_id=d.business_id and e.debt_id=d.id
    where d.business_id=p_business group by d.id,c.id
  ), filtered as (
    select r.*,r.due_on-today as days from records r
    where strpos(lower(r.name),lower(left(trim(coalesce(p_search,'')),100)))>0 or trim(coalesce(p_search,''))=''
  ), page as (
    select * from filtered where p_status='all' or (p_status='paid' and balance=0)
      or (balance>0 and (p_status='active' or (p_status='overdue' and days<0) or (p_status='today' and days=0)))
    order by (balance=0),due_on,id limit 21 offset p_offset
  )
  select jsonb_build_object('total',(select coalesce(sum(balance),0)::text from records),
    'count',(select count(distinct customer_id) from records where balance>0),
    'rows',coalesce((select jsonb_agg(to_jsonb(page) order by (balance=0),due_on,id) from page),'[]'::jsonb)) into response;
  return response;
end
$$;

create function commerce_private.debt_history(p_business uuid,p_debt uuid,p_offset integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not commerce_private.debt_allowed(p_business) then raise exception 'permission denied' using errcode='42501'; end if;
  if p_offset is null or p_offset not between 0 and 100000 then raise exception 'invalid page'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(h) order by created_at desc,request_id),'[]'::jsonb) from (
    select kind,amount,note,created_at,request_id from commerce_private.debt_entries
    where business_id=p_business and debt_id=p_debt order by created_at desc,request_id limit 21 offset p_offset
  ) h);
end
$$;

create function public.write_debt(p_business uuid,p_request uuid,p_amount bigint,p_note text,p_customer uuid,p_due date,p_debt uuid)
returns uuid language sql set search_path='' as $$ select commerce_private.write_debt(p_business,p_request,p_amount,p_note,p_customer,p_due,p_debt) $$;
create function public.debt_overview(p_business uuid,p_search text,p_status text,p_offset integer)
returns jsonb language sql stable set search_path='' as $$ select commerce_private.debt_overview(p_business,p_search,p_status,p_offset) $$;
create function public.debt_history(p_business uuid,p_debt uuid,p_offset integer)
returns jsonb language sql stable set search_path='' as $$ select commerce_private.debt_history(p_business,p_debt,p_offset) $$;
revoke all on function commerce_private.debt_allowed(uuid),
  commerce_private.write_debt(uuid,uuid,bigint,text,uuid,date,uuid),public.write_debt(uuid,uuid,bigint,text,uuid,date,uuid),
  commerce_private.debt_overview(uuid,text,text,integer),public.debt_overview(uuid,text,text,integer),
  commerce_private.debt_history(uuid,uuid,integer),public.debt_history(uuid,uuid,integer) from public,anon;
grant execute on function commerce_private.write_debt(uuid,uuid,bigint,text,uuid,date,uuid),public.write_debt(uuid,uuid,bigint,text,uuid,date,uuid),
  commerce_private.debt_overview(uuid,text,text,integer),public.debt_overview(uuid,text,text,integer),
  commerce_private.debt_history(uuid,uuid,integer),public.debt_history(uuid,uuid,integer) to authenticated;
