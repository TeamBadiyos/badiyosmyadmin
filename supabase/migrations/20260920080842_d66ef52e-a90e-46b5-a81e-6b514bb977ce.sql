
-- =========================================================
-- PHASE 1: config flags, commission rules, booking snapshots,
-- TDS columns, encrypted PAN. All new behaviour flag-gated OFF.
-- =========================================================

-- ---------- 1. Settings ----------
INSERT INTO public.ops_settings(key, value, label) VALUES
  ('use_new_commission_engine','0','Use new commission rules engine'),
  ('payout_batch_wallet_mode','0','Payout batch settles wallet balance'),
  ('tds_master_enabled','0','TDS master switch'),
  ('tds_expert_enabled','0','Deduct TDS for experts'),
  ('tds_partner_enabled','0','Deduct TDS for area partners'),
  ('tds_tip_enabled','0','Deduct TDS on tips'),
  ('tds_manual_adj_enabled','0','Deduct TDS on manual adjustments'),
  ('reward_punctuality_gate_enabled','0','Require on-time arrival for incentives'),
  ('tds_default_rate','2.0','Default TDS rate (%)'),
  ('tds_no_pan_rate','20.0','TDS rate when PAN is missing (%)'),
  ('tds_annual_threshold','0','Annual TDS exemption threshold'),
  ('tds_effective_from','2026-10-01','TDS effective from date'),
  ('tds_rounding_rule','round_nearest_rupee','TDS rounding rule'),
  ('tds_rate_service','2.0','TDS rate: service earnings (%)'),
  ('tds_rate_incentive','2.0','TDS rate: incentives (%)'),
  ('tds_rate_referral','2.0','TDS rate: referral rewards (%)'),
  ('tds_rate_courier','1.0','TDS rate: courier earnings (%)'),
  ('tds_rate_tip','0.0','TDS rate: tips (%)'),
  ('tds_rate_manual_adj','2.0','TDS rate: manual adjustments (%)'),
  ('commission_min_hq_share','0','Minimum HQ share per order')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_ops_flag(_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((SELECT value = '1' FROM public.ops_settings WHERE key = _key), false);
$$;

CREATE OR REPLACE FUNCTION public.get_ops_num(_key text, _default numeric)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(NULLIF(regexp_replace(
           COALESCE((SELECT value FROM public.ops_settings WHERE key = _key), ''),
           '[^0-9.\-]', '', 'g'), '')::numeric, _default);
$$;

REVOKE EXECUTE ON FUNCTION public.get_ops_flag(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_ops_num(text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ops_flag(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_ops_num(text, numeric) TO authenticated, service_role;

-- ---------- 2. Commission rules ----------
CREATE TABLE IF NOT EXISTS public.commission_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'price_option',            -- 'default' | 'price_option'
  price_option_id uuid REFERENCES public.service_price_options(id) ON DELETE CASCADE,
  expert_type text NOT NULL DEFAULT 'per_hour',          -- per_hour | fixed | percent
  expert_value numeric NOT NULL DEFAULT 0,
  partner_type text NOT NULL DEFAULT 'fixed',
  partner_value numeric NOT NULL DEFAULT 0,
  min_hq_share numeric NOT NULL DEFAULT 0,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS commission_rules_price_option_uniq
  ON public.commission_rules(price_option_id) WHERE price_option_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS commission_rules_default_uniq
  ON public.commission_rules((scope)) WHERE scope = 'default';

GRANT SELECT ON public.commission_rules TO authenticated;
GRANT ALL ON public.commission_rules TO service_role;
ALTER TABLE public.commission_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read commission rules" ON public.commission_rules;
CREATE POLICY "Staff can read commission rules" ON public.commission_rules
  FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

CREATE OR REPLACE FUNCTION public.commission_rules_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS commission_rules_touch ON public.commission_rules;
CREATE TRIGGER commission_rules_touch BEFORE UPDATE ON public.commission_rules
  FOR EACH ROW EXECUTE FUNCTION public.commission_rules_touch();

-- default rule: Rs 80/hr expert, Rs 10 fixed partner
INSERT INTO public.commission_rules(scope, price_option_id, expert_type, expert_value, partner_type, partner_value, notes)
SELECT 'default', NULL, 'per_hour', 80, 'fixed', 10, 'Default rule'
WHERE NOT EXISTS (SELECT 1 FROM public.commission_rules WHERE scope='default');

-- seed exact legacy values per existing price option
INSERT INTO public.commission_rules(scope, price_option_id, expert_type, expert_value, partner_type, partner_value, notes)
SELECT 'price_option', spo.id, 'fixed', COALESCE(spo.expert_payout,0), 'fixed', COALESCE(spo.partner_commission,0),
       'Seeded from legacy catalogue values'
  FROM public.service_price_options spo
 WHERE NOT EXISTS (SELECT 1 FROM public.commission_rules cr WHERE cr.price_option_id = spo.id);

-- ---------- 3. Split resolution ----------
CREATE OR REPLACE FUNCTION public.resolve_commission_split(
  _price_option_id uuid, _price numeric, _duration_minutes integer)
RETURNS TABLE(expert_amount numeric, partner_amount numeric, hq_amount numeric,
              hourly_rate numeric, rule_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _r record; _hours numeric; _e numeric; _p numeric;
BEGIN
  _hours := GREATEST(COALESCE(_duration_minutes,60)::numeric / 60.0, 0);
  IF _hours = 0 THEN _hours := 1; END IF;

  SELECT * INTO _r FROM public.commission_rules
   WHERE is_active AND price_option_id = _price_option_id LIMIT 1;
  IF _r.id IS NULL THEN
    SELECT * INTO _r FROM public.commission_rules WHERE is_active AND scope='default' LIMIT 1;
  END IF;
  IF _r.id IS NULL THEN
    RETURN QUERY SELECT 0::numeric, 0::numeric, COALESCE(_price,0), 0::numeric, NULL::uuid; RETURN;
  END IF;

  _e := CASE _r.expert_type
          WHEN 'per_hour' THEN _r.expert_value * _hours
          WHEN 'percent'  THEN COALESCE(_price,0) * _r.expert_value / 100.0
          ELSE _r.expert_value END;
  _p := CASE _r.partner_type
          WHEN 'per_hour' THEN _r.partner_value * _hours
          WHEN 'percent'  THEN COALESCE(_price,0) * _r.partner_value / 100.0
          ELSE _r.partner_value END;

  _e := round(COALESCE(_e,0));
  _p := round(COALESCE(_p,0));
  RETURN QUERY SELECT _e, _p, round(COALESCE(_price,0)) - _e - _p,
                      CASE WHEN _hours > 0 THEN round(_e / _hours, 2) ELSE _e END, _r.id;
END $$;

REVOKE EXECUTE ON FUNCTION public.resolve_commission_split(uuid, numeric, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_commission_split(uuid, numeric, integer) TO authenticated, service_role;

-- ---------- 4. Booking snapshot columns ----------
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS assigned_area_partner_id uuid REFERENCES public.area_partners(id),
  ADD COLUMN IF NOT EXISTS snapshot_expert_payout numeric,
  ADD COLUMN IF NOT EXISTS snapshot_partner_payout numeric,
  ADD COLUMN IF NOT EXISTS snapshot_hq_share numeric,
  ADD COLUMN IF NOT EXISTS snapshot_hourly_rate numeric,
  ADD COLUMN IF NOT EXISTS commission_rule_id uuid REFERENCES public.commission_rules(id),
  ADD COLUMN IF NOT EXISTS expert_payout_batch_id uuid REFERENCES public.payout_batches(id),
  ADD COLUMN IF NOT EXISTS partner_payout_batch_id uuid REFERENCES public.payout_batches(id);

CREATE INDEX IF NOT EXISTS bookings_expert_batch_idx ON public.bookings(expert_payout_batch_id);
CREATE INDEX IF NOT EXISTS bookings_partner_batch_idx ON public.bookings(partner_payout_batch_id);

-- snapshot writer: always on (legacy values while the engine flag is off)
CREATE OR REPLACE FUNCTION public.bookings_snapshot_commission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _spo record; _split record; _ep numeric; _ap numeric; _hours numeric;
BEGIN
  IF NEW.assigned_area_partner_id IS NULL AND NEW.zone_id IS NOT NULL THEN
    SELECT z.assigned_area_partner_id INTO NEW.assigned_area_partner_id
      FROM public.zones z WHERE z.id = NEW.zone_id;
  END IF;

  SELECT spo.id, spo.expert_payout, spo.partner_commission
    INTO _spo
    FROM public.service_price_options spo
    JOIN public.services s ON s.id = spo.service_id
   WHERE lower(spo.label) = lower(COALESCE(NEW.service_label,''))
     AND (NEW.service_category_id IS NULL OR s.category_id = NEW.service_category_id)
     AND spo.is_active
   ORDER BY (s.category_id = NEW.service_category_id) DESC, spo.display_order
   LIMIT 1;

  IF _spo.id IS NULL AND NEW.service_duration_minutes IS NOT NULL THEN
    SELECT spo.id, spo.expert_payout, spo.partner_commission INTO _spo
      FROM public.service_price_options spo
     WHERE spo.duration_minutes = NEW.service_duration_minutes AND spo.is_active
     ORDER BY spo.display_order LIMIT 1;
  END IF;

  IF public.get_ops_flag('use_new_commission_engine') THEN
    SELECT * INTO _split FROM public.resolve_commission_split(
      _spo.id, COALESCE(NEW.price,0), NEW.service_duration_minutes);
    NEW.snapshot_expert_payout  := _split.expert_amount;
    NEW.snapshot_partner_payout := _split.partner_amount;
    NEW.snapshot_hq_share       := _split.hq_amount;
    NEW.snapshot_hourly_rate    := _split.hourly_rate;
    NEW.commission_rule_id      := _split.rule_id;
  ELSE
    _ep := COALESCE(_spo.expert_payout, 0);
    _ap := COALESCE(_spo.partner_commission, 0);
    IF _spo.id IS NULL THEN
      SELECT COALESCE(sc.expert_payout,0), COALESCE(sc.area_partner_payout,0) INTO _ep, _ap
        FROM public.service_catalogue_config sc
       WHERE sc.duration_minutes = NEW.service_duration_minutes AND sc.is_active
       ORDER BY sc.created_at DESC LIMIT 1;
    END IF;
    _hours := GREATEST(COALESCE(NEW.service_duration_minutes,60)::numeric / 60.0, 1.0/60.0);
    NEW.snapshot_expert_payout  := COALESCE(_ep,0);
    NEW.snapshot_partner_payout := COALESCE(_ap,0);
    NEW.snapshot_hq_share       := round(COALESCE(NEW.price,0)) - COALESCE(_ep,0) - COALESCE(_ap,0);
    NEW.snapshot_hourly_rate    := round(COALESCE(_ep,0) / _hours, 2);
    NEW.commission_rule_id      := NULL;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS zz_bookings_snapshot_commission ON public.bookings;
CREATE TRIGGER zz_bookings_snapshot_commission
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_snapshot_commission();

-- backfill partner attribution for historical bookings (snapshots left untouched)
UPDATE public.bookings b
   SET assigned_area_partner_id = z.assigned_area_partner_id
  FROM public.zones z
 WHERE b.zone_id = z.id
   AND b.assigned_area_partner_id IS NULL
   AND z.assigned_area_partner_id IS NOT NULL;

-- ---------- 5. TDS columns on payout items ----------
ALTER TABLE public.payout_batch_items
  ADD COLUMN IF NOT EXISTS gross_amount numeric,
  ADD COLUMN IF NOT EXISTS tds_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tds_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount numeric,
  ADD COLUMN IF NOT EXISTS tds_status text NOT NULL DEFAULT 'none',  -- none|accrued|deposited|cancelled
  ADD COLUMN IF NOT EXISTS tds_deposited_at timestamptz,
  ADD COLUMN IF NOT EXISTS pan_last4 text;

UPDATE public.payout_batch_items
   SET gross_amount = COALESCE(gross_amount, amount),
       net_amount   = COALESCE(net_amount, amount)
 WHERE gross_amount IS NULL OR net_amount IS NULL;

-- ---------- 6. Encrypted PAN ----------
ALTER TABLE public.experts
  ADD COLUMN IF NOT EXISTS pan_encrypted bytea,
  ADD COLUMN IF NOT EXISTS pan_last4 text,
  ADD COLUMN IF NOT EXISTS pan_updated_at timestamptz;
ALTER TABLE public.area_partners
  ADD COLUMN IF NOT EXISTS pan_encrypted bytea,
  ADD COLUMN IF NOT EXISTS pan_last4 text,
  ADD COLUMN IF NOT EXISTS pan_updated_at timestamptz;

-- vault-backed key
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'badiyos_pan_key') THEN
    PERFORM vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'badiyos_pan_key', 'PAN encryption key');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.pan_key()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public, vault, extensions' AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'badiyos_pan_key' LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.pan_key() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.staff_set_pan(
  _owner_type text, _owner_id uuid, _pan text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public, extensions' AS $$
DECLARE _uid uuid := auth.uid(); _clean text; _last4 text; _before jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_super_admin_user() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _owner_type NOT IN ('expert','area_partner') THEN RAISE EXCEPTION 'Invalid owner type'; END IF;

  _clean := upper(regexp_replace(COALESCE(_pan,''), '\s', '', 'g'));
  IF _clean <> '' AND _clean !~ '^[A-Z]{5}[0-9]{4}[A-Z]{1}$' THEN
    RAISE EXCEPTION 'Invalid PAN format';
  END IF;
  _last4 := NULLIF(right(_clean, 4), '');

  IF _owner_type = 'expert' THEN
    SELECT jsonb_build_object('pan_last4', pan_last4) INTO _before FROM public.experts WHERE id = _owner_id;
    UPDATE public.experts
       SET pan_encrypted = CASE WHEN _clean = '' THEN NULL
                                ELSE pgp_sym_encrypt(_clean, public.pan_key()) END,
           pan_last4 = _last4, pan_updated_at = now()
     WHERE id = _owner_id;
  ELSE
    SELECT jsonb_build_object('pan_last4', pan_last4) INTO _before FROM public.area_partners WHERE id = _owner_id;
    UPDATE public.area_partners
       SET pan_encrypted = CASE WHEN _clean = '' THEN NULL
                                ELSE pgp_sym_encrypt(_clean, public.pan_key()) END,
           pan_last4 = _last4, pan_updated_at = now()
     WHERE id = _owner_id;
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES(_uid, 'set_pan', _owner_type, _owner_id, _before,
         jsonb_build_object('pan_last4', _last4));
END $$;

REVOKE EXECUTE ON FUNCTION public.staff_set_pan(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_set_pan(text, uuid, text) TO authenticated, service_role;

-- ---------- 7. Staff commission-rule RPCs ----------
CREATE OR REPLACE FUNCTION public.staff_upsert_commission_rule(
  _id uuid, _scope text, _price_option_id uuid,
  _expert_type text, _expert_value numeric,
  _partner_type text, _partner_value numeric,
  _min_hq_share numeric, _is_active boolean, _notes text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _before jsonb; _rid uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_super_admin_user() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _expert_type NOT IN ('per_hour','fixed','percent') OR _partner_type NOT IN ('per_hour','fixed','percent') THEN
    RAISE EXCEPTION 'Invalid commission type';
  END IF;
  IF COALESCE(_expert_value,0) < 0 OR COALESCE(_partner_value,0) < 0 THEN
    RAISE EXCEPTION 'Commission values must be non-negative';
  END IF;

  IF _id IS NOT NULL THEN
    SELECT to_jsonb(c) INTO _before FROM public.commission_rules c WHERE c.id = _id;
    UPDATE public.commission_rules SET
      expert_type=_expert_type, expert_value=_expert_value,
      partner_type=_partner_type, partner_value=_partner_value,
      min_hq_share=COALESCE(_min_hq_share,0), is_active=COALESCE(_is_active,true), notes=_notes
     WHERE id=_id RETURNING id INTO _rid;
  ELSE
    INSERT INTO public.commission_rules(scope, price_option_id, expert_type, expert_value,
      partner_type, partner_value, min_hq_share, is_active, notes)
    VALUES(COALESCE(_scope,'price_option'), _price_option_id, _expert_type, _expert_value,
      _partner_type, _partner_value, COALESCE(_min_hq_share,0), COALESCE(_is_active,true), _notes)
    ON CONFLICT (price_option_id) WHERE price_option_id IS NOT NULL
    DO UPDATE SET expert_type=EXCLUDED.expert_type, expert_value=EXCLUDED.expert_value,
                  partner_type=EXCLUDED.partner_type, partner_value=EXCLUDED.partner_value,
                  min_hq_share=EXCLUDED.min_hq_share, is_active=EXCLUDED.is_active, notes=EXCLUDED.notes
    RETURNING id INTO _rid;
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  SELECT _uid, 'upsert_commission_rule', 'commission_rules', _rid, _before, to_jsonb(c)
    FROM public.commission_rules c WHERE c.id = _rid;
  RETURN _rid;
END $$;

CREATE OR REPLACE FUNCTION public.staff_set_commission_rule_active(_id uuid, _is_active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _before jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_super_admin_user() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT to_jsonb(c) INTO _before FROM public.commission_rules c WHERE c.id=_id;
  UPDATE public.commission_rules SET is_active=_is_active WHERE id=_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  SELECT _uid,'set_commission_rule_active','commission_rules',_id,_before,to_jsonb(c)
    FROM public.commission_rules c WHERE c.id=_id;
END $$;

CREATE OR REPLACE FUNCTION public.verify_commission_parity()
RETURNS TABLE(price_option_id uuid, label text, customer_price numeric,
              legacy_expert numeric, legacy_partner numeric,
              new_expert numeric, new_partner numeric, matches boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN QUERY
  SELECT spo.id, spo.label, spo.customer_price,
         COALESCE(spo.expert_payout,0), COALESCE(spo.partner_commission,0),
         s.expert_amount, s.partner_amount,
         (COALESCE(spo.expert_payout,0) = s.expert_amount
          AND COALESCE(spo.partner_commission,0) = s.partner_amount)
    FROM public.service_price_options spo
    CROSS JOIN LATERAL public.resolve_commission_split(spo.id, spo.customer_price, spo.duration_minutes) s
   WHERE spo.is_active
   ORDER BY spo.display_order;
END $$;

REVOKE EXECUTE ON FUNCTION public.staff_upsert_commission_rule(uuid,text,uuid,text,numeric,text,numeric,numeric,boolean,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.staff_set_commission_rule_active(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.verify_commission_parity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_upsert_commission_rule(uuid,text,uuid,text,numeric,text,numeric,numeric,boolean,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_set_commission_rule_active(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_commission_parity() TO authenticated, service_role;
