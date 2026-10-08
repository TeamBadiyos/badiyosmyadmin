-- ===== Step 2: zero all old partner earnings =====
SELECT set_config('app.booking_bypass', 'on', true);
UPDATE public.bookings SET snapshot_partner_payout = 0 WHERE COALESCE(snapshot_partner_payout,0) <> 0;
UPDATE public.bookings SET partner_payout_batch_id = NULL WHERE partner_payout_batch_id IS NOT NULL;
UPDATE public.service_price_options SET partner_commission = 0 WHERE COALESCE(partner_commission,0) <> 0;
UPDATE public.service_catalogue_config SET area_partner_payout = 0 WHERE COALESCE(area_partner_payout,0) <> 0;
UPDATE public.commission_rules SET partner_value = 0 WHERE COALESCE(partner_value,0) <> 0;
DELETE FROM public.wallet_ledger WHERE owner_type = 'area_partner';
DELETE FROM public.payout_batch_items WHERE owner_type = 'area_partner';
DELETE FROM public.payout_batches WHERE batch_type = 'area_partner';
DELETE FROM public.staff_notification_state WHERE notification_id IN (SELECT id FROM public.staff_notifications WHERE notif_key LIKE 'lead_partner:%');
DELETE FROM public.staff_notifications WHERE notif_key LIKE 'lead_partner:%';
UPDATE public.staff_users SET status = 'inactive' WHERE role = 'area_partner' AND status <> 'inactive';

-- ===== Step 3: stop partner commission calculation =====
CREATE OR REPLACE FUNCTION public.bookings_snapshot_commission()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _spo record; _split record; _ep numeric; _hours numeric;
BEGIN
  IF COALESCE(NEW.is_training, false) THEN
    NEW.snapshot_expert_payout := 0; NEW.snapshot_partner_payout := 0;
    NEW.snapshot_hq_share := 0; NEW.snapshot_hourly_rate := 0; NEW.commission_rule_id := NULL;
    RETURN NEW;
  END IF;
  IF NEW.price_option_id IS NOT NULL THEN
    SELECT spo.id, spo.expert_payout INTO _spo FROM public.service_price_options spo WHERE spo.id = NEW.price_option_id;
  END IF;
  IF _spo.id IS NULL THEN
    SELECT spo.id, spo.expert_payout INTO _spo
      FROM public.service_price_options spo JOIN public.services s ON s.id = spo.service_id
     WHERE lower(spo.label) = lower(COALESCE(NEW.service_label,''))
       AND (NEW.service_category_id IS NULL OR s.category_id = NEW.service_category_id)
       AND spo.is_active
     ORDER BY (s.category_id = NEW.service_category_id) DESC, spo.display_order LIMIT 1;
  END IF;
  IF public.get_ops_flag('use_new_commission_engine') THEN
    SELECT * INTO _split FROM public.resolve_commission_split(_spo.id, COALESCE(NEW.price,0), NEW.service_duration_minutes);
    NEW.snapshot_expert_payout := _split.expert_amount;
    NEW.snapshot_partner_payout := 0;
    NEW.snapshot_hq_share := _split.hq_amount;
    NEW.snapshot_hourly_rate := _split.hourly_rate;
    NEW.commission_rule_id := _split.rule_id;
  ELSE
    _ep := COALESCE(_spo.expert_payout, 0);
    _hours := GREATEST(COALESCE(NEW.service_duration_minutes,60)::numeric / 60.0, 1.0/60.0);
    NEW.snapshot_expert_payout := _ep;
    NEW.snapshot_partner_payout := 0;
    NEW.snapshot_hq_share := round(COALESCE(NEW.price,0)) - _ep;
    NEW.snapshot_hourly_rate := round(_ep / _hours, 2);
    NEW.commission_rule_id := NULL;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.resolve_commission_split(_price_option_id uuid, _price numeric, _duration_minutes integer)
 RETURNS TABLE(expert_amount numeric, partner_amount numeric, hq_amount numeric, hourly_rate numeric, rule_id uuid)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _r record; _hours numeric; _e numeric;
