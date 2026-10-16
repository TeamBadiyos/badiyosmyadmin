
CREATE TABLE public.cities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  state text NOT NULL DEFAULT 'Maharashtra',
  state_code text,
  status text NOT NULL DEFAULT 'coming_soon' CHECK (status IN ('active','coming_soon','inactive')),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cities_name_uq ON public.cities (lower(name));
CREATE UNIQUE INDEX cities_one_default ON public.cities (is_default) WHERE is_default;
GRANT SELECT ON public.cities TO anon, authenticated;
GRANT ALL ON public.cities TO service_role;
ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read cities" ON public.cities FOR SELECT USING (true);

INSERT INTO public.cities (name, state, state_code, status, is_default) VALUES ('Latur','Maharashtra','27','active',true);

CREATE OR REPLACE FUNCTION public.default_city_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.cities WHERE is_default LIMIT 1 $$;

CREATE OR REPLACE FUNCTION public.city_id_by_name(_name text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.cities WHERE lower(name) = lower(trim(_name)) LIMIT 1 $$;

-- Staff city access
CREATE TABLE public.staff_city_access (
  staff_user_id uuid NOT NULL REFERENCES public.staff_users(id) ON DELETE CASCADE,
  city_id uuid NOT NULL REFERENCES public.cities(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (staff_user_id, city_id)
);
GRANT SELECT ON public.staff_city_access TO authenticated;
GRANT ALL ON public.staff_city_access TO service_role;
ALTER TABLE public.staff_city_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read own access, super admin all" ON public.staff_city_access FOR SELECT TO authenticated
USING (public.is_active_staff(auth.uid(), ARRAY['super_admin'])
   OR staff_user_id IN (SELECT id FROM public.staff_users WHERE auth_user_id = auth.uid()));

-- Cities the caller may see. super_admin/ops_manager/finance: all cities unless rows exist restricting them.
CREATE OR REPLACE FUNCTION public.staff_allowed_city_ids() RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _s record; _ids uuid[];
BEGIN
  SELECT id, role, status, zone_id INTO _s FROM staff_users WHERE auth_user_id = auth.uid();
  IF _s.id IS NULL OR _s.status <> 'active' THEN RETURN ARRAY[]::uuid[]; END IF;
  SELECT array_agg(city_id) INTO _ids FROM staff_city_access WHERE staff_user_id = _s.id;
  IF _ids IS NOT NULL THEN RETURN _ids; END IF;
  IF _s.role IN ('super_admin','ops_manager','finance') THEN
    RETURN (SELECT array_agg(id) FROM cities);
  END IF;
  -- other roles: cities of their zones
  RETURN (SELECT array_agg(DISTINCT z.city_id) FROM zones z
          WHERE z.id = _s.zone_id OR z.id IN (SELECT zone_id FROM staff_user_zones WHERE staff_user_id = _s.id));
END $$;

CREATE OR REPLACE FUNCTION public.staff_can_city(_city uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _city IS NULL OR _city = ANY (coalesce(public.staff_allowed_city_ids(), ARRAY[]::uuid[])) $$;

CREATE OR REPLACE FUNCTION public.staff_my_cities() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _role text; _restricted boolean;
BEGIN
  SELECT s.role, EXISTS(SELECT 1 FROM staff_city_access a WHERE a.staff_user_id = s.id)
    INTO _role, _restricted FROM staff_users s WHERE s.auth_user_id = auth.uid() AND s.status='active';
  IF _role IS NULL THEN RAISE EXCEPTION 'Forbidden'; END IF;
  RETURN jsonb_build_object(
    'can_all', _role IN ('super_admin','finance') AND NOT _restricted,
    'cities', coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'state',c.state,'status',c.status,'is_default',c.is_default) ORDER BY c.is_default DESC, c.name)
       FROM cities c WHERE c.id = ANY(public.staff_allowed_city_ids())), '[]'::jsonb));
