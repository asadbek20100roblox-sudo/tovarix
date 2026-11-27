create table commerce_private.platform_admins (user_id uuid primary key references auth.users(id));
alter table commerce_private.platform_admins enable row level security;

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  author_id uuid not null default auth.uid() references auth.users(id),
  subject text not null check(char_length(trim(subject)) between 1 and 120),
  message text not null check(char_length(trim(message)) between 1 and 4000),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  resolution text
);
create index ticket_business_date on public.support_tickets(business_id,created_at desc);
alter table public.support_tickets enable row level security;
revoke all on public.support_tickets from public,anon,authenticated;
grant select,insert(business_id,subject,message) on public.support_tickets to authenticated;
create policy ticket_read on public.support_tickets for select to authenticated using (
  exists(select 1 from public.businesses b where b.id=business_id and b.owner_id=auth.uid())
  or (author_id=auth.uid() and commerce_private.can_access(business_id,'read'))
);
create policy ticket_create on public.support_tickets for insert to authenticated with check (
  author_id=auth.uid() and commerce_private.can_access(business_id,'read')
);

create table commerce_private.platform_audit (
  id bigint generated always as identity primary key,
  actor uuid not null references auth.users(id),
  action text not null,
  ticket uuid references public.support_tickets(id),
  created_at timestamptz not null default now()
);
alter table commerce_private.platform_audit enable row level security;

create function commerce_private.platform_overview()
returns jsonb language sql stable security definer set search_path='' as $$
  select case when exists(select 1 from commerce_private.platform_admins where user_id=auth.uid()) then
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
create function commerce_private.resolve_ticket(p_ticket uuid,p_resolution text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from commerce_private.platform_admins where user_id=auth.uid()) then
    raise exception 'permission denied' using errcode='42501';
  end if;
  if p_resolution is null or char_length(trim(p_resolution)) not between 1 and 4000 then raise exception 'invalid resolution'; end if;
  update public.support_tickets set closed_at=now(),resolution=trim(p_resolution) where id=p_ticket and closed_at is null;
  if not found then raise exception 'ticket unavailable'; end if;
  insert into commerce_private.platform_audit(actor,action,ticket) values(auth.uid(),'support.resolve',p_ticket);
end
$$;
create function public.platform_overview()
returns jsonb language sql stable set search_path='' as $$ select commerce_private.platform_overview() $$;
create function public.resolve_ticket(p_ticket uuid,p_resolution text)
returns void language sql set search_path='' as $$ select commerce_private.resolve_ticket(p_ticket,p_resolution) $$;
revoke all on function commerce_private.platform_overview(),public.platform_overview(),
  commerce_private.resolve_ticket(uuid,text),public.resolve_ticket(uuid,text) from public,anon;
grant execute on function commerce_private.platform_overview(),public.platform_overview(),
  commerce_private.resolve_ticket(uuid,text),public.resolve_ticket(uuid,text) to authenticated;
