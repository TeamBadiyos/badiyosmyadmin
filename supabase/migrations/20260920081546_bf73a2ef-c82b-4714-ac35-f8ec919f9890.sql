
-- ---------- TDS helper ----------
CREATE OR REPLACE FUNCTION public.compute_tds(_owner_type text, _owner_id uuid, _gross numeric)
RETURNS TABLE(rate numeric, amount numeric, pan_last4 text, applicable boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _rate numeric := 0; _pan text; _has_pan boolean := false; _eff date; _threshold numeric;
BEGIN
  IF NOT public.get_ops_flag('tds_master_enabled') THEN
    RETURN QUERY SELECT 0::numeric, 0::numeric, NULL::text, false; RETURN;
  END IF;
  IF _owner_type = 'expert' AND NOT public.get_ops_flag('tds_expert_enabled') THEN
    RETURN QUERY SELECT 0::numeric, 0::numeric, NULL::text, false; RETURN;
  END IF;
  IF _owner_type = 'area_partner' AND NOT public.get_ops_flag('tds_partner_enabled') THEN
    RETURN QUERY SELECT 0::numeric, 0::numeric, NULL::text, false; RETURN;
  END IF;
  IF _owner_type NOT IN ('expert','area_partner') THEN
    RETURN QUERY SELECT 0::numeric, 0::numeric, NULL::text, false; RETURN;
  END IF;

  _eff := COALESCE(NULLIF((SELECT value FROM public.ops_settings WHERE key='tds_effective_from'),'')::date, '1900-01-01');
  IF CURRENT_DATE < _eff THEN
    RETURN QUERY SELECT 0::numeric, 0::numeric, NULL::text, false; RETURN;
  END IF;

  _threshold := public.get_ops_num('tds_annual_threshold', 0);
  IF COALESCE(_gross,0) <= 0 OR COALESCE(_gross,0) < _threshold THEN
    RETURN QUERY SELECT 0::numeric, 0::numeric, NULL::text, false; RETURN;
  END IF;

  IF _owner_type = 'expert' THEN
    SELECT e.pan_last4 INTO _pan FROM public.experts e WHERE e.id = _owner_id;
  ELSE
    SELECT a.pan_last4 INTO _pan FROM public.area_partners a WHERE a.id = _owner_id;
  END IF;
  _has_pan := _pan IS NOT NULL AND _pan <> '';

  _rate := CASE WHEN _has_pan
                THEN public.get_ops_num('tds_rate_service', public.get_ops_num('tds_default_rate', 2))
                ELSE public.get_ops_num('tds_no_pan_rate', 20) END;

  RETURN QUERY SELECT _rate, round(COALESCE(_gross,0) * _rate / 100.0), _pan, true;
END $$;

REVOKE EXECUTE ON FUNCTION public.compute_tds(text, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_tds(text, uuid, numeric) TO authenticated, service_role;

-- ---------- Payout batch generation v2 ----------
CREATE OR REPLACE FUNCTION public.staff_generate_payout_batch()
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid uuid := auth.uid();
  _batch_id uuid; _ws date; _we date; _total numeric := 0;
  _wallet_mode boolean := public.get_ops_flag('payout_batch_wallet_mode');
  _new_engine boolean := public.get_ops_flag('use_new_commission_engine');
  _it record; _t record;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  _ws := date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata')::date;
  _we := (_ws + INTERVAL '6 days')::date;

  IF EXISTS (SELECT 1 FROM public.payout_batches
              WHERE week_start=_ws AND batch_type='expert' AND status <> 'discarded') THEN
    RAISE EXCEPTION 'Batch already exists for this week';
  END IF;

  INSERT INTO public.payout_batches(week_start, week_end, status, total_amount, batch_type)
    VALUES(_ws, _we, 'pending', 0, 'expert') RETURNING id INTO _batch_id;

  IF _wallet_mode THEN
    -- settle full withdrawable wallet balances
    INSERT INTO public.payout_batch_items(batch_id, owner_type, owner_id, amount, gross_amount, booking_ids)
      SELECT _batch_id, 'expert', e.id, e.wallet_balance, e.wallet_balance, ARRAY[]::uuid[]
        FROM public.experts e WHERE COALESCE(e.wallet_balance,0) > 0;

    INSERT INTO public.payout_batch_items(batch_id, owner_type, owner_id, amount, gross_amount, booking_ids)
      SELECT _batch_id, 'area_partner', l.owner_id,
             SUM(CASE WHEN l.type='credit' THEN l.amount ELSE -l.amount END),
             SUM(CASE WHEN l.type='credit' THEN l.amount ELSE -l.amount END),
             ARRAY[]::uuid[]
        FROM public.wallet_ledger l
       WHERE l.owner_type='area_partner'
       GROUP BY l.owner_id
      HAVING SUM(CASE WHEN l.type='credit' THEN l.amount ELSE -l.amount END) > 0;
  ELSE
    -- expert side, booking based, one booking one batch
    WITH cand AS (
      SELECT b.id AS booking_id, b.assigned_expert_id AS owner_id,
             CASE WHEN _new_engine THEN COALESCE(b.snapshot_expert_payout,0)
                  ELSE (SELECT r.expert_payout FROM public.resolve_booking_payouts(b.id) r) END AS payout
        FROM public.bookings b
       WHERE b.status='completed' AND b.assigned_expert_id IS NOT NULL
         AND b.expert_payout_batch_id IS NULL
         AND (b.updated_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN _ws AND _we
    ), agg AS (
      SELECT owner_id, SUM(payout) AS amount, array_agg(booking_id) AS booking_ids
        FROM cand WHERE payout > 0 GROUP BY owner_id
    )
    INSERT INTO public.payout_batch_items(batch_id, owner_type, owner_id, amount, gross_amount, booking_ids)
      SELECT _batch_id, 'expert', owner_id, amount, amount, booking_ids FROM agg;

    -- partner side
    WITH cand AS (
      SELECT b.id AS booking_id,
             COALESCE(b.assigned_area_partner_id, z.assigned_area_partner_id) AS owner_id,
             CASE WHEN _new_engine THEN COALESCE(b.snapshot_partner_payout,0)
                  ELSE (SELECT r.area_partner_payout FROM public.resolve_booking_payouts(b.id) r) END AS payout
        FROM public.bookings b
        LEFT JOIN public.zones z ON z.id = b.zone_id
       WHERE b.status='completed'
         AND b.partner_payout_batch_id IS NULL
         AND COALESCE(b.assigned_area_partner_id, z.assigned_area_partner_id) IS NOT NULL
         AND (b.updated_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN _ws AND _we
    ), agg AS (
      SELECT owner_id, SUM(payout) AS amount, array_agg(booking_id) AS booking_ids
        FROM cand WHERE payout > 0 GROUP BY owner_id
    )
    INSERT INTO public.payout_batch_items(batch_id, owner_type, owner_id, amount, gross_amount, booking_ids)
      SELECT _batch_id, 'area_partner', owner_id, amount, amount, booking_ids FROM agg;

    -- stamp bookings so they can never enter another batch
    UPDATE public.bookings b SET expert_payout_batch_id = _batch_id
      FROM public.payout_batch_items i
     WHERE i.batch_id=_batch_id AND i.owner_type='expert' AND b.id = ANY(i.booking_ids);
    UPDATE public.bookings b SET partner_payout_batch_id = _batch_id
      FROM public.payout_batch_items i
     WHERE i.batch_id=_batch_id AND i.owner_type='area_partner' AND b.id = ANY(i.booking_ids);
  END IF;

  -- TDS per item
  FOR _it IN SELECT * FROM public.payout_batch_items WHERE batch_id=_batch_id LOOP
    SELECT * INTO _t FROM public.compute_tds(_it.owner_type, _it.owner_id, _it.gross_amount);
    UPDATE public.payout_batch_items
       SET tds_rate = COALESCE(_t.rate,0),
           tds_amount = COALESCE(_t.amount,0),
           net_amount = round(_it.gross_amount) - COALESCE(_t.amount,0),
           tds_status = CASE WHEN COALESCE(_t.amount,0) > 0 THEN 'accrued' ELSE 'none' END,
           pan_last4 = _t.pan_last4
     WHERE id = _it.id;
  END LOOP;

  SELECT COALESCE(SUM(amount),0) INTO _total FROM public.payout_batch_items WHERE batch_id=_batch_id;
  UPDATE public.payout_batches SET total_amount=_total WHERE id=_batch_id;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES(_uid,'generate_payout_batch','payout_batches',_batch_id,NULL,
         jsonb_build_object('week_start',_ws,'week_end',_we,'total_amount',_total,
                            'batch_type','expert','wallet_mode',_wallet_mode,'new_engine',_new_engine));
  RETURN _batch_id;
END $$;

-- ---------- Discard a pending batch ----------
CREATE OR REPLACE FUNCTION public.staff_discard_payout_batch(_batch_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _before jsonb; _it record;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_super_admin_user() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT to_jsonb(b) INTO _before FROM public.payout_batches b WHERE b.id=_batch_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Batch not found'; END IF;
  IF (_before->>'status') = 'paid' THEN RAISE EXCEPTION 'Paid batch cannot be discarded'; END IF;

  -- release bookings
  UPDATE public.bookings SET expert_payout_batch_id = NULL WHERE expert_payout_batch_id = _batch_id;
  UPDATE public.bookings SET partner_payout_batch_id = NULL WHERE partner_payout_batch_id = _batch_id;

  -- reverse any wallet debits already posted for this batch (never delete ledger rows)
  FOR _it IN SELECT * FROM public.payout_batch_items WHERE batch_id=_batch_id AND paid LOOP
    INSERT INTO public.wallet_ledger(owner_type, owner_id, type, amount, reason)
    VALUES(_it.owner_type, _it.owner_id, 'credit', _it.gross_amount,
           'Payout batch discarded – reversal: ' || _batch_id);
    IF _it.owner_type='expert' THEN
      UPDATE public.experts SET wallet_balance = COALESCE(wallet_balance,0) + _it.gross_amount
       WHERE id=_it.owner_id;
    END IF;
  END LOOP;

  UPDATE public.payout_batch_items
     SET tds_status = CASE WHEN tds_status='accrued' THEN 'cancelled' ELSE tds_status END,
         paid = false, paid_at = NULL
   WHERE batch_id=_batch_id;

  UPDATE public.payout_batches SET status='discarded' WHERE id=_batch_id;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES(_uid,'discard_payout_batch','payout_batches',_batch_id,_before,
         jsonb_build_object('status','discarded','reason',_reason));
END $$;

-- ---------- Confirm batch: wallet debit in wallet mode ----------
CREATE OR REPLACE FUNCTION public.staff_confirm_payout_batch(_batch_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _before jsonb; _it record;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT to_jsonb(b) INTO _before FROM public.payout_batches b WHERE b.id=_batch_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Batch not found'; END IF;
  IF (_before->>'status') = 'paid' THEN RETURN; END IF;
  IF (_before->>'status') = 'discarded' THEN RAISE EXCEPTION 'Batch was discarded'; END IF;

  IF public.get_ops_flag('payout_batch_wallet_mode') THEN
    FOR _it IN SELECT * FROM public.payout_batch_items WHERE batch_id=_batch_id AND NOT paid LOOP
      INSERT INTO public.wallet_ledger(owner_type, owner_id, type, amount, reason)
      VALUES(_it.owner_type, _it.owner_id, 'debit', _it.gross_amount,
             'Payout batch settled (gross): ' || _batch_id);
      IF COALESCE(_it.tds_amount,0) > 0 THEN
        INSERT INTO public.wallet_ledger(owner_type, owner_id, type, amount, reason)
        VALUES(_it.owner_type, _it.owner_id, 'credit', _it.tds_amount,
               'TDS withheld @' || _it.tds_rate || '% for batch ' || _batch_id);
      END IF;
      IF _it.owner_type='expert' THEN
        UPDATE public.experts
           SET wallet_balance = COALESCE(wallet_balance,0) - _it.gross_amount + COALESCE(_it.tds_amount,0)
         WHERE id=_it.owner_id;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.payout_batch_items SET paid=true, paid_at=now() WHERE batch_id=_batch_id;
  UPDATE public.payout_batches SET status='paid' WHERE id=_batch_id;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES(_uid,'confirm_payout_batch','payout_batches',_batch_id,_before,
         jsonb_build_object('status','paid','wallet_mode',public.get_ops_flag('payout_batch_wallet_mode')));
END $$;

-- ---------- TDS report + deposit marking ----------
CREATE OR REPLACE FUNCTION public.staff_tds_report(_fy_start_year integer)
RETURNS TABLE(owner_type text, owner_id uuid, owner_name text, pan_last4 text,
              gross_total numeric, tds_total numeric, net_total numeric,
              deposited_total numeric, items integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _from date; _to date;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  _from := make_date(_fy_start_year, 4, 1);
  _to := make_date(_fy_start_year + 1, 3, 31);

  RETURN QUERY
  SELECT i.owner_type, i.owner_id,
         COALESCE(e.name, a.name, 'Unknown'),
         COALESCE(e.pan_last4, a.pan_last4),
         SUM(COALESCE(i.gross_amount, i.amount)),
         SUM(COALESCE(i.tds_amount,0)),
         SUM(COALESCE(i.net_amount, i.amount)),
         SUM(CASE WHEN i.tds_status='deposited' THEN COALESCE(i.tds_amount,0) ELSE 0 END),
         COUNT(*)::int
    FROM public.payout_batch_items i
    JOIN public.payout_batches b ON b.id = i.batch_id
    LEFT JOIN public.experts e ON i.owner_type='expert' AND e.id = i.owner_id
    LEFT JOIN public.area_partners a ON i.owner_type='area_partner' AND a.id = i.owner_id
   WHERE b.status = 'paid'
     AND b.week_start BETWEEN _from AND _to
     AND i.owner_type IN ('expert','area_partner')
   GROUP BY i.owner_type, i.owner_id, e.name, a.name, e.pan_last4, a.pan_last4
   ORDER BY 3;
END $$;

CREATE OR REPLACE FUNCTION public.staff_mark_tds_deposited(
  _owner_type text, _owner_id uuid, _fy_start_year integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _n integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_super_admin_user() THEN RAISE EXCEPTION 'Forbidden'; END IF;

  WITH upd AS (
    UPDATE public.payout_batch_items i
       SET tds_status='deposited', tds_deposited_at=now()
      FROM public.payout_batches b
     WHERE b.id=i.batch_id AND b.status='paid'
       AND i.owner_type=_owner_type AND i.owner_id=_owner_id
       AND i.tds_status='accrued'
       AND b.week_start BETWEEN make_date(_fy_start_year,4,1) AND make_date(_fy_start_year+1,3,31)
    RETURNING i.id
  ) SELECT COUNT(*) INTO _n FROM upd;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES(_uid,'mark_tds_deposited','payout_batch_items',_owner_id,NULL,
         jsonb_build_object('owner_type',_owner_type,'fy',_fy_start_year,'items',_n));
  RETURN _n;
END $$;

CREATE OR REPLACE FUNCTION public.staff_export_raw_pan_tds_report(_fy_start_year integer)
RETURNS TABLE(owner_type text, owner_name text, pan text,
              gross_total numeric, tds_total numeric, net_total numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public, extensions' AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_super_admin_user() THEN RAISE EXCEPTION 'Forbidden'; END IF;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES(_uid,'export_raw_pan_tds_report','payout_batch_items',NULL,NULL,
         jsonb_build_object('fy',_fy_start_year));

  RETURN QUERY
  SELECT r.owner_type, r.owner_name,
         CASE WHEN r.owner_type='expert'
              THEN (SELECT pgp_sym_decrypt(e.pan_encrypted, public.pan_key()) FROM public.experts e WHERE e.id=r.owner_id)
              ELSE (SELECT pgp_sym_decrypt(a.pan_encrypted, public.pan_key()) FROM public.area_partners a WHERE a.id=r.owner_id)
         END,
         r.gross_total, r.tds_total, r.net_total
    FROM public.staff_tds_report(_fy_start_year) r;
END $$;

REVOKE EXECUTE ON FUNCTION public.staff_generate_payout_batch() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.staff_discard_payout_batch(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.staff_confirm_payout_batch(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.staff_tds_report(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.staff_mark_tds_deposited(text, uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.staff_export_raw_pan_tds_report(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_discard_payout_batch(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_confirm_payout_batch(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_tds_report(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_mark_tds_deposited(text, uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_export_raw_pan_tds_report(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_generate_payout_batch() TO authenticated, service_role;
