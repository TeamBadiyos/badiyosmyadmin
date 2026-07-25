
-- ============ wallet_ledger ============
CREATE TABLE IF NOT EXISTS public.wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type text NOT NULL CHECK (owner_type IN ('expert','area_partner')),
  owner_id uuid NOT NULL,
  amount numeric NOT NULL,
  type text NOT NULL CHECK (type IN ('credit','debit')),
  reason text NOT NULL,
  created_by uuid NULL REFERENCES public.staff_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.wallet_ledger TO authenticated;
GRANT ALL ON public.wallet_ledger TO service_role;
ALTER TABLE public.wallet_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff can read wallet_ledger" ON public.wallet_ledger;
CREATE POLICY "Staff can read wallet_ledger" ON public.wallet_ledger
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.staff_users s WHERE s.auth_user_id = auth.uid() AND s.status='active'));

CREATE INDEX IF NOT EXISTS wallet_ledger_owner_idx ON public.wallet_ledger(owner_type, owner_id, created_at DESC);

-- ============ payout_batches ============
CREATE TABLE IF NOT EXISTS public.payout_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start date NOT NULL,
  week_end date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),
  total_amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz NULL
);
GRANT SELECT ON public.payout_batches TO authenticated;
GRANT ALL ON public.payout_batches TO service_role;
ALTER TABLE public.payout_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff can read payout_batches" ON public.payout_batches;
CREATE POLICY "Staff can read payout_batches" ON public.payout_batches
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.staff_users s WHERE s.auth_user_id = auth.uid() AND s.status='active'));

-- ============ payout_batch_items ============
CREATE TABLE IF NOT EXISTS public.payout_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.payout_batches(id) ON DELETE CASCADE,
  owner_type text NOT NULL CHECK (owner_type IN ('expert','area_partner')),
  owner_id uuid NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  paid boolean NOT NULL DEFAULT false,
  paid_at timestamptz NULL,
  booking_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id, owner_type, owner_id)
);
GRANT SELECT ON public.payout_batch_items TO authenticated;
GRANT ALL ON public.payout_batch_items TO service_role;
ALTER TABLE public.payout_batch_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff can read payout_batch_items" ON public.payout_batch_items;
CREATE POLICY "Staff can read payout_batch_items" ON public.payout_batch_items
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.staff_users s WHERE s.auth_user_id = auth.uid() AND s.status='active'));

-- ============ referral: reversal_reason ============
ALTER TABLE public.referral_transactions ADD COLUMN IF NOT EXISTS reversal_reason text NULL;
ALTER TABLE public.referral_transactions ADD COLUMN IF NOT EXISTS reversed_at timestamptz NULL;

-- ============================================================
-- RPCs
-- ============================================================