END $$;
GRANT EXECUTE ON FUNCTION public.staff_my_cities() TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_set_city_access(_staff_user_id uuid, _city_ids uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _before jsonb;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin']) THEN RAISE EXCEPTION 'Only super admin can change city access'; END IF;
  IF _staff_user_id IN (SELECT id FROM staff_users WHERE auth_user_id = auth.uid()) THEN RAISE EXCEPTION 'You cannot change your own city access'; END IF;
  SELECT coalesce(jsonb_agg(city_id),'[]') INTO _before FROM staff_city_access WHERE staff_user_id = _staff_user_id;
  DELETE FROM staff_city_access WHERE staff_user_id = _staff_user_id;
  INSERT INTO staff_city_access (staff_user_id, city_id, created_by)
    SELECT _staff_user_id, unnest(coalesce(_city_ids, ARRAY[]::uuid[])), auth.uid();
  INSERT INTO audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), 'set_city_access', 'staff_city_access', _staff_user_id, jsonb_build_object('cities',_before), jsonb_build_object('cities',to_jsonb(_city_ids)));
END $$;
GRANT EXECUTE ON FUNCTION public.staff_set_city_access(uuid, uuid[]) TO authenticated;

-- Add city_id columns
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bookings','courier_orders','merchant_orders','business_orders','merchants','experts','expert_applications','zones','partners','partner_payments','agreements','customer_invoices','sponsored_slots','coupons','marketing_campaigns','service_flags','dispatch_config','courier_vehicle_rates']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS city_id uuid REFERENCES public.cities(id)', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (city_id)', t || '_city_id_idx', t);
  END LOOP;
END $$;
ALTER TABLE public.app_banners DROP CONSTRAINT IF EXISTS app_banners_city_id_fkey;
ALTER TABLE public.app_banners ADD CONSTRAINT app_banners_city_id_fkey FOREIGN KEY (city_id) REFERENCES public.cities(id);

-- Backfill (coupons, banners, campaigns stay NULL = all cities)
DO $$
DECLARE t text; _l uuid := public.default_city_id();
BEGIN
  FOREACH t IN ARRAY ARRAY['bookings','courier_orders','merchant_orders','business_orders','merchants','experts','expert_applications','zones','partners','partner_payments','agreements','customer_invoices','sponsored_slots','service_flags','dispatch_config','courier_vehicle_rates']
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', t);
    EXECUTE format('UPDATE public.%I SET city_id = $1 WHERE city_id IS NULL', t) USING _l;
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', t);
  END LOOP;
END $$;

-- Auto-fill city on new rows
CREATE OR REPLACE FUNCTION public.fill_city_id() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _j jsonb := to_jsonb(NEW); _c uuid;
BEGIN
  IF NEW.city_id IS NOT NULL THEN RETURN NEW; END IF;
  IF _j ? 'zone_id' AND (_j->>'zone_id') IS NOT NULL THEN
    SELECT city_id INTO _c FROM zones WHERE id = (_j->>'zone_id')::uuid;
  END IF;
  IF _c IS NULL AND _j ? 'merchant_id' AND (_j->>'merchant_id') IS NOT NULL THEN
    SELECT city_id INTO _c FROM merchants WHERE id = (_j->>'merchant_id')::uuid;
  END IF;
  IF _c IS NULL AND _j ? 'store_id' AND (_j->>'store_id') IS NOT NULL THEN
    SELECT city_id INTO _c FROM merchants WHERE id = (_j->>'store_id')::uuid;
  END IF;
  IF _c IS NULL AND _j ? 'partner_id' AND (_j->>'partner_id') IS NOT NULL THEN
    SELECT city_id INTO _c FROM partners WHERE id = (_j->>'partner_id')::uuid;
  END IF;
  IF _c IS NULL AND _j ? 'city' AND (_j->>'city') IS NOT NULL THEN
    _c := public.city_id_by_name(_j->>'city');
  END IF;
  IF _c IS NULL AND TG_TABLE_NAME = 'customer_invoices' THEN
    SELECT coalesce((SELECT city_id FROM bookings WHERE id = NEW.ref_id),
                    (SELECT city_id FROM courier_orders WHERE id = NEW.ref_id),
                    (SELECT city_id FROM merchant_orders WHERE id = NEW.ref_id)) INTO _c;
  END IF;
  NEW.city_id := coalesce(_c, public.default_city_id());
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bookings','courier_orders','merchant_orders','business_orders','merchants','experts','expert_applications','zones','partners','partner_payments','agreements','customer_invoices','sponsored_slots','service_flags','dispatch_config','courier_vehicle_rates']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS aa_fill_city_id ON public.%I', t);
    EXECUTE format('CREATE TRIGGER aa_fill_city_id BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fill_city_id()', t);
  END LOOP;
