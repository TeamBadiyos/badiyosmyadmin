CREATE TABLE public.city_ops_settings (
  city_id uuid NOT NULL REFERENCES public.cities(id) ON DELETE CASCADE,
  key text NOT NULL,
  value text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (city_id, key)
);
GRANT SELECT ON public.city_ops_settings TO anon, authenticated;
GRANT ALL ON public.city_ops_settings TO service_role;
ALTER TABLE public.city_ops_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read city ops settings" ON public.city_ops_settings FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION public.city_ops_keys() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['slot_capacity_enabled','slot_capacity_mode','default_slot_capacity','wash_default_slot_capacity',
    'clean_band_morning_end','clean_band_day_end','wash_band_morning_end','wash_band_day_end',
    'slot_first_start_hour','slot_last_start_hour','slot_step_minutes',
    'instant_booking_enabled','wash_instant_booking_enabled','store_accept_timeout_minutes'] $$;

INSERT INTO public.city_ops_settings (city_id, key, value)
SELECT public.default_city_id(), o.key, o.value FROM public.ops_settings o WHERE o.key = ANY(public.city_ops_keys())
ON CONFLICT DO NOTHING;

-- Latur (default city) mirrors to the legacy shared rows, which existing booking/capacity logic still reads.
CREATE OR REPLACE FUNCTION public.city_ops_mirror_default() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.city_id = public.default_city_id() THEN
    UPDATE ops_settings SET value = NEW.value, updated_at = now() WHERE key = NEW.key;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER city_ops_mirror AFTER INSERT OR UPDATE ON public.city_ops_settings FOR EACH ROW EXECUTE FUNCTION public.city_ops_mirror_default();

CREATE OR REPLACE FUNCTION public.city_svc_mirror_default() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.city_id = public.default_city_id() THEN
    UPDATE service_settings SET delivery_min_fare = NEW.delivery_min_fare, delivery_per_km = NEW.delivery_per_km,
      default_accept_timeout_minutes = NEW.default_accept_timeout_minutes, updated_at = now()
    WHERE service_key = NEW.service_key;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER city_svc_mirror AFTER INSERT OR UPDATE ON public.city_service_settings FOR EACH ROW EXECUTE FUNCTION public.city_svc_mirror_default();

-- Read / write helpers for staff
CREATE OR REPLACE FUNCTION public.staff_get_city_ops(_city_id uuid, _keys text[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb) FROM city_ops_settings
  WHERE city_id = _city_id AND key = ANY(_keys) AND public.staff_can_city(_city_id) $$;
GRANT EXECUTE ON FUNCTION public.staff_get_city_ops(uuid, text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_set_city_ops(_city_id uuid, _values jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE k text; v text; _before jsonb;
BEGIN
  IF NOT public.staff_can_city(_city_id) OR NOT EXISTS (SELECT 1 FROM staff_users WHERE auth_user_id = auth.uid() AND is_active AND role IN ('super_admin','ops_manager')) THEN
    RAISE EXCEPTION 'Not allowed for this city';
  END IF;
  SELECT jsonb_object_agg(key, value) INTO _before FROM city_ops_settings WHERE city_id=_city_id AND key IN (SELECT jsonb_object_keys(_values));
  FOR k, v IN SELECT * FROM jsonb_each_text(_values) LOOP
    IF NOT k = ANY(public.city_ops_keys()) THEN RAISE EXCEPTION 'Unknown setting %', k; END IF;
    INSERT INTO city_ops_settings (city_id, key, value, updated_at, updated_by) VALUES (_city_id, k, v, now(), auth.uid())
    ON CONFLICT (city_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = auth.uid();
  END LOOP;
  INSERT INTO audit_logs (actor_id, action, table_name, record_id, old_data, new_data)
  VALUES (auth.uid(), 'city_ops_update', 'city_ops_settings', _city_id, _before, _values);
END $$;
GRANT EXECUTE ON FUNCTION public.staff_set_city_ops(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_set_city_service(_city_id uuid, _service_key text, _patch jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _before jsonb;
BEGIN
  IF NOT public.staff_can_city(_city_id) OR NOT EXISTS (SELECT 1 FROM staff_users WHERE auth_user_id = auth.uid() AND is_active AND role IN ('super_admin','ops_manager')) THEN
    RAISE EXCEPTION 'Not allowed for this city';
  END IF;
  SELECT to_jsonb(s) INTO _before FROM city_service_settings s WHERE city_id=_city_id AND service_key=_service_key;
  INSERT INTO city_service_settings (city_id, service_key) VALUES (_city_id, _service_key) ON CONFLICT DO NOTHING;
  UPDATE city_service_settings SET
    delivery_min_fare = coalesce((_patch->>'delivery_min_fare')::numeric, delivery_min_fare),
    delivery_per_km = coalesce((_patch->>'delivery_per_km')::numeric, delivery_per_km),
    default_accept_timeout_minutes = coalesce((_patch->>'default_accept_timeout_minutes')::int, default_accept_timeout_minutes),
    updated_at = now()
  WHERE city_id=_city_id AND service_key=_service_key;
  INSERT INTO audit_logs (actor_id, action, table_name, record_id, old_data, new_data)
  VALUES (auth.uid(), 'city_service_update', 'city_service_settings', _city_id, _before, _patch || jsonb_build_object('service_key', _service_key));
END $$;
GRANT EXECUTE ON FUNCTION public.staff_set_city_service(uuid, text, jsonb) TO authenticated;

-- New cities copy ops values from the source city
CREATE OR REPLACE FUNCTION public.cities_copy_ops() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO city_ops_settings (city_id, key, value)
  SELECT NEW.id, key, value FROM city_ops_settings WHERE city_id = public.default_city_id()
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER cities_copy_ops AFTER INSERT ON public.cities FOR EACH ROW EXECUTE FUNCTION public.cities_copy_ops();

-- Fees: one city or all cities (NULL)
ALTER TABLE public.fee_rules ADD COLUMN IF NOT EXISTS city_id uuid REFERENCES public.cities(id) ON DELETE CASCADE;