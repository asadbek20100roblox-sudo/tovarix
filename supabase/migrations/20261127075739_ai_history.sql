create table public.ai_history (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  user_id uuid not null references auth.users(id),
  question text not null check(char_length(question) between 1 and 2000),
  answer text not null check(char_length(answer) between 1 and 24000),
  model text not null,
  input_tokens integer check(input_tokens>=0),
  output_tokens integer check(output_tokens>=0),
  estimated_usd_micros bigint check(estimated_usd_micros>=0),
  created_at timestamptz not null default now()
);
alter table public.ai_history enable row level security;
create index ai_history_scope on public.ai_history(business_id,user_id,created_at desc);
revoke all on public.ai_history from public,anon,authenticated;
grant select on public.ai_history to authenticated;
create policy ai_history_read on public.ai_history for select to authenticated
  using(user_id=auth.uid() and commerce_private.can_access(business_id,'ai') and commerce_private.in_store(business_id,null));

create table commerce_private.ai_model_rates (
  model text primary key,
  input_micros_per_million bigint not null check(input_micros_per_million between 0 and 1000000000000),
  output_micros_per_million bigint not null check(output_micros_per_million between 0 and 1000000000000)
);
alter table commerce_private.ai_model_rates enable row level security;
create function commerce_private.record_ai(p_business uuid,p_user uuid,p_question text,p_answer text,p_model text,p_input integer,p_output integer)
returns void language plpgsql security definer set search_path='' as $$
declare v_estimate bigint;
begin
  select round((p_input::numeric*input_micros_per_million+p_output::numeric*output_micros_per_million)/1000000)
    into v_estimate from commerce_private.ai_model_rates where model=p_model;
  insert into public.ai_history(business_id,user_id,question,answer,model,input_tokens,output_tokens,estimated_usd_micros)
    values(p_business,p_user,trim(p_question),p_answer,p_model,p_input,p_output,v_estimate);
end
$$;
create function public.record_ai(p_business uuid,p_user uuid,p_question text,p_answer text,p_model text,p_input integer,p_output integer)
returns void language sql set search_path='' as $$
  select commerce_private.record_ai(p_business,p_user,p_question,p_answer,p_model,p_input,p_output)
$$;
revoke all on function commerce_private.record_ai(uuid,uuid,text,text,text,integer,integer),
  public.record_ai(uuid,uuid,text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function commerce_private.record_ai(uuid,uuid,text,text,text,integer,integer),
  public.record_ai(uuid,uuid,text,text,text,integer,integer) to service_role;
