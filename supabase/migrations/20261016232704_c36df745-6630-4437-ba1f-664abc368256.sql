CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

ALTER TABLE public.city_service_settings ADD COLUMN IF NOT EXISTS launch_progress_pct smallint;
CREATE OR REPLACE FUNCTION public.css_launch_progress_check() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.launch_progress_pct IS NOT NULL AND (NEW.launch_progress_pct < 0 OR NEW.launch_progress_pct > 100) THEN
    RAISE EXCEPTION 'Launch progress must be 0–100';
  END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS css_launch_progress_check ON public.city_service_settings;
CREATE TRIGGER css_launch_progress_check BEFORE INSERT OR UPDATE ON public.city_service_settings FOR EACH ROW EXECUTE FUNCTION public.css_launch_progress_check();

CREATE OR REPLACE FUNCTION public.staff_set_city_service(_city_id uuid, _service_key text, _patch jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _before jsonb;
BEGIN
  IF NOT public.staff_can_city(_city_id) OR NOT EXISTS (SELECT 1 FROM staff_users WHERE auth_user_id = auth.uid() AND status = 'active' AND role IN ('super_admin','ops_manager')) THEN
    RAISE EXCEPTION 'Not allowed for this city';
  END IF;
  SELECT to_jsonb(s) INTO _before FROM city_service_settings s WHERE city_id=_city_id AND service_key=_service_key;
  INSERT INTO city_service_settings (city_id, service_key) VALUES (_city_id, _service_key) ON CONFLICT DO NOTHING;
  UPDATE city_service_settings SET
    delivery_min_fare = coalesce((_patch->>'delivery_min_fare')::numeric, delivery_min_fare),
    delivery_per_km = coalesce((_patch->>'delivery_per_km')::numeric, delivery_per_km),
    delivery_base_fare = coalesce((_patch->>'delivery_base_fare')::numeric, delivery_base_fare),
    delivery_included_km = coalesce((_patch->>'delivery_included_km')::numeric, delivery_included_km),
    delivery_platform_fee = coalesce((_patch->>'delivery_platform_fee')::numeric, delivery_platform_fee),
    rider_share_pct = coalesce((_patch->>'rider_share_pct')::numeric, rider_share_pct),
    default_accept_timeout_minutes = coalesce((_patch->>'default_accept_timeout_minutes')::int, default_accept_timeout_minutes),
    launch_progress_pct = CASE WHEN _patch ? 'launch_progress_pct' THEN (nullif(_patch->>'launch_progress_pct',''))::smallint ELSE launch_progress_pct END,
    updated_at = now()
  WHERE city_id=_city_id AND service_key=_service_key;
  INSERT INTO audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), 'city_service_update', 'city_service_settings', _city_id, _before, _patch || jsonb_build_object('service_key', _service_key));
END $function$;

CREATE OR REPLACE FUNCTION public.app_launch_progress(_service_key text, _city_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object('percent', coalesce(
    (SELECT launch_progress_pct FROM city_service_settings WHERE city_id=_city_id AND service_key=_service_key),
    (SELECT s.launch_progress_pct FROM city_service_settings s JOIN cities c ON c.id=s.city_id WHERE c.is_default AND s.service_key=_service_key LIMIT 1)));
$$;
GRANT EXECUTE ON FUNCTION public.app_launch_progress(text, uuid) TO anon, authenticated;

-- Wanted names
CREATE OR REPLACE FUNCTION public.demand_name_key(_n text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT coalesce(string_agg(w, ' ' ORDER BY w), '') FROM (
    SELECT DISTINCT w FROM regexp_split_to_table(regexp_replace(lower(trim(coalesce(_n,''))), '[^a-z0-9\u0900-\u097f ]+', ' ', 'g'), '\s+') w
    WHERE w <> '' AND w NOT IN ('hotel','restaurant','shop','store','the','and')) t;
$$;

CREATE TABLE public.waitlist_wanted_names (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.waitlist_requests(id) ON DELETE CASCADE,
  city text NOT NULL,
  service text NOT NULL,
  name text NOT NULL,
  norm_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, service, norm_key)
);
CREATE INDEX ON public.waitlist_wanted_names (lower(city), service);
GRANT SELECT ON public.waitlist_wanted_names TO authenticated;
GRANT ALL ON public.waitlist_wanted_names TO service_role;
ALTER TABLE public.waitlist_wanted_names ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read wanted names" ON public.waitlist_wanted_names FOR SELECT TO authenticated
  USING (is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));