-- Manual wallet adjustment (super_admin only)
CREATE OR REPLACE FUNCTION public.staff_wallet_adjust(
  _owner_type text, _owner_id uuid, _amount numeric, _type text, _reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public'
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _staff_id uuid;
  _ledger_id uuid;
  _delta numeric;
  _exists boolean;
  _before jsonb; _after jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT id INTO _staff_id FROM public.staff_users
    WHERE auth_user_id=_uid AND status='active' AND role='super_admin';
  IF _staff_id IS NULL THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _owner_type NOT IN ('expert','area_partner') THEN RAISE EXCEPTION 'Invalid owner_type'; END IF;
  IF _type NOT IN ('credit','debit') THEN RAISE EXCEPTION 'Invalid type'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION 'Reason required'; END IF;

  IF _owner_type='expert' THEN
    SELECT EXISTS(SELECT 1 FROM public.experts WHERE id=_owner_id) INTO _exists;
  ELSE
    SELECT EXISTS(SELECT 1 FROM public.area_partners WHERE id=_owner_id) INTO _exists;
  END IF;
  IF NOT _exists THEN RAISE EXCEPTION 'Owner not found'; END IF;

  _delta := CASE WHEN _type='credit' THEN _amount ELSE -_amount END;

  INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
    VALUES(_owner_type, _owner_id, _amount, _type, btrim(_reason), _staff_id)
    RETURNING id INTO _ledger_id;

  IF _owner_type='expert' THEN
    SELECT to_jsonb(e) INTO _before FROM public.experts e WHERE id=_owner_id;
    UPDATE public.experts SET wallet_balance = COALESCE(wallet_balance,0) + _delta WHERE id=_owner_id;
    SELECT to_jsonb(e) INTO _after FROM public.experts e WHERE id=_owner_id;
  ELSE
    _before := NULL; _after := NULL; -- area_partners have no wallet_balance column; balance is derived
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
    VALUES(_uid, 'wallet_adjust', 'wallet_ledger', _ledger_id,
           jsonb_build_object('owner_type',_owner_type,'owner_id',_owner_id,'before',_before),
           jsonb_build_object('amount',_amount,'type',_type,'reason',_reason,'after',_after));
  RETURN _ledger_id;
END $fn$;

-- Generate this week's payout batch
CREATE OR REPLACE FUNCTION public.staff_generate_payout_batch()
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public'
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _batch_id uuid;
  _ws date;
  _we date;
  _total numeric := 0;
  _used_bookings uuid[];
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  _ws := date_trunc('week', now())::date;              -- Monday of current ISO week
  _we := (_ws + INTERVAL '6 days')::date;

  IF EXISTS (SELECT 1 FROM public.payout_batches WHERE week_start=_ws) THEN
    RAISE EXCEPTION 'Batch already exists for this week';
  END IF;

  -- Bookings already in any previous batch item
  SELECT COALESCE(array_agg(DISTINCT b), ARRAY[]::uuid[])
    INTO _used_bookings
    FROM public.payout_batch_items p, unnest(p.booking_ids) AS b;

  INSERT INTO public.payout_batches(week_start, week_end, status, total_amount)
    VALUES(_ws, _we, 'pending', 0)
    RETURNING id INTO _batch_id;

  -- Expert payouts: completed bookings in the window with an assigned expert
  WITH cand AS (
    SELECT b.id AS booking_id, b.assigned_expert_id AS owner_id,
           COALESCE(sc.expert_payout, 0) AS payout
      FROM public.bookings b
      LEFT JOIN public.service_catalogue_config sc
        ON sc.duration_minutes = b.service_duration_minutes AND sc.is_active = true
     WHERE b.status = 'completed'
       AND b.assigned_expert_id IS NOT NULL
       AND b.updated_at::date BETWEEN _ws AND _we
       AND NOT (b.id = ANY(_used_bookings))
  ), agg AS (
    SELECT owner_id, SUM(payout) AS amount, array_agg(booking_id) AS booking_ids
      FROM cand
     WHERE payout > 0
     GROUP BY owner_id
  )
  INSERT INTO public.payout_batch_items(batch_id, owner_type, owner_id, amount, booking_ids)
    SELECT _batch_id, 'expert', owner_id, amount, booking_ids FROM agg;

  -- Area-partner payouts: completed bookings whose zone has an assigned area partner
  WITH cand AS (
    SELECT b.id AS booking_id, z.assigned_area_partner_id AS owner_id,
           COALESCE(sc.area_partner_payout, 0) AS payout
      FROM public.bookings b
      JOIN public.zones z ON z.id = b.zone_id
      LEFT JOIN public.service_catalogue_config sc
        ON sc.duration_minutes = b.service_duration_minutes AND sc.is_active = true
     WHERE b.status = 'completed'
       AND b.zone_id IS NOT NULL
       AND z.assigned_area_partner_id IS NOT NULL
       AND b.updated_at::date BETWEEN _ws AND _we
       AND NOT (b.id = ANY(_used_bookings))
  ), agg AS (
    SELECT owner_id, SUM(payout) AS amount, array_agg(booking_id) AS booking_ids
      FROM cand
     WHERE payout > 0
     GROUP BY owner_id
  )
  INSERT INTO public.payout_batch_items(batch_id, owner_type, owner_id, amount, booking_ids)
    SELECT _batch_id, 'area_partner', owner_id, amount, booking_ids FROM agg;

  SELECT COALESCE(SUM(amount),0) INTO _total FROM public.payout_batch_items WHERE batch_id=_batch_id;
  UPDATE public.payout_batches SET total_amount=_total WHERE id=_batch_id;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
    VALUES(_uid,'generate_payout_batch','payout_batches',_batch_id,NULL,
           jsonb_build_object('week_start',_ws,'week_end',_we,'total_amount',_total));

  RETURN _batch_id;
END $fn$;

-- Mark a single item paid/unpaid
CREATE OR REPLACE FUNCTION public.staff_mark_payout_item_paid(_item_id uuid, _paid boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public'
AS $fn$
DECLARE _uid uuid := auth.uid(); _batch uuid; _before jsonb; _after jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT to_jsonb(i), batch_id INTO _before, _batch FROM public.payout_batch_items i WHERE id=_item_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Item not found'; END IF;
  UPDATE public.payout_batch_items
     SET paid = _paid,
         paid_at = CASE WHEN _paid THEN now() ELSE NULL END
   WHERE id = _item_id;
  SELECT to_jsonb(i) INTO _after FROM public.payout_batch_items i WHERE id=_item_id;

  -- Auto-flip batch status if all items paid
  IF _paid AND NOT EXISTS (SELECT 1 FROM public.payout_batch_items WHERE batch_id=_batch AND paid=false) THEN
    UPDATE public.payout_batches SET status='paid', paid_at=now() WHERE id=_batch;
  ELSIF NOT _paid THEN
    UPDATE public.payout_batches SET status='pending', paid_at=NULL WHERE id=_batch;
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
    VALUES(_uid,'mark_payout_item_paid','payout_batch_items',_item_id,_before,_after);
END $fn$;

-- Mark entire batch paid
CREATE OR REPLACE FUNCTION public.staff_mark_payout_batch_paid(_batch_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public'
AS $fn$
DECLARE _uid uuid := auth.uid(); _before jsonb; _after jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT to_jsonb(b) INTO _before FROM public.payout_batches b WHERE id=_batch_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Batch not found'; END IF;
  UPDATE public.payout_batch_items SET paid=true, paid_at=now() WHERE batch_id=_batch_id AND paid=false;
  UPDATE public.payout_batches SET status='paid', paid_at=now() WHERE id=_batch_id;
  SELECT to_jsonb(b) INTO _after FROM public.payout_batches b WHERE id=_batch_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
    VALUES(_uid,'mark_payout_batch_paid','payout_batches',_batch_id,_before,_after);
END $fn$;

-- Referral config update (super_admin)
CREATE OR REPLACE FUNCTION public.staff_update_referral_config(_reward numeric, _is_active boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public'
AS $fn$
DECLARE _uid uuid := auth.uid(); _before jsonb; _after jsonb; _id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _reward IS NULL OR _reward < 0 THEN RAISE EXCEPTION 'Reward must be non-negative'; END IF;

  SELECT id INTO _id FROM public.referral_config ORDER BY updated_at DESC NULLS LAST LIMIT 1;
  IF _id IS NULL THEN
    INSERT INTO public.referral_config(reward_coins, is_active, updated_at)
      VALUES(_reward, _is_active, now())
      RETURNING id INTO _id;
    _before := NULL;
  ELSE
    SELECT to_jsonb(c) INTO _before FROM public.referral_config c WHERE id=_id;
    UPDATE public.referral_config
       SET reward_coins=_reward, is_active=_is_active, updated_at=now()
     WHERE id=_id;
  END IF;
  SELECT to_jsonb(c) INTO _after FROM public.referral_config c WHERE id=_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
    VALUES(_uid,'update_referral_config','referral_config',_id,_before,_after);
END $fn$;

-- Reverse a credited referral reward
CREATE OR REPLACE FUNCTION public.staff_reverse_referral_reward(_txn_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public'
AS $fn$
DECLARE _uid uuid := auth.uid(); _before jsonb; _after jsonb; _referrer uuid; _amount numeric; _status text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _reason IS NULL OR btrim(_reason)='' THEN RAISE EXCEPTION 'Reason required'; END IF;

  SELECT to_jsonb(r), referrer_id, COALESCE(reward_amount,0), status
    INTO _before, _referrer, _amount, _status
    FROM public.referral_transactions r WHERE id=_txn_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Transaction not found'; END IF;
  IF _status <> 'reward_credited' THEN RAISE EXCEPTION 'Only credited rewards can be reversed'; END IF;

  UPDATE public.referral_transactions
     SET status='reversed', reversal_reason=btrim(_reason), reversed_at=now()
   WHERE id=_txn_id;

  PERFORM set_config('app.users_bypass','on', true);
  UPDATE public.users
     SET total_coins_earned = GREATEST(COALESCE(total_coins_earned,0) - _amount::int, 0),
         successful_referrals = GREATEST(COALESCE(successful_referrals,0) - 1, 0)
   WHERE id = _referrer;
  PERFORM set_config('app.users_bypass','off', true);

  INSERT INTO public.wallet_transactions(user_id, amount, type, description)
    VALUES(_referrer, _amount, 'debit', 'Referral reward reversed: '||btrim(_reason));

  SELECT to_jsonb(r) INTO _after FROM public.referral_transactions r WHERE id=_txn_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
    VALUES(_uid,'reverse_referral_reward','referral_transactions',_txn_id,_before,_after);
END $fn$;
