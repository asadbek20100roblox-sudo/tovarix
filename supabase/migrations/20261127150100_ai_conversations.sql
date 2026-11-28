create table commerce_private.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  user_id uuid not null references auth.users(id),
  title text not null check(char_length(title) between 1 and 100),
  updated_at timestamptz not null default now()
);
alter table commerce_private.ai_conversations enable row level security;
revoke all on commerce_private.ai_conversations from public,anon,authenticated;
create index ai_conversations_scope on commerce_private.ai_conversations(business_id,user_id,updated_at desc,id);
alter table public.ai_history add column conversation_id uuid references commerce_private.ai_conversations(id) on delete cascade,
  add column profit_scope boolean not null default true;
create index ai_history_conversation on public.ai_history(conversation_id,created_at desc) where conversation_id is not null;
alter policy ai_history_read on public.ai_history using (
  user_id=auth.uid() and commerce_private.can_access(business_id,'ai') and commerce_private.in_store(business_id,null)
  and (not profit_scope or commerce_private.can_access(business_id,'profit'))
);

create function public.ai_conversations(p_business uuid,p_action text,p_id uuid default null,p_title text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_chat commerce_private.ai_conversations;
begin
  if not commerce_private.can_access(p_business,'ai') or not commerce_private.in_store(p_business,null) then
    raise exception 'permission denied' using errcode='42501';
  end if;
  if p_action='list' then
    return (select coalesce(jsonb_agg(to_jsonb(c) order by updated_at desc,id),'[]') from (
      select id,title,updated_at from commerce_private.ai_conversations
      where business_id=p_business and user_id=auth.uid() order by updated_at desc,id limit 100
    ) c);
  end if;
  if p_action in ('create','rename') and coalesce(char_length(trim(p_title)),0) not between 1 and 100 then
    raise exception 'invalid title';
  end if;
  case p_action
    when 'create' then
      perform pg_advisory_xact_lock(hashtextextended(p_business::text||auth.uid()::text,10));
      if (select count(*) from commerce_private.ai_conversations where business_id=p_business and user_id=auth.uid())>=100 then
        raise exception 'conversation limit';
      end if;
      insert into commerce_private.ai_conversations(business_id,user_id,title)
        values(p_business,auth.uid(),trim(p_title)) returning * into v_chat;
    when 'rename' then
      update commerce_private.ai_conversations set title=trim(p_title),updated_at=now()
        where business_id=p_business and user_id=auth.uid() and id=p_id returning * into v_chat;
    when 'delete' then
      delete from commerce_private.ai_conversations where business_id=p_business and user_id=auth.uid() and id=p_id returning * into v_chat;
    when 'get' then
      select * into v_chat from commerce_private.ai_conversations where business_id=p_business and user_id=auth.uid() and id=p_id;
    else raise exception 'invalid operation';
  end case;
  if v_chat.id is null then raise exception 'permission denied' using errcode='42501'; end if;
  return jsonb_build_object('id',v_chat.id,'title',v_chat.title,'updated_at',v_chat.updated_at);
end
$$;

create function public.record_ai_turn(p_business uuid,p_user uuid,p_chat uuid,p_question text,p_answer text,
  p_model text,p_input integer,p_output integer,p_profit boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_estimate bigint;
begin
  if p_chat is not null then
    update commerce_private.ai_conversations set updated_at=now()
      where id=p_chat and business_id=p_business and user_id=p_user;
    if not found then raise exception 'conversation unavailable' using errcode='42501'; end if;
  end if;
  select round((p_input::numeric*input_micros_per_million+p_output::numeric*output_micros_per_million)/1000000)
    into v_estimate from commerce_private.ai_model_rates where model=p_model;
  insert into public.ai_history(business_id,user_id,conversation_id,question,answer,model,input_tokens,output_tokens,estimated_usd_micros,profit_scope)
    values(p_business,p_user,p_chat,trim(p_question),p_answer,p_model,p_input,p_output,v_estimate,coalesce(p_profit,true))
    returning id into v_id;
  return v_id;
end
$$;
revoke all on function public.record_ai_turn(uuid,uuid,uuid,text,text,text,integer,integer,boolean) from public,anon,authenticated;
grant execute on function public.record_ai_turn(uuid,uuid,uuid,text,text,text,integer,integer,boolean) to service_role;
revoke all on function public.ai_conversations(uuid,text,uuid,text) from public,anon;
grant execute on function public.ai_conversations(uuid,text,uuid,text) to authenticated;

create or replace function commerce_private.ai_remaining(p_business uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare enabled boolean; allowance integer; consumed integer; global_cap integer; global_count integer; pilot integer;
  v_day date:=(now() at time zone 'Asia/Tashkent')::date;
begin
  if not commerce_private.can_access(p_business,'ai') or not commerce_private.in_store(p_business,null) then
    raise exception 'permission denied' using errcode='42501';
  end if;
  select ai_enabled,ai_daily_budget into enabled,global_cap from commerce_private.platform_settings where singleton;
  select daily_requests into allowance from commerce_private.ai_plan_limits where plan=commerce_private.effective_plan(p_business);
  select count into consumed from commerce_private.ai_usage where business_id=p_business and day=v_day;
  select count into global_count from commerce_private.ai_global_usage where day=v_day;
  select remaining into pilot from commerce_private.ai_pilot
    where business_id=p_business and user_id=auth.uid() and expires_at>now();
  return jsonb_build_object('enabled',coalesce(global_cap,0)>0 and (coalesce(enabled,false) or coalesce(pilot,0)>0),
    'remaining',greatest(0,least(coalesce(allowance,0)-coalesce(consumed,0),coalesce(global_cap,0)-coalesce(global_count,0),
      case when enabled then allowance else coalesce(pilot,0) end)));
end
$$;
