create function public.receive_purchase_batch(p_business uuid,p_store uuid,p_supplier uuid,p_reference text,p_lines jsonb)
returns uuid[] language plpgsql set search_path='' as $$
declare v_line record; v_ids uuid[]:='{}';
begin
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'invalid purchase lines'; end if;
  if jsonb_array_length(p_lines) not between 1 and 100 then raise exception 'invalid purchase line count'; end if;
  for v_line in select * from jsonb_to_recordset(p_lines) as l(product_id uuid,quantity numeric,total bigint) order by product_id loop
    v_ids:=array_append(v_ids,commerce_private.receive_purchase(p_business,p_store,v_line.product_id,p_supplier,
      v_line.quantity,v_line.total,p_reference));
  end loop;
  return v_ids;
end
$$;
revoke all on function public.receive_purchase_batch(uuid,uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.receive_purchase_batch(uuid,uuid,uuid,text,jsonb) to authenticated;
