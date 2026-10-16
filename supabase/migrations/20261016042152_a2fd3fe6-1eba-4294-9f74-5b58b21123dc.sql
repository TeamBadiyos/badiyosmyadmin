CREATE OR REPLACE FUNCTION public.staff_list_refunds_all(_status text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _r jsonb;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager','finance']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  WITH a AS (
    SELECT 'booking'::text kind, b.id, coalesce(b.booking_number, upper(left(b.id::text,8))) order_number,
      CASE WHEN public.booking_capacity_group(b.service_category_id,b.service_label)='wash' THEN 'Clean Auto' ELSE 'Clean Home' END service,
      coalesce(b.service_label,'—') store_name, b.refund_amount, b.cancellation_reason refund_reason, b.refund_attempts, b.refund_id, b.refund_error, b.created_at,
      CASE b.refund_status WHEN 'pending' THEN 'refund_pending' WHEN 'refund_pending' THEN 'refund_pending' WHEN 'refunded' THEN 'done' WHEN 'done' THEN 'done' WHEN 'processing' THEN 'processing' WHEN 'failed' THEN 'failed' END st,
      b.city_id
    FROM bookings b WHERE coalesce(b.refund_amount,0) > 0 OR b.refund_status IN ('pending','processing','failed','refunded')
    UNION ALL
    SELECT 'courier', c.id, coalesce(c.order_code, upper(left(c.id::text,8))), 'Parcel', '—', c.refund_amount, c.refund_reason, c.refund_attempts, c.refund_id, NULL, c.created_at,
      CASE c.refund_status WHEN 'refund_pending' THEN 'refund_pending' WHEN 'pending' THEN 'refund_pending' WHEN 'processing' THEN 'processing' WHEN 'done' THEN 'done' WHEN 'refunded' THEN 'done' WHEN 'failed' THEN 'failed' END,
      c.city_id
    FROM courier_orders c WHERE c.refund_status NOT IN ('none','not_applicable')
    UNION ALL
    SELECT 'merchant', o.id, o.order_number, CASE WHEN m.service_type='food' THEN 'Food' ELSE 'Store' END, coalesce(m.store_name,'—'), o.refund_amount, o.refund_reason, o.refund_attempts, o.refund_id, NULL, o.created_at,
      o.refund_status, o.city_id
    FROM merchant_orders o LEFT JOIN merchants m ON m.id=o.merchant_id WHERE o.refund_status IN ('refund_pending','processing','done','failed')
  )
  SELECT coalesce(jsonb_agg(to_jsonb(a) || jsonb_build_object('refunded_to',
      CASE WHEN EXISTS (SELECT 1 FROM customer_wallet_ledger l WHERE l.type='refund_in' AND l.ref_id=a.id::text) THEN 'Wallet' ELSE 'Original' END)
    ORDER BY a.created_at DESC), '[]'::jsonb) INTO _r
  FROM (SELECT * FROM a WHERE st = _status LIMIT 500) a;
  RETURN _r;
END $function$;