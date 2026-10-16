
-- B. customer note
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS customer_note text;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS refund_destination text;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS refund_wallet_amount numeric;
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_customer_note_len;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_customer_note_len CHECK (customer_note IS NULL OR char_length(customer_note) <= 300);
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_refund_destination_chk;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_refund_destination_chk CHECK (refund_destination IS NULL OR refund_destination IN ('wallet','original'));
ALTER TABLE public.customer_credit_notes ADD COLUMN IF NOT EXISTS refund_destination text;

CREATE OR REPLACE FUNCTION public.bookings_trim_note() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.customer_note IS NOT NULL THEN NEW.customer_note := nullif(left(btrim(NEW.customer_note), 300), ''); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS a0_bookings_trim_note ON public.bookings;
CREATE TRIGGER a0_bookings_trim_note BEFORE INSERT OR UPDATE OF customer_note ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.bookings_trim_note();

-- D. settings keys
CREATE OR REPLACE FUNCTION public.city_ops_keys()
 RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT ARRAY['slot_capacity_enabled','slot_capacity_mode','default_slot_capacity','wash_default_slot_capacity',
    'clean_band_morning_end','clean_band_day_end','wash_band_morning_end','wash_band_day_end',
    'slot_first_start_hour','slot_last_start_hour','slot_step_minutes',
    'instant_booking_enabled','wash_instant_booking_enabled',
    'clean_auto_cancel_minutes','wash_auto_cancel_minutes',
    'clean_last_slot_before_close_minutes','wash_last_slot_before_close_minutes',
    'clean_cancel_fee_percent','wash_cancel_fee_percent',
    'clean_no_refund_after_arrived','wash_no_refund_after_arrived',
    'clean_cancel_policy','wash_cancel_policy'] $$;

INSERT INTO public.city_ops_settings (city_id, key, value, updated_at)
SELECT c.id, k.key, k.val, now() FROM public.cities c CROSS JOIN (VALUES
 ('clean_cancel_fee_percent','50'),('wash_cancel_fee_percent','50'),
 ('clean_no_refund_after_arrived','1'),('wash_no_refund_after_arrived','1')) k(key,val)
