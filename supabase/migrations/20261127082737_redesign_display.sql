alter table public.members add column display_name text
  check(display_name is null or char_length(display_name) between 1 and 100);

create function commerce_private.set_staff_display_name(p_business uuid,p_user uuid,p_name text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.businesses where id=p_business and owner_id=auth.uid()) then
    raise exception 'permission denied' using errcode='42501';
  end if;
  update public.members set display_name=nullif(trim(p_name),'') where business_id=p_business and user_id=p_user;
  if not found then raise exception 'employee unavailable'; end if;
  insert into public.audit_log(business_id,actor_id,action,detail)
    values(p_business,auth.uid(),'staff.display_name',jsonb_build_object('user',p_user));
end
$$;

create function public.set_staff_display_name(p_business uuid,p_user uuid,p_name text)
returns void language sql set search_path='' as $$
  select commerce_private.set_staff_display_name(p_business,p_user,p_name)
$$;
revoke all on function commerce_private.set_staff_display_name(uuid,uuid,text),
  public.set_staff_display_name(uuid,uuid,text) from public,anon;
grant execute on function commerce_private.set_staff_display_name(uuid,uuid,text),
  public.set_staff_display_name(uuid,uuid,text) to authenticated;
