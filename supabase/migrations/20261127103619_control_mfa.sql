create function commerce_private.control_eligible()
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from commerce_private.platform_admins where user_id=(select auth.uid()))
$$;
create function public.control_eligible()
returns boolean language sql stable set search_path='' as $$ select commerce_private.control_eligible() $$;
revoke all on function commerce_private.control_eligible(),public.control_eligible() from public,anon;
grant execute on function commerce_private.control_eligible(),public.control_eligible() to authenticated;

create or replace function commerce_private.platform_overview()
returns jsonb language sql stable security definer set search_path='' as $$
  select case when commerce_private.control_eligible() and (select auth.jwt()->>'aal')='aal2' then
    jsonb_build_object(
      'businesses',(select count(*) from public.businesses),
      'subscriptions',(select count(*) from public.subscriptions where paid_until>now()),
      'payments',(select count(*) from commerce_private.billing_events),
      'ai_requests',(select coalesce(sum(count),0) from commerce_private.ai_usage where day=(now() at time zone 'Asia/Tashkent')::date),
      'tickets',(select coalesce(jsonb_agg(to_jsonb(t) order by created_at desc),'[]') from (
        select id,business_id,subject,message,created_at from public.support_tickets where closed_at is null order by created_at desc limit 50
      ) t),
      'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by id desc),'[]') from (
        select id,actor,action,ticket,created_at from commerce_private.platform_audit order by id desc limit 50
      ) a)
    )
  end
$$;

create or replace function commerce_private.resolve_ticket(p_ticket uuid,p_resolution text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not commerce_private.control_eligible() or (select auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception 'permission denied' using errcode='42501';
  end if;
  if p_resolution is null or char_length(trim(p_resolution)) not between 1 and 4000 then raise exception 'invalid resolution'; end if;
  update public.support_tickets set closed_at=now(),resolution=trim(p_resolution) where id=p_ticket and closed_at is null;
  if not found then raise exception 'ticket unavailable'; end if;
  insert into commerce_private.platform_audit(actor,action,ticket) values(auth.uid(),'support.resolve',p_ticket);
end
$$;