END $$;

-- City-wise Clean prices
CREATE TABLE public.city_price_options (
  city_id uuid NOT NULL REFERENCES public.cities(id) ON DELETE CASCADE,
  price_option_id uuid NOT NULL REFERENCES public.service_price_options(id) ON DELETE CASCADE,
  customer_price numeric NOT NULL,
  strikethrough_price numeric,
  expert_payout numeric NOT NULL DEFAULT 0,
  partner_commission numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (city_id, price_option_id)
);
GRANT SELECT ON public.city_price_options TO anon, authenticated;
GRANT ALL ON public.city_price_options TO service_role;
ALTER TABLE public.city_price_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read city prices" ON public.city_price_options FOR SELECT USING (true);
INSERT INTO public.city_price_options (city_id, price_option_id, customer_price, strikethrough_price, expert_payout, partner_commission, is_active)
SELECT public.default_city_id(), id, customer_price, strikethrough_price, coalesce(expert_payout,0), coalesce(partner_commission,0), is_active
FROM public.service_price_options;

-- City-wise delivery settings (Store / Food / Parcel)
CREATE TABLE public.city_service_settings (
  city_id uuid NOT NULL REFERENCES public.cities(id) ON DELETE CASCADE,
  service_key text NOT NULL,
  delivery_min_fare numeric,
  delivery_per_km numeric,
  default_accept_timeout_minutes integer,
  timings jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (city_id, service_key)
);
GRANT SELECT ON public.city_service_settings TO anon, authenticated;
GRANT ALL ON public.city_service_settings TO service_role;
ALTER TABLE public.city_service_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read city service settings" ON public.city_service_settings FOR SELECT USING (true);
INSERT INTO public.city_service_settings (city_id, service_key, delivery_min_fare, delivery_per_km, default_accept_timeout_minutes, timings)
SELECT public.default_city_id(), service_key, delivery_min_fare, delivery_per_km, default_accept_timeout_minutes, timings FROM public.service_settings;

-- Customer app: price options for a city (hidden when the city has no price — never falls back)
CREATE OR REPLACE FUNCTION public.app_city_price_options(_city_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('price_option_id',o.id,'service_id',o.service_id,'label',o.label,
     'duration_minutes',o.duration_minutes,'customer_price',c.customer_price,'strikethrough_price',c.strikethrough_price) ORDER BY o.display_order),'[]'::jsonb)
  FROM service_price_options o JOIN city_price_options c ON c.price_option_id = o.id AND c.city_id = _city_id
  WHERE o.is_active AND c.is_active AND c.customer_price IS NOT NULL $$;
GRANT EXECUTE ON FUNCTION public.app_city_price_options(uuid) TO anon, authenticated;

