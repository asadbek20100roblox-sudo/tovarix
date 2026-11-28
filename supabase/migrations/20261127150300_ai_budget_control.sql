alter table commerce_private.platform_settings add column ai_daily_usd_micros bigint not null default 250000
  check(ai_daily_usd_micros between 0 and 100000000);
alter table commerce_private.ai_global_usage add column reserved_usd_micros bigint not null default 0;
insert into commerce_private.ai_model_rates(model,input_micros_per_million,output_micros_per_million)
  values('gemini-3.1-flash-lite',250000,1500000) on conflict(model) do nothing;

create table commerce_private.ai_daily_tokens (
  day date primary key,
  input_tokens bigint not null,
  output_tokens bigint not null,
  estimated bigint not null
);
alter table commerce_private.ai_daily_tokens enable row level security;
revoke all on commerce_private.ai_daily_tokens from public,anon,authenticated;
insert into commerce_private.ai_daily_tokens(day,input_tokens,output_tokens,estimated)
  select (created_at at time zone 'Asia/Tashkent')::date,coalesce(sum(input_tokens),0),
    coalesce(sum(output_tokens),0),coalesce(sum(estimated_usd_micros),0) from public.ai_history group by 1;
create function commerce_private.count_ai_turn()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into commerce_private.ai_daily_tokens as totals(day,input_tokens,output_tokens,estimated)
    values((new.created_at at time zone 'Asia/Tashkent')::date,coalesce(new.input_tokens,0),
      coalesce(new.output_tokens,0),coalesce(new.estimated_usd_micros,0))
    on conflict(day) do update set input_tokens=totals.input_tokens+excluded.input_tokens,
      output_tokens=totals.output_tokens+excluded.output_tokens,estimated=totals.estimated+excluded.estimated;
  return new;
end
$$;
revoke all on function commerce_private.count_ai_turn() from public,anon,authenticated;
create trigger count_ai_turn after insert on public.ai_history for each row execute function commerce_private.count_ai_turn();

