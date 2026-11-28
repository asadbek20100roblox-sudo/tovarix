create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  given_name text not null check(char_length(given_name) between 1 and 80),
  family_name text not null check(char_length(family_name) between 1 and 80),
  middle_name text check(char_length(middle_name)<=80),
  contact_phone text not null check(contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  language text not null check(language in ('uz','ru','en')),
  terms_revision text not null,
  accepted_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from public,anon,authenticated;
grant select on public.profiles to authenticated;
create policy profile_read on public.profiles for select to authenticated using(user_id=(select auth.uid()));

alter table public.businesses
  add column business_type text not null default 'other'
    check(business_type in ('supermarket','grocery','electronics','apparel','wholesale','construction','auto','cosmetics','pharmacy','other')),
  add column business_address text check(char_length(business_address)<=250),
  add column currency text not null default 'UZS' check(currency='UZS'),
  add column default_unit text not null default 'piece' check(default_unit in ('piece','kg','l','m')),
  add column register_name text check(char_length(register_name)<=100);

create function commerce_private.complete_profile()
returns boolean language plpgsql security definer set search_path='' as $$
declare data jsonb; phone text;
begin
  select raw_user_meta_data into data from auth.users where id=auth.uid() and email_confirmed_at is not null;
  if not found then return false; end if;
  if data->>'terms_revision' is distinct from 'pilot-v0.4' then return false; end if;
  phone:=regexp_replace(coalesce(data->>'contact_phone',''),'[[:space:]()-]','','g');
  if phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'invalid contact number'; end if;
  insert into public.profiles(user_id,given_name,family_name,middle_name,contact_phone,language,terms_revision)
    values(auth.uid(),trim(data->>'given_name'),trim(data->>'family_name'),nullif(trim(data->>'middle_name'),''),phone,
      data->>'language','pilot-v0.4') on conflict(user_id) do nothing;
  return true;
end
$$;
create function public.complete_profile()
returns boolean language sql set search_path='' as $$ select commerce_private.complete_profile() $$;

create function commerce_private.open_business_v04(p_name text,p_store text,p_type text,p_address text,p_unit text,p_register text)
returns uuid language plpgsql security definer set search_path='' as $$
declare business uuid;
begin
  if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then
    raise exception 'confirmed email required' using errcode='42501';
  end if;
  business:=commerce_private.open_business(p_name,p_store);
  update public.businesses set
    business_type=p_type,business_address=nullif(trim(p_address),''),default_unit=p_unit,register_name=nullif(trim(p_register),'')
    where id=business;
  return business;
end
$$;
create function public.open_business_v04(p_name text,p_store text,p_type text,p_address text,p_unit text,p_register text)
returns uuid language sql set search_path='' as $$
  select commerce_private.open_business_v04(p_name,p_store,p_type,p_address,p_unit,p_register)
$$;
revoke all on function commerce_private.complete_profile(),public.complete_profile(),
  commerce_private.open_business_v04(text,text,text,text,text,text),public.open_business_v04(text,text,text,text,text,text) from public,anon;
grant execute on function commerce_private.complete_profile(),public.complete_profile(),
  commerce_private.open_business_v04(text,text,text,text,text,text),public.open_business_v04(text,text,text,text,text,text) to authenticated;
