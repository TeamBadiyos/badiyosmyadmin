ALTER TABLE public.merchant_settlement_adjustments ALTER COLUMN order_id DROP NOT NULL;

ALTER TABLE public.merchant_referral_config
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS target_orders integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS window_days integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS updated_by uuid;
UPDATE public.merchant_referral_config SET reward_amount = 500 WHERE id = 1 AND coalesce(reward_amount,0) = 0;
INSERT INTO public.merchant_referral_config(id, reward_amount) VALUES (1, 500) ON CONFLICT (id) DO NOTHING;

CREATE TABLE public.merchant_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES public.merchants(id),
  referred_store_id uuid NOT NULL UNIQUE REFERENCES public.merchants(id),
  status text NOT NULL DEFAULT 'in_progress',
  reward_amount numeric NOT NULL DEFAULT 500,
  target_orders integer NOT NULL DEFAULT 20,
  window_days integer NOT NULL DEFAULT 60,
  live_at timestamptz,
  window_expires_at timestamptz,
  delivered_count integer NOT NULL DEFAULT 0,
  earned_at timestamptz,
  earned_by uuid,
  adjustment_id uuid REFERENCES public.merchant_settlement_adjustments(id),
  reversed_at timestamptz,
  reversed_by uuid,
  reversal_reason text,
  reversal_adjustment_id uuid REFERENCES public.merchant_settlement_adjustments(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.merchant_referrals TO authenticated;
GRANT ALL ON public.merchant_referrals TO service_role;
ALTER TABLE public.merchant_referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read merchant referrals" ON public.merchant_referrals FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager','finance'])
      OR EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = referrer_id AND m.auth_user_id = auth.uid()));

