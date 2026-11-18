CREATE OR REPLACE FUNCTION public.staff_generate_payout_batch_range(_batch_type text, _from date, _to date, _notes text DEFAULT NULL::text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid(); _batch_id uuid; _total numeric := 0;
  _today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  _end_ts timestamptz; _start_ts timestamptz;
  _it record; _t record;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager','finance']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _batch_type NOT IN ('expert','merchant') THEN RAISE EXCEPTION 'Invalid batch type'; END IF;
  IF _from IS NULL OR _to IS NULL OR _from > _to THEN RAISE EXCEPTION 'Choose a valid start and end date'; END IF;
  IF _batch_type='expert' AND (extract(isodow FROM _from) <> 1 OR _to <> _from + 6) THEN
    RAISE EXCEPTION 'Expert payouts must cover one full Monday to Sunday week';
  END IF;
  IF _to >= _today THEN RAISE EXCEPTION 'The week must be finished before generating a payout'; END IF;
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

  -- due = earnings/deductions dated up to week end MINUS every payout already settled (whatever date it was paid).
  -- Over-payments from earlier batches are therefore recovered automatically from coming weeks.
  INSERT INTO public.payout_batch_items(batch_id, owner_type, owner_id, amount, gross_amount, booking_ids, bonus_amount)
  SELECT _batch_id, s.owner_type, s.owner_id, d.due, d.due, ARRAY[]::uuid[], LEAST(s.bonus, d.due)
    FROM (
      SELECT l.owner_type, l.owner_id,
             SUM(CASE WHEN l.is_settle OR l.effective_at < _end_ts THEN l.signed ELSE 0 END) AS upto,
             SUM(l.signed) AS cur,
             COALESCE(SUM(CASE WHEN l.type='credit' AND NOT l.is_settle AND l.effective_at >= _start_ts AND l.effective_at < _end_ts
                                AND (l.reason ILIKE 'Reward:%' OR l.reason ILIKE '%bonus%' OR l.reason ILIKE '%incentive%')
                           THEN l.amount END),0) AS bonus
        FROM (SELECT w.*, CASE WHEN w.type='credit' THEN w.amount ELSE -w.amount END AS signed,
                     (w.reason ILIKE 'Payout paid%' OR w.reason ILIKE 'TDS withheld%' OR w.reason ILIKE 'Payout un-marked%') AS is_settle
                FROM public.wallet_ledger w) l
       WHERE COALESCE(l.wallet_type,'earnings')='earnings'
         AND ((_batch_type='expert' AND l.owner_type IN ('expert','area_partner'))
           OR (_batch_type='merchant' AND l.owner_type='merchant'))
       GROUP BY l.owner_type, l.owner_id
    ) s
    CROSS JOIN LATERAL (SELECT LEAST(s.upto, s.cur) AS due) d
   WHERE d.due > 0;

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
END $function$;