ON CONFLICT (city_id, key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.default_cancel_policy() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
SELECT jsonb_build_object(
 'en', jsonb_build_array(
   'Cancel before an expert is assigned: full refund.',
   'Cancel after an expert is assigned: {fee_percent}% cancellation fee, rest refunded.',
   'Cancel after the expert arrives: no refund.',
   'If no expert accepts within {auto_cancel_minutes} minutes, the booking is cancelled automatically with a full refund.',
   'Choose your refund: instantly to your badiyos Wallet, or to your original payment method in 5–7 working days.'),
 'mr', jsonb_build_array(
   'मदतनीस नेमण्यापूर्वी रद्द केल्यास: पूर्ण परतावा.',
   'मदतनीस नेमल्यानंतर रद्द केल्यास: {fee_percent}% रद्द शुल्क, उर्वरित परत.',
   'मदतनीस पोहोचल्यानंतर रद्द केल्यास: परतावा नाही.',
   '{auto_cancel_minutes} मिनिटांत कोणी स्वीकारले नाही तर बुकिंग आपोआप रद्द होऊन पूर्ण परतावा.',
   'परतावा निवडा: त्वरित badiyos Wallet मध्ये, किंवा मूळ पेमेंट पद्धतीवर 5–7 कामकाजाच्या दिवसांत.')) $$;

CREATE OR REPLACE FUNCTION public.booking_group_of(_booking_id uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN public.booking_capacity_group(service_category_id, service_label)='wash' THEN 'wash' ELSE 'clean' END FROM public.bookings WHERE id=_booking_id $$;

-- Refund split: fee by stage, then refund shared proportionally across what was paid.
CREATE OR REPLACE FUNCTION public.booking_refund_split(_booking_id uuid, _mode text DEFAULT 'policy')
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE b record; _g text; _total numeric; _wc numeric; _wb numeric; _rzp numeric; _fee numeric := 0; _pct numeric; _noarr boolean;
  _stage text; _r numeric; _ref numeric;
BEGIN
  SELECT * INTO b FROM public.bookings WHERE id=_booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
  _g := public.booking_group_of(_booking_id);
  _total := coalesce(b.total_amount, b.price, 0);
  SELECT coalesce(-sum(amount) FILTER (WHERE bucket='cash'),0), coalesce(-sum(amount) FILTER (WHERE bucket='bonus'),0)
    INTO _wc, _wb FROM public.customer_wallet_ledger WHERE ref_type='booking' AND ref_id=_booking_id::text AND type='payment';
  _wc := greatest(_wc,0); _wb := greatest(_wb,0);
  _rzp := CASE WHEN coalesce(b.razorpay_payment_id,'') LIKE 'pay\_%' THEN greatest(_total - _wc - _wb, 0) ELSE 0 END;
  IF b.razorpay_payment_id IS NULL OR b.razorpay_payment_id = '' THEN
    IF _wc + _wb = 0 THEN _total := 0; END IF;
  END IF;
  _total := least(_total, _rzp + _wc + _wb);
  _pct := public.city_ops_num(b.city_id, _g || '_cancel_fee_percent', 50);
  _noarr := public.city_ops_text(b.city_id, _g || '_no_refund_after_arrived', '1') = '1';
  IF b.assigned_expert_id IS NULL THEN _stage := 'before_assign';
  ELSIF b.arrived_at IS NOT NULL OR b.status IN ('arrived','in_progress') THEN _stage := 'arrived';
  ELSE _stage := 'assigned'; END IF;
  IF _mode = 'full' OR _stage = 'before_assign' THEN _fee := 0;
  ELSIF _stage = 'arrived' AND _noarr THEN _fee := _total;
  ELSE _fee := round(_total * _pct / 100, 2); END IF;
  _ref := greatest(_total - _fee, 0);
  _r := CASE WHEN _total > 0 THEN _ref / _total ELSE 0 END;
  RETURN jsonb_build_object('stage',_stage,'total_paid',_total,'fee',_fee,'fee_percent',_pct,'refund',_ref,
    'paid_wallet_cash',_wc,'paid_wallet_bonus',_wb,'paid_online',_rzp,
    'refund_wallet_cash', round(_wc*_r,2), 'refund_wallet_bonus', round(_wb*_r,2),
    'refund_online', _ref - round(_wc*_r,2) - round(_wb*_r,2));
END $$;
REVOKE ALL ON FUNCTION public.booking_refund_split(uuid,text) FROM public, anon, authenticated;

-- Shared cancel core (called only by the wrappers below)
CREATE OR REPLACE FUNCTION public.booking_cancel_core(_booking_id uuid, _actor text, _actor_uid uuid, _reason text, _destination text, _mode text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE b record; s jsonb; _before jsonb; _after jsonb; _dest text := CASE WHEN _destination='wallet' THEN 'wallet' ELSE 'original' END;
  _online numeric; _wcash numeric; _wbonus numeric; _rstatus text; _ramount numeric; _wamount numeric; _share numeric;
BEGIN
  SELECT * INTO b FROM public.bookings WHERE id=_booking_id FOR UPDATE;
  _before := to_jsonb(b);
  IF b.status IN ('completed','cancelled','rejected','refunded') THEN RAISE EXCEPTION 'Booking already in terminal state: %', b.status; END IF;
  s := public.booking_refund_split(_booking_id, _mode);
  _online := (s->>'refund_online')::numeric; _wcash := (s->>'refund_wallet_cash')::numeric; _wbonus := (s->>'refund_wallet_bonus')::numeric;
  IF _dest = 'wallet' THEN _wcash := _wcash + _online; _online := 0; END IF;
  IF _wcash > 0 THEN PERFORM public.wallet_post(b.user_id,'refund','cash',_wcash,'booking',_booking_id::text,'Booking cancelled',NULL,_actor_uid); END IF;
  IF _wbonus > 0 THEN PERFORM public.wallet_post(b.user_id,'refund','bonus',_wbonus,'booking',_booking_id::text,'Booking cancelled',NULL,_actor_uid); END IF;
  _wamount := _wcash + _wbonus;
  _ramount := _online;
  _rstatus := CASE WHEN _online > 0 THEN 'pending' WHEN _wamount > 0 THEN 'done' ELSE NULL END;
  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings SET status='cancelled', cancellation_reason=_reason, cancellation_fee=(s->>'fee')::numeric,
     refund_amount=_ramount, refund_wallet_amount=_wamount, refund_destination=CASE WHEN (s->>'refund')::numeric > 0 THEN _dest END,
     refund_status=_rstatus, refund_next_attempt_at=NULL, refund_attempts=0, refund_error=NULL,
     cancelled_by=_actor, cancelled_at=now()
   WHERE id=_booking_id;
  PERFORM set_config('app.booking_bypass','off', true);
  IF b.assigned_expert_id IS NOT NULL THEN
    UPDATE public.experts SET is_busy=false WHERE id=b.assigned_expert_id;
    IF (s->>'fee')::numeric > 0 THEN
      _share := round((s->>'fee')::numeric * public.courier_setting('cancel_fee_expert_share_pct', 50) / 100, 2);
      IF _share > 0 THEN
        INSERT INTO public.wallet_ledger (owner_type, owner_id, amount, type, reason) VALUES ('expert', b.assigned_expert_id, _share, 'credit', 'booking_cancel_fee:' || _booking_id::text);
        UPDATE public.experts SET wallet_balance = coalesce(wallet_balance,0) + _share WHERE id = b.assigned_expert_id;
      END IF;
    END IF;
    BEGIN PERFORM public.notify_expert_push(b.assigned_expert_id,'Booking cancelled','The booking assigned to you has been cancelled.','home'); EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  SELECT to_jsonb(x) INTO _after FROM public.bookings x WHERE id=_booking_id;
  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (coalesce(_actor_uid,'00000000-0000-0000-0000-000000000000'::uuid), _actor || '_cancel_booking', 'bookings', _booking_id, _before, _after || jsonb_build_object('split', s));
  BEGIN
    PERFORM public.notify_customer_push(_booking_id, 'Booking cancelled',
      CASE WHEN _wamount > 0 AND _ramount > 0 THEN 'Booking cancelled. ₹' || _wamount || ' added to your badiyos Wallet; ₹' || _ramount || ' will reach your original payment method in 5–7 working days.'
           WHEN _wamount > 0 THEN 'Booking cancelled. ₹' || _wamount || ' has been added to your badiyos Wallet.'
           WHEN _ramount > 0 THEN 'Booking cancelled. ₹' || _ramount || ' will reach your original payment method in 5–7 working days.'
           ELSE 'Booking cancelled. No refund applies.' END, 'my-bookings');
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN jsonb_build_object('ok',true,'cancellation_fee',(s->>'fee')::numeric,'refund_total',(s->>'refund')::numeric,
    'refund_to_wallet',_wamount,'refund_to_original',_ramount,'refund_destination',_dest,'stage',s->>'stage');
END $$;
REVOKE ALL ON FUNCTION public.booking_cancel_core(uuid,text,uuid,text,text,text) FROM public, anon, authenticated;

-- Customer: quote + cancel
CREATE OR REPLACE FUNCTION public.app_cancel_quote(_booking_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE b record; s jsonb;
BEGIN
  SELECT * INTO b FROM public.bookings WHERE id=_booking_id;
  IF NOT FOUND OR b.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  s := public.booking_refund_split(_booking_id, 'policy');
  RETURN s || jsonb_build_object('can_cancel', b.status IN ('confirmed','accepted','expert_assigned','on_the_way','arrived'),
    'destinations', jsonb_build_array(
      jsonb_build_object('key','wallet','label','badiyos Wallet','label_mr','badiyos Wallet','eta','Instant'),
      jsonb_build_object('key','original','label','Original payment method','label_mr','मूळ पेमेंट पद्धत','eta','5–7 working days')));
END $$;

CREATE OR REPLACE FUNCTION public.app_cancel_booking(_booking_id uuid, _destination text DEFAULT 'original')
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE b record;
BEGIN
  SELECT * INTO b FROM public.bookings WHERE id=_booking_id;
  IF NOT FOUND OR b.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF b.status NOT IN ('confirmed','accepted','expert_assigned','on_the_way','arrived') THEN
    RAISE EXCEPTION 'Cannot cancel — service has already started or booking is closed (status: %)', b.status; END IF;
  IF _destination NOT IN ('wallet','original') THEN RAISE EXCEPTION 'Destination must be wallet or original'; END IF;
  RETURN public.booking_cancel_core(_booking_id, 'customer', auth.uid(), 'customer_cancelled', _destination, 'policy');
END $$;
GRANT EXECUTE ON FUNCTION public.app_cancel_quote(uuid), public.app_cancel_booking(uuid,text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.app_cancel_quote(uuid), public.app_cancel_booking(uuid,text) FROM anon, public;

-- Old customer path (edge function) now goes through the same rules; passed fee/refund are ignored.
CREATE OR REPLACE FUNCTION public.customer_cancel_booking_apply(_booking_id uuid, _cancellation_fee numeric, _refund_amount numeric, _refund_id text, _refund_status text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN RETURN public.app_cancel_booking(_booking_id, 'original'); END $$;

-- Staff cancel with refund choice
CREATE OR REPLACE FUNCTION public.staff_cancel_booking_v2(_booking_id uuid, _reason text, _destination text DEFAULT 'original', _apply_fee boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _role text;
BEGIN
  SELECT role INTO _role FROM public.staff_users WHERE auth_user_id=auth.uid() AND status='active';
  IF _role IS NULL OR _role NOT IN ('super_admin','ops_manager') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF NOT public.staff_can_city((SELECT city_id FROM public.bookings WHERE id=_booking_id)) THEN RAISE EXCEPTION 'Not allowed for this city'; END IF;
  IF _reason IS NULL OR _reason NOT IN ('SAFETY','FRAUD','DUPLICATE','MANUAL_OVERRIDE','OTHER') THEN RAISE EXCEPTION 'Invalid reason'; END IF;
  IF _destination NOT IN ('wallet','original') THEN RAISE EXCEPTION 'Destination must be wallet or original'; END IF;
  RETURN public.booking_cancel_core(_booking_id, 'staff', auth.uid(), _reason, _destination, CASE WHEN _apply_fee THEN 'policy' ELSE 'full' END);
END $$;
GRANT EXECUTE ON FUNCTION public.staff_cancel_booking_v2(uuid,text,text,boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_cancel_booking_v2(uuid,text,text,boolean) FROM anon, public;

-- Auto-cancel: record destination; return wallet-paid part to wallet.
CREATE OR REPLACE FUNCTION public.system_auto_cancel_booking_no_expert(_booking_id uuid, _refund_amount numeric, _refund_id text, _refund_status text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _before jsonb; _after jsonb; _current text; _assigned uuid; s jsonb; _w numeric := 0; _uid uuid;
  _rs text := _refund_status; _ra numeric := COALESCE(_refund_amount,0);
BEGIN
  SELECT to_jsonb(b), b.status, b.assigned_expert_id, b.user_id INTO _before, _current, _assigned, _uid
    FROM public.bookings b WHERE b.id = _booking_id FOR UPDATE;
  IF _before IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _current NOT IN ('confirmed','accepted') OR _assigned IS NOT NULL THEN
    RETURN jsonb_build_object('skipped', true, 'status', _current);
  END IF;
  s := public.booking_refund_split(_booking_id, 'full');
  IF (s->>'refund_wallet_cash')::numeric > 0 THEN PERFORM public.wallet_post(_uid,'refund','cash',(s->>'refund_wallet_cash')::numeric,'booking',_booking_id::text,'No expert available',NULL,NULL); END IF;
  IF (s->>'refund_wallet_bonus')::numeric > 0 THEN PERFORM public.wallet_post(_uid,'refund','bonus',(s->>'refund_wallet_bonus')::numeric,'booking',_booking_id::text,'No expert available',NULL,NULL); END IF;
  _w := (s->>'refund_wallet_cash')::numeric + (s->>'refund_wallet_bonus')::numeric;
  IF (s->>'paid_online')::numeric = 0 THEN _ra := 0; _rs := CASE WHEN _w > 0 THEN 'done' ELSE _refund_status END; END IF;
  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings
     SET status = 'cancelled', cancellation_reason = 'no_expert_available', cancellation_fee = 0,
         refund_amount = _ra, refund_wallet_amount = _w, refund_id = _refund_id, refund_status = _rs,
         refund_destination = CASE WHEN _ra + _w > 0 THEN 'original' END,
         cancelled_by = 'system', cancelled_at = now(), dispatch_exhausted_at = COALESCE(dispatch_exhausted_at, now())
   WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);
  SELECT to_jsonb(b) INTO _after FROM public.bookings b WHERE b.id = _booking_id;
  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES ('00000000-0000-0000-0000-000000000000'::uuid, 'auto_cancel_no_expert', 'bookings', _booking_id, _before, _after || jsonb_build_object('actor_role','system'));
  PERFORM public.notify_customer_push(_booking_id, 'No expert available',
    CASE WHEN _ra + _w > 0 THEN 'We could not find an expert for your booking. It has been cancelled and ₹' || (_ra + _w)::text || ' has been refunded to your original payment method.'
         ELSE 'We could not find an expert for your booking. It has been cancelled and any payment will be refunded.' END, 'home');
  RETURN jsonb_build_object('ok', true, 'new_status', 'cancelled', 'refund_amount', _ra, 'refund_wallet_amount', _w, 'refund_id', _refund_id, 'refund_status', _rs);
END $function$;

-- Credit note: full refund (online + wallet) and destination
CREATE OR REPLACE FUNCTION public.fin_invoice_trg()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _rt text := TG_ARGV[0]; _now boolean; _before boolean; _cn uuid; _amt numeric;
BEGIN
 IF coalesce((to_jsonb(NEW)->>'is_training')::boolean, false) THEN RETURN NEW; END IF;
 BEGIN
  IF _rt='booking' THEN
   _now := NEW.razorpay_payment_id IS NOT NULL OR lower(NEW.status)='completed';
   _before := TG_OP='UPDATE' AND (OLD.razorpay_payment_id IS NOT NULL OR lower(coalesce(OLD.status,''))='completed');
  ELSIF _rt='merchant_order' THEN
   _now := NEW.paid_at IS NOT NULL OR lower(NEW.status) IN ('delivered','completed');
   _before := TG_OP='UPDATE' AND (OLD.paid_at IS NOT NULL OR lower(coalesce(OLD.status,'')) IN ('delivered','completed'));
  ELSE
   _now := NEW.payment_status='paid' OR upper(NEW.status)='COMPLETED';
   _before := TG_OP='UPDATE' AND (OLD.payment_status='paid' OR upper(coalesce(OLD.status,''))='COMPLETED');
  END IF;
  IF _now AND NOT _before THEN PERFORM fin_issue_invoice(_rt, NEW.id); END IF;
  IF TG_OP='UPDATE' AND NEW.refund_status='done' AND coalesce(OLD.refund_status,'')<>'done' THEN
   _amt := coalesce(NEW.refund_amount,0) + coalesce((to_jsonb(NEW)->>'refund_wallet_amount')::numeric,0);
   _cn := fin_issue_credit_note(_rt, NEW.id, _amt, 'Refund');
   IF _cn IS NOT NULL AND _rt='booking' THEN UPDATE customer_credit_notes SET refund_destination = NEW.refund_destination WHERE id=_cn; END IF;
  END IF;
 EXCEPTION WHEN OTHERS THEN RAISE WARNING 'invoice issue failed %: %', NEW.id, SQLERRM; END;
 RETURN NEW;
END $function$;

-- Policy for the Customer App
CREATE OR REPLACE FUNCTION public.app_cancellation_policy(_service_key text, _city_id uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _g text := CASE WHEN _service_key IN ('wash','clean_auto') THEN 'wash' ELSE 'clean' END;
  _c uuid := coalesce(_city_id, public.default_city_id()); _pct numeric; _ac int; _raw text; _p jsonb; _en jsonb; _mr jsonb;
BEGIN
  _pct := public.city_ops_num(_c, _g || '_cancel_fee_percent', 50);
  _ac := public.auto_cancel_minutes(_g, _c);
  _raw := public.city_ops_text(_c, _g || '_cancel_policy', '');
  BEGIN _p := nullif(_raw,'')::jsonb; EXCEPTION WHEN OTHERS THEN _p := NULL; END;
  IF _p IS NULL OR jsonb_typeof(_p->'en') <> 'array' THEN _p := public.default_cancel_policy(); END IF;
  SELECT jsonb_agg(replace(replace(x,'{fee_percent}',trim_scale(_pct)::text),'{auto_cancel_minutes}',_ac::text)) INTO _en FROM jsonb_array_elements_text(_p->'en') x;
  SELECT jsonb_agg(replace(replace(x,'{fee_percent}',trim_scale(_pct)::text),'{auto_cancel_minutes}',_ac::text)) INTO _mr FROM jsonb_array_elements_text(coalesce(_p->'mr','[]'::jsonb)) x;
  RETURN jsonb_build_object('service_key',_g,'city_id',_c,'fee_percent',_pct,
    'no_refund_after_arrived', public.city_ops_text(_c, _g || '_no_refund_after_arrived','1')='1',
    'auto_cancel_minutes',_ac,'lines_en',coalesce(_en,'[]'::jsonb),'lines_mr',coalesce(_mr,'[]'::jsonb));
END $$;
GRANT EXECUTE ON FUNCTION public.app_cancellation_policy(text,uuid) TO anon, authenticated;

-- C. Full wallet booking
CREATE OR REPLACE FUNCTION public.app_create_booking_wallet(_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _id uuid; b record; w customer_wallets; _c numeric; _bn numeric; _inv uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  INSERT INTO public.bookings (user_id, address_id, price_option_id, service_category_id, service_label, slot_type,
      scheduled_date, scheduled_time_slot, booking_lat, booking_lng, city_id, coupon_code, customer_note)
  VALUES (_uid, nullif(_payload->>'address_id','')::uuid, nullif(_payload->>'price_option_id','')::uuid,
      nullif(_payload->>'service_category_id','')::uuid, _payload->>'service_label', coalesce(_payload->>'slot_type','scheduled'),
      nullif(_payload->>'scheduled_date','')::date, _payload->>'scheduled_time_slot',
      nullif(_payload->>'booking_lat','')::numeric, nullif(_payload->>'booking_lng','')::numeric,
      nullif(_payload->>'city_id','')::uuid, nullif(_payload->>'coupon_code',''), _payload->>'customer_note')
  RETURNING id INTO _id;
  SELECT * INTO b FROM public.bookings WHERE id=_id;
  IF coalesce(b.total_amount,0) <= 0 THEN RAISE EXCEPTION 'Nothing to pay'; END IF;
  SELECT * INTO w FROM public.customer_wallets WHERE user_id=_uid FOR UPDATE;
  IF NOT FOUND OR w.cash_balance + w.bonus_balance < b.total_amount THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;
  _c := least(w.cash_balance, b.total_amount); _bn := b.total_amount - _c;   -- cash first, bonus last
  IF _c > 0 THEN PERFORM public.wallet_post(_uid,'payment','cash',-_c,'booking',_id::text,'Payment',NULL,_uid); END IF;
  IF _bn > 0 THEN PERFORM public.wallet_post(_uid,'payment','bonus',-_bn,'booking',_id::text,'Payment',NULL,_uid); END IF;
  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings SET razorpay_order_id='wallet_'||_id::text, razorpay_payment_id='wallet_'||_id::text WHERE id=_id;
  PERFORM set_config('app.booking_bypass','off', true);
  SELECT id INTO _inv FROM public.customer_invoices WHERE ref_type='booking' AND ref_id=_id;
  IF _inv IS NULL THEN _inv := public.fin_issue_invoice('booking', _id); END IF;
  SELECT * INTO b FROM public.bookings WHERE id=_id;
  RETURN jsonb_build_object('ok',true,'booking_id',_id,'booking_number',b.booking_number,'status',b.status,
    'total_amount',b.total_amount,'from_cash',_c,'from_bonus',_bn,'invoice_id',_inv);
END $$;
GRANT EXECUTE ON FUNCTION public.app_create_booking_wallet(jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.app_create_booking_wallet(jsonb) FROM anon, public;

-- B. Expert job details
CREATE OR REPLACE FUNCTION public.expert_job_details(_booking_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE b record; _eid uuid;
BEGIN
  SELECT id INTO _eid FROM public.experts WHERE auth_user_id=auth.uid();
  SELECT * INTO b FROM public.bookings WHERE id=_booking_id;
  IF _eid IS NULL OR NOT FOUND OR b.assigned_expert_id IS DISTINCT FROM _eid THEN RAISE EXCEPTION 'Forbidden'; END IF;
  RETURN jsonb_build_object('booking_id',b.id,'booking_number',b.booking_number,'status',b.status,'service_label',b.service_label,
    'scheduled_date',b.scheduled_date,'scheduled_time_slot',b.scheduled_time_slot,'duration_minutes',b.service_duration_minutes,
    'customer_note',b.customer_note,'address_id',b.address_id,'booking_lat',b.booking_lat,'booking_lng',b.booking_lng);
END $$;
GRANT EXECUTE ON FUNCTION public.expert_job_details(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.expert_job_details(uuid) FROM anon, public;
