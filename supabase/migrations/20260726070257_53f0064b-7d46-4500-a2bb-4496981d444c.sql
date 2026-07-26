-- 1. Expert push helper (mirrors notify_customer_push)
CREATE OR REPLACE FUNCTION public.notify_expert_push(_expert_id uuid, _title text, _body text, _route text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $$
DECLARE
  _base text := 'https://dkneclwmmjlqswovtqno.supabase.co/functions/v1';
  _secret text;
BEGIN
  BEGIN
    IF _expert_id IS NULL THEN RETURN; END IF;
    SELECT value INTO _secret FROM public.edge_runtime_config WHERE key = 'push_trigger_secret';
    IF _secret IS NULL OR _secret = '' THEN RETURN; END IF;

    PERFORM net.http_post(
      url := _base || '/send-push-notification',
      headers := jsonb_build_object(
        'content-type','application/json',
        'x-internal-secret', _secret
      ),
      body := jsonb_build_object(
        'user_type','expert',
        'user_id', _expert_id,
        'title', _title,
        'body', _body,
        'data', jsonb_build_object('route', _route)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[notify_expert_push] failed for expert %: %', _expert_id, SQLERRM;
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_expert_push(uuid,text,text,text) FROM PUBLIC, anon, authenticated;

-- Variant that also carries booking metadata + type in data payload
CREATE OR REPLACE FUNCTION public.notify_expert_broadcast(_expert_id uuid, _booking_id uuid, _title text, _body text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $$
DECLARE
  _base text := 'https://dkneclwmmjlqswovtqno.supabase.co/functions/v1';
  _secret text;
BEGIN
  BEGIN
    IF _expert_id IS NULL THEN RETURN; END IF;
    SELECT value INTO _secret FROM public.edge_runtime_config WHERE key = 'push_trigger_secret';
    IF _secret IS NULL OR _secret = '' THEN RETURN; END IF;

    PERFORM net.http_post(
      url := _base || '/send-push-notification',
      headers := jsonb_build_object(
        'content-type','application/json',
        'x-internal-secret', _secret
      ),
      body := jsonb_build_object(
        'user_type','expert',
        'user_id', _expert_id,
        'title', _title,
        'body', _body,
        'data', jsonb_build_object('type','new_booking_broadcast','route','home','booking_id', _booking_id)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[notify_expert_broadcast] failed for expert %: %', _expert_id, SQLERRM;
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_expert_broadcast(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;

-- 2. Broadcast trigger: fires ONCE per booking when it enters 'accepted' with no expert.
--    Does NOT fire on eligibility polling (polling issues SELECTs, not UPDATEs).
--    Does NOT re-fire on subsequent updates because we require the status transition
--    (OLD.status IS DISTINCT FROM 'accepted' AND NEW.status = 'accepted').
CREATE OR REPLACE FUNCTION public.on_booking_broadcast_start()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $$
DECLARE
  _radius numeric;
  _duration_text text;
  _body text;
  _title text := 'New booking nearby';
  r record;
BEGIN
  IF NEW.status <> 'accepted' THEN RETURN NEW; END IF;
  IF NEW.assigned_expert_id IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  IF NEW.booking_lat IS NULL OR NEW.booking_lng IS NULL THEN RETURN NEW; END IF;

  SELECT broadcast_radius_km INTO _radius FROM public.dispatch_config LIMIT 1;
  IF _radius IS NULL THEN _radius := 5; END IF;

  IF NEW.service_duration_minutes IS NOT NULL THEN
    IF NEW.service_duration_minutes >= 60 AND NEW.service_duration_minutes % 60 = 0 THEN
      _duration_text := (NEW.service_duration_minutes / 60)::text || 'h';
    ELSE
      _duration_text := NEW.service_duration_minutes::text || ' min';
    END IF;
  ELSE
    _duration_text := 'A';
  END IF;
  _body := _duration_text || ' booking available near you — tap to view.';

  FOR r IN
    SELECT e.id
    FROM public.experts e
    WHERE e.is_online = true
      AND COALESCE(e.is_busy,false) = false
      AND e.current_lat IS NOT NULL
      AND e.current_lng IS NOT NULL
      AND e.status = 'active'
      AND public.haversine_km(e.current_lat, e.current_lng, NEW.booking_lat, NEW.booking_lng) <= _radius
  LOOP
    PERFORM public.notify_expert_broadcast(r.id, NEW.id, _title, _body);
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_booking_broadcast_start_ins ON public.bookings;
DROP TRIGGER IF EXISTS trg_booking_broadcast_start_upd ON public.bookings;
CREATE TRIGGER trg_booking_broadcast_start_ins
  AFTER INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.on_booking_broadcast_start();
CREATE TRIGGER trg_booking_broadcast_start_upd
  AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.on_booking_broadcast_start();

-- 3. Notify assigned expert on staff cancellation
CREATE OR REPLACE FUNCTION public.staff_cancel_booking(_booking_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _current text;
  _assigned uuid;
  _before jsonb;
  _after jsonb;
  _body text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT role INTO _role FROM public.staff_users WHERE auth_user_id = _uid AND status='active';
  IF _role IS NULL OR _role NOT IN ('super_admin','ops_manager') THEN RAISE EXCEPTION 'Forbidden'; END IF;

  IF _reason IS NULL OR _reason NOT IN ('SAFETY','FRAUD','DUPLICATE','MANUAL_OVERRIDE','OTHER') THEN
    RAISE EXCEPTION 'Invalid reason';
  END IF;

  SELECT to_jsonb(b), status, assigned_expert_id
    INTO _before, _current, _assigned
    FROM public.bookings b WHERE id = _booking_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _current IN ('completed','cancelled','rejected') THEN
    RAISE EXCEPTION 'Booking already in terminal state: %', _current;
  END IF;

  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings SET status = 'cancelled', cancellation_reason = _reason WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);

  IF _assigned IS NOT NULL AND _current IN ('expert_assigned','in_progress') THEN
    UPDATE public.experts SET is_busy = false WHERE id = _assigned;
  END IF;

  SELECT to_jsonb(b) INTO _after FROM public.bookings b WHERE id = _booking_id;
  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'cancel_booking', 'bookings', _booking_id, _before, _after);

  _body := 'Your booking has been cancelled. Reason: ' || _reason;
  PERFORM public.notify_customer_push(_booking_id, 'Booking cancelled', _body, 'home');

  IF _assigned IS NOT NULL AND _current IN ('expert_assigned','in_progress') THEN
    PERFORM public.notify_expert_push(
      _assigned,
      'Booking cancelled',
      'The booking assigned to you has been cancelled.',
      'home'
    );
  END IF;
END;
$function$;

-- 4. Same for generic status update path
CREATE OR REPLACE FUNCTION public.staff_update_booking_status(_booking_id uuid, _new_status text, _note text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _current text;
  _assigned uuid;
  _before jsonb;
  _after jsonb;
  _allowed boolean := false;
  _body text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT role INTO _role FROM public.staff_users WHERE auth_user_id = _uid AND status='active';
  IF _role IS NULL OR _role NOT IN ('super_admin','ops_manager') THEN RAISE EXCEPTION 'Forbidden'; END IF;

  SELECT to_jsonb(b), status, assigned_expert_id
    INTO _before, _current, _assigned
    FROM public.bookings b WHERE id = _booking_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;

  IF _current = 'confirmed' AND _new_status IN ('accepted','rejected','cancelled') THEN _allowed := true;
  ELSIF _current = 'accepted' AND _new_status IN ('expert_assigned','cancelled','rejected') THEN _allowed := true;
  ELSIF _current = 'expert_assigned' AND _new_status IN ('in_progress','cancelled') THEN _allowed := true;
  ELSIF _current = 'in_progress' AND _new_status IN ('completed','cancelled') THEN _allowed := true;
  END IF;

  IF NOT _allowed THEN RAISE EXCEPTION 'Invalid status transition from % to %', _current, _new_status; END IF;

  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings SET status = _new_status WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);

  IF _assigned IS NOT NULL AND _new_status IN ('completed','cancelled','rejected') AND _current IN ('expert_assigned','in_progress') THEN
    UPDATE public.experts SET is_busy = false WHERE id = _assigned;
  END IF;

  SELECT to_jsonb(b) INTO _after FROM public.bookings b WHERE id = _booking_id;
  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'update_booking_status', 'bookings', _booking_id, _before || jsonb_build_object('note', _note), _after);

  IF _new_status = 'cancelled' THEN
    _body := 'Your booking has been cancelled.' ||
             CASE WHEN _note IS NOT NULL AND btrim(_note) <> '' THEN ' Reason: ' || _note ELSE '' END;
    PERFORM public.notify_customer_push(_booking_id, 'Booking cancelled', _body, 'home');

    IF _assigned IS NOT NULL AND _current IN ('expert_assigned','in_progress') THEN
      PERFORM public.notify_expert_push(
        _assigned,
        'Booking cancelled',
        'The booking assigned to you has been cancelled.',
        'home'
      );
    END IF;
  END IF;
END;
$function$;

-- 5. Reassignment: notify the previous expert they've been freed
CREATE OR REPLACE FUNCTION public.staff_reassign_expert(_booking_id uuid, _new_expert_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _expert_ok boolean;
  _new_busy boolean;
  _new_name text;
  _before jsonb;
  _after jsonb;
  _current_status text;
  _current_expert uuid;
  _updated_count int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT role INTO _role FROM public.staff_users WHERE auth_user_id = _uid AND status = 'active';
  IF _role IS NULL OR _role NOT IN ('super_admin','ops_manager') THEN RAISE EXCEPTION 'Forbidden'; END IF;

  SELECT (status = 'active'), COALESCE(is_busy,false), name
    INTO _expert_ok, _new_busy, _new_name
    FROM public.experts WHERE id = _new_expert_id FOR UPDATE;
  IF NOT COALESCE(_expert_ok,false) THEN RAISE EXCEPTION 'Expert not available'; END IF;
  IF _new_busy THEN RAISE EXCEPTION 'Expert already has an active booking'; END IF;

  SELECT status, assigned_expert_id INTO _current_status, _current_expert
    FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF _current_status IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _current_status <> 'expert_assigned' THEN RAISE EXCEPTION 'Booking cannot be reassigned in its current state'; END IF;

  SELECT to_jsonb(b) INTO _before FROM public.bookings b WHERE id = _booking_id;

  PERFORM set_config('app.booking_bypass', 'on', true);
  UPDATE public.bookings
     SET assigned_expert_id = _new_expert_id
   WHERE id = _booking_id AND status = 'expert_assigned' AND assigned_expert_id = _current_expert;
  GET DIAGNOSTICS _updated_count = ROW_COUNT;
  PERFORM set_config('app.booking_bypass', 'off', true);

  IF _updated_count = 0 THEN RAISE EXCEPTION 'Booking state changed, please refresh and try again'; END IF;

  IF _current_expert IS NOT NULL AND _current_expert <> _new_expert_id THEN
    UPDATE public.experts SET is_busy = false WHERE id = _current_expert;
    PERFORM public.notify_expert_push(
      _current_expert,
      'Booking reassigned',
      'This booking has been reassigned to another expert.',
      'home'
    );
  END IF;
  UPDATE public.experts SET is_busy = true WHERE id = _new_expert_id;

  SELECT to_jsonb(b) INTO _after FROM public.bookings b WHERE id = _booking_id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'reassigned_by_staff', 'bookings', _booking_id, _before, _after);

  PERFORM public.notify_customer_push(
    _booking_id,
    'Expert assigned!',
    COALESCE(_new_name, 'Your expert') || ' is on the way for your booking.',
    'booking/' || _booking_id::text
  );
END;
$function$;