-- Customer app: which city a location is in (nearest zone's city, else default)
CREATE OR REPLACE FUNCTION public.app_city_for_location(_lat double precision, _lng double precision) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _c uuid;
BEGIN
  BEGIN
    EXECUTE 'SELECT z.city_id FROM zones z WHERE z.deleted_at IS NULL AND z.status=''active'' AND z.boundary IS NOT NULL
             AND ST_Contains(z.boundary::geometry, ST_SetSRID(ST_MakePoint($2,$1),4326)) LIMIT 1' INTO _c USING _lat, _lng;
  EXCEPTION WHEN others THEN _c := NULL;
  END;
  RETURN coalesce(_c, public.default_city_id());
END $$;
GRANT EXECUTE ON FUNCTION public.app_city_for_location(double precision, double precision) TO anon, authenticated;

-- Place of supply + IGST
ALTER TABLE public.customer_invoices ADD COLUMN IF NOT EXISTS place_of_supply text, ADD COLUMN IF NOT EXISTS pos_state_code text;
CREATE OR REPLACE FUNCTION public.customer_invoices_place_of_supply() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _st text; _code text; _co text;
BEGIN
  SELECT state, state_code INTO _st, _code FROM cities WHERE id = NEW.city_id;
  _co := nullif(trim(coalesce(NEW.company->>'state','')),'');
  IF _co IS NULL THEN _co := 'Maharashtra'; END IF;
  NEW.place_of_supply := coalesce(_st, _co);
  NEW.pos_state_code := _code;
  IF lower(NEW.place_of_supply) <> lower(_co) THEN
    NEW.igst := coalesce(NEW.igst,0) + coalesce(NEW.cgst,0) + coalesce(NEW.sgst,0);
    NEW.cgst := 0; NEW.sgst := 0;
  ELSIF coalesce(NEW.igst,0) > 0 AND coalesce(NEW.cgst,0) = 0 AND coalesce(NEW.sgst,0) = 0 THEN
    NEW.cgst := round(NEW.igst/2, 2); NEW.sgst := NEW.igst - round(NEW.igst/2, 2); NEW.igst := 0;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ab_place_of_supply ON public.customer_invoices;
CREATE TRIGGER ab_place_of_supply BEFORE INSERT OR UPDATE OF city_id, company ON public.customer_invoices
FOR EACH ROW EXECUTE FUNCTION public.customer_invoices_place_of_supply();
ALTER TABLE public.customer_invoices DISABLE TRIGGER USER;
UPDATE public.customer_invoices i SET place_of_supply = c.state, pos_state_code = c.state_code FROM public.cities c WHERE c.id = i.city_id;
ALTER TABLE public.customer_invoices ENABLE TRIGGER USER;

-- Staff: list cities with counts
CREATE OR REPLACE FUNCTION public.staff_list_cities() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'state',c.state,'state_code',c.state_code,'status',c.status,'is_default',c.is_default,
    'zones',(SELECT count(*) FROM zones z WHERE z.city_id=c.id AND z.deleted_at IS NULL),
    'live_services',(SELECT count(*) FROM service_flags f WHERE f.city_id=c.id AND f.status='live'),
    'merchants',(SELECT count(*) FROM merchants m WHERE m.city_id=c.id),
    'experts',(SELECT count(*) FROM experts e WHERE e.city_id=c.id),
    'bookings',(SELECT count(*) FROM bookings b WHERE b.city_id=c.id),
    'orders',(SELECT count(*) FROM merchant_orders o WHERE o.city_id=c.id)+(SELECT count(*) FROM courier_orders o WHERE o.city_id=c.id)
  ) ORDER BY c.is_default DESC, c.name) FROM cities c), '[]'::jsonb);
END $$;
GRANT EXECUTE ON FUNCTION public.staff_list_cities() TO authenticated;

-- Wizard source values
CREATE OR REPLACE FUNCTION public.staff_city_template(_from uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  RETURN jsonb_build_object(
    'prices', coalesce((SELECT jsonb_agg(jsonb_build_object('price_option_id',o.id,'service',s.name,'label',o.label,
        'customer_price',cp.customer_price,'expert_payout',cp.expert_payout,'partner_commission',cp.partner_commission) ORDER BY s.name, o.display_order)
      FROM city_price_options cp JOIN service_price_options o ON o.id=cp.price_option_id JOIN services s ON s.id=o.service_id
      WHERE cp.city_id=_from AND o.is_active), '[]'::jsonb),
    'delivery', coalesce((SELECT jsonb_agg(jsonb_build_object('service_key',service_key,'delivery_min_fare',delivery_min_fare,'delivery_per_km',delivery_per_km) ORDER BY service_key)
      FROM city_service_settings WHERE city_id=_from), '[]'::jsonb),
    'vehicle_rates', coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'vehicle',v.name,'segment',r.customer_segment,'base_fare',r.base_fare,'per_km',r.per_km,'min_fare',r.min_fare))
      FROM courier_vehicle_rates r LEFT JOIN courier_vehicle_types v ON v.id=r.vehicle_type_id WHERE r.city_id=_from), '[]'::jsonb));
