alter table public.contacts add unique(business_id,id);
create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  store_id uuid not null,
  product_id uuid not null,
  supplier_id uuid,
  operator_id uuid not null references auth.users(id),
  quantity numeric(15,3) not null check(quantity>0),
  total_uzs bigint not null check(total_uzs between 0 and 9007199254740991),
  reference text not null check(char_length(reference) between 1 and 120),
  created_at timestamptz not null default now(),
  unique(business_id,store_id,product_id,reference),
  foreign key(business_id,store_id) references public.stores(business_id,id),
  foreign key(business_id,product_id) references public.products(business_id,id),
  foreign key(business_id,supplier_id) references public.contacts(business_id,id)
);
alter table public.purchases enable row level security;
revoke all on public.purchases from public,anon,authenticated;
grant select on public.purchases to authenticated;
create policy purchase_read on public.purchases for select to authenticated using(commerce_private.can_access(business_id,'inventory'));

create function commerce_private.receive_purchase(p_business uuid,p_store uuid,p_product uuid,p_supplier uuid,
  p_quantity numeric,p_total bigint,p_reference text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_purchase uuid;
begin
  if not commerce_private.can_access(p_business,'inventory') then raise exception 'permission denied' using errcode='42501'; end if;
  if p_quantity is null or p_quantity<=0 or p_quantity<>round(p_quantity,3) then raise exception 'invalid quantity'; end if;
  if p_supplier is not null and not exists(select 1 from public.contacts
      where id=p_supplier and business_id=p_business and kind='supplier') then raise exception 'supplier unavailable'; end if;
  insert into public.purchases(business_id,store_id,product_id,supplier_id,operator_id,quantity,total_uzs,reference)
    values(p_business,p_store,p_product,p_supplier,auth.uid(),p_quantity,p_total,trim(p_reference)) returning id into v_purchase;
  perform commerce_private.adjust_stock(p_business,p_store,p_product,p_quantity,'Purchase ' || v_purchase);
  return v_purchase;
end
$$;
create function public.receive_purchase(p_business uuid,p_store uuid,p_product uuid,p_supplier uuid,
  p_quantity numeric,p_total bigint,p_reference text)
returns uuid language sql set search_path='' as $$
  select commerce_private.receive_purchase(p_business,p_store,p_product,p_supplier,p_quantity,p_total,p_reference)
$$;
revoke execute on function commerce_private.receive_purchase(uuid,uuid,uuid,uuid,numeric,bigint,text),
  public.receive_purchase(uuid,uuid,uuid,uuid,numeric,bigint,text) from public,anon;
grant execute on function commerce_private.receive_purchase(uuid,uuid,uuid,uuid,numeric,bigint,text),
  public.receive_purchase(uuid,uuid,uuid,uuid,numeric,bigint,text) to authenticated;
