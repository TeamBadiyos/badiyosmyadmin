
-- 1. bookings_before_update: add assigned_expert_id, zone_id, cancellation_reason, address_id to immutable list
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

-- 2. users_before_update: add referral_count to immutable list
CREATE OR REPLACE FUNCTION public.users_before_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _bypass text;
BEGIN
  BEGIN _bypass := current_setting('app.users_bypass', true); EXCEPTION WHEN OTHERS THEN _bypass := NULL; END;
  IF _bypass = 'on' THEN RETURN NEW; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.total_coins_earned IS DISTINCT FROM OLD.total_coins_earned
     OR NEW.successful_referrals IS DISTINCT FROM OLD.successful_referrals
     OR NEW.referral_count IS DISTINCT FROM OLD.referral_count
     OR NEW.referral_code IS DISTINCT FROM OLD.referral_code
     OR NEW.referred_by IS DISTINCT FROM OLD.referred_by
  THEN
    RAISE EXCEPTION 'Field not updatable';
  END IF;
  RETURN NEW;
END;$function$;

-- 3. Lock down SECURITY DEFINER function execution.
-- Revoke default PUBLIC + anon execute on all definer functions; grant back to authenticated only where the app needs it.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.prosecdef=true
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC', r.proname, r.args);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM anon', r.proname, r.args);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM authenticated', r.proname, r.args);
  END LOOP;
END $$;

-- Re-grant to authenticated for functions the app calls from user sessions (staff admin + customer app).
GRANT EXECUTE ON FUNCTION public.staff_accept_booking(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_reject_booking(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_assign_expert(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_assign_area_partner(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_update_booking_status(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_cancel_booking(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_upsert_expert(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_expert_kyc_decision(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_upsert_area_partner(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_upsert_homepage_section(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_set_homepage_section_active(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_reorder_homepage_sections(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_update_service_price(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_update_referral_config(numeric, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_reverse_referral_reward(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_wallet_adjust(text, uuid, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_generate_payout_batch() TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_mark_payout_item_paid(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_mark_payout_batch_paid(uuid) TO authenticated;
-- Customer-app user-callable definer functions
GRANT EXECUTE ON FUNCTION public.advance_booking_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_booking_review(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_referral(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.credit_referral_for_booking(uuid) TO authenticated;
-- is_active_staff is used inside other definer functions and by RLS; needs authenticated for RLS eval
GRANT EXECUTE ON FUNCTION public.is_active_staff(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_zone_for_point(numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.point_in_polygon(numeric, numeric, jsonb) TO authenticated;
-- NOT granted: get_auth_user_id_by_email, get_auth_user_id_by_phone (leak user existence — internal use only),
-- bookings_before_insert, bookings_before_update, users_before_update, generate_referral_code (triggers).

-- 4. Storage: tighten address-photo upload to signed-in users only.
DROP POLICY IF EXISTS "Users can upload own address photos" ON storage.objects;
CREATE POLICY "Users can upload own address photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'address-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
