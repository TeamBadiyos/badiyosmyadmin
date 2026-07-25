
-- 1. Add soft-delete columns
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS delete_reason text;

CREATE INDEX IF NOT EXISTS bookings_deleted_at_idx
  ON public.bookings (deleted_at)
  WHERE deleted_at IS NULL;

-- 2. Extend the bookings_before_update trigger to also lock the new columns
--    unless the same bypass flag is set. Reuses the existing app.booking_bypass
--    convention already used by other staff RPCs.
CREATE OR REPLACE FUNCTION public.bookings_before_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _bypass text;
BEGIN
  BEGIN _bypass := current_setting('app.booking_bypass', true); EXCEPTION WHEN OTHERS THEN _bypass := NULL; END;
  IF _bypass = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.price IS DISTINCT FROM OLD.price
     OR NEW.service_duration_minutes IS DISTINCT FROM OLD.service_duration_minutes
     OR NEW.service_label IS DISTINCT FROM OLD.service_label
     OR NEW.razorpay_order_id IS DISTINCT FROM OLD.razorpay_order_id
     OR NEW.razorpay_payment_id IS DISTINCT FROM OLD.razorpay_payment_id
     OR NEW.rating IS DISTINCT FROM OLD.rating
     OR NEW.review_text IS DISTINCT FROM OLD.review_text
     OR NEW.assigned_expert_id IS DISTINCT FROM OLD.assigned_expert_id
     OR NEW.zone_id IS DISTINCT FROM OLD.zone_id
     OR NEW.cancellation_reason IS DISTINCT FROM OLD.cancellation_reason
     OR NEW.address_id IS DISTINCT FROM OLD.address_id
     OR NEW.started_at IS DISTINCT FROM OLD.started_at
     OR NEW.service_end_at IS DISTINCT FROM OLD.service_end_at
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
     OR NEW.deleted_by IS DISTINCT FROM OLD.deleted_by
     OR NEW.delete_reason IS DISTINCT FROM OLD.delete_reason
  THEN
    RAISE EXCEPTION 'Field not updatable';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (OLD.status = 'confirmed' AND NEW.status = 'cancelled') THEN
      RAISE EXCEPTION 'Invalid status transition';
    END IF;
  END IF;
  RETURN NEW;
END;$function$;

