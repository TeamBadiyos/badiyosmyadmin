CREATE OR REPLACE FUNCTION public.staff_delete_coupon(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _before jsonb;
BEGIN
  PERFORM public.offers_require_writer();
  SELECT to_jsonb(c) INTO _before FROM public.coupons c WHERE c.id = _id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Coupon not found'; END IF;
  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings SET coupon_id = NULL WHERE coupon_id = _id;
  PERFORM set_config('app.booking_bypass','off', true);
  UPDATE public.courier_orders SET coupon_id = NULL WHERE coupon_id = _id;
  UPDATE public.marketing_campaigns SET coupon_id = NULL WHERE coupon_id = _id;
  UPDATE public.referral_milestone_awards SET coupon_id = NULL WHERE coupon_id = _id;
  DELETE FROM public.coupon_redemptions WHERE coupon_id = _id;
  DELETE FROM public.coupon_phone_grants WHERE coupon_id = _id;
  DELETE FROM public.customer_coupons WHERE coupon_id = _id;
  DELETE FROM public.coupons WHERE id = _id;
  PERFORM public.offers_audit('coupon_deleted', 'coupons', _id, _before, NULL);
END; $$;
REVOKE ALL ON FUNCTION public.staff_delete_coupon(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_delete_coupon(uuid) TO authenticated;