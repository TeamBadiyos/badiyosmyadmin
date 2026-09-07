-- 1) Restore staff EXECUTE on the eligible-experts lookup (lost in a grant cleanup)
GRANT EXECUTE ON FUNCTION public.get_eligible_experts_for_booking(uuid) TO authenticated;

-- 2) Stop wiping the Razorpay references supplied at booking creation.
CREATE OR REPLACE FUNCTION public.bookings_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _price numeric;
  _addr_lat numeric;
  _addr_lng numeric;
  _bypass text;
  _cat uuid;
BEGIN
  BEGIN _bypass := current_setting('app.booking_bypass', true); EXCEPTION WHEN OTHERS THEN _bypass := NULL; END;

  SELECT price INTO _price FROM public.service_catalogue_config
   WHERE duration_minutes = NEW.service_duration_minutes AND is_active = true
   ORDER BY created_at DESC LIMIT 1;
  IF _price IS NULL THEN
    RAISE EXCEPTION 'Invalid service duration';
  END IF;
  NEW.price := _price;
  NEW.status := 'confirmed';
  NEW.rating := NULL;
  NEW.review_text := NULL;

  IF _bypass IS DISTINCT FROM 'on' THEN
    NEW.assigned_expert_id := NULL;
    -- razorpay_order_id / razorpay_payment_id are intentionally preserved:
    -- the Customer app sets them only after a successful checkout, and the
    -- webhook safety-net reconciles them afterwards.
    NEW.refund_id := NULL;
    NEW.refund_status := NULL;
    NEW.refund_amount := NULL;
    NEW.cancellation_fee := NULL;
    NEW.cancellation_reason := NULL;
    NEW.cancelled_by := NULL;
    NEW.cancelled_at := NULL;
    NEW.started_at := NULL;
    NEW.service_end_at := NULL;
    NEW.start_otp := NULL;
    NEW.end_otp := NULL;
    NEW.broadcast_started_at := NULL;
    NEW.current_search_radius_km := NULL;
    NEW.deleted_at := NULL;
    NEW.deleted_by := NULL;
    NEW.delete_reason := NULL;
  END IF;

  IF NEW.service_category_id IS NULL THEN
    SELECT sv.category_id INTO _cat
      FROM public.service_price_options spo
      JOIN public.services sv ON sv.id = spo.service_id
      JOIN public.service_categories sc ON sc.id = sv.category_id
     WHERE spo.is_active = true AND sv.is_active = true AND sc.is_active = true
       AND lower(spo.label) = lower(COALESCE(NEW.service_label, ''))
     ORDER BY spo.display_order
     LIMIT 1;

    IF _cat IS NULL AND NEW.service_duration_minutes IS NOT NULL THEN
      SELECT sv.category_id INTO _cat
        FROM public.service_price_options spo
        JOIN public.services sv ON sv.id = spo.service_id
        JOIN public.service_categories sc ON sc.id = sv.category_id
       WHERE spo.is_active = true AND sv.is_active = true AND sc.is_active = true
         AND spo.duration_minutes = NEW.service_duration_minutes
       ORDER BY spo.display_order
       LIMIT 1;
    END IF;

    IF _cat IS NULL THEN
      SELECT scc.service_category_id INTO _cat
        FROM public.service_catalogue_config scc
       WHERE scc.is_active = true
         AND scc.duration_minutes = NEW.service_duration_minutes
         AND scc.service_category_id IS NOT NULL
       ORDER BY scc.created_at DESC
       LIMIT 1;
    END IF;

    NEW.service_category_id := _cat;
  END IF;

  IF (NEW.booking_lat IS NULL OR NEW.booking_lng IS NULL) AND NEW.address_id IS NOT NULL THEN
    SELECT latitude, longitude INTO _addr_lat, _addr_lng
      FROM public.addresses WHERE id = NEW.address_id;
    IF NEW.booking_lat IS NULL THEN NEW.booking_lat := _addr_lat; END IF;
    IF NEW.booking_lng IS NULL THEN NEW.booking_lng := _addr_lng; END IF;
  END IF;

  IF NEW.booking_lat IS NULL OR NEW.booking_lng IS NULL THEN
    RAISE EXCEPTION 'Booking requires geographic coordinates: booking_lat/booking_lng were not provided and could not be resolved from address_id %', NEW.address_id
      USING ERRCODE = 'check_violation', HINT = 'Ensure the selected address has latitude/longitude, or pass booking_lat/booking_lng explicitly.';
  END IF;

  RETURN NEW;
END;
$$;

-- 3) Backfill payment references from fulfilled payment intents
UPDATE public.bookings b
   SET razorpay_payment_id = COALESCE(b.razorpay_payment_id, pi.razorpay_payment_id),
       razorpay_order_id   = COALESCE(b.razorpay_order_id, pi.razorpay_order_id)
  FROM public.payment_intents pi
 WHERE pi.booking_id = b.id
   AND pi.razorpay_payment_id IS NOT NULL
   AND b.razorpay_payment_id IS NULL;

-- 4) Notify the submitter when a ticket is resolved
CREATE OR REPLACE FUNCTION public.staff_update_support_ticket(_ticket_id uuid, _status text, _note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _staff_id uuid;
  _before jsonb;
  _ticket public.support_tickets%ROWTYPE;
  _target uuid;
  _body text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _status NOT IN ('open','in_progress','resolved') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  SELECT id INTO _staff_id FROM public.staff_users WHERE auth_user_id = _uid;

  SELECT to_jsonb(t) INTO _before FROM public.support_tickets t WHERE t.id = _ticket_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Ticket not found'; END IF;

  UPDATE public.support_tickets
     SET status = _status,
         internal_note = COALESCE(_note, internal_note),
         resolved_at = CASE WHEN _status = 'resolved' THEN COALESCE(resolved_at, now()) ELSE NULL END,
         resolved_by = CASE WHEN _status = 'resolved' THEN _staff_id ELSE NULL END,
         updated_at = now()
   WHERE id = _ticket_id;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES(_uid, 'update_support_ticket', 'support_tickets', _ticket_id, _before,
         jsonb_build_object('status', _status, 'internal_note', _note));

  IF _status = 'resolved' AND (_before->>'status') IS DISTINCT FROM 'resolved' THEN
    SELECT * INTO _ticket FROM public.support_tickets WHERE id = _ticket_id;
    _body := COALESCE(NULLIF(btrim(COALESCE(_note, _ticket.internal_note, '')), ''),
                      'Your support request has been resolved by our team.');

    IF _ticket.source = 'partner' THEN
      SELECT e.id INTO _target FROM public.experts e WHERE e.auth_user_id = _ticket.user_id LIMIT 1;
      IF _target IS NOT NULL THEN
        PERFORM public.notify_push_event('expert', _target, 'support_resolved',
          'Support request resolved', _body,
          jsonb_build_object('ticket_id', _ticket_id, 'route', 'support'));
      END IF;
    ELSIF _ticket.source = 'merchant' THEN
      SELECT m.id INTO _target FROM public.merchants m WHERE m.auth_user_id = _ticket.user_id LIMIT 1;
      IF _target IS NOT NULL THEN
        PERFORM public.notify_push_event('merchant', _target, 'support_resolved',
          'Support request resolved', _body,
          jsonb_build_object('ticket_id', _ticket_id, 'route', 'support'));
      END IF;
    ELSE
      PERFORM public.notify_push_event('customer', _ticket.user_id, 'support_resolved',
        'Support request resolved', _body,
        jsonb_build_object('ticket_id', _ticket_id, 'route', 'support'));
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.staff_update_support_ticket(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_update_support_ticket(uuid, text, text) TO authenticated;