create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  store_id uuid not null,
  author_id uuid not null references auth.users(id),
  amount bigint not null check(amount between 1 and 9007199254740991),
  description text not null check(char_length(trim(description)) between 1 and 300),
  created_at timestamptz not null default now(),
  foreign key(business_id,store_id) references public.stores(business_id,id)
);
alter table public.expenses enable row level security;
revoke all on public.expenses from public,anon,authenticated;
grant select on public.expenses to authenticated;
create policy expense_read on public.expenses for select to authenticated
  using(commerce_private.in_store(business_id,store_id) and commerce_private.can_access(business_id,'analytics'));
create function commerce_private.record_expense(p_business uuid,p_store uuid,p_amount bigint,p_description text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if not exists(select 1 from public.businesses where id=p_business and owner_id=auth.uid()) then
    raise exception 'permission denied' using errcode='42501';
  end if;
  insert into public.expenses(business_id,store_id,author_id,amount,description)
    values(p_business,p_store,auth.uid(),p_amount,trim(p_description)) returning id into v_id;
  insert into public.audit_log(business_id,actor_id,action,detail)
    values(p_business,auth.uid(),'expense.record',jsonb_build_object('expense',v_id,'amount',p_amount,'store',p_store));
  return v_id;
end
$$;
create function public.record_expense(p_business uuid,p_store uuid,p_amount bigint,p_description text)
returns uuid language sql set search_path='' as $$
 select commerce_private.record_expense(p_business,p_store,p_amount,p_description)
$$;
revoke all on function commerce_private.record_expense(uuid,uuid,bigint,text),public.record_expense(uuid,uuid,bigint,text) from public,anon;
grant execute on function commerce_private.record_expense(uuid,uuid,bigint,text),public.record_expense(uuid,uuid,bigint,text) to authenticated;

alter table public.shifts add column expected_cash bigint;
alter table public.shifts add column cash_variance bigint generated always as (closing_cash-expected_cash) stored;
create index sales_by_shift on public.sales(shift_id);
create index returns_by_shift on public.sale_returns(shift_id);
create index partial_returns_by_shift on public.partial_returns(shift_id);
create function commerce_private.reconcile_shift()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  new.expected_cash:=old.opening_cash
    + coalesce((select sum(cash) from public.sales where shift_id=old.id),0)
    - coalesce((select sum(s.cash) from public.sale_returns r join public.sales s on s.id=r.sale_id where r.shift_id=old.id),0)
    - coalesce((select sum(cash) from public.partial_returns where shift_id=old.id),0);
  return new;
end
$$;
revoke all on function commerce_private.reconcile_shift() from public,anon,authenticated;
create trigger reconcile_shift before update of closed_at on public.shifts for each row
  when(old.closed_at is null and new.closed_at is not null) execute function commerce_private.reconcile_shift();
