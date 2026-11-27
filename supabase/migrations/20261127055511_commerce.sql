create table public.businesses(id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), name text not null);
create table public.members(business_id uuid references public.businesses on delete cascade,user_id uuid references auth.users(id),role text not null check(role in ('cashier','manager','warehouse')),primary key(business_id,user_id));
create table public.products(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.businesses on delete cascade,name text not null,barcode text not null,price bigint not null check(price>=0),unique(business_id,barcode));
create table public.stores(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.businesses on delete cascade,name text not null,unique(business_id,id));
create table public.stock(business_id uuid not null references public.businesses,store_id uuid not null,product_id uuid not null references public.products,quantity numeric not null check(quantity>=0),primary key(store_id,product_id),foreign key(business_id,store_id) references public.stores(business_id,id));
alter table public.products
  add unique (business_id,id),
  add column cost bigint not null default 0 check (cost between 0 and 1000000000000),
  add column attributes jsonb not null default '{}' check (jsonb_typeof(attributes) = 'object'),
  add constraint valid_product check (char_length(trim(name)) between 1 and 200
    and char_length(trim(barcode)) between 1 and 128 and price <= 1000000000000);
alter table public.stock alter column quantity type numeric(15,3),
  add foreign key (business_id,product_id) references public.products(business_id,id);
alter table public.members add column permissions text[] not null default '{}';
alter table public.businesses add constraint valid_business_name check (char_length(trim(name)) between 1 and 200);
alter table public.stores add constraint valid_store_name check (char_length(trim(name)) between 1 and 200);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  store_id uuid not null,
  operator_id uuid not null references auth.users(id),
  request_id uuid not null,
  payload jsonb not null,
  items jsonb not null,
  total bigint not null,
  cost bigint not null,
  cash bigint not null,
  card bigint not null,
  created_at timestamptz not null default now(),
  unique (business_id,operator_id,request_id),
  foreign key (business_id,store_id) references public.stores(business_id,id)
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id),
  actor_id uuid not null references auth.users(id),
  action text not null,
  detail jsonb not null,
  created_at timestamptz not null default now()
);
create index sales_store_date on public.sales (business_id,store_id,created_at desc);
create index members_user on public.members(user_id,business_id);

create schema if not exists commerce_private;
revoke all on schema commerce_private from public;
grant usage on schema commerce_private to authenticated;

