-- 1. Batch typing
ALTER TABLE public.payout_batches
  ADD COLUMN IF NOT EXISTS batch_type text NOT NULL DEFAULT 'expert';
ALTER TABLE public.payout_batches DROP CONSTRAINT IF EXISTS payout_batches_batch_type_check;
ALTER TABLE public.payout_batches
  ADD CONSTRAINT payout_batches_batch_type_check CHECK (batch_type IN ('expert','merchant'));

-- 2. Merchant owner support + ledger tracking on items
ALTER TABLE public.payout_batch_items DROP CONSTRAINT IF EXISTS payout_batch_items_owner_type_check;
ALTER TABLE public.payout_batch_items
  ADD CONSTRAINT payout_batch_items_owner_type_check
  CHECK (owner_type IN ('expert','area_partner','merchant'));
ALTER TABLE public.payout_batch_items
  ADD COLUMN IF NOT EXISTS ledger_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[];

-- 3. Existing expert generator: scope its duplicate-week guard + tag its batches
CREATE OR REPLACE FUNCTION public.staff_generate_payout_batch()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  _ws := date_trunc('week', now())::date;
  _we := (_ws + INTERVAL '6 days')::date;

  IF EXISTS (SELECT 1 FROM public.payout_batches WHERE week_start=_ws AND batch_type='expert') THEN
    RAISE EXCEPTION 'Batch already exists for this week';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT b), ARRAY[]::uuid[])
    INTO _used_bookings
    FROM public.payout_batch_items p, unnest(p.booking_ids) AS b;

  INSERT INTO public.payout_batches(week_start, week_end, status, total_amount, batch_type)
    VALUES(_ws, _we, 'pending', 0, 'expert')
    RETURNING id INTO _batch_id;

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
      FROM cand WHERE payout > 0 GROUP BY owner_id
  )
  INSERT INTO public.payout_batch_items(batch_id, owner_type, owner_id, amount, booking_ids)
    SELECT _batch_id, 'expert', owner_id, amount, booking_ids FROM agg;

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
      FROM cand WHERE payout > 0 GROUP BY owner_id
  )
  INSERT INTO public.payout_batch_items(batch_id, owner_type, owner_id, amount, booking_ids)
    SELECT _batch_id, 'area_partner', owner_id, amount, booking_ids FROM agg;

  SELECT COALESCE(SUM(amount),0) INTO _total FROM public.payout_batch_items WHERE batch_id=_batch_id;
  UPDATE public.payout_batches SET total_amount=_total WHERE id=_batch_id;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
    VALUES(_uid,'generate_payout_batch','payout_batches',_batch_id,NULL,
           jsonb_build_object('week_start',_ws,'week_end',_we,'total_amount',_total,'batch_type','expert'));

  RETURN _batch_id;
END $function$;

-- 4. Merchant generator (ledger-based)
CREATE OR REPLACE FUNCTION public.staff_generate_merchant_payout_batch()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _batch_id uuid;
  _ws date;
  _we date;
  _total numeric := 0;
  _used_ledger uuid[];
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  _ws := date_trunc('week', now())::date;
  _we := (_ws + INTERVAL '6 days')::date;

  IF EXISTS (SELECT 1 FROM public.payout_batches WHERE week_start=_ws AND batch_type='merchant') THEN
    RAISE EXCEPTION 'Merchant batch already exists for this week';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT l), ARRAY[]::uuid[])
    INTO _used_ledger
    FROM public.payout_batch_items p, unnest(p.ledger_ids) AS l;

  INSERT INTO public.payout_batches(week_start, week_end, status, total_amount, batch_type)
    VALUES(_ws, _we, 'pending', 0, 'merchant')
    RETURNING id INTO _batch_id;

  WITH cand AS (
    SELECT wl.id AS ledger_id, wl.owner_id,
           CASE WHEN wl.type = 'credit' THEN wl.amount ELSE -wl.amount END AS delta
      FROM public.wallet_ledger wl
     WHERE wl.owner_type = 'merchant'
       AND wl.created_at::date BETWEEN _ws AND _we
       AND NOT (wl.id = ANY(_used_ledger))
  ), agg AS (
    SELECT owner_id, SUM(delta) AS amount, array_agg(ledger_id) AS ledger_ids
      FROM cand GROUP BY owner_id
  )
  INSERT INTO public.payout_batch_items(batch_id, owner_type, owner_id, amount, booking_ids, ledger_ids)
    SELECT _batch_id, 'merchant', owner_id, amount, ARRAY[]::uuid[], ledger_ids
      FROM agg WHERE amount > 0;

  SELECT COALESCE(SUM(amount),0) INTO _total FROM public.payout_batch_items WHERE batch_id=_batch_id;
  UPDATE public.payout_batches SET total_amount=_total WHERE id=_batch_id;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
    VALUES(_uid,'generate_merchant_payout_batch','payout_batches',_batch_id,NULL,
           jsonb_build_object('week_start',_ws,'week_end',_we,'total_amount',_total,'batch_type','merchant'));

  RETURN _batch_id;
END $function$;

REVOKE ALL ON FUNCTION public.staff_generate_merchant_payout_batch() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_generate_merchant_payout_batch() TO authenticated;