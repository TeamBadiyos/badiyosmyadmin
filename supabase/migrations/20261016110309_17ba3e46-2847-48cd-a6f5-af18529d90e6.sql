ALTER TABLE public.operating_expenses ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;
UPDATE public.operating_expenses SET is_system = true
 WHERE category = 'Marketing — Merchant referral rewards' AND paid_via = 'Settlement adjustment';

CREATE OR REPLACE FUNCTION public.operating_expenses_system_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.category = 'Marketing — Merchant referral rewards' THEN
      IF current_setting('app.system_expense', true) = 'on' THEN NEW.is_system := true;
      ELSE RAISE EXCEPTION 'Merchant referral reward expenses are created by the system only'; END IF;
    ELSE NEW.is_system := false; END IF;
    RETURN NEW;
  END IF;
  IF OLD.is_system AND coalesce(current_setting('app.system_expense', true),'') <> 'on' THEN
    RAISE EXCEPTION 'System expense — correct it through Rewards → Programs → Reverse';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.category = 'Marketing — Merchant referral rewards' AND NOT OLD.is_system THEN
    RAISE EXCEPTION 'Merchant referral reward expenses are created by the system only';
  END IF;
  NEW.is_system := OLD.is_system;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.operating_expenses_system_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_operating_expenses_system_guard ON public.operating_expenses;
CREATE TRIGGER trg_operating_expenses_system_guard BEFORE INSERT OR UPDATE OR DELETE ON public.operating_expenses
  FOR EACH ROW EXECUTE FUNCTION public.operating_expenses_system_guard();

CREATE OR REPLACE FUNCTION public.merchant_referral_credit(_ref_id uuid, _by uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.merchant_referrals; _name text; _ref text; _adj uuid;
BEGIN
  SELECT * INTO r FROM public.merchant_referrals WHERE id = _ref_id FOR UPDATE;
  IF r.id IS NULL OR r.status = 'earned' THEN RETURN; END IF;
  SELECT coalesce(store_name, owner_name, 'store') INTO _name FROM public.merchants WHERE id = r.referred_store_id;
  SELECT coalesce(store_name, owner_name, 'store') INTO _ref FROM public.merchants WHERE id = r.referrer_id;
  INSERT INTO public.merchant_settlement_adjustments(store_id, order_id, amount, reason)
  VALUES (r.referrer_id, NULL, abs(r.reward_amount), 'Referral reward — ' || _name) RETURNING id INTO _adj;
  PERFORM set_config('app.system_expense', 'on', true);
  INSERT INTO public.operating_expenses(expense_date, category, amount, gst_paid, paid_via, vendor, note, created_by)
  VALUES ((now() AT TIME ZONE 'Asia/Kolkata')::date, 'Marketing — Merchant referral rewards', abs(r.reward_amount), 0,
          'Settlement adjustment', _ref, 'Referral reward — ' || _name || ' (referral ' || r.id || ')', _by);
  PERFORM set_config('app.system_expense', 'off', true);
  UPDATE public.merchant_referrals SET status='earned', earned_at=now(), earned_by=_by, adjustment_id=_adj,
    reversed_at=NULL, reversed_by=NULL, reversal_reason=NULL, updated_at=now() WHERE id = r.id;
END $$;
REVOKE EXECUTE ON FUNCTION public.merchant_referral_credit(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.staff_reverse_merchant_referral(_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := public.cc_uid(); r public.merchant_referrals; _b jsonb; _a jsonb; _adj uuid; _name text; _ref text;
BEGIN
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF coalesce(trim(_reason),'') = '' THEN RAISE EXCEPTION 'Reason required'; END IF;
  SELECT * INTO r FROM public.merchant_referrals WHERE id = _id FOR UPDATE;
  IF r.id IS NULL OR r.status <> 'earned' THEN RAISE EXCEPTION 'Only earned rewards can be reversed'; END IF;
  _b := to_jsonb(r);
  SELECT coalesce(store_name,'store') INTO _name FROM public.merchants WHERE id = r.referred_store_id;
  SELECT coalesce(store_name,'store') INTO _ref FROM public.merchants WHERE id = r.referrer_id;
  INSERT INTO public.merchant_settlement_adjustments(store_id, order_id, amount, reason)
  VALUES (r.referrer_id, NULL, -abs(r.reward_amount), 'Referral reward reversed — ' || _name) RETURNING id INTO _adj;
  PERFORM set_config('app.system_expense', 'on', true);
  INSERT INTO public.operating_expenses(expense_date, category, amount, gst_paid, paid_via, vendor, note, created_by)
  VALUES ((now() AT TIME ZONE 'Asia/Kolkata')::date, 'Marketing — Merchant referral rewards', -abs(r.reward_amount), 0,
          'Settlement adjustment', _ref, 'Referral reward reversed — ' || _name || ': ' || trim(_reason) || ' (referral ' || r.id || ')', _uid);
  PERFORM set_config('app.system_expense', 'off', true);
  UPDATE public.merchant_referrals SET status='reversed', reversed_at=now(), reversed_by=_uid,
    reversal_reason=trim(_reason), reversal_adjustment_id=_adj, updated_at=now() WHERE id = _id;
  SELECT to_jsonb(x) INTO _a FROM public.merchant_referrals x WHERE id = _id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'merchant_referral_reverse', 'merchant_referrals', _id, _b, _a);
END $$;
REVOKE EXECUTE ON FUNCTION public.staff_reverse_merchant_referral(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_reverse_merchant_referral(uuid, text) TO authenticated;