CREATE POLICY cc_reader_all ON public.waitlist_wanted_names FOR SELECT TO cc_reader USING (true);
GRANT SELECT ON public.waitlist_wanted_names TO cc_reader;

CREATE OR REPLACE FUNCTION public.demand_add_names_core(_request_id uuid, _names text[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record; n text; k text; s text; c int := 0;
BEGIN
  SELECT * INTO r FROM waitlist_requests WHERE id=_request_id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF coalesce(array_length(_names,1),0) > 10 THEN RAISE EXCEPTION 'Up to 10 names'; END IF;
  FOREACH n IN ARRAY coalesce(_names, '{}') LOOP
    n := regexp_replace(trim(n), '\s+', ' ', 'g');
    IF n = '' THEN CONTINUE; END IF;
    IF length(n) > 60 THEN RAISE EXCEPTION 'Name too long (max 60)'; END IF;
    k := demand_name_key(n); IF k = '' THEN k := lower(n); END IF;
    FOREACH s IN ARRAY r.services LOOP
      INSERT INTO waitlist_wanted_names (request_id, city, service, name, norm_key)
      VALUES (r.id, trim(r.city), s, n, k) ON CONFLICT DO NOTHING;
      IF FOUND THEN c := c + 1; END IF;
    END LOOP;
  END LOOP;
  RETURN c;
END $$;
REVOKE ALL ON FUNCTION public.demand_add_names_core(uuid, text[]) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.app_demand_add_names(_request_id uuid, _names text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM waitlist_requests WHERE id=_request_id AND user_id=auth.uid()) THEN
    RAISE EXCEPTION 'Not allowed' USING errcode='42501';
  END IF;
  RETURN jsonb_build_object('ok', true, 'added', demand_add_names_core(_request_id, _names));
END $$;
REVOKE ALL ON FUNCTION public.app_demand_add_names(uuid, text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.app_demand_add_names(uuid, text[]) TO authenticated;

DROP FUNCTION IF EXISTS public.submit_demand_request(text[], text, text, numeric, numeric, text, text, text);
CREATE FUNCTION public.submit_demand_request(_services text[], _city text, _area text DEFAULT NULL, _lat numeric DEFAULT NULL, _lng numeric DEFAULT NULL, _phone text DEFAULT NULL, _source text DEFAULT 'outside-city', _address_text text DEFAULT NULL, _wanted_names text[] DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _svc text[]; _ph text; _id uuid; _dup boolean := false;
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
  IF _id IS NOT NULL THEN _dup := true;
  ELSE
    INSERT INTO public.users (id) VALUES (_uid) ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.waitlist_requests (user_id, services, city, area, latitude, longitude, phone, source, address_text)
    VALUES (_uid, _svc, trim(_city), nullif(trim(_area),''), _lat, _lng, _ph, _source, _address_text)
    RETURNING id INTO _id;
  END IF;
  IF _wanted_names IS NOT NULL THEN PERFORM demand_add_names_core(_id, _wanted_names); END IF;
  RETURN jsonb_build_object('ok', true, 'duplicate', _dup, 'id', _id);
END $function$;
GRANT EXECUTE ON FUNCTION public.submit_demand_request(text[], text, text, numeric, numeric, text, text, text, text[]) TO authenticated;

-- grouping: each key joins the most-requested leader it resembles
CREATE OR REPLACE FUNCTION public.demand_name_groups(_city text, _service text)
RETURNS TABLE(leader text, norm_key text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public, extensions AS $$
DECLARE r record; leaders text[] := '{}'; l text; hit text;
BEGIN
  FOR r IN SELECT w.norm_key k, count(DISTINCT w.request_id) n FROM waitlist_wanted_names w
           WHERE (_city IS NULL OR lower(w.city)=lower(trim(_city))) AND (_service IS NULL OR w.service=_service)
           GROUP BY 1 ORDER BY 2 DESC, 1 LOOP
    hit := NULL;
    FOREACH l IN ARRAY leaders LOOP
      IF extensions.similarity(l, r.k) >= 0.6 THEN hit := l; EXIT; END IF;
    END LOOP;
    IF hit IS NULL THEN leaders := leaders || r.k; hit := r.k; END IF;
    leader := hit; norm_key := r.k; RETURN NEXT;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.demand_name_groups(text, text) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.staff_demand_top_names(_city text DEFAULT NULL, _service text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE out jsonb;
BEGIN
  IF NOT is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  WITH cities AS (SELECT DISTINCT lower(city) lc, service FROM waitlist_wanted_names
                  WHERE (_city IS NULL OR lower(city)=lower(trim(_city))) AND (_service IS NULL OR service=_service)),
  g AS (SELECT c.lc, c.service, x.leader, x.norm_key FROM cities c, LATERAL demand_name_groups(c.lc, c.service) x),
  rows AS (
    SELECT g.lc, g.service, g.leader, w.name, w.request_id, w.created_at, wr.phone, w.city
    FROM g JOIN waitlist_wanted_names w ON lower(w.city)=g.lc AND w.service=g.service AND w.norm_key=g.norm_key
    JOIN waitlist_requests wr ON wr.id=w.request_id),
  agg AS (
    SELECT min(city) city, service, leader,
      (SELECT name FROM rows r2 WHERE r2.lc=r.lc AND r2.service=r.service AND r2.leader=r.leader GROUP BY name ORDER BY count(*) DESC, name LIMIT 1) name,
      count(DISTINCT request_id) customers, max(created_at) latest_at,
      array_agg(DISTINCT phone) FILTER (WHERE phone IS NOT NULL) phones,
      array_agg(DISTINCT name) spellings
    FROM rows r GROUP BY lc, service, leader)
  SELECT coalesce(jsonb_agg(jsonb_build_object('city',city,'service',service,'name',name,'customers',customers,
    'latest_at',latest_at,'phones',to_jsonb(coalesce(phones,'{}')),'spellings',to_jsonb(spellings)) ORDER BY customers DESC, latest_at DESC), '[]')
  INTO out FROM agg;
  RETURN out;
END $$;
GRANT EXECUTE ON FUNCTION public.staff_demand_top_names(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.app_demand_name_suggestions(_city text, _service text, _q text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE out jsonb;
BEGIN
  WITH g AS (SELECT * FROM demand_name_groups(_city, _service)),
  rows AS (SELECT g.leader, w.name, w.request_id FROM g JOIN waitlist_wanted_names w
           ON lower(w.city)=lower(trim(_city)) AND w.service=_service AND w.norm_key=g.norm_key),
  agg AS (SELECT leader, (SELECT name FROM rows r2 WHERE r2.leader=r.leader GROUP BY name ORDER BY count(*) DESC, name LIMIT 1) name,
            count(DISTINCT request_id) n FROM rows r GROUP BY leader)
  SELECT coalesce(jsonb_agg(jsonb_build_object('name', name) ORDER BY n DESC, name), '[]') INTO out
  FROM (SELECT * FROM agg WHERE _q IS NULL OR trim(_q)='' OR name ILIKE '%'||trim(_q)||'%' ORDER BY n DESC, name LIMIT 10) t;
  RETURN out;
END $$;
GRANT EXECUTE ON FUNCTION public.app_demand_name_suggestions(text, text, text) TO anon, authenticated;