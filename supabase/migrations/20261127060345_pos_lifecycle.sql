create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  store_id uuid not null,
  operator_id uuid not null references auth.users(id),
  opening_cash bigint not null check(opening_cash between 0 and 9007199254740991),
  closing_cash bigint check(closing_cash between 0 and 9007199254740991),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  foreign key(business_id,store_id) references public.stores(business_id,id)
);
create unique index one_open_shift on public.shifts(business_id,store_id,operator_id) where closed_at is null;
alter table public.sales add column shift_id uuid references public.shifts(id);

create table public.sale_returns (
  sale_id uuid primary key references public.sales(id),
  business_id uuid not null references public.businesses(id),
  operator_id uuid not null references auth.users(id),
  shift_id uuid not null references public.shifts(id),
  reason text not null,
  created_at timestamptz not null default now()
);

create table public.price_history (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id),
  product_id uuid not null references public.products(id),
  old_price bigint not null,
  new_price bigint not null,
  actor_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index price_history_product on public.price_history(business_id,product_id,created_at desc);

alter table public.shifts enable row level security;
alter table public.sale_returns enable row level security;
alter table public.price_history enable row level security;
revoke all on public.shifts,public.sale_returns,public.price_history from public,anon,authenticated;
grant select on public.shifts,public.sale_returns,public.price_history to authenticated;
create policy shift_read on public.shifts for select to authenticated using(
  commerce_private.can_access(business_id,'analytics') or
  (operator_id=(select auth.uid()) and commerce_private.can_access(business_id,'sell'))
);
create policy return_read on public.sale_returns for select to authenticated using(
  commerce_private.can_access(business_id,'analytics') or exists(select 1 from public.sales where id=sale_id)
);
create policy price_read on public.price_history for select to authenticated using(commerce_private.can_access(business_id,'catalog'));

create function commerce_private.record_price()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.price_history(business_id,product_id,old_price,new_price,actor_id)
    values(new.business_id,new.id,old.price,new.price,auth.uid());
  return new;
end
$$;
create trigger record_price after update of price on public.products for each row
  when (old.price is distinct from new.price) execute function commerce_private.record_price();

create function commerce_private.change_shift(p_business uuid,p_store uuid,p_cash bigint,p_close boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_shift uuid;
begin
  if not commerce_private.can_access(p_business,'sell') then raise exception 'permission denied' using errcode='42501'; end if;
  if p_cash is null or p_close is null then raise exception 'invalid shift'; end if;
  if p_close then
    update public.shifts set closing_cash=p_cash,closed_at=now()
      where business_id=p_business and store_id=p_store and operator_id=auth.uid() and closed_at is null returning id into v_shift;
    if not found then raise exception 'no open shift'; end if;
  else
    insert into public.shifts(business_id,store_id,operator_id,opening_cash)
      values(p_business,p_store,auth.uid(),p_cash) returning id into v_shift;
  end if;
  insert into public.audit_log(business_id,actor_id,action,detail)
    values(p_business,auth.uid(),case when p_close then 'shift.close' else 'shift.open' end,jsonb_build_object('shift',v_shift,'cash',p_cash));
  return v_shift;
end
$$;
create function public.change_shift(p_business uuid,p_store uuid,p_cash bigint,p_close boolean)
returns uuid language sql set search_path='' as $$
  select commerce_private.change_shift(p_business,p_store,p_cash,p_close)
$$;

create function commerce_private.attach_shift()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  select id into new.shift_id from public.shifts where business_id=new.business_id and store_id=new.store_id
    and operator_id=new.operator_id and closed_at is null for share;
  if not found then raise exception 'no open shift'; end if;
  return new;
end
$$;
create trigger attach_shift before insert on public.sales for each row execute function commerce_private.attach_shift();

create function commerce_private.return_sale(p_business uuid,p_sale uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare v_sale public.sales; v_shift uuid; v_line record;
begin
  if not commerce_private.can_access(p_business,'returns') then raise exception 'permission denied' using errcode='42501'; end if;
  if p_reason is null or char_length(trim(p_reason)) not between 1 and 500 then raise exception 'invalid return reason'; end if;
  select * into v_sale from public.sales where business_id=p_business and id=p_sale for update;
  if not found then raise exception 'sale unavailable'; end if;
  if exists(select 1 from public.sale_returns where sale_id=p_sale) then raise exception 'already returned'; end if;
  for v_line in select * from jsonb_to_recordset(v_sale.items) as t(product_id uuid,quantity numeric) order by product_id loop
    update public.stock set quantity=quantity+v_line.quantity
      where business_id=p_business and store_id=v_sale.store_id and product_id=v_line.product_id;
    if not found then raise exception 'stock record missing'; end if;
  end loop;
  select id into v_shift from public.shifts where business_id=p_business and store_id=v_sale.store_id
    and operator_id=auth.uid() and closed_at is null for share;
  if not found then raise exception 'no open shift'; end if;
  insert into public.sale_returns(sale_id,business_id,operator_id,shift_id,reason)
    values(p_sale,p_business,auth.uid(),v_shift,trim(p_reason));
  insert into public.audit_log(business_id,actor_id,action,detail)
    values(p_business,auth.uid(),'sale.return',jsonb_build_object('sale',p_sale,'reason',trim(p_reason)));
end
$$;
create function public.return_sale(p_business uuid,p_sale uuid,p_reason text)
returns void language sql set search_path='' as $$
  select commerce_private.return_sale(p_business,p_sale,p_reason)
$$;
revoke execute on function commerce_private.record_price(),commerce_private.attach_shift() from public,anon,authenticated;
revoke execute on function commerce_private.change_shift(uuid,uuid,bigint,boolean),public.change_shift(uuid,uuid,bigint,boolean),
  commerce_private.return_sale(uuid,uuid,text),public.return_sale(uuid,uuid,text) from public,anon;
grant execute on function commerce_private.change_shift(uuid,uuid,bigint,boolean),public.change_shift(uuid,uuid,bigint,boolean),
  commerce_private.return_sale(uuid,uuid,text),public.return_sale(uuid,uuid,text) to authenticated;