END $$;
GRANT EXECUTE ON FUNCTION public.staff_city_template(uuid) TO authenticated;

-- Create city (wizard)
CREATE OR REPLACE FUNCTION public.staff_create_city(_name text, _state text, _state_code text, _copy_from uuid, _prices jsonb, _delivery jsonb, _vehicle_rates jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _src text; p jsonb;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin']) THEN RAISE EXCEPTION 'Only super admin can add cities'; END IF;
  IF nullif(trim(_name),'') IS NULL OR nullif(trim(_state),'') IS NULL THEN RAISE EXCEPTION 'Name and state are required'; END IF;
  INSERT INTO cities (name, state, state_code, status) VALUES (trim(_name), trim(_state), nullif(trim(_state_code),''), 'coming_soon') RETURNING id INTO _id;
  SELECT name INTO _src FROM cities WHERE id=_copy_from;

  -- Services: all Coming Soon
  INSERT INTO service_flags (service_key, city, city_id, is_active, label, sort_order, status, hours_enabled, last_order_buffer_minutes)
  SELECT service_key, trim(_name), _id, is_active, label, sort_order, 'coming_soon', hours_enabled, last_order_buffer_minutes
  FROM service_flags WHERE city_id = coalesce(_copy_from, public.default_city_id());
  INSERT INTO service_hours (service_flag_id, weekday, open_time, close_time, is_closed)
  SELECT nf.id, h.weekday, h.open_time, h.close_time, h.is_closed
  FROM service_flags nf JOIN service_flags of ON of.service_key=nf.service_key AND of.city_id=coalesce(_copy_from, public.default_city_id())
  JOIN service_hours h ON h.service_flag_id=of.id WHERE nf.city_id=_id;

  -- Dispatch / alert limits
  INSERT INTO dispatch_config (city, city_id, broadcast_radius_km, broadcast_timeout_seconds, radius_expand_step_km, radius_expand_max_km, radius_expand_after_seconds,
    no_expert_timeout_minutes, no_accept_alert_threshold_seconds, aisensy_template_name, ops_alert_whatsapp_numbers, almost_available_window_minutes, no_accept_minutes)
  SELECT trim(_name), _id, broadcast_radius_km, broadcast_timeout_seconds, radius_expand_step_km, radius_expand_max_km, radius_expand_after_seconds,
    no_expert_timeout_minutes, no_accept_alert_threshold_seconds, aisensy_template_name, ops_alert_whatsapp_numbers, almost_available_window_minutes, no_accept_minutes
  FROM dispatch_config WHERE city_id = coalesce(_copy_from, public.default_city_id()) LIMIT 1;

  -- Prices (only the ones provided with a price)
  FOR p IN SELECT * FROM jsonb_array_elements(coalesce(_prices,'[]')) LOOP
    IF (p->>'customer_price') IS NOT NULL AND (p->>'customer_price') <> '' THEN
      INSERT INTO city_price_options (city_id, price_option_id, customer_price, expert_payout, partner_commission)
      VALUES (_id, (p->>'price_option_id')::uuid, (p->>'customer_price')::numeric, coalesce(nullif(p->>'expert_payout','')::numeric,0), coalesce(nullif(p->>'partner_commission','')::numeric,0));
    END IF;
  END LOOP;
  FOR p IN SELECT * FROM jsonb_array_elements(coalesce(_delivery,'[]')) LOOP
    INSERT INTO city_service_settings (city_id, service_key, delivery_min_fare, delivery_per_km, default_accept_timeout_minutes, timings)
    SELECT _id, p->>'service_key', nullif(p->>'delivery_min_fare','')::numeric, nullif(p->>'delivery_per_km','')::numeric, s.default_accept_timeout_minutes, s.timings
    FROM (SELECT 1) x LEFT JOIN city_service_settings s ON s.city_id=coalesce(_copy_from, public.default_city_id()) AND s.service_key=p->>'service_key';
  END LOOP;
  FOR p IN SELECT * FROM jsonb_array_elements(coalesce(_vehicle_rates,'[]')) LOOP
    INSERT INTO courier_vehicle_rates (city, city_id, vehicle_type_id, base_fare, included_km, per_km, min_fare, platform_fee, commission_pct, is_placeholder,
      extra_pickup_fee, extra_drop_fee, max_pickups, max_drops, return_per_km, customer_segment)
    SELECT trim(_name), _id, r.vehicle_type_id, coalesce(nullif(p->>'base_fare','')::numeric, r.base_fare), r.included_km, coalesce(nullif(p->>'per_km','')::numeric, r.per_km),
      coalesce(nullif(p->>'min_fare','')::numeric, r.min_fare), r.platform_fee, r.commission_pct, r.is_placeholder, r.extra_pickup_fee, r.extra_drop_fee, r.max_pickups, r.max_drops, r.return_per_km, r.customer_segment
    FROM courier_vehicle_rates r WHERE r.id = (p->>'id')::uuid;
  END LOOP;

  INSERT INTO audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), 'create_city', 'cities', _id, NULL, jsonb_build_object('name',_name,'state',_state,'copy_from',_src,'prices',_prices,'delivery',_delivery,'vehicle_rates',_vehicle_rates));
  RETURN _id;