-- Credit the reward (idempotent)
CREATE OR REPLACE FUNCTION public.merchant_referral_credit(_ref_id uuid, _by uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.merchant_referrals; _name text; _adj uuid;
BEGIN
  SELECT * INTO r FROM public.merchant_referrals WHERE id = _ref_id FOR UPDATE;
  IF r.id IS NULL OR r.status = 'earned' THEN RETURN; END IF;
  SELECT coalesce(store_name, owner_name, 'store') INTO _name FROM public.merchants WHERE id = r.referred_store_id;
  INSERT INTO public.merchant_settlement_adjustments(store_id, order_id, amount, reason)
  VALUES (r.referrer_id, NULL, abs(r.reward_amount), 'Referral reward — ' || _name) RETURNING id INTO _adj;
  UPDATE public.merchant_referrals SET status='earned', earned_at=now(), earned_by=_by, adjustment_id=_adj,
    reversed_at=NULL, reversed_by=NULL, reversal_reason=NULL, updated_at=now() WHERE id = r.id;
END $$;
REVOKE EXECUTE ON FUNCTION public.merchant_referral_credit(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Evaluate one referred store
CREATE OR REPLACE FUNCTION public.merchant_referral_evaluate(_store_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.merchant_referrals; c public.merchant_referral_config; n int;
BEGIN
  SELECT * INTO r FROM public.merchant_referrals WHERE referred_store_id = _store_id;
  IF r.id IS NULL OR r.status <> 'in_progress' OR r.live_at IS NULL THEN RETURN; END IF;
  SELECT count(*) INTO n FROM public.merchant_orders o
   WHERE o.merchant_id = _store_id AND o.status = 'delivered'
     AND o.delivered_at >= r.live_at AND o.delivered_at < r.window_expires_at
     AND coalesce(o.refund_status,'none') NOT IN ('refund_pending','processing','done','failed','refunded');
  UPDATE public.merchant_referrals SET delivered_count = n, updated_at = now() WHERE id = r.id;
  SELECT * INTO c FROM public.merchant_referral_config WHERE id = 1;
  IF n >= r.target_orders AND coalesce(c.is_active, true) THEN
    PERFORM public.merchant_referral_credit(r.id, NULL);
  ELSIF now() >= r.window_expires_at THEN
    UPDATE public.merchant_referrals SET status='expired', updated_at=now() WHERE id = r.id;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.merchant_referral_evaluate(uuid) FROM PUBLIC, anon, authenticated;

-- Create/refresh referral row when a referred store exists / goes live
CREATE OR REPLACE FUNCTION public.merchant_referral_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.merchant_referral_config;
BEGIN
  IF NEW.referred_by_merchant_id IS NULL OR NEW.referred_by_merchant_id = NEW.id THEN RETURN NEW; END IF;
  SELECT * INTO c FROM public.merchant_referral_config WHERE id = 1;
  INSERT INTO public.merchant_referrals(referrer_id, referred_store_id, reward_amount, target_orders, window_days)
  VALUES (NEW.referred_by_merchant_id, NEW.id, coalesce(c.reward_amount,500), coalesce(c.target_orders,20), coalesce(c.window_days,60))
  ON CONFLICT (referred_store_id) DO NOTHING;
  IF NEW.status = 'approved' AND NEW.approved_at IS NOT NULL THEN
    UPDATE public.merchant_referrals
       SET live_at = NEW.approved_at, window_expires_at = NEW.approved_at + make_interval(days => window_days), updated_at = now()
     WHERE referred_store_id = NEW.id AND live_at IS NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_merchant_referral_sync ON public.merchants;
CREATE TRIGGER trg_merchant_referral_sync AFTER INSERT OR UPDATE OF referred_by_merchant_id, status, approved_at ON public.merchants
  FOR EACH ROW EXECUTE FUNCTION public.merchant_referral_sync();

CREATE OR REPLACE FUNCTION public.merchant_referral_on_order() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered' THEN
    BEGIN PERFORM public.merchant_referral_evaluate(NEW.merchant_id);
    EXCEPTION WHEN others THEN NULL; END;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_merchant_referral_on_order ON public.merchant_orders;
CREATE TRIGGER trg_merchant_referral_on_order AFTER UPDATE OF status ON public.merchant_orders
  FOR EACH ROW EXECUTE FUNCTION public.merchant_referral_on_order();

-- Staff RPCs
CREATE OR REPLACE FUNCTION public.staff_merchant_referrals()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_active_staff(public.cc_uid(), ARRAY['super_admin','ops_manager','finance']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN jsonb_build_object(
    'config', (SELECT to_jsonb(c) FROM public.merchant_referral_config c WHERE id = 1),
    'rows', coalesce((SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
      SELECT r.*, a.store_name referrer_name, a.phone referrer_phone, b.store_name referred_name, b.phone referred_phone
        FROM public.merchant_referrals r
        JOIN public.merchants a ON a.id = r.referrer_id
        JOIN public.merchants b ON b.id = r.referred_store_id) x), '[]'::jsonb));
END $$;
GRANT EXECUTE ON FUNCTION public.staff_merchant_referrals() TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_update_merchant_referral_config(_reward numeric, _target integer, _days integer, _active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _b jsonb; _a jsonb; _uid uuid := public.cc_uid();
BEGIN
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF _reward < 0 OR _target < 1 OR _days < 1 THEN RAISE EXCEPTION 'Invalid values'; END IF;
  SELECT to_jsonb(c) INTO _b FROM public.merchant_referral_config c WHERE id = 1;
  UPDATE public.merchant_referral_config SET reward_amount=_reward, target_orders=_target, window_days=_days,
    is_active=_active, updated_at=now(), updated_by=_uid WHERE id = 1;
  SELECT to_jsonb(c) INTO _a FROM public.merchant_referral_config c WHERE id = 1;
  INSERT INTO public.audit_logs(actor_id, action, target_table, before_state, after_state)
  VALUES (_uid, 'update_merchant_referral_config', 'merchant_referral_config', _b, _a);
END $$;
GRANT EXECUTE ON FUNCTION public.staff_update_merchant_referral_config(numeric, integer, integer, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_mark_merchant_referral_earned(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := public.cc_uid(); _b jsonb; _a jsonb;
BEGIN
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT to_jsonb(r) INTO _b FROM public.merchant_referrals r WHERE id = _id;
  IF _b IS NULL THEN RAISE EXCEPTION 'Referral not found'; END IF;
  IF _b->>'status' = 'earned' THEN RAISE EXCEPTION 'Already earned'; END IF;
  PERFORM public.merchant_referral_credit(_id, _uid);
  SELECT to_jsonb(r) INTO _a FROM public.merchant_referrals r WHERE id = _id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'merchant_referral_mark_earned', 'merchant_referrals', _id, _b, _a);
END $$;
GRANT EXECUTE ON FUNCTION public.staff_mark_merchant_referral_earned(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_reverse_merchant_referral(_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := public.cc_uid(); r public.merchant_referrals; _b jsonb; _a jsonb; _adj uuid; _name text;
BEGIN
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF coalesce(trim(_reason),'') = '' THEN RAISE EXCEPTION 'Reason required'; END IF;
  SELECT * INTO r FROM public.merchant_referrals WHERE id = _id FOR UPDATE;
  IF r.id IS NULL OR r.status <> 'earned' THEN RAISE EXCEPTION 'Only earned rewards can be reversed'; END IF;
  _b := to_jsonb(r);
  SELECT coalesce(store_name,'store') INTO _name FROM public.merchants WHERE id = r.referred_store_id;
  INSERT INTO public.merchant_settlement_adjustments(store_id, order_id, amount, reason)
  VALUES (r.referrer_id, NULL, -abs(r.reward_amount), 'Referral reward reversed — ' || _name) RETURNING id INTO _adj;
  UPDATE public.merchant_referrals SET status='reversed', reversed_at=now(), reversed_by=_uid,
    reversal_reason=trim(_reason), reversal_adjustment_id=_adj, updated_at=now() WHERE id = _id;
  SELECT to_jsonb(x) INTO _a FROM public.merchant_referrals x WHERE id = _id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'merchant_referral_reverse', 'merchant_referrals', _id, _b, _a);
END $$;
GRANT EXECUTE ON FUNCTION public.staff_reverse_merchant_referral(uuid, text) TO authenticated;

-- Backfill any existing referred stores
INSERT INTO public.merchant_referrals(referrer_id, referred_store_id, live_at, window_expires_at)
SELECT m.referred_by_merchant_id, m.id,
  CASE WHEN m.status='approved' THEN m.approved_at END,
  CASE WHEN m.status='approved' THEN m.approved_at + interval '60 days' END
FROM public.merchants m WHERE m.referred_by_merchant_id IS NOT NULL AND m.referred_by_merchant_id <> m.id
ON CONFLICT (referred_store_id) DO NOTHING;