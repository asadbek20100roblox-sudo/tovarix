insert into commerce_private.entitlements(plan,feature) values('FREE','debts') on conflict do nothing;
insert into commerce_private.entitlements(plan,feature)
  select id,'smart_qarz' from public.plan_catalog where id in ('STANDARD','PLUS','PRO','PREMIUM') on conflict do nothing;
alter table commerce_private.customer_debts add column original_due_on date, add column cancelled_at timestamptz, add column sale_id uuid unique references public.sales(id);
alter table commerce_private.debt_entries add column payment_method text check(payment_method in ('cash','card','transfer'));
update commerce_private.customer_debts set original_due_on=due_on;
alter table commerce_private.customer_debts alter column original_due_on set not null;
create or replace function commerce_private.write_debt(
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
      if entry.kind<>'opening' or account.customer_id<>p_customer or account.original_due_on<>p_due then raise exception 'request mismatch'; end if;
    end if;
    return entry.debt_id;
  end if;
  if p_debt is null then
    if not commerce_private.has_feature(p_business,'debts') then raise exception 'plan feature unavailable'; end if;
    if not exists(select 1 from public.contacts c where c.id=p_customer and c.business_id=p_business and (c.kind='customer' or commerce_private.can_access(p_business,'supplier'))) then
      raise exception 'customer unavailable';
    end if;
    insert into commerce_private.customer_debts(business_id,customer_id,due_on,original_due_on) values(p_business,p_customer,p_due,p_due) returning id into id_new;
  else
    select id into id_new from commerce_private.customer_debts where business_id=p_business and id=p_debt and cancelled_at is null and exists (select 1 from public.contacts c where c.id=customer_id and (c.kind='customer' or commerce_private.can_access(p_business,'supplier'))) for update;
    if not found then raise exception 'debt unavailable'; end if;
    select sum(case when kind='opening' then amount else -amount end) into balance
      from commerce_private.debt_entries where business_id=p_business and debt_id=p_debt;
    if balance is null or p_amount>balance then raise exception 'repayment exceeds balance'; end if;
  end if;
  insert into commerce_private.debt_entries(business_id,debt_id,request_id,actor_id,kind,amount,note,created_at) values(p_business,id_new,p_request,auth.uid(),
    case when p_debt is null then 'opening' else 'repayment' end,p_amount,note,now());
  insert into public.audit_log(business_id,actor_id,action,detail) values(p_business,auth.uid(),
    case when p_debt is null then 'debt.open' else 'debt.repay' end,jsonb_build_object('debt',id_new,'request',p_request));
  return id_new;
end
$$;

create or replace function commerce_private.debt_history(p_business uuid,p_debt uuid,p_offset integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not commerce_private.debt_allowed(p_business) then raise exception 'permission denied' using errcode='42501'; end if;
  if not exists(select 1 from commerce_private.customer_debts d join public.contacts c on c.id=d.customer_id where d.id=p_debt and d.business_id=p_business and (c.kind='customer' or commerce_private.can_access(p_business,'supplier'))) then raise exception 'permission denied' using errcode='42501'; end if;
  if p_offset is null or p_offset not between 0 and 100000 then raise exception 'invalid page'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(h) order by created_at desc,request_id),'[]'::jsonb) from (
    select * from (
      select kind,amount,note,created_at,request_id::text,payment_method from commerce_private.debt_entries
      where business_id=p_business and debt_id=p_debt
      union all
      select case when action='debt.cancel' then 'cancelled' else 'rescheduled' end,null,
        case when action='debt.cancel' then detail->>'reason' else (detail->>'previous_due')||' → '||(detail->>'new_due') end,
        created_at,'audit:'||id,null from public.audit_log
      where business_id=p_business and action in ('debt.cancel','debt.reschedule') and detail->>'debt'=p_debt::text
    ) events order by created_at desc,request_id limit 21 offset p_offset
  ) h);
end
$$;

