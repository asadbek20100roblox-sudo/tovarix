alter table commerce_private.platform_admins add column login_alias text unique
  check(login_alias is null or (role='SUPER_ADMIN' and login_alias ~ '^[A-Z0-9]{4,24}$'));

create table commerce_private.control_login_limits (
  user_id uuid primary key references commerce_private.platform_admins(user_id) on delete cascade,
  window_start timestamptz not null,
  attempts integer not null check(attempts between 1 and 8)
);
alter table commerce_private.control_login_limits enable row level security;
revoke all on commerce_private.control_login_limits from public,anon,authenticated;

create function public.control_login_target(p_alias text)
returns text language plpgsql security definer set search_path='' as $$
declare
  v_user uuid;
  v_email text;
  v_window timestamptz := date_bin(interval '5 minutes',now(),timestamptz '2026-01-01 00:00:00+00');
begin
  select u.id,u.email into v_user,v_email from commerce_private.platform_admins a join auth.users u on u.id=a.user_id
    where a.login_alias=p_alias and a.role='SUPER_ADMIN' and u.email_confirmed_at is not null;
  if not found then return null; end if;
  insert into commerce_private.control_login_limits as limits(user_id,window_start,attempts)
    values(v_user,v_window,1)
    on conflict(user_id) do update set window_start=v_window,
      attempts=case when limits.window_start<v_window then 1 else limits.attempts+1 end
    where limits.window_start<v_window or limits.attempts<8;
  if not found then return null; end if;
  return v_email;
end
$$;

create function public.control_password_verified(p_alias text,p_uid uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  insert into commerce_private.platform_audit(actor,action)
    select a.user_id,'control.password.verified' from commerce_private.platform_admins a
    join auth.users u on u.id=a.user_id
    where a.user_id=p_uid and a.role='SUPER_ADMIN' and a.login_alias=p_alias and u.email_confirmed_at is not null;
  return found;
end
$$;

revoke all on function public.control_login_target(text),public.control_password_verified(text,uuid) from public,anon,authenticated;
grant execute on function public.control_login_target(text),public.control_password_verified(text,uuid) to service_role;
