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
     OR NEW.start_otp IS DISTINCT FROM OLD.start_otp
     OR NEW.end_otp IS DISTINCT FROM OLD.end_otp
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