END $$;
GRANT EXECUTE ON FUNCTION public.staff_create_city(text,text,text,uuid,jsonb,jsonb,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_set_city_status(_id uuid, _status text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _old text;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT status INTO _old FROM cities WHERE id=_id;
  UPDATE cities SET status=_status, updated_at=now() WHERE id=_id;
  INSERT INTO audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), 'set_city_status', 'cities', _id, jsonb_build_object('status',_old), jsonb_build_object('status',_status));
END $$;
GRANT EXECUTE ON FUNCTION public.staff_set_city_status(uuid, text) TO authenticated;

-- Delete city: only when nothing operational exists in it
CREATE OR REPLACE FUNCTION public.staff_delete_city(_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _c record;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT * INTO _c FROM cities WHERE id=_id;
  IF _c.id IS NULL THEN RAISE EXCEPTION 'City not found'; END IF;
  IF _c.is_default THEN RAISE EXCEPTION 'The default city cannot be deleted'; END IF;
  IF EXISTS(SELECT 1 FROM bookings WHERE city_id=_id) OR EXISTS(SELECT 1 FROM courier_orders WHERE city_id=_id)
     OR EXISTS(SELECT 1 FROM merchant_orders WHERE city_id=_id) OR EXISTS(SELECT 1 FROM business_orders WHERE city_id=_id)
     OR EXISTS(SELECT 1 FROM merchants WHERE city_id=_id) OR EXISTS(SELECT 1 FROM experts WHERE city_id=_id)
     OR EXISTS(SELECT 1 FROM partners WHERE city_id=_id) OR EXISTS(SELECT 1 FROM customer_invoices WHERE city_id=_id)
     OR EXISTS(SELECT 1 FROM expert_applications WHERE city_id=_id) OR EXISTS(SELECT 1 FROM agreements WHERE city_id=_id) THEN
    RAISE EXCEPTION 'This city already has orders, stores, experts or partners — set it Inactive instead';
  END IF;
  DELETE FROM service_hours WHERE service_flag_id IN (SELECT id FROM service_flags WHERE city_id=_id);
  DELETE FROM service_flags WHERE city_id=_id;
  DELETE FROM dispatch_config WHERE city_id=_id;
  DELETE FROM courier_vehicle_rates WHERE city_id=_id;
  DELETE FROM sponsored_slots WHERE city_id=_id;
  UPDATE coupons SET city_id=NULL WHERE city_id=_id;
  UPDATE app_banners SET city_id=NULL WHERE city_id=_id;
  UPDATE marketing_campaigns SET city_id=NULL WHERE city_id=_id;
  DELETE FROM zones WHERE city_id=_id;
  DELETE FROM cities WHERE id=_id;
  INSERT INTO audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), 'delete_city', 'cities', _id, to_jsonb(_c), NULL);
END $$;
GRANT EXECUTE ON FUNCTION public.staff_delete_city(uuid) TO authenticated;
