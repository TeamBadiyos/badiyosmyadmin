ALTER TABLE public.payout_batch_items
  ADD COLUMN IF NOT EXISTS paid_on date,
  ADD COLUMN IF NOT EXISTS utr text,
  ADD COLUMN IF NOT EXISTS payment_mode text,
  ADD COLUMN IF NOT EXISTS payment_notes text,
  ADD COLUMN IF NOT EXISTS bonus_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wallet_debited boolean NOT NULL DEFAULT false;
ALTER TABLE public.payout_batches ADD COLUMN IF NOT EXISTS notes text;

CREATE OR REPLACE FUNCTION public.staff_generate_payout_batch_range(_batch_type text, _from date, _to date, _notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid uuid := auth.uid(); _batch_id uuid; _total numeric := 0;
  _today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  _end_ts timestamptz; _start_ts timestamptz;
  _it record; _t record;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _batch_type NOT IN ('expert','merchant') THEN RAISE EXCEPTION 'Invalid batch type'; END IF;
  IF _from IS NULL OR _to IS NULL OR _from > _to THEN RAISE EXCEPTION 'Choose a valid start and end date'; END IF;
  IF _to > _today THEN RAISE EXCEPTION 'End date cannot be in the future'; END IF;
  IF EXISTS (SELECT 1 FROM public.payout_batches WHERE batch_type=_batch_type AND status='pending') THEN
    RAISE EXCEPTION 'A pending batch already exists. Pay or discard it first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payout_batches WHERE batch_type=_batch_type AND status <> 'discarded'
              AND week_start <= _to AND week_end >= _from) THEN
    RAISE EXCEPTION 'These dates overlap an existing batch';
  END IF;

  _start_ts := (_from::timestamp) AT TIME ZONE 'Asia/Kolkata';
  _end_ts := ((_to + 1)::timestamp) AT TIME ZONE 'Asia/Kolkata';

  INSERT INTO public.payout_batches(week_start, week_end, status, total_amount, batch_type, notes)
    VALUES(_from, _to, 'pending', 0, _batch_type, NULLIF(trim(COALESCE(_notes,'')),''))
    RETURNING id INTO _batch_id;

  -- payable = earnings-wallet balance up to end date (includes bonuses, minus past payouts)
  INSERT INTO public.payout_batch_items(batch_id, owner_type, owner_id, amount, gross_amount, booking_ids, bonus_amount)
  SELECT _batch_id, l.owner_type, l.owner_id,
         SUM(CASE WHEN l.type='credit' THEN l.amount ELSE -l.amount END),
         SUM(CASE WHEN l.type='credit' THEN l.amount ELSE -l.amount END),
         ARRAY[]::uuid[],
         COALESCE(SUM(CASE WHEN l.type='credit' AND l.created_at >= _start_ts
                            AND (l.reason ILIKE 'Reward:%' OR l.reason ILIKE '%bonus%' OR l.reason ILIKE '%incentive%')
                       THEN l.amount END),0)
    FROM public.wallet_ledger l
   WHERE COALESCE(l.wallet_type,'earnings')='earnings'
     AND l.created_at < _end_ts
     AND ((_batch_type='expert' AND l.owner_type IN ('expert','area_partner'))
       OR (_batch_type='merchant' AND l.owner_type='merchant'))
   GROUP BY l.owner_type, l.owner_id
  HAVING SUM(CASE WHEN l.type='credit' THEN l.amount ELSE -l.amount END) > 0;

  IF _batch_type='expert' THEN
    FOR _it IN SELECT * FROM public.payout_batch_items WHERE batch_id=_batch_id LOOP
      SELECT * INTO _t FROM public.compute_tds(_it.owner_type, _it.owner_id, _it.gross_amount);
      UPDATE public.payout_batch_items
         SET tds_rate=COALESCE(_t.rate,0), tds_amount=COALESCE(_t.amount,0),
             net_amount=round(_it.gross_amount) - COALESCE(_t.amount,0),
             tds_status=CASE WHEN COALESCE(_t.amount,0)>0 THEN 'accrued' ELSE 'none' END,
             pan_last4=_t.pan_last4
       WHERE id=_it.id;
    END LOOP;
  ELSE
    UPDATE public.payout_batch_items SET net_amount=gross_amount WHERE batch_id=_batch_id;
  END IF;

  SELECT COALESCE(SUM(amount),0) INTO _total FROM public.payout_batch_items WHERE batch_id=_batch_id;
  UPDATE public.payout_batches SET total_amount=_total WHERE id=_batch_id;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES(_uid,'generate_payout_batch','payout_batches',_batch_id,NULL,
         jsonb_build_object('from',_from,'to',_to,'total_amount',_total,'batch_type',_batch_type));
  RETURN _batch_id;
END $$;

