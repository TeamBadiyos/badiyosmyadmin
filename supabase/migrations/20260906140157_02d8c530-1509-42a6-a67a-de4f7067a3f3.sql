
CREATE OR REPLACE FUNCTION public.resolve_booking_payouts(_booking_id uuid)
RETURNS TABLE(expert_payout numeric, area_partner_payout numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _b record; _ep numeric; _ap numeric;
BEGIN
  SELECT id, service_label, service_duration_minutes, service_category_id
    INTO _b FROM public.bookings WHERE id = _booking_id;
  IF _b.id IS NULL THEN
    RETURN QUERY SELECT 0::numeric, 0::numeric; RETURN;
  END IF;

  SELECT COALESCE(spo.expert_payout,0), COALESCE(spo.partner_commission,0)
    INTO _ep, _ap
    FROM public.service_price_options spo
    JOIN public.services s ON s.id = spo.service_id
   WHERE lower(spo.label) = lower(COALESCE(_b.service_label,''))
     AND (_b.service_category_id IS NULL OR s.category_id = _b.service_category_id)
     AND spo.is_active
   ORDER BY (s.category_id = _b.service_category_id) DESC, spo.display_order
   LIMIT 1;

  IF _ep IS NULL THEN
    SELECT COALESCE(spo.expert_payout,0), COALESCE(spo.partner_commission,0)
      INTO _ep, _ap
      FROM public.service_price_options spo
     WHERE spo.duration_minutes = _b.service_duration_minutes
       AND spo.is_active
     ORDER BY spo.display_order
     LIMIT 1;
  END IF;

  IF _ep IS NULL THEN
    SELECT COALESCE(sc.expert_payout,0), COALESCE(sc.area_partner_payout,0)
      INTO _ep, _ap
      FROM public.service_catalogue_config sc
     WHERE sc.duration_minutes = _b.service_duration_minutes AND sc.is_active
     ORDER BY sc.created_at DESC
     LIMIT 1;
  END IF;

  RETURN QUERY SELECT COALESCE(_ep,0), COALESCE(_ap,0);
END $$;

REVOKE ALL ON FUNCTION public.resolve_booking_payouts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_booking_payouts(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.expert_verify_end_otp(_booking_id uuid, _otp text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _expert_id uuid; _b record; _payout numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  _expert_id := public.get_expert_id_for_auth(auth.uid());
  IF _expert_id IS NULL THEN RAISE EXCEPTION 'Not an expert'; END IF;
  IF _otp IS NULL OR btrim(_otp) = '' THEN RAISE EXCEPTION 'OTP required'; END IF;

  SELECT id, assigned_expert_id, status, end_otp, service_duration_minutes, user_id, price
    INTO _b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF _b.id IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _b.assigned_expert_id <> _expert_id THEN RAISE EXCEPTION 'Not your booking'; END IF;

  SELECT r.expert_payout INTO _payout FROM public.resolve_booking_payouts(_booking_id) r;
  _payout := COALESCE(_payout, 0);

  IF _b.status = 'completed' THEN
    RETURN _payout;
  END IF;
  IF _b.status <> 'in_progress' THEN RAISE EXCEPTION 'Booking not in progress'; END IF;
  IF _b.end_otp IS NULL OR btrim(_otp) <> _b.end_otp THEN RAISE EXCEPTION 'Invalid end OTP'; END IF;

  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings
     SET status = 'completed', service_end_at = COALESCE(service_end_at, now()), updated_at = now()
   WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);

  UPDATE public.experts SET is_busy = false WHERE id = _expert_id;

  IF _payout > 0 AND NOT EXISTS (
       SELECT 1 FROM public.wallet_ledger
        WHERE owner_type='expert' AND owner_id=_expert_id
          AND reason = 'Booking payout: ' || _booking_id::text) THEN
    INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
    VALUES('expert', _expert_id, _payout, 'credit', 'Booking payout: ' || _booking_id::text, NULL);
    UPDATE public.experts SET wallet_balance = COALESCE(wallet_balance,0) + _payout WHERE id = _expert_id;
  END IF;

  PERFORM public.evaluate_reward_triggers('partner', _expert_id, 'booking_completed', _booking_id::text,
    jsonb_build_object('booking_id', _booking_id, 'amount', COALESCE(_b.price,0),
                       'minutes', COALESCE(_b.service_duration_minutes,0)));
  IF _b.user_id IS NOT NULL THEN
    PERFORM public.evaluate_reward_triggers('customer', _b.user_id, 'booking_completed', _booking_id::text,
      jsonb_build_object('booking_id', _booking_id, 'amount', COALESCE(_b.price,0)));
  END IF;

  PERFORM public.notify_customer_alert(
    _booking_id, 'order_completed', 'Service completed',
    'Your booking is complete! Please rate your experience.',
    jsonb_build_object('route', 'booking/' || _booking_id::text)
  );
  PERFORM public.notify_expert_alert(
    _expert_id, 'order_completed', 'Job completed',
    'You completed the job. ₹' || _payout::text || ' has been credited to your wallet.',
    jsonb_build_object('booking_id', _booking_id, 'route', 'booking/' || _booking_id::text)
  );

  RETURN _payout;
END $function$;

CREATE OR REPLACE FUNCTION public.staff_generate_payout_batch()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _batch_id uuid;
  _ws date;
  _we date;
  _total numeric := 0;
  _used_bookings uuid[];
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  _ws := date_trunc('week', now())::date;
  _we := (_ws + INTERVAL '6 days')::date;

  IF EXISTS (SELECT 1 FROM public.payout_batches WHERE week_start=_ws AND batch_type='expert') THEN
    RAISE EXCEPTION 'Batch already exists for this week';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT b), ARRAY[]::uuid[])
    INTO _used_bookings
    FROM public.payout_batch_items p, unnest(p.booking_ids) AS b;

  INSERT INTO public.payout_batches(week_start, week_end, status, total_amount, batch_type)
    VALUES(_ws, _we, 'pending', 0, 'expert')
    RETURNING id INTO _batch_id;

  WITH cand AS (
    SELECT b.id AS booking_id, b.assigned_expert_id AS owner_id,
           (SELECT r.expert_payout FROM public.resolve_booking_payouts(b.id) r) AS payout
      FROM public.bookings b
     WHERE b.status = 'completed'
       AND b.assigned_expert_id IS NOT NULL
       AND b.updated_at::date BETWEEN _ws AND _we
       AND NOT (b.id = ANY(_used_bookings))
  ), agg AS (
    SELECT owner_id, SUM(payout) AS amount, array_agg(booking_id) AS booking_ids
      FROM cand WHERE payout > 0 GROUP BY owner_id
  )
  INSERT INTO public.payout_batch_items(batch_id, owner_type, owner_id, amount, booking_ids)
    SELECT _batch_id, 'expert', owner_id, amount, booking_ids FROM agg;

  WITH cand AS (
    SELECT b.id AS booking_id, z.assigned_area_partner_id AS owner_id,
           (SELECT r.area_partner_payout FROM public.resolve_booking_payouts(b.id) r) AS payout
      FROM public.bookings b
      JOIN public.zones z ON z.id = b.zone_id
     WHERE b.status = 'completed'
       AND b.zone_id IS NOT NULL
       AND z.assigned_area_partner_id IS NOT NULL
       AND b.updated_at::date BETWEEN _ws AND _we
       AND NOT (b.id = ANY(_used_bookings))
  ), agg AS (
    SELECT owner_id, SUM(payout) AS amount, array_agg(booking_id) AS booking_ids
      FROM cand WHERE payout > 0 GROUP BY owner_id
  )
  INSERT INTO public.payout_batch_items(batch_id, owner_type, owner_id, amount, booking_ids)
    SELECT _batch_id, 'area_partner', owner_id, amount, booking_ids FROM agg;

  SELECT COALESCE(SUM(amount),0) INTO _total FROM public.payout_batch_items WHERE batch_id=_batch_id;
  UPDATE public.payout_batches SET total_amount=_total WHERE id=_batch_id;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
    VALUES(_uid,'generate_payout_batch','payout_batches',_batch_id,NULL,
           jsonb_build_object('week_start',_ws,'week_end',_we,'total_amount',_total,'batch_type','expert'));

  RETURN _batch_id;
END $function$;

-- Back-credit missing expert earnings for past completed bookings
WITH missing AS (
  SELECT b.id AS booking_id, b.assigned_expert_id AS expert_id,
         (SELECT r.expert_payout FROM public.resolve_booking_payouts(b.id) r) AS payout
    FROM public.bookings b
   WHERE b.status = 'completed'
     AND b.assigned_expert_id IS NOT NULL
     AND COALESCE(b.deleted_at, NULL) IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.wallet_ledger w
        WHERE w.owner_type='expert' AND w.owner_id = b.assigned_expert_id
          AND w.reason = 'Booking payout: ' || b.id::text)
), ins AS (
  INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
  SELECT 'expert', expert_id, payout, 'credit', 'Booking payout: ' || booking_id::text, NULL
    FROM missing WHERE payout > 0
  RETURNING owner_id, amount
)
UPDATE public.experts e
   SET wallet_balance = COALESCE(e.wallet_balance,0) + agg.total
  FROM (SELECT owner_id, SUM(amount) AS total FROM ins GROUP BY owner_id) agg
 WHERE e.id = agg.owner_id;
