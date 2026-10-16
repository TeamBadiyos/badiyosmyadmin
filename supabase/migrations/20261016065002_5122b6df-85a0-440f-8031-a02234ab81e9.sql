CREATE TABLE public.booking_time_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  delta_minutes integer NOT NULL CHECK (delta_minutes <> 0),
  reason text NOT NULL,
  note text,
  money_mode text NOT NULL CHECK (money_mode IN ('charge','no_charge','refund','no_refund')),
  customer_amount numeric NOT NULL DEFAULT 0,
  expert_pay_delta numeric NOT NULL DEFAULT 0,
  extension_id uuid,
  refund_status text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.booking_time_adjustments TO authenticated;
GRANT ALL ON public.booking_time_adjustments TO service_role;
GRANT SELECT ON public.booking_time_adjustments TO cc_reader;
ALTER TABLE public.booking_time_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read time adjustments" ON public.booking_time_adjustments FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager','finance','area_partner']));
CREATE POLICY cc_reader_all ON public.booking_time_adjustments FOR SELECT TO cc_reader USING (true);
CREATE INDEX booking_time_adjustments_booking_idx ON public.booking_time_adjustments(booking_id);

CREATE OR REPLACE FUNCTION public.staff_adjust_booking_time(
  _booking_id uuid, _delta_minutes integer, _reason text, _note text, _money_mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _b record; _base_min numeric; _rate numeric; _cust numeric := 0;
        _pay numeric := 0; _ext uuid; _id uuid; _cur_total numeric; _base_pay numeric;
BEGIN
  IF _uid IS NULL OR NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF COALESCE(_delta_minutes,0) = 0 THEN RAISE EXCEPTION 'Enter the minutes to add or remove'; END IF;
  IF COALESCE(trim(_reason),'') = '' THEN RAISE EXCEPTION 'Reason required'; END IF;
  IF _delta_minutes > 0 AND _money_mode NOT IN ('charge','no_charge') THEN RAISE EXCEPTION 'Choose Charge customer or No charge'; END IF;
  IF _delta_minutes < 0 AND _money_mode NOT IN ('refund','no_refund') THEN RAISE EXCEPTION 'Choose Refund the difference or No refund'; END IF;
  SELECT id, status, price, service_duration_minutes, snapshot_hourly_rate, assigned_expert_id
    INTO _b FROM public.bookings WHERE id = _booking_id AND deleted_at IS NULL FOR UPDATE;
  IF _b.id IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _b.status NOT IN ('expert_assigned','on_the_way','arrived','in_progress') THEN RAISE EXCEPTION 'Time can only be adjusted on an assigned or running job'; END IF;
  _base_min := GREATEST(COALESCE(_b.service_duration_minutes,60),1);
  _cur_total := _base_min
    + COALESCE((SELECT SUM(extra_minutes) FROM public.booking_extensions WHERE booking_id=_booking_id AND approval_status IN ('accepted','approved')),0)
    + COALESCE((SELECT SUM(delta_minutes) FROM public.booking_time_adjustments WHERE booking_id=_booking_id AND money_mode <> 'charge'),0);
  IF _cur_total + _delta_minutes < 15 THEN RAISE EXCEPTION 'Job must stay at least 15 minutes'; END IF;
  SELECT expert_payout INTO _base_pay FROM public.resolve_booking_payouts(_booking_id);
  _rate := COALESCE(NULLIF(_b.snapshot_hourly_rate,0), COALESCE(_base_pay,0) / (_base_min/60.0));
  _cust := round(COALESCE(_b.price,0) / _base_min * abs(_delta_minutes));
  IF _money_mode = 'charge' THEN
    -- Goes through the existing extension flow: the customer pays in the app; time and expert pay apply once paid.
    INSERT INTO public.booking_extensions(booking_id, extra_minutes, price, approval_status)
      VALUES (_booking_id, _delta_minutes, _cust, 'pending') RETURNING id INTO _ext;
    _pay := 0;
  ELSE
    _pay := round(_delta_minutes / 60.0 * _rate);
    IF _money_mode = 'no_charge' OR _money_mode = 'no_refund' THEN _cust := 0; END IF;
  END IF;
  INSERT INTO public.booking_time_adjustments(booking_id, delta_minutes, reason, note, money_mode, customer_amount,
      expert_pay_delta, extension_id, refund_status, created_by)
    VALUES (_booking_id, _delta_minutes, trim(_reason), NULLIF(trim(COALESCE(_note,'')),''), _money_mode, _cust,
      _pay, _ext, CASE WHEN _money_mode='refund' THEN 'due' END, _uid)
    RETURNING id INTO _id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, after_state)
    VALUES (_uid, 'booking_time_adjusted', 'bookings', _booking_id,
      jsonb_build_object('delta_minutes',_delta_minutes,'reason',_reason,'note',_note,'money_mode',_money_mode,
                         'customer_amount',_cust,'expert_pay_delta',_pay,'adjustment_id',_id));
  RETURN jsonb_build_object('id',_id,'customer_amount',_cust,'expert_pay_delta',_pay,'extension_id',_ext);
END $$;
REVOKE EXECUTE ON FUNCTION public.staff_adjust_booking_time(uuid,integer,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_adjust_booking_time(uuid,integer,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_booking_payouts(_booking_id uuid)
 RETURNS TABLE(expert_payout numeric, area_partner_payout numeric)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _b record; _ep numeric; _ext numeric; _adj numeric;
BEGIN
  SELECT id, service_label, service_duration_minutes, service_category_id, price_option_id,
         snapshot_expert_payout, snapshot_hourly_rate
    INTO _b FROM public.bookings WHERE id = _booking_id;
  IF _b.id IS NULL THEN RETURN QUERY SELECT 0::numeric, 0::numeric; RETURN; END IF;
  IF _b.price_option_id IS NOT NULL THEN
    SELECT NULLIF(COALESCE((public.city_opt(spo.id,(SELECT bk.city_id FROM public.bookings bk WHERE bk.id=_booking_id))).expert_payout,0),0) INTO _ep FROM public.service_price_options spo WHERE spo.id = _b.price_option_id;
  END IF;
  IF _ep IS NULL THEN
    SELECT NULLIF(COALESCE((public.city_opt(spo.id,(SELECT bk.city_id FROM public.bookings bk WHERE bk.id=_booking_id))).expert_payout,0),0) INTO _ep
      FROM public.service_price_options spo JOIN public.services s ON s.id = spo.service_id
     WHERE lower(spo.label) = lower(COALESCE(_b.service_label,''))
       AND (_b.service_category_id IS NULL OR s.category_id = _b.service_category_id)
       AND spo.is_active
     ORDER BY (s.category_id = _b.service_category_id) DESC, spo.display_order LIMIT 1;
  END IF;
  IF COALESCE(_ep,0) = 0 THEN _ep := NULLIF(COALESCE(_b.snapshot_expert_payout,0),0); END IF;
  SELECT COALESCE(SUM(round(be.extra_minutes / 60.0 * COALESCE(_b.snapshot_hourly_rate, 0))), 0) INTO _ext
    FROM public.booking_extensions be
   WHERE be.booking_id = _booking_id AND be.approval_status = 'accepted' AND be.razorpay_payment_id IS NOT NULL;
  SELECT COALESCE(SUM(a.expert_pay_delta),0) INTO _adj FROM public.booking_time_adjustments a WHERE a.booking_id = _booking_id;
  _ep := GREATEST(COALESCE(_ep, 0) + _ext + _adj, 0);
  RETURN QUERY SELECT COALESCE(_ep,0), 0::numeric;
END $function$;