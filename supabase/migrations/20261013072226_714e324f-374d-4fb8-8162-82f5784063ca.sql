CREATE OR REPLACE FUNCTION public.staff_record_payout_payment(_item_id uuid, _paid boolean, _paid_on date DEFAULT NULL::date, _utr text DEFAULT NULL::text, _mode text DEFAULT NULL::text, _notes text DEFAULT NULL::text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _it public.payout_batch_items; _bstatus text; _before jsonb; _tds numeric;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT * INTO _it FROM public.payout_batch_items WHERE id=_item_id FOR UPDATE;
  IF _it.id IS NULL THEN RAISE EXCEPTION 'Item not found'; END IF;
  IF _it.removed THEN RAISE EXCEPTION 'Person is removed from this batch'; END IF;
  SELECT status INTO _bstatus FROM public.payout_batches WHERE id=_it.batch_id;
  IF _bstatus='discarded' THEN RAISE EXCEPTION 'Batch was discarded'; END IF;
  _before := to_jsonb(_it);
  _tds := COALESCE(_it.tds_amount,0);

  IF _paid THEN
    IF _paid_on IS NULL THEN RAISE EXCEPTION 'Payment date is required'; END IF;
    IF _paid_on > (now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Payment date cannot be in the future'; END IF;
    IF NOT _it.wallet_debited THEN
      INSERT INTO public.wallet_ledger(owner_type, owner_id, type, amount, reason, created_by)
      VALUES(_it.owner_type, _it.owner_id, 'debit', _it.gross_amount - _tds,
             'Payout paid (batch ' || _it.batch_id || ')' || COALESCE(' UTR ' || NULLIF(trim(_utr),''), ''), _uid);
      IF _tds > 0 THEN
        INSERT INTO public.wallet_ledger(owner_type, owner_id, type, amount, reason, created_by)
        VALUES(_it.owner_type, _it.owner_id, 'debit', _tds,
               'TDS withheld @' || _it.tds_rate || '% for batch ' || _it.batch_id, _uid);
      END IF;
      IF _it.owner_type='expert' THEN
        UPDATE public.experts SET wallet_balance = COALESCE(wallet_balance,0) - _it.gross_amount WHERE id=_it.owner_id;
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
      VALUES(_it.owner_type, _it.owner_id, 'credit', _it.gross_amount,
             'Payout un-marked – reversal incl. TDS (batch ' || _it.batch_id || ')', _uid);
      IF _it.owner_type='expert' THEN
        UPDATE public.experts SET wallet_balance = COALESCE(wallet_balance,0) + _it.gross_amount WHERE id=_it.owner_id;
      END IF;
    END IF;
    UPDATE public.payout_batch_items
       SET paid=false, paid_at=NULL, paid_on=NULL, utr=NULL, payment_mode=NULL, payment_notes=NULL, wallet_debited=false
     WHERE id=_item_id;
  END IF;

  PERFORM public.payout_batch_recalc_total(_it.batch_id);
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  SELECT _uid, 'record_payout_payment', 'payout_batch_items', _item_id, _before, to_jsonb(i)
    FROM public.payout_batch_items i WHERE i.id=_item_id;
END $function$;

-- Top-slab-only guard inside the reward period job
DO $do$
DECLARE _src text;
BEGIN
  _src := pg_get_functiondef('public.run_reward_period_jobs(date)'::regprocedure);
  _src := replace(_src,
    'IF _tier_group IS NOT NULL AND jsonb_exists(_paid_tier, _tier_key) THEN',
    'IF _tier_group IS NOT NULL AND (jsonb_exists(_paid_tier, _tier_key) OR EXISTS (
           SELECT 1 FROM public.reward_ledger rl JOIN public.reward_programs rp2 ON rp2.id = rl.program_id
            WHERE rl.actor_id = _actor.id AND rl.trigger_event_ref = _ref AND rl.status = ''credited''
              AND rp2.condition->>''tier_group'' = _tier_group)) THEN');
  IF position('rp2.condition' in _src) = 0 THEN RAISE EXCEPTION 'patch failed'; END IF;
  EXECUTE _src;
END $do$;

-- Historical TDS correction: payout debit -> net, TDS credit -> debit
DO $do$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM public.payout_batch_items WHERE wallet_debited AND COALESCE(tds_amount,0) > 0 LOOP
    UPDATE public.wallet_ledger SET type='debit'
     WHERE owner_id=r.owner_id AND type='credit' AND amount=r.tds_amount
       AND reason LIKE 'TDS withheld%' || r.batch_id::text;
    IF FOUND THEN
      UPDATE public.wallet_ledger SET amount = r.gross_amount - r.tds_amount
       WHERE owner_id=r.owner_id AND type='debit' AND amount=r.gross_amount
         AND reason LIKE 'Payout paid (batch ' || r.batch_id::text || ')%';
      IF r.owner_type='expert' THEN
        UPDATE public.experts SET wallet_balance = COALESCE(wallet_balance,0) - r.tds_amount WHERE id=r.owner_id;
      END IF;
    END IF;
  END LOOP;
END $do$;

-- Remove duplicate lower-slab bonuses (same expert, same week, same tier group)
DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT rl.* FROM public.reward_ledger rl JOIN public.reward_programs rp ON rp.id=rl.program_id
     WHERE rl.status='credited' AND rp.condition->>'tier_group' IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.reward_ledger x JOIN public.reward_programs xp ON xp.id=x.program_id
                    WHERE x.actor_id=rl.actor_id AND x.trigger_event_ref=rl.trigger_event_ref AND x.status='credited'
                      AND xp.condition->>'tier_group' = rp.condition->>'tier_group'
                      AND (x.reward_value > rl.reward_value OR (x.reward_value = rl.reward_value AND x.credited_at < rl.credited_at)))
  LOOP
    DELETE FROM public.wallet_ledger WHERE id = (
      SELECT id FROM public.wallet_ledger WHERE owner_id=r.actor_id AND type='credit'
         AND reason='Reward: ' || r.program_name AND amount=r.reward_value
         AND created_at BETWEEN r.credited_at - interval '1 minute' AND r.credited_at + interval '1 minute'
       LIMIT 1);
    UPDATE public.experts SET wallet_balance = COALESCE(wallet_balance,0) - r.reward_value WHERE id=r.actor_id;
    DELETE FROM public.reward_ledger WHERE id=r.id;
  END LOOP;
END $do$;