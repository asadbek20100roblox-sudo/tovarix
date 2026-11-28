create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  kind text not null check (kind in ('customer','supplier')),
  name text not null check (char_length(trim(name)) between 1 and 200),
  phone text check (char_length(phone)<=50)
);
create index contacts_business on public.contacts(business_id,kind);
alter table public.contacts enable row level security;
revoke all on public.contacts from public,anon,authenticated;
grant select,insert on public.contacts to authenticated;
create policy contacts_read on public.contacts for select to authenticated
  using (commerce_private.can_access(business_id,kind));
create policy contacts_insert on public.contacts for insert to authenticated
  with check (commerce_private.can_access(business_id,kind));

create function commerce_private.transfer_stock(p_business uuid,p_from uuid,p_to uuid,p_product uuid,p_quantity numeric)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not commerce_private.can_access(p_business,'inventory') then raise exception 'permission denied' using errcode='42501'; end if;
  if p_from is null or p_to is null or p_from=p_to or p_product is null or p_quantity is null or p_quantity<=0 then
    raise exception 'invalid transfer';
  end if;
  -- Both directions acquire the same pair lock. Order endpoint writes by store.
  perform pg_advisory_xact_lock(hashtextextended(p_business::text || p_product::text || least(p_from,p_to)::text || greatest(p_from,p_to)::text,1));
  if p_from<p_to then
    perform commerce_private.adjust_stock(p_business,p_from,p_product,-p_quantity,'Transfer to ' || p_to);
    perform commerce_private.adjust_stock(p_business,p_to,p_product,p_quantity,'Transfer from ' || p_from);
  else
    perform commerce_private.adjust_stock(p_business,p_to,p_product,p_quantity,'Transfer from ' || p_from);
    perform commerce_private.adjust_stock(p_business,p_from,p_product,-p_quantity,'Transfer to ' || p_to);
  end if;
end
$$;
create function public.transfer_stock(p_business uuid,p_from uuid,p_to uuid,p_product uuid,p_quantity numeric)
returns void language sql set search_path='' as $$
  select commerce_private.transfer_stock(p_business,p_from,p_to,p_product,p_quantity)
$$;
revoke execute on function commerce_private.transfer_stock(uuid,uuid,uuid,uuid,numeric),
  public.transfer_stock(uuid,uuid,uuid,uuid,numeric) from public,anon;
grant execute on function commerce_private.transfer_stock(uuid,uuid,uuid,uuid,numeric),
  public.transfer_stock(uuid,uuid,uuid,uuid,numeric) to authenticated;