-- 3. staff_edit_booking: super_admin + ops_manager can edit non-terminal, non-deleted bookings.
CREATE OR REPLACE FUNCTION public.staff_edit_booking(_booking_id uuid, _payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _current record;
  _before jsonb := '{}'::jsonb;
  _after  jsonb := '{}'::jsonb;
  _new_duration int;
  _new_price numeric;
  _new_addr uuid;
  _new_date date;
  _new_slot text;
  _has_duration boolean;
  _has_price boolean;
  _has_addr boolean;
  _has_date boolean;
  _has_slot boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT role INTO _role FROM public.staff_users WHERE auth_user_id = _uid AND status = 'active';
  IF _role IS NULL OR _role NOT IN ('super_admin','ops_manager') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT id, status, price, service_duration_minutes, address_id,
         scheduled_date, scheduled_time_slot, deleted_at
    INTO _current
    FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF _current.id IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _current.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Booking has been deleted'; END IF;
  IF _current.status IN ('completed','cancelled','rejected') THEN
    RAISE EXCEPTION 'Booking is in a terminal state and cannot be edited';
  END IF;

  _has_duration := _payload ? 'service_duration_minutes';
  _has_price    := _payload ? 'price';
  _has_addr     := _payload ? 'address_id';
  _has_date     := _payload ? 'scheduled_date';
  _has_slot     := _payload ? 'scheduled_time_slot';

  IF _has_duration THEN
    _new_duration := NULLIF(_payload->>'service_duration_minutes','')::int;
    IF _new_duration IS NULL OR _new_duration <= 0 THEN RAISE EXCEPTION 'Invalid duration'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.service_catalogue_config
       WHERE duration_minutes = _new_duration AND is_active = true
    ) THEN
      RAISE EXCEPTION 'Duration not in active catalogue';
    END IF;
  END IF;

  IF _has_price THEN
    _new_price := NULLIF(_payload->>'price','')::numeric;
    IF _new_price IS NULL OR _new_price < 0 THEN RAISE EXCEPTION 'Invalid price'; END IF;
  END IF;

  IF _has_addr THEN
    _new_addr := NULLIF(_payload->>'address_id','')::uuid;
    IF _new_addr IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.addresses WHERE id = _new_addr
    ) THEN
      RAISE EXCEPTION 'Address not found';
    END IF;
  END IF;

  IF _has_date THEN
    _new_date := NULLIF(_payload->>'scheduled_date','')::date;
  END IF;
  IF _has_slot THEN
    _new_slot := NULLIF(btrim(_payload->>'scheduled_time_slot'),'');
  END IF;

  -- Compute change diffs
  IF _has_duration AND _new_duration IS DISTINCT FROM _current.service_duration_minutes THEN
    _before := _before || jsonb_build_object('service_duration_minutes', _current.service_duration_minutes);
    _after  := _after  || jsonb_build_object('service_duration_minutes', _new_duration);
  END IF;
  IF _has_price AND _new_price IS DISTINCT FROM _current.price THEN
    _before := _before || jsonb_build_object('price', _current.price);
    _after  := _after  || jsonb_build_object('price', _new_price);
  END IF;
  IF _has_addr AND _new_addr IS DISTINCT FROM _current.address_id THEN
    _before := _before || jsonb_build_object('address_id', _current.address_id);
    _after  := _after  || jsonb_build_object('address_id', _new_addr);
  END IF;
  IF _has_date AND _new_date IS DISTINCT FROM _current.scheduled_date THEN
    _before := _before || jsonb_build_object('scheduled_date', _current.scheduled_date);
    _after  := _after  || jsonb_build_object('scheduled_date', _new_date);
  END IF;
  IF _has_slot AND _new_slot IS DISTINCT FROM _current.scheduled_time_slot THEN
    _before := _before || jsonb_build_object('scheduled_time_slot', _current.scheduled_time_slot);
    _after  := _after  || jsonb_build_object('scheduled_time_slot', _new_slot);
  END IF;

  IF _after = '{}'::jsonb THEN
    -- Nothing actually changed; no-op, no audit entry.
    RETURN;
  END IF;

  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings SET
    service_duration_minutes = CASE WHEN _has_duration THEN _new_duration ELSE service_duration_minutes END,
    price                    = CASE WHEN _has_price    THEN _new_price    ELSE price END,
    address_id               = CASE WHEN _has_addr     THEN _new_addr     ELSE address_id END,
    scheduled_date           = CASE WHEN _has_date     THEN _new_date     ELSE scheduled_date END,
    scheduled_time_slot      = CASE WHEN _has_slot     THEN _new_slot     ELSE scheduled_time_slot END,
    updated_at               = now()
  WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'edit_booking', 'bookings', _booking_id, _before, _after);
END;$function$;

REVOKE ALL ON FUNCTION public.staff_edit_booking(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_edit_booking(uuid, jsonb) TO authenticated;

-- 4. staff_soft_delete_booking: super_admin only.
CREATE OR REPLACE FUNCTION public.staff_soft_delete_booking(_booking_id uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _before jsonb;
  _after jsonb;
  _existing_deleted timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT role INTO _role FROM public.staff_users WHERE auth_user_id = _uid AND status = 'active';
  IF _role IS NULL OR _role <> 'super_admin' THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION 'Reason required'; END IF;

  SELECT to_jsonb(b), b.deleted_at INTO _before, _existing_deleted
    FROM public.bookings b WHERE id = _booking_id FOR UPDATE;
  IF _before IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _existing_deleted IS NOT NULL THEN RAISE EXCEPTION 'Booking already deleted'; END IF;

  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings
     SET deleted_at = now(),
         deleted_by = _uid,
         delete_reason = btrim(_reason),
         updated_at = now()
   WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);

  SELECT to_jsonb(b) INTO _after FROM public.bookings b WHERE id = _booking_id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'soft_delete_booking', 'bookings', _booking_id, _before, _after);
END;$function$;

REVOKE ALL ON FUNCTION public.staff_soft_delete_booking(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_soft_delete_booking(uuid, text) TO authenticated;