BEGIN
  _hours := GREATEST(COALESCE(_duration_minutes,60)::numeric / 60.0, 0);
  IF _hours = 0 THEN _hours := 1; END IF;
  SELECT * INTO _r FROM public.commission_rules WHERE is_active AND price_option_id = _price_option_id LIMIT 1;
  IF _r.id IS NULL THEN SELECT * INTO _r FROM public.commission_rules WHERE is_active AND scope='default' LIMIT 1; END IF;
  IF _r.id IS NULL THEN
    RETURN QUERY SELECT 0::numeric, 0::numeric, COALESCE(_price,0), 0::numeric, NULL::uuid; RETURN;
  END IF;
  _e := CASE _r.expert_type WHEN 'per_hour' THEN _r.expert_value * _hours
          WHEN 'percent' THEN COALESCE(_price,0) * _r.expert_value / 100.0 ELSE _r.expert_value END;
  _e := round(COALESCE(_e,0));
  RETURN QUERY SELECT _e, 0::numeric, round(COALESCE(_price,0)) - _e,
                      CASE WHEN _hours > 0 THEN round(_e / _hours, 2) ELSE _e END, _r.id;
END $function$;

CREATE OR REPLACE FUNCTION public.resolve_booking_payouts(_booking_id uuid)
 RETURNS TABLE(expert_payout numeric, area_partner_payout numeric)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _b record; _ep numeric; _ext numeric;
BEGIN
  SELECT id, service_label, service_duration_minutes, service_category_id, price_option_id,
         snapshot_expert_payout, snapshot_hourly_rate
    INTO _b FROM public.bookings WHERE id = _booking_id;
  IF _b.id IS NULL THEN RETURN QUERY SELECT 0::numeric, 0::numeric; RETURN; END IF;
  IF _b.price_option_id IS NOT NULL THEN
    SELECT NULLIF(COALESCE(spo.expert_payout,0),0) INTO _ep FROM public.service_price_options spo WHERE spo.id = _b.price_option_id;
  END IF;
  IF _ep IS NULL THEN
    SELECT NULLIF(COALESCE(spo.expert_payout,0),0) INTO _ep
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
  _ep := COALESCE(_ep, 0) + _ext;
  RETURN QUERY SELECT COALESCE(_ep,0), 0::numeric;
END $function$;

