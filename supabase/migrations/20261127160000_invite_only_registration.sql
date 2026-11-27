alter table commerce_private.platform_settings
  add column public_signup_enabled boolean not null default false;

create function commerce_private.registration_open()
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select public_signup_enabled from commerce_private.platform_settings where singleton),false)
$$;
create function public.registration_open()
returns boolean language sql stable security invoker set search_path=''
return commerce_private.registration_open();
revoke all on function commerce_private.registration_open(),public.registration_open() from public;
grant execute on function commerce_private.registration_open(),public.registration_open() to anon,authenticated;

create function commerce_private.require_auth_invitation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.invited_at is null and not commerce_private.registration_open() then
    raise exception 'Registration is by invitation only' using errcode='42501';
  end if;
  return new;
end
$$;
revoke all on function commerce_private.require_auth_invitation() from public,anon,authenticated;
create trigger tovarix_require_auth_invitation before insert on auth.users
  for each row execute function commerce_private.require_auth_invitation();
