
-- Add refund tracking columns to bookings
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS cancellation_fee numeric,
  ADD COLUMN IF NOT EXISTS refund_amount numeric,
  ADD COLUMN IF NOT EXISTS refund_id text,
  ADD COLUMN IF NOT EXISTS refund_status text,
  ADD COLUMN IF NOT EXISTS cancelled_by text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

-- Tighten before-update trigger: disallow customer-initiated status changes
-- entirely. All cancellations (including the previously-allowed
-- confirmed -> cancelled direct client path) must now go through
-- SECURITY DEFINER RPCs / edge functions that set app.booking_bypass.
CREATE OR REPLACE FUNCTION public.bookings_before_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
     OR NEW.start_otp IS DISTINCT FROM OLD.start_otp
     OR NEW.end_otp IS DISTINCT FROM OLD.end_otp
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
     OR NEW.deleted_by IS DISTINCT FROM OLD.deleted_by
     OR NEW.delete_reason IS DISTINCT FROM OLD.delete_reason
  THEN
    RAISE EXCEPTION 'Field not updatable';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Status changes must go through server-side functions';
  END IF;
  RETURN NEW;
END;$$;

-- RPC used by the customer-cancel edge function to apply the DB side of a
-- cancellation atomically. Verifies caller owns the booking. Called by the
-- edge function while impersonating the customer (their JWT), so auth.uid()
-- is the customer.
CREATE OR REPLACE FUNCTION public.customer_cancel_booking_apply(
  _booking_id uuid,
  _cancellation_fee numeric,
  _refund_amount numeric,
  _refund_id text,
  _refund_status text
)
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
  VALUES (
    _uid,
    'customer_cancel_booking',
    'bookings',
    _booking_id,
    _before,
    _after || jsonb_build_object('actor_role','customer')
  );

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
    PERFORM public.notify_expert_push(
      _assigned,
      'Booking cancelled',
      'The booking assigned to you was cancelled by the customer.',
      'home'
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

GRANT EXECUTE ON FUNCTION public.customer_cancel_booking_apply(uuid, numeric, numeric, text, text) TO authenticated;
