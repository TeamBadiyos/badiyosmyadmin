ALTER TABLE public.waitlist_requests
  ADD COLUMN IF NOT EXISTS services text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS area text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'outside-city';
ALTER TABLE public.waitlist_requests ALTER COLUMN latitude DROP NOT NULL, ALTER COLUMN longitude DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_waitlist_city_lower ON public.waitlist_requests (lower(trim(city)), status);

-- Backfill services from the old "[wants: ...]" text / segment
UPDATE public.waitlist_requests w SET services = ARRAY(
  SELECT DISTINCT trim(x) FROM unnest(string_to_array(substring(w.address_text from '\[wants: ([^\]]*)\]'), ',')) x WHERE trim(x) <> '')
WHERE w.services = '{}' AND w.address_text ~ '\[wants:';
UPDATE public.waitlist_requests w SET services = ARRAY[CASE s.slug WHEN 'clean' THEN 'maid' WHEN 'courier' THEN 'parcel' WHEN 'store' THEN 'grocery' ELSE s.slug END]
FROM public.segments s WHERE w.services = '{}' AND s.id = w.segment_id;

CREATE OR REPLACE FUNCTION public.submit_demand_request(
  _services text[], _city text, _area text DEFAULT NULL, _lat numeric DEFAULT NULL, _lng numeric DEFAULT NULL,
  _phone text DEFAULT NULL, _source text DEFAULT 'outside-city', _address_text text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _svc text[]; _ph text; _id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING errcode='42501'; END IF;
  SELECT array_agg(DISTINCT lower(trim(x))) INTO _svc FROM unnest(_services) x
   WHERE lower(trim(x)) IN ('maid','grocery','food','parcel','clean_auto');
  IF _svc IS NULL THEN RAISE EXCEPTION 'Pick at least one service'; END IF;
  IF coalesce(trim(_city),'') = '' THEN RAISE EXCEPTION 'City required'; END IF;
  IF _source NOT IN ('outside-city','coming-soon') THEN _source := 'outside-city'; END IF;
  SELECT coalesce(nullif(trim(_phone),''), u.phone) INTO _ph FROM public.users u WHERE u.id = _uid;
  _ph := coalesce(_ph, nullif(trim(_phone),''));
  SELECT id INTO _id FROM public.waitlist_requests
   WHERE user_id = _uid AND lower(trim(city)) = lower(trim(_city)) AND status = 'pending' AND services @> _svc AND source = _source
   LIMIT 1;
  IF _id IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'duplicate', true, 'id', _id); END IF;
  INSERT INTO public.users (id) VALUES (_uid) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.waitlist_requests (user_id, services, city, area, latitude, longitude, phone, source, address_text)
  VALUES (_uid, _svc, trim(_city), nullif(trim(_area),''), _lat, _lng, _ph, _source, _address_text)
  RETURNING id INTO _id;
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'id', _id);
END $$;
REVOKE ALL ON FUNCTION public.submit_demand_request(text[], text, text, numeric, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_demand_request(text[], text, text, numeric, numeric, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.demand_waiting_count(_city text)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(DISTINCT coalesce(user_id::text, id::text))::int FROM public.waitlist_requests
   WHERE lower(trim(city)) = lower(trim(_city)) AND status = 'pending' AND notified_at IS NULL;
$$;
GRANT EXECUTE ON FUNCTION public.demand_waiting_count(text) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.customer_notify_me(text);
CREATE FUNCTION public.customer_notify_me(_service_key text, _city text DEFAULT NULL, _area text DEFAULT NULL,
  _lat numeric DEFAULT NULL, _lng numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _existing uuid; _svc text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING errcode = '42501'; END IF;
  SELECT id INTO _existing FROM public.service_notify_requests WHERE user_id = auth.uid() AND service_key = _service_key;
  IF _existing IS NULL THEN
    INSERT INTO public.service_notify_requests (user_id, service_key) VALUES (auth.uid(), _service_key)
    ON CONFLICT (user_id, service_key) DO NOTHING;
  END IF;
  _svc := CASE lower(_service_key) WHEN 'clean' THEN 'maid' WHEN 'store' THEN 'grocery' WHEN 'courier' THEN 'parcel'
          WHEN 'wash' THEN 'clean_auto' ELSE lower(_service_key) END;
  IF _svc IN ('maid','grocery','food','parcel','clean_auto') THEN
    PERFORM public.submit_demand_request(ARRAY[_svc],
      coalesce(nullif(trim(_city),''), (SELECT c.name FROM public.cities c WHERE c.id = public.app_city_for_location(_lat::float8, _lng::float8)), 'Unknown city'),
      _area, _lat, _lng, NULL, 'coming-soon', NULL);
  END IF;
  RETURN jsonb_build_object('ok', true, 'already', _existing IS NOT NULL, 'duplicate', _existing IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.customer_notify_me(text, text, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_notify_me(text, text, text, numeric, numeric) TO authenticated;

ALTER TABLE public.service_settings ADD COLUMN IF NOT EXISTS hide_low_item_sections boolean NOT NULL DEFAULT false;