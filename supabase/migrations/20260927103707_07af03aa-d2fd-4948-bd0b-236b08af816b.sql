CREATE OR REPLACE FUNCTION public.staff_list_unassigned_business_trips()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.business_require_ops();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'courier_order_id', c.id, 'batch_id', b.id, 'order_code', c.order_code, 'status', c.status,
      'merchant_id', c.business_merchant_id, 'business_name', bp.business_name,
      'trip_no', b.trip_no, 'trip_label', b.trip_label, 'drops', b.drops_count,
      'total_amount', c.total_amount, 'search_started_at', c.search_started_at,
      'needs_ops_attention', c.needs_ops_attention) order by c.created_at)
    from public.courier_orders c
    left join public.business_batches b on b.courier_order_id=c.id
    left join public.business_profiles bp on bp.merchant_id=c.business_merchant_id
   where c.source='business' and c.status in ('REQUESTED','SEARCHING') and c.assigned_expert_id is null), '[]'::jsonb);
end
$function$;