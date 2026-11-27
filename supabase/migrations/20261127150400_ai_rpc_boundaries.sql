-- Match the existing Data API boundary: public invoker wrappers and private privileged logic.
alter function public.ai_conversations(uuid,text,uuid,text) set schema commerce_private;
alter function public.ai_price_action(uuid,uuid,text) set schema commerce_private;
alter function public.control_ai(text,bigint,uuid) set schema commerce_private;

create function public.ai_conversations(p_business uuid,p_action text,p_id uuid default null,p_title text default null)
returns jsonb language sql security invoker set search_path='' as $$
  select commerce_private.ai_conversations(p_business,p_action,p_id,p_title)
$$;
create function public.ai_price_action(p_business uuid,p_turn uuid,p_action text)
returns jsonb language sql security invoker set search_path='' as $$
  select commerce_private.ai_price_action(p_business,p_turn,p_action)
$$;
create function public.control_ai(p_action text default 'get',p_amount bigint default null,p_business uuid default null)
returns jsonb language sql security invoker set search_path='' as $$
  select commerce_private.control_ai(p_action,p_amount,p_business)
$$;

revoke all on function public.ai_conversations(uuid,text,uuid,text),public.ai_price_action(uuid,uuid,text),
  public.control_ai(text,bigint,uuid) from public,anon;
grant execute on function public.ai_conversations(uuid,text,uuid,text),public.ai_price_action(uuid,uuid,text),
  public.control_ai(text,bigint,uuid) to authenticated;