CREATE OR REPLACE FUNCTION public.staff_generate_payout_batch()
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _batch_id uuid; _ws date; _we date; _total numeric := 0;
  _wallet_mode boolean := public.get_ops_flag('payout_batch_wallet_mode');
  _new_engine boolean := public.get_ops_flag('use_new_commission_engine');
  _it record; _t record;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  _ws := date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata')::date;
  _we := (_ws + INTERVAL '6 days')::date;
  IF EXISTS (SELECT 1 FROM public.payout_batches WHERE week_start=_ws AND batch_type='expert' AND status <> 'discarded') THEN
    RAISE EXCEPTION 'Batch already exists for this week';
  END IF;
  INSERT INTO public.payout_batches(week_start, week_end, status, total_amount, batch_type)
    VALUES(_ws, _we, 'pending', 0, 'expert') RETURNING id INTO _batch_id;
  IF _wallet_mode THEN
    INSERT INTO public.payout_batch_items(batch_id, owner_type, owner_id, amount, gross_amount, booking_ids)
      SELECT _batch_id, 'expert', e.id, e.wallet_balance, e.wallet_balance, ARRAY[]::uuid[]
        FROM public.experts e WHERE COALESCE(e.wallet_balance,0) > 0;
  ELSE
    WITH cand AS (
      SELECT b.id AS booking_id, b.assigned_expert_id AS owner_id,
             CASE WHEN _new_engine THEN COALESCE(b.snapshot_expert_payout,0)
                  ELSE (SELECT r.expert_payout FROM public.resolve_booking_payouts(b.id) r) END AS payout
        FROM public.bookings b
       WHERE NOT b.is_training AND b.status='completed' AND b.assigned_expert_id IS NOT NULL
         AND b.expert_payout_batch_id IS NULL
         AND (b.updated_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN _ws AND _we
    ), agg AS (
      SELECT owner_id, SUM(payout) AS amount, array_agg(booking_id) AS booking_ids
        FROM cand WHERE payout > 0 GROUP BY owner_id
    )
    INSERT INTO public.payout_batch_items(batch_id, owner_type, owner_id, amount, gross_amount, booking_ids)
      SELECT _batch_id, 'expert', owner_id, amount, amount, booking_ids FROM agg;
    UPDATE public.bookings b SET expert_payout_batch_id = _batch_id
      FROM public.payout_batch_items i
     WHERE i.batch_id=_batch_id AND i.owner_type='expert' AND b.id = ANY(i.booking_ids);
  END IF;
  FOR _it IN SELECT * FROM public.payout_batch_items WHERE batch_id=_batch_id LOOP
    SELECT * INTO _t FROM public.compute_tds(_it.owner_type, _it.owner_id, _it.gross_amount);
    UPDATE public.payout_batch_items
       SET tds_rate = COALESCE(_t.rate,0), tds_amount = COALESCE(_t.amount,0),
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
END $function$;

CREATE OR REPLACE FUNCTION public.compute_tds(_owner_type text, _owner_id uuid, _gross numeric)
 RETURNS TABLE(rate numeric, amount numeric, pan_last4 text, applicable boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _rate numeric := 0; _pan text;
BEGIN
  IF NOT public.get_ops_flag('tds_master_enabled') THEN
    RETURN QUERY SELECT 0::numeric, 0::numeric, NULL::text, false; RETURN;
  END IF;
  IF _owner_type <> 'expert' OR COALESCE(_gross,0) <= 0 THEN
    RETURN QUERY SELECT 0::numeric, 0::numeric, NULL::text, false; RETURN;
  END IF;
  SELECT e.pan_last4 INTO _pan FROM public.experts e WHERE e.id = _owner_id;
  _rate := public.get_ops_num('tds_default_rate', 2);
  RETURN QUERY SELECT _rate, round(COALESCE(_gross,0) * _rate / 100.0), _pan, true;
END $function$;

CREATE OR REPLACE FUNCTION public.staff_export_raw_pan_tds_report(_fy_start_year integer)
 RETURNS TABLE(owner_type text, owner_name text, pan text, gross_total numeric, tds_total numeric, net_total numeric)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public, extensions'
AS $function$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_super_admin_user() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES(_uid,'export_raw_pan_tds_report','payout_batch_items',NULL,NULL, jsonb_build_object('fy',_fy_start_year));
  RETURN QUERY
  SELECT r.owner_type, r.owner_name,
         (SELECT pgp_sym_decrypt(e.pan_encrypted, public.pan_key()) FROM public.experts e WHERE e.id=r.owner_id),
         r.gross_total, r.tds_total, r.net_total
    FROM public.staff_tds_report(_fy_start_year) r;
END $function$;

CREATE OR REPLACE FUNCTION public.staff_tds_report(_fy_start_year integer)
 RETURNS TABLE(owner_type text, owner_id uuid, owner_name text, pan_last4 text, gross_total numeric, tds_total numeric, net_total numeric, deposited_total numeric, items integer)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _from date; _to date;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  _from := make_date(_fy_start_year, 4, 1);
  _to := make_date(_fy_start_year + 1, 3, 31);
  RETURN QUERY
  SELECT i.owner_type, i.owner_id, COALESCE(e.name, 'Unknown'), e.pan_last4,
         SUM(COALESCE(i.gross_amount, i.amount)), SUM(COALESCE(i.tds_amount,0)),
         SUM(COALESCE(i.net_amount, i.amount)),
         SUM(CASE WHEN i.tds_status='deposited' THEN COALESCE(i.tds_amount,0) ELSE 0 END), COUNT(*)::int
    FROM public.payout_batch_items i
    JOIN public.payout_batches b ON b.id = i.batch_id
    LEFT JOIN public.experts e ON e.id = i.owner_id
   WHERE b.status = 'paid' AND b.week_start BETWEEN _from AND _to AND i.owner_type = 'expert'
   GROUP BY i.owner_type, i.owner_id, e.name, e.pan_last4
   ORDER BY 3;
END $function$;

CREATE OR REPLACE FUNCTION public.staff_set_pan(_owner_type text, _owner_id uuid, _pan text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public, extensions'
AS $function$
DECLARE _uid uuid := auth.uid(); _clean text; _last4 text; _before jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_super_admin_user() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _owner_type <> 'expert' THEN RAISE EXCEPTION 'Invalid owner type'; END IF;
  _clean := upper(regexp_replace(COALESCE(_pan,''), '\s', '', 'g'));
  IF _clean <> '' AND _clean !~ '^[A-Z]{5}[0-9]{4}[A-Z]{1}$' THEN RAISE EXCEPTION 'Invalid PAN format'; END IF;
  _last4 := NULLIF(right(_clean, 4), '');
  SELECT jsonb_build_object('pan_last4', pan_last4) INTO _before FROM public.experts WHERE id = _owner_id;
  UPDATE public.experts
     SET pan_encrypted = CASE WHEN _clean = '' THEN NULL ELSE pgp_sym_encrypt(_clean, public.pan_key()) END,
         pan_last4 = _last4, pan_updated_at = now()
   WHERE id = _owner_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES(_uid, 'set_pan', _owner_type, _owner_id, _before, jsonb_build_object('pan_last4', _last4));
END $function$;

CREATE OR REPLACE FUNCTION public.staff_wallet_adjust(_owner_type text, _owner_id uuid, _amount numeric, _type text, _reason text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _staff_id uuid; _ledger_id uuid; _delta numeric; _before jsonb; _after jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT id INTO _staff_id FROM public.staff_users WHERE auth_user_id=_uid AND status='active' AND role='super_admin';
  IF _staff_id IS NULL THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _owner_type <> 'expert' THEN RAISE EXCEPTION 'Invalid owner_type'; END IF;
  IF _type NOT IN ('credit','debit') THEN RAISE EXCEPTION 'Invalid type'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION 'Reason required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.experts WHERE id=_owner_id) THEN RAISE EXCEPTION 'Owner not found'; END IF;
  _delta := CASE WHEN _type='credit' THEN _amount ELSE -_amount END;
  INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
    VALUES(_owner_type, _owner_id, _amount, _type, btrim(_reason), _staff_id) RETURNING id INTO _ledger_id;
  SELECT to_jsonb(e) INTO _before FROM public.experts e WHERE id=_owner_id;
  UPDATE public.experts SET wallet_balance = COALESCE(wallet_balance,0) + _delta WHERE id=_owner_id;
  SELECT to_jsonb(e) INTO _after FROM public.experts e WHERE id=_owner_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
    VALUES(_uid, 'wallet_adjust', 'wallet_ledger', _ledger_id,
           jsonb_build_object('owner_type',_owner_type,'owner_id',_owner_id,'before',_before),
           jsonb_build_object('amount',_amount,'type',_type,'reason',_reason,'after',_after));
  RETURN _ledger_id;
END $function$;

CREATE OR REPLACE FUNCTION public.staff_set_lead_status(_kind text, _lead_id uuid, _status text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_ok boolean; v_old text;
begin
  select exists (select 1 from staff_users s where s.auth_user_id = auth.uid() and s.status = 'active'
                 and s.role in ('super_admin','ops_manager')) into v_ok;
  if not v_ok then raise exception 'Forbidden'; end if;
  if _status not in ('new','contacted','converted','rejected') then raise exception 'invalid_status'; end if;
  if _kind = 'expert' then
    select status into v_old from expert_leads where id = _lead_id;
    if v_old is null then raise exception 'lead_not_found'; end if;
    update expert_leads set status = _status where id = _lead_id;
  else
    raise exception 'invalid_kind';
  end if;
  insert into audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (auth.uid(), 'lead_status_change', _kind || '_lead', _lead_id,
          jsonb_build_object('status', v_old), jsonb_build_object('status', _status));
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.zone_delete_impact(_zone_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _experts int; _bookings int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT count(*) INTO _experts FROM public.experts WHERE zone_id = _zone_id AND status = 'active';
  SELECT count(*) INTO _bookings FROM public.bookings
    WHERE zone_id = _zone_id AND status NOT IN ('completed','cancelled','rejected') AND deleted_at IS NULL;
  RETURN jsonb_build_object('active_experts', COALESCE(_experts,0), 'has_partner', false, 'open_bookings', COALESCE(_bookings,0));
END;$function$;

CREATE OR REPLACE FUNCTION public.staff_soft_delete_zone(_zone_id uuid, _reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _before jsonb; _after jsonb; _unassigned int := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION 'Reason required'; END IF;
  SELECT to_jsonb(z) INTO _before FROM public.zones z WHERE id = _zone_id FOR UPDATE;
  IF _before IS NULL THEN RAISE EXCEPTION 'Zone not found'; END IF;
  IF (_before->>'deleted_at') IS NOT NULL THEN RAISE EXCEPTION 'Zone already deleted'; END IF;
  UPDATE public.experts SET zone_id = NULL WHERE zone_id = _zone_id;
  GET DIAGNOSTICS _unassigned = ROW_COUNT;
  UPDATE public.zones SET deleted_at = now(), deleted_by = _uid, delete_reason = btrim(_reason), status = 'inactive'
   WHERE id = _zone_id;
  SELECT to_jsonb(z) INTO _after FROM public.zones z WHERE id = _zone_id;
  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'soft_delete_zone', 'zones', _zone_id, _before, _after || jsonb_build_object('experts_unassigned', _unassigned));
END;$function$;

-- staff_sync_notifications: remove the area-partner lead block and keep-list line
DO $do$
DECLARE d text; blk text := $b$  INSERT INTO public.staff_notifications (notif_key, kind, title, detail, target, target_id, event_at)
  SELECT 'lead_partner:'||l.id, 'lead', 'New area partner lead',
         coalesce(l.name,'')||' — '||coalesce(l.area,'')||' ('||coalesce(l.phone,'')||')',
         'partners', l.id, l.created_at
  FROM public.area_partner_leads l
  WHERE coalesce(l.status,'new') = 'new'
  ON CONFLICT (notif_key) DO NOTHING;
$b$;
BEGIN
  d := pg_get_functiondef('public.staff_sync_notifications'::regproc);
  IF position(blk in d) = 0 THEN RAISE EXCEPTION 'partner lead block not found'; END IF;
  d := replace(d, blk, '');
  d := replace(d, E'\n    UNION ALL SELECT ''lead_partner:''||l.id FROM public.area_partner_leads l WHERE coalesce(l.status,''new'') = ''new''', '');
  IF d ~ 'area_partner' THEN RAISE EXCEPTION 'partner reference remains in staff_sync_notifications'; END IF;
  EXECUTE d;
END $do$;

-- ===== Drop partner-only objects =====
DROP FUNCTION IF EXISTS public.staff_upsert_area_partner(jsonb);
DROP FUNCTION IF EXISTS public.staff_area_partner_kyc_decision(uuid, text, text);
DROP FUNCTION IF EXISTS public.staff_assign_area_partner(uuid, uuid);
DROP FUNCTION IF EXISTS public.staff_soft_delete_area_partner(uuid, text);
DROP FUNCTION IF EXISTS public.staff_set_partner_zones(uuid, uuid[]);

ALTER TABLE public.experts DROP CONSTRAINT IF EXISTS experts_onboarded_by_fkey;
ALTER TABLE public.merchants DROP CONSTRAINT IF EXISTS merchants_onboarded_by_fkey;
ALTER TABLE public.zones DROP CONSTRAINT IF EXISTS zones_assigned_area_partner_fk;
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_assigned_area_partner_id_fkey;
ALTER TABLE public.zones DROP COLUMN IF EXISTS assigned_area_partner_id;
ALTER TABLE public.bookings DROP COLUMN IF EXISTS assigned_area_partner_id;

DROP TABLE IF EXISTS public.area_partners;
DROP TABLE IF EXISTS public.area_partner_leads;

DROP POLICY IF EXISTS "Staff can read area partner files" ON storage.objects;
DROP POLICY IF EXISTS "Staff can write area partner files" ON storage.objects;
DROP POLICY IF EXISTS "Staff can update area partner files" ON storage.objects;
DROP POLICY IF EXISTS "Staff can delete area partner files" ON storage.objects;

INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
SELECT (SELECT auth_user_id FROM public.staff_users WHERE role='super_admin' AND status='active' AND auth_user_id IS NOT NULL ORDER BY created_at LIMIT 1),
       'Old Area Partner module removed', 'area_partners', NULL, NULL,
       jsonb_build_object('partner_earnings_reset_bookings', 115, 'partner_earnings_reset_total', 1580, 'by', 'system migration');