create function public.reserve_ai_budget(p_model text,p_input integer,p_output integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_budget bigint; v_reserve bigint; v_day date:=(now() at time zone 'Asia/Tashkent')::date;
begin
  if p_input is null or p_input not between 1 and 64000 or p_output is distinct from 1200 then return false; end if;
  select ai_daily_usd_micros into v_budget from commerce_private.platform_settings where singleton and ai_daily_budget>0 for share;
  if not found or v_budget=0 then return false; end if;
  select ceil((p_input::numeric*input_micros_per_million+p_output::numeric*output_micros_per_million)/1000000)
    into v_reserve from commerce_private.ai_model_rates where model=p_model;
  if not found then return false; end if;
  update commerce_private.ai_global_usage set reserved_usd_micros=reserved_usd_micros+v_reserve
    where day=v_day and reserved_usd_micros+v_reserve<=v_budget;
  return found;
end
$$;
revoke all on function public.reserve_ai_budget(text,integer,integer) from public,anon,authenticated;
grant execute on function public.reserve_ai_budget(text,integer,integer) to service_role;

create function commerce_private.is_super_admin()
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(auth.jwt()->>'aal'='aal2',false) and exists (
    select 1 from commerce_private.platform_admins a join auth.users u on u.id=a.user_id
      where a.user_id=auth.uid() and a.role='SUPER_ADMIN' and u.email_confirmed_at is not null)
$$;
revoke all on function commerce_private.is_super_admin() from public,anon,authenticated;

create function public.control_ai(p_action text default 'get',p_amount bigint default null,p_business uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg commerce_private.platform_settings; v_user uuid; v_payload jsonb;
  v_day date:=(now() at time zone 'Asia/Tashkent')::date;
begin
  if not commerce_private.is_super_admin() then raise exception 'permission denied' using errcode='42501'; end if;
  case p_action
    when 'get' then null;
    when 'stop' then
      update commerce_private.platform_settings set ai_enabled=false,ai_daily_budget=0 where singleton;
      delete from commerce_private.ai_pilot;
    when 'disable' then
      update commerce_private.platform_settings set ai_enabled=false where singleton;
    when 'enable' then
      update commerce_private.platform_settings set ai_enabled=true
        where singleton and ai_daily_budget>0 and ai_daily_usd_micros>0;
      if not found then raise exception 'positive limits required'; end if;
    when 'requests' then
      if p_amount is null or p_amount not between 0 and 1000000 then raise exception 'invalid limit'; end if;
      update commerce_private.platform_settings set ai_daily_budget=p_amount where singleton;
    when 'budget' then
      if p_amount is null or p_amount not between 0 and 100000000 then raise exception 'invalid budget'; end if;
      update commerce_private.platform_settings set ai_daily_usd_micros=p_amount where singleton;
    when 'pilot' then
      select owner_id into v_user from public.businesses where id=p_business;
      if not found or p_amount is null or p_amount not between 1 and 3 then raise exception 'invalid pilot'; end if;
      insert into commerce_private.ai_pilot(business_id,user_id,expires_at,remaining)
        values(p_business,v_user,now()+interval '1 hour',p_amount)
        on conflict(business_id,user_id) do update set expires_at=excluded.expires_at,remaining=excluded.remaining;
    when 'remove-pilot' then
      delete from commerce_private.ai_pilot where business_id=p_business;
    else raise exception 'invalid operation';
  end case;
  if p_action<>'get' then
    insert into commerce_private.platform_audit(actor,action,detail)
      values(auth.uid(),'ai.control.'||p_action,jsonb_build_object('value',p_amount,'business',p_business));
  end if;
  select * into cfg from commerce_private.platform_settings;
  select jsonb_build_object('enabled',cfg.ai_enabled,'request_cap',cfg.ai_daily_budget,'budget',cfg.ai_daily_usd_micros,
    'requests',coalesce((select count from commerce_private.ai_global_usage where day=v_day),0),
    'reserved',coalesce((select reserved_usd_micros from commerce_private.ai_global_usage where day=v_day),0),
    'input_tokens',coalesce((select input_tokens from commerce_private.ai_daily_tokens where day=v_day),0),
    'output_tokens',coalesce((select output_tokens from commerce_private.ai_daily_tokens where day=v_day),0),
    'estimated',coalesce((select estimated from commerce_private.ai_daily_tokens where day=v_day),0)) into v_payload;
  return v_payload;
end
$$;
revoke all on function public.control_ai(text,bigint,uuid) from public,anon;
grant execute on function public.control_ai(text,bigint,uuid) to authenticated;

create function public.ai_analytics_context(p_business uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_day date:=(now() at time zone 'Asia/Tashkent')::date; v_result jsonb:='{}';
  v_now jsonb; v_previous jsonb; v_debts jsonb; v_month jsonb;
begin
  if not commerce_private.can_access(p_business,'ai') or not commerce_private.in_store(p_business,null) then
    raise exception 'permission denied' using errcode='42501';
  end if;
  if commerce_private.can_access(p_business,'analytics') then
    v_now:=public.sales_report(p_business,v_day-6,v_day+1);
    v_previous:=public.sales_report(p_business,v_day-13,v_day-6);
    v_month:=public.sales_report(p_business,v_day-29,v_day+1);
    v_result:=jsonb_build_object('current_7_days',v_now->'totals','previous_7_days',v_previous->'totals',
      'today',public.sales_report(p_business,v_day,v_day+1)->'totals',
      'last_30_days',v_month->'totals',
      'daily_revenue',v_month->'days',
      'popular_products',v_now->'popular','slow_products',v_now->'slow',
      'anonymous_operator_totals',(select coalesce(jsonb_agg(value-'operator_id'),'[]') from jsonb_array_elements(v_now->'operators')),
      'recorded_expenses_7_days',(select coalesce(sum(amount),0) from public.expenses
        where business_id=p_business and created_at>=(v_day-6)::timestamp at time zone 'Asia/Tashkent'));
  end if;
  if commerce_private.can_access(p_business,'customer') then
    v_debts:=public.debt_overview(p_business,'','all',0);
    v_result:=v_result||jsonb_build_object('current_customer_debt_total_uzs',v_debts->'total',
      'customers_with_outstanding_debt',v_debts->'count');
  end if;
  return v_result;
end
$$;
revoke all on function public.ai_analytics_context(uuid) from public,anon;
grant execute on function public.ai_analytics_context(uuid) to authenticated;
