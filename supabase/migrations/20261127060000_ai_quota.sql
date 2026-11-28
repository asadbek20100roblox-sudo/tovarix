create table commerce_private.ai_usage (
  business_id uuid not null references public.businesses(id),
  day date not null,
  count integer not null default 1,
  primary key(business_id,day)
);
alter table commerce_private.ai_usage enable row level security;

create function commerce_private.ai_context(p_business uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_summary jsonb;
begin
  if not commerce_private.can_access(p_business,'ai') or not commerce_private.has_feature(p_business,'ai')
    then raise exception 'permission denied' using errcode='42501'; end if;
  insert into commerce_private.ai_usage as usage (business_id,day) values(p_business,(now() at time zone 'Asia/Tashkent')::date)
    on conflict (business_id,day) do update set count=usage.count+1 where usage.count<20;
  if not found then raise exception 'AI quota exceeded'; end if;
  select coalesce(jsonb_agg(to_jsonb(daily)), '[]') into v_summary from (
    select (created_at at time zone 'Asia/Tashkent')::date as day, count(*) as sales,
      sum(total) as revenue_uzs, sum(total-cost) as gross_profit_uzs
    from public.sales where business_id=p_business and created_at>=now()-interval '30 days'
    group by 1 order by 1
  ) daily;
  return jsonb_build_object('daily_sales',v_summary);
end
$$;
create function public.ai_context(p_business uuid)
returns jsonb language sql set search_path='' as $$
  select commerce_private.ai_context(p_business)
$$;
revoke execute on function commerce_private.ai_context(uuid),public.ai_context(uuid) from public,anon;
grant execute on function commerce_private.ai_context(uuid),public.ai_context(uuid) to authenticated;
