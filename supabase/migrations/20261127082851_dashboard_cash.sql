create function public.dashboard_cash(p_business uuid,p_store uuid,p_from timestamptz,p_until timestamptz)
returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb;
begin
  if not commerce_private.can_access(p_business,'analytics') or not commerce_private.in_store(p_business,p_store) then
    raise exception 'permission denied' using errcode='42501';
  end if;
  if p_from is null or p_until is null or p_until<=p_from or p_until-p_from>interval '32 days' then
    raise exception 'invalid dashboard period';
  end if;
  select jsonb_build_object(
    'expenses',coalesce((select sum(e.amount) from public.expenses e
      where e.business_id=p_business and e.store_id=p_store and e.created_at>=p_from and e.created_at<p_until),0),
    'cash',(select sum(sh.opening_cash
      + coalesce((select sum(s.cash) from public.sales s where s.shift_id=sh.id),0)
      - coalesce((select sum(s.cash) from public.sale_returns r join public.sales s on s.id=r.sale_id where r.shift_id=sh.id),0)
      - coalesce((select sum(r.cash) from public.partial_returns r where r.shift_id=sh.id),0))
      from public.shifts sh where sh.business_id=p_business and sh.store_id=p_store and sh.closed_at is null)
  ) into result;
  return result;
end
$$;
revoke all on function public.dashboard_cash(uuid,uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.dashboard_cash(uuid,uuid,timestamptz,timestamptz) to authenticated;
