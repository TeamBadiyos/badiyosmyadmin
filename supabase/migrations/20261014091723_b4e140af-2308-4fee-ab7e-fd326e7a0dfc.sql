DROP FUNCTION IF EXISTS public.system_mark_offer_paid(text, text, int);

CREATE FUNCTION public.system_mark_offer_paid(_razorpay_order_id text, _payment_id text, _amount_paise int DEFAULT NULL, _amount int DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- _amount_paise / _amount (legacy name, used by Badiyos User webhook) are BOTH Razorpay paise.
-- event_redemptions.amount is rupees; compare in paise to avoid rounding.
DECLARE r public.event_redemptions; v_paise int := COALESCE(_amount_paise, _amount);
BEGIN
  SELECT * INTO r FROM public.event_redemptions WHERE razorpay_payment_id = _payment_id;
  IF FOUND THEN RETURN jsonb_build_object('ok',true,'id',r.id,'status',r.status,'duplicate',true); END IF;
  SELECT * INTO r FROM public.event_redemptions WHERE razorpay_order_id = _razorpay_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','NOT_FOUND'); END IF;
  IF v_paise IS NOT NULL AND v_paise < r.amount * 100 THEN
    RETURN jsonb_build_object('ok',false,'error','AMOUNT_MISMATCH','paid_rupees', v_paise / 100.0,'expected_rupees', r.amount);
  END IF;
  UPDATE public.event_redemptions SET status='paid', paid_at=now(), razorpay_payment_id=_payment_id
   WHERE id = r.id AND status IN ('payment_pending','expired','payment_failed') RETURNING * INTO r;
  RETURN jsonb_build_object('ok',true,'id',r.id,'status',COALESCE(r.status,'paid'));
END $$;
REVOKE EXECUTE ON FUNCTION public.system_mark_offer_paid(text,text,int,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.system_mark_offer_paid(text,text,int,int) TO service_role;