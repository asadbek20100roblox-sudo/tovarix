create table commerce_private.platform_announcements (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id),
  title text not null check(length(title) between 1 and 120),
  message text not null check(length(message) between 1 and 2000),
  kind text not null check(kind in ('update','maintenance','subscription')),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
alter table commerce_private.platform_announcements enable row level security;
revoke all on commerce_private.platform_announcements from public,anon,authenticated;

create function commerce_private.platform_announcements_for_member()
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(a) order by created_at desc,id),'[]') from (
    select id,title,message,kind,created_at from commerce_private.platform_announcements
    where auth.uid() is not null and archived_at is null order by created_at desc,id limit 20
  ) a
$$;
create function public.platform_announcements()
returns jsonb language sql stable security invoker set search_path=''
return commerce_private.platform_announcements_for_member();
revoke all on function public.platform_announcements(),commerce_private.platform_announcements_for_member() from public,anon;
grant execute on function public.platform_announcements(),commerce_private.platform_announcements_for_member() to authenticated;

create function commerce_private.control_platform(p_area text,p_search text,p_offset integer,p_command text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_search text := lower(left(trim(coalesce(p_search,'')),120));
  v_id uuid; v_plan text; v_reason text; v_until timestamptz; v_result jsonb;
  v_day date := (now() at time zone 'Asia/Tashkent')::date;
begin
  if not commerce_private.is_super_admin() then raise exception 'permission denied' using errcode='42501'; end if;
  if p_offset is null or p_offset not between 0 and 50000 then raise exception 'invalid offset'; end if;
  if p_command is not null then
    v_id := (p_payload->>'id')::uuid;
    v_reason := trim(p_payload->>'reason');
    if p_command in ('suspend','restore','revoke-sessions','grant-plan','cancel-plan','end-trial')
      and coalesce(length(v_reason),0) not between 4 and 300 then raise exception 'reason required'; end if;
    case p_command
      when 'suspend','restore','revoke-sessions' then
        if v_id is null or v_id=auth.uid() or exists(select 1 from commerce_private.platform_admins where user_id=v_id)
          or not exists(select 1 from auth.users where id=v_id) then raise exception 'account unavailable'; end if;
        if p_command<>'revoke-sessions' then
          update auth.users set banned_until=case when p_command='suspend' then now()+interval '100 years' else null end,
            updated_at=now() where id=v_id;
        end if;
        if p_command<>'restore' then delete from auth.sessions where user_id=v_id; end if;
      when 'grant-plan','cancel-plan','end-trial' then
        if p_command='grant-plan' then
          v_plan := p_payload->>'plan';
          v_until := (p_payload->>'until')::timestamptz;
          if v_plan is null or v_plan='FREE' or not exists(select 1 from public.plan_catalog where id=v_plan)
            or v_until is null or v_until<=now() or v_until>now()+interval '5 years' then raise exception 'invalid subscription'; end if;
          update public.subscriptions set plan=v_plan,paid_until=v_until where business_id=v_id;
        elsif p_command='cancel-plan' then
          update public.subscriptions set plan='FREE',paid_until=null where business_id=v_id;
        else
          update public.subscriptions set trial_until=least(trial_until,now()) where business_id=v_id;
        end if;
        if not found then raise exception 'subscription unavailable'; end if;
      when 'publish' then
        insert into commerce_private.platform_announcements(author_id,title,message,kind)
          values(auth.uid(),trim(p_payload->>'title'),trim(p_payload->>'message'),p_payload->>'kind') returning id into v_id;
      when 'archive' then
        update commerce_private.platform_announcements set archived_at=now() where id=v_id and archived_at is null;
        if not found then raise exception 'announcement unavailable'; end if;
      else raise exception 'invalid command';
    end case;
    insert into commerce_private.platform_audit(actor,action,detail) values(auth.uid(),'control.'||p_command,
      jsonb_build_object('id',v_id,'reason',v_reason,'plan',v_plan,'until',v_until));
  end if;
  case p_area
    when 'dashboard' then
      select jsonb_build_object(
        'users',(select count(*) from auth.users),
        'businesses',(select count(*) from public.businesses),
        'signed_in_7d',(select count(*) from auth.users where last_sign_in_at>=now()-interval '7 days'),
        'new_7d',(select count(*) from auth.users where created_at>=now()-interval '7 days'),
        'previous_new_7d',(select count(*) from auth.users where created_at>=now()-interval '14 days' and created_at<now()-interval '7 days'),
        'trial',(select count(*) from public.subscriptions where trial_started_at is not null and trial_until>now()),
        'paid',(select count(*) from public.subscriptions where plan<>'FREE' and paid_until>now()),
        'free',(select count(*) from public.subscriptions where commerce_private.effective_plan(business_id)='FREE'),
        'plan_distribution',(select coalesce(jsonb_object_agg(plan,n),'{}') from (
          select commerce_private.effective_plan(business_id) plan,count(*) n from public.subscriptions group by 1) d),
        'confirmed_revenue',(select coalesce(sum(amount_uzs),0)::text from commerce_private.subscription_requests where status='ACTIVATED'),
        'ai_requests',(select coalesce(sum(count),0) from commerce_private.ai_global_usage where day=v_day),
        'open_tickets',(select count(*) from public.support_tickets where closed_at is null)
      ) into v_result;
    when 'users' then
      select coalesce(jsonb_agg(to_jsonb(r) order by created_at desc,id),'[]') into v_result from (
        select u.id,u.email,u.created_at,u.email_confirmed_at,u.last_sign_in_at,u.banned_until>now() as banned,
          p.given_name,p.family_name,(select count(*) from public.businesses b where b.owner_id=u.id) businesses
        from auth.users u left join public.profiles p on p.user_id=u.id
        where v_search='' or strpos(lower(coalesce(u.email,'')||' '||coalesce(p.given_name,'')||' '||coalesce(p.family_name,'')),v_search)>0
        order by u.created_at desc,u.id limit 26 offset p_offset
      ) r;
    when 'businesses','subscriptions' then
      select coalesce(jsonb_agg(to_jsonb(r) order by name,id),'[]') into v_result from (
        select b.id,b.name,b.business_type,commerce_private.effective_plan(b.id) effective_plan,s.plan,s.paid_until,s.trial_until,
          (select count(*) from public.members m where m.business_id=b.id) employees,
          (select count(*) from public.stores l where l.business_id=b.id) branches,
          (select count(*) from public.products p where p.business_id=b.id) products
        from public.businesses b left join public.subscriptions s on s.business_id=b.id
        where v_search='' or strpos(lower(b.name||' '||b.business_type),v_search)>0 order by b.name,b.id limit 26 offset p_offset
      ) r;
    when 'finance' then
      select coalesce(jsonb_agg(to_jsonb(r) order by created_at desc,id),'[]') into v_result from (
        select id,business_id,plan,months,amount_uzs,created_at from commerce_private.subscription_requests
        where status='ACTIVATED' order by created_at desc,id limit 26 offset p_offset
      ) r;
    when 'promos' then
      select coalesce(jsonb_agg(to_jsonb(r) order by month desc,slot desc),'[]') into v_result from (
        select code,discount_percent,month,slot,use_count,expires_at from commerce_private.promos
        order by month desc,slot desc limit 26 offset p_offset
      ) r;
    when 'notifications' then
      select coalesce(jsonb_agg(to_jsonb(r) order by created_at desc,id),'[]') into v_result from (
        select id,title,message,kind,created_at,archived_at from commerce_private.platform_announcements
        order by created_at desc,id limit 26 offset p_offset
      ) r;
    when 'security' then
      select coalesce(jsonb_agg(to_jsonb(r) order by id desc),'[]') into v_result from (
        select id,actor,action,detail,created_at from commerce_private.platform_audit order by id desc limit 26 offset p_offset
      ) r;
    when 'flags' then
      select jsonb_build_object('registration_open',public_signup_enabled,'ai',ai_enabled)
        into v_result from commerce_private.platform_settings where singleton;
    else raise exception 'invalid section';
  end case;
  return v_result;
end
$$;
create function public.control_platform(p_area text,p_search text default '',p_offset integer default 0,
  p_command text default null,p_payload jsonb default '{}')
returns jsonb language sql security invoker set search_path=''
return commerce_private.control_platform(p_area,p_search,p_offset,p_command,p_payload);
revoke all on function public.control_platform(text,text,integer,text,jsonb),
  commerce_private.control_platform(text,text,integer,text,jsonb) from public,anon;
grant execute on function public.control_platform(text,text,integer,text,jsonb),
  commerce_private.control_platform(text,text,integer,text,jsonb) to authenticated;

create or replace function commerce_private.can_access(p_business uuid,p_permission text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.users where id=auth.uid() and (banned_until is null or banned_until<=now()))
    and (nullif(auth.jwt()->>'session_id','') is null
      or exists(select 1 from auth.sessions where id=(auth.jwt()->>'session_id')::uuid and user_id=auth.uid()))
    and (exists(select 1 from public.businesses where id=p_business and owner_id=auth.uid())
    or exists (
      select 1 from public.subscriptions s join public.plan_catalog p
        on p.id=commerce_private.effective_plan(p_business)
      cross join lateral (
        select m.user_id,m.permissions from public.members m where m.business_id=p_business and m.blocked_at is null
        order by m.user_id limit p.technical_employee_limit
      ) active
      where s.business_id=p_business and active.user_id=auth.uid()
        and (p_permission='read' or p_permission=any(active.permissions))
    ))
$$;
