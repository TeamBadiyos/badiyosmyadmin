
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS dispatch_exhausted_at timestamptz;

ALTER TABLE public.dispatch_config
  ADD COLUMN IF NOT EXISTS no_expert_timeout_minutes integer NOT NULL DEFAULT 30;

CREATE INDEX IF NOT EXISTS bookings_searching_idx
  ON public.bookings (status, broadcast_started_at)
  WHERE assigned_expert_id IS NULL AND deleted_at IS NULL;

-- Mark bookings whose radius has fully expanded and still have no expert.
CREATE OR REPLACE FUNCTION public.expand_stale_broadcasts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  cfg record;
  b record;
  _new_radius numeric;
  _expanded integer := 0;
BEGIN
  SELECT * INTO cfg FROM public.dispatch_config LIMIT 1;
  IF cfg.id IS NULL THEN RETURN 0; END IF;

  FOR b IN
    SELECT id, COALESCE(current_search_radius_km, cfg.broadcast_radius_km) AS radius
    FROM public.bookings
    WHERE status = 'accepted'
      AND assigned_expert_id IS NULL
      AND deleted_at IS NULL
      AND broadcast_started_at IS NOT NULL
      AND broadcast_started_at < now() - make_interval(secs => cfg.radius_expand_after_seconds)
      AND COALESCE(current_search_radius_km, cfg.broadcast_radius_km) < cfg.radius_expand_max_km
  LOOP
    _new_radius := LEAST(b.radius + cfg.radius_expand_step_km, cfg.radius_expand_max_km);
    UPDATE public.bookings SET current_search_radius_km = _new_radius WHERE id = b.id;
    PERFORM public.broadcast_booking_to_experts(b.id, _new_radius);
    _expanded := _expanded + 1;
  END LOOP;

  -- Flag max-radius-exhausted bookings so staff can intervene manually.
  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings
     SET dispatch_exhausted_at = now()
   WHERE status = 'accepted'
     AND assigned_expert_id IS NULL
     AND deleted_at IS NULL
     AND dispatch_exhausted_at IS NULL
     AND broadcast_started_at IS NOT NULL
     AND broadcast_started_at < now() - make_interval(secs => cfg.radius_expand_after_seconds)
     AND COALESCE(current_search_radius_km, cfg.broadcast_radius_km) >= cfg.radius_expand_max_km;
  PERFORM set_config('app.booking_bypass','off', true);

  RETURN _expanded;
END;
$function$;

-- Candidate list for the auto-expiry worker (service role only).
CREATE OR REPLACE FUNCTION public.system_list_expired_unassigned_bookings()
 RETURNS TABLE (id uuid, price numeric, razorpay_payment_id text, broadcast_started_at timestamptz, created_at timestamptz)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT b.id, b.price, b.razorpay_payment_id, b.broadcast_started_at, b.created_at
  FROM public.bookings b
  CROSS JOIN LATERAL (SELECT COALESCE((SELECT no_expert_timeout_minutes FROM public.dispatch_config LIMIT 1), 30) AS mins) cfg
  WHERE b.status IN ('confirmed','accepted')
    AND b.assigned_expert_id IS NULL
    AND b.deleted_at IS NULL
    AND COALESCE(b.broadcast_started_at, b.created_at) < now() - make_interval(mins => cfg.mins)
  ORDER BY COALESCE(b.broadcast_started_at, b.created_at)
  LIMIT 50;
$function$;

REVOKE ALL ON FUNCTION public.system_list_expired_unassigned_bookings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.system_list_expired_unassigned_bookings() TO service_role;

-- Auto-cancel + refund record for bookings no expert ever accepted.
CREATE OR REPLACE FUNCTION public.system_auto_cancel_booking_no_expert(
  _booking_id uuid,
  _refund_amount numeric,
  _refund_id text,
  _refund_status text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _before jsonb;
  _after jsonb;
  _current text;
  _assigned uuid;
BEGIN
  SELECT to_jsonb(b), b.status, b.assigned_expert_id
    INTO _before, _current, _assigned
    FROM public.bookings b WHERE b.id = _booking_id FOR UPDATE;
  IF _before IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;

  IF _current NOT IN ('confirmed','accepted') OR _assigned IS NOT NULL THEN
    RETURN jsonb_build_object('skipped', true, 'status', _current);
  END IF;

  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings
     SET status = 'cancelled',
         cancellation_reason = 'no_expert_available',
         cancellation_fee = 0,
         refund_amount = COALESCE(_refund_amount, 0),
         refund_id = _refund_id,
         refund_status = _refund_status,
         cancelled_by = 'system',
         cancelled_at = now(),
         dispatch_exhausted_at = COALESCE(dispatch_exhausted_at, now())
   WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);

  SELECT to_jsonb(b) INTO _after FROM public.bookings b WHERE b.id = _booking_id;
  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (
    COALESCE((SELECT id FROM public.staff_users WHERE role = 'super_admin' AND status = 'active' ORDER BY created_at LIMIT 1), _booking_id),
    'auto_cancel_no_expert', 'bookings', _booking_id, _before,
    _after || jsonb_build_object('actor_role','system')
  );

  PERFORM public.notify_customer_push(
    _booking_id,
    'No expert available',
    CASE
      WHEN COALESCE(_refund_amount,0) > 0
        THEN 'We could not find an expert for your booking. It has been cancelled and ₹' || _refund_amount::text || ' has been refunded to your original payment method.'
      ELSE 'We could not find an expert for your booking. It has been cancelled and any payment will be refunded.'
    END,
    'home'
  );

  RETURN jsonb_build_object('ok', true, 'new_status', 'cancelled', 'refund_amount', COALESCE(_refund_amount,0), 'refund_id', _refund_id, 'refund_status', _refund_status);
END;
$function$;

REVOKE ALL ON FUNCTION public.system_auto_cancel_booking_no_expert(uuid, numeric, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.system_auto_cancel_booking_no_expert(uuid, numeric, text, text) TO service_role;

-- Ops reporting: dispatch failures in a window.
CREATE OR REPLACE FUNCTION public.staff_dispatch_failure_stats(_from date, _to date)
 RETURNS TABLE (day date, failures bigint, refunded numeric)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (b.cancelled_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
         count(*)::bigint AS failures,
         COALESCE(sum(b.refund_amount), 0) AS refunded
  FROM public.bookings b
  WHERE b.cancellation_reason = 'no_expert_available'
    AND b.cancelled_at >= _from::timestamptz
    AND b.cancelled_at < (_to + 1)::timestamptz
    AND public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager','support_agent','area_partner'])
  GROUP BY 1
  ORDER BY 1 DESC;
$function$;

REVOKE ALL ON FUNCTION public.staff_dispatch_failure_stats(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_dispatch_failure_stats(date, date) TO authenticated, service_role;
