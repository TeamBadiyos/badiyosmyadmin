-- 1. City-tagging for remaining finance/support tables
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['merchant_settlements','partner_payout_lines','customer_credit_notes','support_tickets','emergency_alerts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS city_id uuid REFERENCES public.cities(id)', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (city_id)', t || '_city_id_idx', t);
  END LOOP; END $$;

CREATE OR REPLACE FUNCTION public.fill_city_id_extra() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _j jsonb := to_jsonb(NEW); _c uuid;
BEGIN
  IF NEW.city_id IS NOT NULL THEN RETURN NEW; END IF;
  IF _j ? 'store_id' THEN SELECT city_id INTO _c FROM merchants WHERE id = (_j->>'store_id')::uuid; END IF;
  IF _c IS NULL AND _j ? 'partner_id' THEN SELECT city_id INTO _c FROM partners WHERE id = (_j->>'partner_id')::uuid; END IF;
  IF _c IS NULL AND _j ? 'invoice_id' THEN SELECT city_id INTO _c FROM customer_invoices WHERE id = (_j->>'invoice_id')::uuid; END IF;
  IF _c IS NULL AND _j ? 'booking_id' THEN SELECT city_id INTO _c FROM bookings WHERE id = (_j->>'booking_id')::uuid; END IF;
  IF _c IS NULL AND _j ? 'expert_id' THEN SELECT city_id INTO _c FROM experts WHERE id = (_j->>'expert_id')::uuid; END IF;
  NEW.city_id := coalesce(_c, public.default_city_id());
  RETURN NEW;
END $$;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['merchant_settlements','partner_payout_lines','customer_credit_notes','support_tickets','emergency_alerts'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS aa_fill_city_id ON public.%I', t);
    EXECUTE format('CREATE TRIGGER aa_fill_city_id BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fill_city_id_extra()', t);
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', t);
    EXECUTE format('UPDATE public.%I SET city_id = public.default_city_id() WHERE city_id IS NULL', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', t);
  END LOOP; END $$;

-- 2. The city each staff member is currently viewing (NULL = all their cities)
CREATE TABLE public.staff_view_city (
  auth_user_id uuid PRIMARY KEY,
  city_id uuid REFERENCES public.cities(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.staff_view_city TO authenticated;
GRANT ALL ON public.staff_view_city TO service_role;
ALTER TABLE public.staff_view_city ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read own view city" ON public.staff_view_city FOR SELECT TO authenticated USING (auth_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.staff_set_view_city(_city_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _role text; _restricted boolean;
BEGIN
  SELECT s.role, EXISTS(SELECT 1 FROM staff_city_access a WHERE a.staff_user_id = s.id) INTO _role, _restricted
    FROM staff_users s WHERE s.auth_user_id = auth.uid() AND s.status = 'active';
  IF _role IS NULL THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _city_id IS NULL AND NOT (_role IN ('super_admin','finance') AND NOT _restricted) THEN
    RAISE EXCEPTION 'Pick one of your cities';
  END IF;
  IF _city_id IS NOT NULL AND NOT (_city_id = ANY(coalesce(public.staff_allowed_city_ids(), ARRAY[]::uuid[]))) THEN
    RAISE EXCEPTION 'You do not have access to this city';
  END IF;
  INSERT INTO staff_view_city (auth_user_id, city_id, updated_at) VALUES (auth.uid(), _city_id, now())
  ON CONFLICT (auth_user_id) DO UPDATE SET city_id = EXCLUDED.city_id, updated_at = now();
END $$;
REVOKE ALL ON FUNCTION public.staff_set_view_city(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_set_view_city(uuid) TO authenticated;

-- NULL = no city filter (not staff: customers, experts, merchants, system jobs).
-- Staff: their allowed cities, narrowed to the city picked in the top bar.
CREATE OR REPLACE FUNCTION public.cc_visible_cities() RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _allowed uuid[]; _sel uuid;
BEGIN
  IF _uid IS NULL OR NOT EXISTS (SELECT 1 FROM staff_users WHERE auth_user_id = _uid) THEN RETURN NULL; END IF;
  _allowed := coalesce(public.staff_allowed_city_ids(), ARRAY[]::uuid[]);
  SELECT city_id INTO _sel FROM staff_view_city WHERE auth_user_id = _uid;
  IF _sel IS NOT NULL AND _sel = ANY(_allowed) THEN RETURN ARRAY[_sel]; END IF;
  RETURN _allowed;
END $$;
REVOKE ALL ON FUNCTION public.cc_visible_cities() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cc_visible_cities() TO authenticated, service_role;

-- 3. Restrictive city policy on every city-tagged operational table
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['bookings','courier_orders','merchant_orders','business_orders','merchants','experts','expert_applications','zones','partners','partner_payments','agreements','customer_invoices','customer_credit_notes','sponsored_slots','coupons','marketing_campaigns','app_banners','merchant_settlements','partner_payout_lines','support_tickets','emergency_alerts'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS cc_city_scope ON public.%I', t);
    EXECUTE format($p$CREATE POLICY cc_city_scope ON public.%I AS RESTRICTIVE FOR ALL
      USING (city_id IS NULL OR (SELECT public.cc_visible_cities()) IS NULL OR city_id = ANY(((SELECT public.cc_visible_cities()))::uuid[]))
      WITH CHECK (city_id IS NULL OR (SELECT public.cc_visible_cities()) IS NULL OR city_id = ANY(((SELECT public.cc_visible_cities()))::uuid[]))$p$, t);
  END LOOP; END $$;

-- 4. Staff report functions run under a role that obeys these policies, so
--    Dashboard / Finance / Tax numbers follow the picked city too.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cc_reader') THEN
    CREATE ROLE cc_reader NOLOGIN NOBYPASSRLS;
  END IF; END $$;
GRANT cc_reader TO postgres;
GRANT USAGE ON SCHEMA public TO cc_reader;
GRANT CREATE ON SCHEMA public TO cc_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO cc_reader;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO cc_reader;
GRANT USAGE ON SCHEMA auth TO cc_reader;
GRANT EXECUTE ON FUNCTION auth.uid() TO cc_reader;
GRANT EXECUTE ON FUNCTION auth.jwt() TO cc_reader;
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND c.relrowsecurity LOOP
    EXECUTE format('DROP POLICY IF EXISTS cc_reader_all ON public.%I', t);
    EXECUTE format('CREATE POLICY cc_reader_all ON public.%I FOR SELECT TO cc_reader USING (true)', t);
  END LOOP; END $$;

DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.prosecdef AND p.provolatile = 's' AND p.proname IN (
             'fin_ca_export','fin_overview','fin_pnl_extras','staff_dashboard_money','staff_dashboard_overview','staff_dashboard_team',
             'staff_dispatch_failure_stats','staff_list_customer_invoices','staff_list_expert_applications','staff_list_refunds_all',
             'staff_list_unassigned_business_trips','staff_list_unsigned_agreements','staff_tax_report','staff_tax_report_ext','staff_tds_report') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO cc_reader', f.sig);
  END LOOP; END $$;