CREATE OR REPLACE FUNCTION public.staff_record_payout_payment(
  _item_id uuid, _paid boolean, _paid_on date DEFAULT NULL, _utr text DEFAULT NULL,
  _mode text DEFAULT NULL, _notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _it public.payout_batch_items; _bstatus text; _before jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT * INTO _it FROM public.payout_batch_items WHERE id=_item_id FOR UPDATE;
  IF _it.id IS NULL THEN RAISE EXCEPTION 'Item not found'; END IF;
  SELECT status INTO _bstatus FROM public.payout_batches WHERE id=_it.batch_id;
  IF _bstatus='discarded' THEN RAISE EXCEPTION 'Batch was discarded'; END IF;
  _before := to_jsonb(_it);

  IF _paid THEN
    IF _paid_on IS NULL THEN RAISE EXCEPTION 'Payment date is required'; END IF;
    IF _paid_on > (now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Payment date cannot be in the future'; END IF;
    IF NOT _it.wallet_debited THEN
      INSERT INTO public.wallet_ledger(owner_type, owner_id, type, amount, reason, created_by)
      VALUES(_it.owner_type, _it.owner_id, 'debit', _it.gross_amount,
             'Payout paid (batch ' || _it.batch_id || ')' || COALESCE(' UTR ' || NULLIF(trim(_utr),''), ''), _uid);
      IF COALESCE(_it.tds_amount,0) > 0 THEN
        INSERT INTO public.wallet_ledger(owner_type, owner_id, type, amount, reason, created_by)
        VALUES(_it.owner_type, _it.owner_id, 'credit', _it.tds_amount,
               'TDS withheld @' || _it.tds_rate || '% for batch ' || _it.batch_id, _uid);
      END IF;
      IF _it.owner_type='expert' THEN
        UPDATE public.experts SET wallet_balance = COALESCE(wallet_balance,0) - _it.gross_amount + COALESCE(_it.tds_amount,0)
         WHERE id=_it.owner_id;
      END IF;
    END IF;
    UPDATE public.payout_batch_items
       SET paid=true, paid_at=COALESCE(paid_at, now()), paid_on=_paid_on,
           utr=NULLIF(trim(COALESCE(_utr,'')),''), payment_mode=NULLIF(trim(COALESCE(_mode,'')),''),
           payment_notes=NULLIF(trim(COALESCE(_notes,'')),''), wallet_debited=true
     WHERE id=_item_id;
    IF _it.owner_type='expert' AND NOT _it.paid THEN
      PERFORM public.notify_expert_alert(_it.owner_id, 'payout_paid', 'Payout sent',
        'Your payout of ₹' || COALESCE(_it.net_amount,_it.amount)::text || ' has been paid out.',
        jsonb_build_object('route','earnings'));
    END IF;
  ELSE
    IF _it.wallet_debited THEN
      INSERT INTO public.wallet_ledger(owner_type, owner_id, type, amount, reason, created_by)
      VALUES(_it.owner_type, _it.owner_id, 'credit', _it.gross_amount - COALESCE(_it.tds_amount,0),
             'Payout un-marked – reversal (batch ' || _it.batch_id || ')', _uid);
      IF _it.owner_type='expert' THEN
        UPDATE public.experts SET wallet_balance = COALESCE(wallet_balance,0) + _it.gross_amount - COALESCE(_it.tds_amount,0)
         WHERE id=_it.owner_id;
      END IF;
    END IF;
    UPDATE public.payout_batch_items
       SET paid=false, paid_at=NULL, paid_on=NULL, utr=NULL, payment_mode=NULL, payment_notes=NULL, wallet_debited=false
     WHERE id=_item_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.payout_batch_items WHERE batch_id=_it.batch_id AND NOT paid) THEN
    UPDATE public.payout_batches SET status='pending', paid_at=NULL WHERE id=_it.batch_id;
  ELSE
    UPDATE public.payout_batches SET status='paid', paid_at=now() WHERE id=_it.batch_id;
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  SELECT _uid, 'record_payout_payment', 'payout_batch_items', _item_id, _before, to_jsonb(i)
    FROM public.payout_batch_items i WHERE i.id=_item_id;
END $$;

-- discard: release + reverse only debited items
CREATE OR REPLACE FUNCTION public.staff_discard_payout_batch(_batch_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _before jsonb; _it record;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT to_jsonb(b) INTO _before FROM public.payout_batches b WHERE b.id=_batch_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Batch not found'; END IF;
  IF (_before->>'status') = 'paid' THEN RAISE EXCEPTION 'Paid batch cannot be discarded'; END IF;
  IF EXISTS (SELECT 1 FROM public.payout_batch_items WHERE batch_id=_batch_id AND paid) THEN
    RAISE EXCEPTION 'Some people are already marked paid. Un-mark them first';
  END IF;
  UPDATE public.bookings SET expert_payout_batch_id = NULL WHERE expert_payout_batch_id = _batch_id;
  UPDATE public.bookings SET partner_payout_batch_id = NULL WHERE partner_payout_batch_id = _batch_id;
  UPDATE public.payout_batch_items
     SET tds_status = CASE WHEN tds_status='accrued' THEN 'cancelled' ELSE tds_status END
   WHERE batch_id=_batch_id;
  UPDATE public.payout_batches SET status='discarded' WHERE id=_batch_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES(_uid,'discard_payout_batch','payout_batches',_batch_id,_before,
         jsonb_build_object('status','discarded','reason',_reason));
END $$;

REVOKE ALL ON FUNCTION public.staff_generate_payout_batch_range(text,date,date,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_record_payout_payment(uuid,boolean,date,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_generate_payout_batch_range(text,date,date,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_record_payout_payment(uuid,boolean,date,text,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_discard_payout_batch(uuid,text) TO authenticated, service_role;