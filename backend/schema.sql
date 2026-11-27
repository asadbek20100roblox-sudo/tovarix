-- Draft schema for a dedicated TOVARIX database. Review and test before deployment.
create table public.businesses(id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), name text not null);
create table public.members(business_id uuid references public.businesses on delete cascade,user_id uuid references auth.users(id),role text not null check(role in ('cashier','manager','warehouse')),primary key(business_id,user_id));
create table public.products(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.businesses on delete cascade,name text not null,barcode text not null,price bigint not null check(price>=0),unique(business_id,barcode));
create table public.stores(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.businesses on delete cascade,name text not null,unique(business_id,id));
create table public.stock(business_id uuid not null references public.businesses,store_id uuid not null,product_id uuid not null references public.products,quantity numeric not null check(quantity>=0),primary key(store_id,product_id),foreign key(business_id,store_id) references public.stores(business_id,id));
alter table public.businesses enable row level security;
alter table public.members enable row level security;
alter table public.products enable row level security;
alter table public.stores enable row level security;
alter table public.stock enable row level security;
create policy owner_business on public.businesses for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy owner_members on public.members for all to authenticated using(exists(select 1 from public.businesses b where b.id=business_id and b.owner_id=auth.uid())) with check(exists(select 1 from public.businesses b where b.id=business_id and b.owner_id=auth.uid()));
create policy owner_products on public.products for all to authenticated using(exists(select 1 from public.businesses b where b.id=business_id and b.owner_id=auth.uid())) with check(exists(select 1 from public.businesses b where b.id=business_id and b.owner_id=auth.uid()));
create policy owner_stores on public.stores for all to authenticated using(exists(select 1 from public.businesses b where b.id=business_id and b.owner_id=auth.uid())) with check(exists(select 1 from public.businesses b where b.id=business_id and b.owner_id=auth.uid()));
-- Stock is intentionally inaccessible until transactional inventory RPC and tenant-safe product foreign keys are implemented.
revoke all on public.stock from anon,authenticated;