create function commerce_private.can_access(p_business uuid, p_permission text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null and (
    exists (select 1 from public.businesses where id=p_business and owner_id=(select auth.uid()))
    or exists (select 1 from public.members where business_id=p_business and user_id=(select auth.uid())
      and (p_permission='read' or p_permission=any(permissions)))
  )
$$;
revoke all on function commerce_private.can_access(uuid,text) from public;
grant execute on function commerce_private.can_access(uuid,text) to authenticated;

alter table public.businesses enable row level security;
alter table public.members enable row level security;
alter table public.products enable row level security;
alter table public.stores enable row level security;
alter table public.stock enable row level security;
alter table public.sales enable row level security;
alter table public.audit_log enable row level security;

revoke all on public.businesses,public.members,public.products,public.stores,
  public.stock,public.sales,public.audit_log from public,anon,authenticated;
grant select on public.businesses,public.members,public.products,public.stores,
  public.stock,public.sales,public.audit_log to authenticated;
grant insert on public.products,public.stores to authenticated;
grant update (name,barcode,price,cost,attributes) on public.products to authenticated;

create policy business_read on public.businesses for select to authenticated using (commerce_private.can_access(id,'read'));
create policy member_read on public.members for select to authenticated
  using (user_id=(select auth.uid()) or commerce_private.can_access(business_id,'staff'));
create policy product_read on public.products for select to authenticated using (commerce_private.can_access(business_id,'read'));
create policy product_insert on public.products for insert to authenticated with check (commerce_private.can_access(business_id,'catalog'));
create policy product_update on public.products for update to authenticated
  using (commerce_private.can_access(business_id,'catalog')) with check (commerce_private.can_access(business_id,'catalog'));
create policy store_read on public.stores for select to authenticated using (commerce_private.can_access(business_id,'read'));
create policy store_insert on public.stores for insert to authenticated with check (commerce_private.can_access(business_id,'stores'));
create policy stock_read on public.stock for select to authenticated using (commerce_private.can_access(business_id,'read'));
create policy sales_read on public.sales for select to authenticated
  using (commerce_private.can_access(business_id,'analytics') or
    (operator_id=(select auth.uid()) and commerce_private.can_access(business_id,'sell')));
create policy audit_read on public.audit_log for select to authenticated using (commerce_private.can_access(business_id,'audit'));

create function commerce_private.open_business(p_name text,p_store text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_business uuid;
begin
  if auth.uid() is null then raise exception 'permission denied' using errcode='42501'; end if;
  insert into public.businesses(owner_id,name) values (auth.uid(), trim(p_name)) returning id into v_business;
  insert into public.stores(business_id,name) values (v_business, trim(p_store));
  return v_business;
end
$$;

create function commerce_private.adjust_stock(p_business uuid,p_store uuid,p_product uuid,p_delta numeric,p_reason text)
returns numeric language plpgsql security definer set search_path = ''
as $$
declare v_quantity numeric;
begin
  if not commerce_private.can_access(p_business,'inventory') then raise exception 'permission denied' using errcode='42501'; end if;
  if p_delta is null or p_delta=0 or abs(p_delta)>1000000000 or p_delta<>round(p_delta,3)
     or p_reason is null or char_length(trim(p_reason)) not between 1 and 500 then
    raise exception 'invalid stock adjustment';
  end if;
  insert into public.stock(business_id,store_id,product_id,quantity)
    values(p_business,p_store,p_product,0) on conflict (store_id,product_id) do nothing;
  update public.stock set quantity=quantity+p_delta
    where business_id=p_business and store_id=p_store and product_id=p_product
      and quantity+p_delta>=0 returning quantity into v_quantity;
  if not found then raise exception 'insufficient stock'; end if;
  insert into public.audit_log(business_id,actor_id,action,detail) values
    (p_business,auth.uid(),'stock.adjust',jsonb_build_object('store',p_store,'product',p_product,'delta',p_delta,'reason',trim(p_reason)));
  return v_quantity;
end
$$;

create function commerce_private.checkout(p_business uuid,p_store uuid,p_request uuid,p_lines jsonb,
  p_cash bigint,p_card bigint,p_discount bigint,p_expected bigint)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_payload jsonb;
  v_existing public.sales;
  v_items jsonb := '[]';
  v_line record;
  v_product public.products;
  v_subtotal bigint := 0;
  v_cost bigint := 0;
  v_sale uuid;
begin
  if not commerce_private.can_access(p_business,'sell') then raise exception 'permission denied' using errcode='42501'; end if;
  if p_request is null or p_store is null or p_cash is null or p_card is null or p_discount is null
    or p_expected is null or least(p_cash,p_card,p_discount,p_expected)<0
    or greatest(p_cash,p_card,p_discount,p_expected)>9007199254740991
    or jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'invalid sale'; end if;
  if jsonb_array_length(p_lines) not between 1 and 100 then raise exception 'invalid cart size'; end if;
  v_payload := jsonb_build_array(p_store,p_lines,p_cash,p_card,p_discount,p_expected);
  perform pg_advisory_xact_lock(hashtextextended(p_business::text || auth.uid()::text || p_request::text,0));
  select * into v_existing from public.sales where business_id=p_business and operator_id=auth.uid() and request_id=p_request;
  if found then
    if v_existing.payload <> v_payload then raise exception 'different payload for request'; end if;
    return v_existing.id;
  end if;
  if p_discount>0 and not commerce_private.can_access(p_business,'discount') then
    raise exception 'discount permission denied' using errcode='42501';
  end if;
  if (select count(distinct product_id) from jsonb_to_recordset(p_lines) as t(product_id uuid)) <> jsonb_array_length(p_lines)
    then raise exception 'duplicate or missing product'; end if;
  for v_line in select * from jsonb_to_recordset(p_lines) as t(product_id uuid,quantity numeric) order by product_id loop
    if v_line.quantity is null or v_line.quantity not between 1 and 1000000
      or v_line.quantity<>trunc(v_line.quantity) then raise exception 'invalid quantity'; end if;
    select * into v_product from public.products where business_id=p_business and id=v_line.product_id for share;
    if not found then raise exception 'product unavailable'; end if;
    update public.stock set quantity=quantity-v_line.quantity
      where business_id=p_business and store_id=p_store and product_id=v_product.id and quantity>=v_line.quantity;
    if not found then raise exception 'insufficient stock'; end if;
    v_subtotal := v_subtotal+v_product.price::numeric*v_line.quantity;
    v_cost := v_cost+v_product.cost::numeric*v_line.quantity;
    v_items := v_items || jsonb_build_array(jsonb_build_object('product_id',v_product.id,
      'name',v_product.name,'quantity',v_line.quantity,'price',v_product.price));
  end loop;
  if v_subtotal-p_discount<>p_expected or p_cash+p_card<>p_expected then
    raise exception 'sale total or tender changed';
  end if;
  insert into public.sales(business_id,store_id,operator_id,request_id,payload,items,total,cost,cash,card)
    values(p_business,p_store,auth.uid(),p_request,v_payload,v_items,p_expected,v_cost,p_cash,p_card)
    returning id into v_sale;
  insert into public.audit_log(business_id,actor_id,action,detail)
    values(p_business,auth.uid(),'sale.checkout',jsonb_build_object('sale',v_sale));
  return v_sale;
end
$$;

create function public.open_business(p_name text,p_store text)
returns uuid language sql set search_path = '' as $$
  select commerce_private.open_business(p_name,p_store)
$$;
create function public.adjust_stock(p_business uuid,p_store uuid,p_product uuid,p_delta numeric,p_reason text)
returns numeric language sql set search_path = '' as $$
  select commerce_private.adjust_stock(p_business,p_store,p_product,p_delta,p_reason)
$$;
create function public.checkout(p_business uuid,p_store uuid,p_request uuid,p_lines jsonb,
  p_cash bigint,p_card bigint,p_discount bigint,p_expected bigint)
returns uuid language sql set search_path = '' as $$
  select commerce_private.checkout(p_business,p_store,p_request,p_lines,p_cash,p_card,p_discount,p_expected)
$$;
revoke execute on all functions in schema commerce_private from public,anon;
grant execute on all functions in schema commerce_private to authenticated;
revoke all on function public.open_business(text,text),public.adjust_stock(uuid,uuid,uuid,numeric,text),
  public.checkout(uuid,uuid,uuid,jsonb,bigint,bigint,bigint,bigint) from public,anon;
grant execute on function public.open_business(text,text),public.adjust_stock(uuid,uuid,uuid,numeric,text),
  public.checkout(uuid,uuid,uuid,jsonb,bigint,bigint,bigint,bigint) to authenticated;