create function commerce_private.debt_book(p_business uuid,p_kind text,p_search text,p_status text,p_sort text,p_offset int,
 p_from date,p_until date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; today date := (now() at time zone 'Asia/Tashkent')::date;
  term text:=lower(left(trim(coalesce(p_search,'')),100));
begin
  if not commerce_private.debt_allowed(p_business) or (p_kind='supplier' and not commerce_private.can_access(p_business,'supplier')) then
    raise exception 'permission denied' using errcode='42501'; end if;
  if p_kind is null or p_kind not in ('customer','supplier') or p_status is null or p_status not in ('all','overdue','today','active','paid','partial','cancelled')
    or p_sort is null or p_offset is null or p_sort not in ('due','balance','newest') or p_offset not between 0 and 100000
    or p_from is null or p_until is null or p_until-p_from not between 0 and 366 then raise exception 'invalid filters'; end if;
  with records as (
    select d.id,d.due_on,d.created_at,d.cancelled_at,d.sale_id,c.id contact_id,c.name,c.phone,
      sum(e.amount) filter(where e.kind='opening') opened,
      coalesce(sum(e.amount) filter(where e.kind='repayment'),0) repaid,
      coalesce(sum(e.amount) filter(where e.kind='repayment' and
        e.created_at>=p_from::timestamp at time zone 'Asia/Tashkent' and e.created_at<(p_until+1)::timestamp at time zone 'Asia/Tashkent'),0) period_repaid
    from commerce_private.customer_debts d join public.contacts c on c.id=d.customer_id and c.business_id=d.business_id
    join commerce_private.debt_entries e on e.business_id=d.business_id and e.debt_id=d.id
    where d.business_id=p_business and c.kind=p_kind group by d.id,c.id
  ), balances as materialized (
    select *, (case when cancelled_at is null then opened-repaid else 0 end)::bigint balance, due_on-today days from records
  ), page as (
    select id,due_on,created_at,cancelled_at,sale_id,name,phone,opened,repaid,balance,days,row_number() over (
      order by case when p_sort='balance' then balance end desc,case when p_sort='newest' then created_at end desc,
        due_on,id) as seq
    from balances where (term='' or strpos(lower(name),term)>0 or strpos(lower(coalesce(phone,'')),term)>0)
     and (p_status='all' or (p_status='cancelled' and cancelled_at is not null) or (p_status='paid' and balance=0 and cancelled_at is null) or (balance>0 and
       (p_status='active' or (p_status='overdue' and days<0) or (p_status='today' and days=0) or (p_status='partial' and repaid>0))))
    order by seq limit 21 offset p_offset
  )
  select jsonb_build_object('total',coalesce(sum(balance),0)::text,'count',count(distinct contact_id) filter(where balance>0),
    'overdue',coalesce(sum(balance) filter(where days<0),0)::text,'due_today',coalesce(sum(balance) filter(where days=0),0)::text,
    'repaid',coalesce(sum(period_repaid),0)::text,'smart',commerce_private.has_feature(p_business,'smart_qarz'),
    'rows',coalesce((select jsonb_agg(to_jsonb(page)-'seq' order by seq) from page),'[]')) into result from balances;
  return result;
end
$$;
create or replace function commerce_private.debt_overview(p_business uuid,p_search text,p_status text,p_offset integer)
returns jsonb language sql stable security definer set search_path=''
return commerce_private.debt_book(p_business,'customer',p_search,p_status,'due',p_offset,
 (now() at time zone 'Asia/Tashkent')::date-29,(now() at time zone 'Asia/Tashkent')::date);

create function public.debt_book(p_business uuid,p_kind text,p_search text,p_status text,p_sort text,p_offset int,
 p_from date,p_until date)
returns jsonb language sql stable security invoker set search_path=''
return commerce_private.debt_book(p_business,p_kind,p_search,p_status,p_sort,p_offset,p_from,p_until);
revoke all on function public.debt_book(uuid,text,text,text,text,int,date,date),
 commerce_private.debt_book(uuid,text,text,text,text,int,date,date) from public,anon;
grant execute on function public.debt_book(uuid,text,text,text,text,int,date,date),
 commerce_private.debt_book(uuid,text,text,text,text,int,date,date) to authenticated;

create function commerce_private.reschedule_debt(p_business uuid,p_debt uuid,p_previous date,p_due date)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not commerce_private.debt_allowed(p_business) then raise exception 'permission denied' using errcode='42501'; end if;
  if p_due is null or not isfinite(p_due) or p_previous is null then raise exception 'invalid due date'; end if;
  update commerce_private.customer_debts d set due_on=p_due where d.business_id=p_business and d.id=p_debt and d.due_on=p_previous
    and exists(select 1 from public.contacts c where c.id=d.customer_id and (c.kind='customer' or commerce_private.can_access(p_business,'supplier')));
  if not found then raise exception 'debt unavailable or changed'; end if;
  if p_due<>p_previous then
    insert into public.audit_log(business_id,actor_id,action,detail) values(p_business,auth.uid(),'debt.reschedule',
      jsonb_build_object('debt',p_debt,'previous_due',p_previous,'new_due',p_due));
  end if;
end
$$;
create function public.reschedule_debt(p_business uuid,p_debt uuid,p_previous date,p_due date)
returns void language sql security invoker set search_path=''
return commerce_private.reschedule_debt(p_business,p_debt,p_previous,p_due);
revoke all on function public.reschedule_debt(uuid,uuid,date,date),commerce_private.reschedule_debt(uuid,uuid,date,date) from public,anon;
grant execute on function public.reschedule_debt(uuid,uuid,date,date),commerce_private.reschedule_debt(uuid,uuid,date,date) to authenticated;

-- Basic debt accounting can add a counterparty without granting the purchase module.
create function commerce_private.create_debt_supplier(p_business uuid,p_name text)
returns uuid language plpgsql security definer set search_path='' as $$
declare supplier uuid;
begin
  if not commerce_private.debt_allowed(p_business) or not commerce_private.can_access(p_business,'supplier') then
    raise exception 'permission denied' using errcode='42501'; end if;
  if coalesce(length(trim(p_name)),0) not between 1 and 120 then raise exception 'invalid supplier name'; end if;
  insert into public.contacts(business_id,kind,name) values(p_business,'supplier',trim(p_name)) returning id into supplier;
  return supplier;
end
$$;
create function public.create_debt_supplier(p_business uuid,p_name text)
returns uuid language sql security invoker set search_path=''
return commerce_private.create_debt_supplier(p_business,p_name);
revoke all on function public.create_debt_supplier(uuid,text),commerce_private.create_debt_supplier(uuid,text) from public,anon;
grant execute on function public.create_debt_supplier(uuid,text),commerce_private.create_debt_supplier(uuid,text) to authenticated;

create function commerce_private.record_debt_payment(p_business uuid,p_request uuid,p_debt uuid,p_amount bigint,p_note text,p_method text)
returns uuid language plpgsql security definer set search_path='' as $$
declare account uuid; prev text;
begin
  if p_method is null or p_method not in ('cash','card','transfer') or p_debt is null then raise exception 'invalid payment method'; end if;
  account:=commerce_private.write_debt(p_business,p_request,p_amount,p_note,null,null,p_debt);
  select payment_method into prev from commerce_private.debt_entries where business_id=p_business and request_id=p_request for update;
  if prev is not null and prev<>p_method then raise exception 'request mismatch'; end if;
  if prev is null then
    update commerce_private.debt_entries set payment_method=p_method where business_id=p_business and request_id=p_request;
  end if;
  return account;
end
$$;
create function public.record_debt_payment(p_business uuid,p_request uuid,p_debt uuid,p_amount bigint,p_note text,p_method text)
returns uuid language sql security invoker set search_path=''
return commerce_private.record_debt_payment(p_business,p_request,p_debt,p_amount,p_note,p_method);
revoke all on function public.record_debt_payment(uuid,uuid,uuid,bigint,text,text),
 commerce_private.record_debt_payment(uuid,uuid,uuid,bigint,text,text) from public,anon;
grant execute on function public.record_debt_payment(uuid,uuid,uuid,bigint,text,text),
 commerce_private.record_debt_payment(uuid,uuid,uuid,bigint,text,text) to authenticated;
