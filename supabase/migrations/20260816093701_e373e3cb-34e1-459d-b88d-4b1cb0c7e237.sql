-- 1. reminder tracking column
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS reminder_sent boolean NOT NULL DEFAULT false;

-- 2. Generic event-driven push helpers (include alert_type so the sender can
--    resolve the configured custom sound for the event).
CREATE OR REPLACE FUNCTION public.notify_push_event(
  _user_type text,
  _user_id uuid,
  _alert_type text,
  _title text,
  _body text,
  _data jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  _base text := 'https://dkneclwmmjlqswovtqno.supabase.co/functions/v1';
  _secret text;
BEGIN
  BEGIN
    IF _user_id IS NULL THEN RETURN; END IF;
    SELECT value INTO _secret FROM public.edge_runtime_config WHERE key = 'push_trigger_secret';
    IF _secret IS NULL OR _secret = '' THEN RETURN; END IF;

    PERFORM net.http_post(
      url := _base || '/send-push-notification',
      headers := jsonb_build_object(
        'content-type','application/json',
        'x-internal-secret', _secret
      ),
      body := jsonb_build_object(
        'user_type', _user_type,
        'user_id', _user_id,
        'alert_type', _alert_type,
        'title', _title,
        'body', _body,
        'data', COALESCE(_data, '{}'::jsonb) || jsonb_build_object('alert_type', _alert_type)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[notify_push_event] % failed for %: %', _alert_type, _user_id, SQLERRM;
  END;
END;$$;

CREATE OR REPLACE FUNCTION public.notify_expert_alert(
  _expert_id uuid, _alert_type text, _title text, _body text, _data jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.notify_push_event('expert', _expert_id, _alert_type, _title, _body, _data);
$$;

CREATE OR REPLACE FUNCTION public.notify_customer_alert(
  _booking_id uuid, _alert_type text, _title text, _body text, _data jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _user_id uuid;
BEGIN
  SELECT user_id INTO _user_id FROM public.bookings WHERE id = _booking_id;
  IF _user_id IS NULL THEN RETURN; END IF;
  PERFORM public.notify_push_event(
    'customer', _user_id, _alert_type, _title, _body,
    COALESCE(_data,'{}'::jsonb) || jsonb_build_object('booking_id', _booking_id)
  );
END;$$;

REVOKE ALL ON FUNCTION public.notify_push_event(text,uuid,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_expert_alert(uuid,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_customer_alert(uuid,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;

-- 3. Broadcast pushes now flow through the sound-aware sender.
CREATE OR REPLACE FUNCTION public.notify_expert_broadcast(_expert_id uuid, _booking_id uuid, _title text, _body text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  IF _expert_id IS NULL THEN RETURN; END IF;
  PERFORM public.notify_expert_alert(
    _expert_id, 'new_order', _title, _body,
    jsonb_build_object('booking_id', _booking_id, 'type', 'new_booking_broadcast', 'route', 'booking/' || _booking_id::text)
  );
END;$$;

-- 4. Customer cancellation: alert the assigned expert with order_cancelled.
CREATE OR REPLACE FUNCTION public.customer_cancel_booking_apply(_booking_id uuid, _cancellation_fee numeric, _refund_amount numeric, _refund_id text, _refund_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _current text;
  _assigned uuid;
  _owner uuid;
  _before jsonb;
  _after jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT to_jsonb(b), b.status, b.assigned_expert_id, b.user_id
    INTO _before, _current, _assigned, _owner
    FROM public.bookings b WHERE b.id = _booking_id FOR UPDATE;
  IF _before IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _owner IS DISTINCT FROM _uid THEN RAISE EXCEPTION 'Forbidden'; END IF;

  IF _current NOT IN ('confirmed','accepted','expert_assigned') THEN
    RAISE EXCEPTION 'Cannot cancel — service has already started or booking is in terminal state (status: %)', _current;
  END IF;

  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings
     SET status = 'cancelled',
         cancellation_reason = 'customer_cancelled',
         cancellation_fee = _cancellation_fee,
         refund_amount = _refund_amount,
         refund_id = _refund_id,
         refund_status = _refund_status,
         cancelled_by = 'customer',
         cancelled_at = now()
   WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);

  IF _assigned IS NOT NULL THEN
    UPDATE public.experts SET is_busy = false WHERE id = _assigned;
  END IF;

  SELECT to_jsonb(b) INTO _after FROM public.bookings b WHERE id = _booking_id;
  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'customer_cancel_booking', 'bookings', _booking_id, _before,
          _after || jsonb_build_object('actor_role','customer'));

  PERFORM public.notify_customer_push(
    _booking_id,
    'Booking cancelled',
    CASE
      WHEN _refund_amount > 0 THEN 'Your booking was cancelled. Refund of ₹' || _refund_amount::text || ' is being processed.'
      ELSE 'Your booking was cancelled. No refund applicable.'
    END,
    'home'
  );

  IF _assigned IS NOT NULL THEN
    PERFORM public.notify_expert_alert(
      _assigned,
      'order_cancelled',
      'Booking cancelled',
      'The booking assigned to you was cancelled by the customer.',
      jsonb_build_object('booking_id', _booking_id, 'route', 'home')
    );
  END IF;

  RETURN jsonb_build_object(
    'new_status','cancelled',
    'cancellation_fee', _cancellation_fee,
    'refund_amount', _refund_amount,
    'refund_id', _refund_id,
    'refund_status', _refund_status
  );
END;$$;

-- 5. Completion: notify BOTH customer and expert with order_completed.
CREATE OR REPLACE FUNCTION public.expert_verify_end_otp(_booking_id uuid, _otp text)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _expert_id uuid; _b record; _payout numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  _expert_id := public.get_expert_id_for_auth(auth.uid());
  IF _expert_id IS NULL THEN RAISE EXCEPTION 'Not an expert'; END IF;
  IF _otp IS NULL OR btrim(_otp) = '' THEN RAISE EXCEPTION 'OTP required'; END IF;

  SELECT id, assigned_expert_id, status, end_otp, service_duration_minutes
    INTO _b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF _b.id IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _b.assigned_expert_id <> _expert_id THEN RAISE EXCEPTION 'Not your booking'; END IF;
  IF _b.status = 'completed' THEN
    SELECT COALESCE(expert_payout,0) INTO _payout FROM public.service_catalogue_config
      WHERE duration_minutes = _b.service_duration_minutes AND is_active = true
      ORDER BY created_at DESC LIMIT 1;
    RETURN COALESCE(_payout, 0);
  END IF;
  IF _b.status <> 'in_progress' THEN RAISE EXCEPTION 'Booking not in progress'; END IF;
  IF _b.end_otp IS NULL OR btrim(_otp) <> _b.end_otp THEN RAISE EXCEPTION 'Invalid end OTP'; END IF;

  SELECT COALESCE(expert_payout,0) INTO _payout FROM public.service_catalogue_config
    WHERE duration_minutes = _b.service_duration_minutes AND is_active = true
    ORDER BY created_at DESC LIMIT 1;
  _payout := COALESCE(_payout, 0);

  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings
     SET status = 'completed', service_end_at = COALESCE(service_end_at, now()), updated_at = now()
   WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);

  UPDATE public.experts SET is_busy = false WHERE id = _expert_id;

  IF _payout > 0 THEN
    INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
    VALUES('expert', _expert_id, _payout, 'credit', 'Booking payout: ' || _booking_id::text, NULL);
    UPDATE public.experts SET wallet_balance = COALESCE(wallet_balance,0) + _payout WHERE id = _expert_id;
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
END $$;

-- 6. 10-minute completion reminders (pg_cron, once per booking).
CREATE OR REPLACE FUNCTION public.send_completion_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _r record; _count integer := 0;
BEGIN
  FOR _r IN
    SELECT id, assigned_expert_id
      FROM public.bookings
     WHERE status = 'in_progress'
       AND reminder_sent = false
       AND service_end_at IS NOT NULL
       AND service_end_at BETWEEN now() + interval '9 minutes' AND now() + interval '11 minutes'
     FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM public.notify_customer_alert(
      _r.id, 'reminder_10min', 'Service ending soon',
      'Your service ends in about 10 minutes. Need more time? You can request an extension.',
      jsonb_build_object('route', 'booking/' || _r.id::text)
    );
    IF _r.assigned_expert_id IS NOT NULL THEN
      PERFORM public.notify_expert_alert(
        _r.assigned_expert_id, 'reminder_10min', 'Job ending soon',
        'This job ends in about 10 minutes.',
        jsonb_build_object('booking_id', _r.id, 'route', 'booking/' || _r.id::text)
      );
    END IF;

    PERFORM set_config('app.booking_bypass','on', true);
    UPDATE public.bookings SET reminder_sent = true WHERE id = _r.id;
    PERFORM set_config('app.booking_bypass','off', true);
    _count := _count + 1;
  END LOOP;
  RETURN _count;
END;$$;

REVOKE ALL ON FUNCTION public.send_completion_reminders() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('send-completion-reminders')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-completion-reminders');

SELECT cron.schedule(
  'send-completion-reminders',
  '* * * * *',
  $$SELECT public.send_completion_reminders();$$
);

-- 7. Extensions are now request -> expert approval (no auto-apply/charge).
DROP FUNCTION IF EXISTS public.extend_booking(uuid, integer, text);

CREATE OR REPLACE FUNCTION public.extend_booking(_booking_id uuid, _extra_minutes integer, _razorpay_payment_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _owner uuid; _status text; _end timestamptz; _price numeric;
  _assigned uuid; _ext_id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _extra_minutes IS NULL OR _extra_minutes <= 0 THEN
    RAISE EXCEPTION 'Invalid extension duration';
  END IF;
  SELECT user_id, status, service_end_at, assigned_expert_id
    INTO _owner, _status, _end, _assigned
    FROM public.bookings WHERE id = _booking_id;
  IF _owner IS NULL OR _owner <> _uid THEN RAISE EXCEPTION 'Not found'; END IF;
  IF _status <> 'in_progress' OR _end IS NULL THEN
    RAISE EXCEPTION 'Service not in progress';
  END IF;
  IF now() > _end + interval '10 minutes' THEN
    RAISE EXCEPTION 'Extension window closed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.booking_extensions
     WHERE booking_id = _booking_id AND approval_status = 'pending'
  ) THEN
    RAISE EXCEPTION 'An extension request is already pending';
  END IF;

  SELECT price INTO _price FROM public.service_catalogue_config
    WHERE duration_minutes = _extra_minutes AND is_active = true
    ORDER BY created_at DESC LIMIT 1;
  IF _price IS NULL THEN RAISE EXCEPTION 'Extension duration not available'; END IF;

  -- Create the request only: booking is NOT extended and no charge is applied
  -- until the assigned expert accepts via partner_decide_extension().
  INSERT INTO public.booking_extensions(booking_id, extra_minutes, price, razorpay_payment_id, approval_status)
    VALUES(_booking_id, _extra_minutes, _price, NULLIF(btrim(_razorpay_payment_id), ''), 'pending')
    RETURNING id INTO _ext_id;

  IF _assigned IS NOT NULL THEN
    PERFORM public.notify_expert_alert(
      _assigned, 'extension_request', 'Extension requested',
      'Customer requested ' || _extra_minutes::text || ' more minutes (₹' || _price::text || ').',
      jsonb_build_object(
        'booking_id', _booking_id,
        'extension_id', _ext_id,
        'extra_minutes', _extra_minutes,
        'price', _price,
        'route', 'booking/' || _booking_id::text
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'extension_id', _ext_id,
    'approval_status', 'pending',
    'extra_minutes', _extra_minutes,
    'price', _price,
    'service_end_at', _end
  );
END;$$;

REVOKE ALL ON FUNCTION public.extend_booking(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.extend_booking(uuid, integer, text) TO authenticated;

-- 8. Expert accept/decline of an extension request.
CREATE OR REPLACE FUNCTION public.partner_decide_extension(_extension_id uuid, _decision text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _expert_id uuid; _e record; _b record; _new_end timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  _expert_id := public.get_expert_id_for_auth(auth.uid());
  IF _expert_id IS NULL THEN RAISE EXCEPTION 'Not an expert'; END IF;
  IF _decision NOT IN ('accepted','declined') THEN RAISE EXCEPTION 'Invalid decision'; END IF;

  SELECT * INTO _e FROM public.booking_extensions WHERE id = _extension_id FOR UPDATE;
  IF _e.id IS NULL THEN RAISE EXCEPTION 'Extension request not found'; END IF;
  IF _e.approval_status <> 'pending' THEN RAISE EXCEPTION 'Extension already %', _e.approval_status; END IF;

  SELECT id, assigned_expert_id, status, service_end_at
    INTO _b FROM public.bookings WHERE id = _e.booking_id FOR UPDATE;
  IF _b.id IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _b.assigned_expert_id IS DISTINCT FROM _expert_id THEN RAISE EXCEPTION 'Not your booking'; END IF;

  IF _decision = 'accepted' THEN
    IF _b.status <> 'in_progress' OR _b.service_end_at IS NULL THEN
      RAISE EXCEPTION 'Service not in progress';
    END IF;
    _new_end := GREATEST(_b.service_end_at, now()) + make_interval(mins => _e.extra_minutes);

    PERFORM set_config('app.booking_bypass','on', true);
    UPDATE public.bookings
       SET service_end_at = _new_end,
           price = COALESCE(price,0) + COALESCE(_e.price,0),
           reminder_sent = false,
           updated_at = now()
     WHERE id = _b.id;
    PERFORM set_config('app.booking_bypass','off', true);
  END IF;

  UPDATE public.booking_extensions SET approval_status = _decision WHERE id = _extension_id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), 'partner_decide_extension', 'booking_extensions', _extension_id,
          to_jsonb(_e), jsonb_build_object('approval_status', _decision, 'new_service_end_at', _new_end));

  PERFORM public.notify_customer_alert(
    _e.booking_id, 'extension_decided',
    CASE WHEN _decision = 'accepted' THEN 'Extension approved' ELSE 'Extension declined' END,
    CASE WHEN _decision = 'accepted'
      THEN 'Your expert approved ' || _e.extra_minutes::text || ' extra minutes.'
      ELSE 'Your expert declined the extra time request.' END,
    jsonb_build_object(
      'extension_id', _extension_id,
      'decision', _decision,
      'extra_minutes', _e.extra_minutes,
      'price', _e.price,
      'service_end_at', COALESCE(_new_end, _b.service_end_at),
      'route', 'booking/' || _e.booking_id::text
    )
  );

  RETURN jsonb_build_object(
    'extension_id', _extension_id,
    'approval_status', _decision,
    'service_end_at', COALESCE(_new_end, _b.service_end_at)
  );
END;$$;

REVOKE ALL ON FUNCTION public.partner_decide_extension(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_decide_extension(uuid, text) TO authenticated;