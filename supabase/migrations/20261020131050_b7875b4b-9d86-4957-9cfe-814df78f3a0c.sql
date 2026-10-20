-- 1
ALTER FUNCTION public.cron_fast_tick() SET search_path = public, pg_temp;

-- 3
REVOKE EXECUTE ON FUNCTION public.booking_travel_payout(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_travel_payout(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_merchant_store_analytics(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_merchant_store_analytics(uuid, integer) TO authenticated, service_role;

-- 4
CREATE OR REPLACE FUNCTION public.get_merchant_store_analytics(_merchant_id uuid, _days integer DEFAULT 30)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _from timestamptz; _today date := (now() AT TIME ZONE 'Asia/Kolkata')::date; r jsonb;
BEGIN
  IF NOT (public.is_active_staff(auth.uid(), NULL::text[])
          OR _merchant_id = public.current_merchant_id()
          OR coalesce(auth.role(), current_setting('request.jwt.claim.role', true)) = 'service_role') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  _days := greatest(1, least(coalesce(_days,30), 365));
  _from := ((_today - (_days-1))::timestamp AT TIME ZONE 'Asia/Kolkata');
  WITH v AS (SELECT * FROM merchant_store_visits WHERE merchant_id=_merchant_id AND visited_at >= _from),
  o AS (SELECT * FROM merchant_orders WHERE merchant_id=_merchant_id AND created_at >= _from)
  SELECT jsonb_build_object(
    'totalVisits', (SELECT count(*) FROM v),
    'uniqueVisitors', (SELECT count(DISTINCT coalesce(user_id::text, session_id)) FROM v),
    'loggedInVisitors', (SELECT count(DISTINCT user_id) FROM v),
    'todayVisits', (SELECT count(*) FROM v WHERE (visited_at AT TIME ZONE 'Asia/Kolkata')::date=_today),
    'yesterdayVisits', (SELECT count(*) FROM v WHERE (visited_at AT TIME ZONE 'Asia/Kolkata')::date=_today-1),
    'orders', (SELECT count(*) FROM o),
    'orderingCustomers', (SELECT count(DISTINCT user_id) FROM o),
    'daily', (SELECT coalesce(jsonb_agg(jsonb_build_object('date',d::date,
        'visits',(SELECT count(*) FROM v WHERE (visited_at AT TIME ZONE 'Asia/Kolkata')::date=d::date),
        'unique',(SELECT count(DISTINCT coalesce(user_id::text,session_id)) FROM v WHERE (visited_at AT TIME ZONE 'Asia/Kolkata')::date=d::date),
        'orders',(SELECT count(*) FROM o WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date=d::date)) ORDER BY d DESC),'[]'::jsonb)
      FROM generate_series(_today-(_days-1), _today, interval '1 day') d),
    'recent', (SELECT coalesce(jsonb_agg(x ORDER BY x->>'at' DESC),'[]'::jsonb) FROM (
        SELECT jsonb_build_object('at',v.visited_at,'name',u.full_name,'phone',u.phone,'guest',v.user_id IS NULL) x
        FROM v LEFT JOIN users u ON u.id=v.user_id ORDER BY v.visited_at DESC LIMIT 50) t)
  ) INTO r;
  RETURN r;
END $function$;

-- 5
CREATE OR REPLACE VIEW public.store_revenue_report WITH (security_invoker = true) AS
 SELECT id AS order_id, order_number, merchant_id, status, delivered_at, items_total, delivery_fee,
    total_amount AS customer_paid, commission_pct,
    commission_amount AS platform_commission_revenue,
    commission_gst_amount AS commission_gst_tax,
    COALESCE(((delivery_quote ->> 'gst_amount'))::numeric, 0) AS delivery_gst_tax,
    COALESCE(((delivery_quote ->> 'platform_fee'))::numeric, 0) AS delivery_platform_fee_revenue,
    (commission_amount + COALESCE(((delivery_quote ->> 'platform_fee'))::numeric, 0)) AS platform_revenue_ex_tax,
    (commission_gst_amount + COALESCE(((delivery_quote ->> 'gst_amount'))::numeric, 0)) AS total_tax_collected,
    merchant_net AS merchant_payable
   FROM public.merchant_orders o
  WHERE public.is_active_staff(auth.uid(), NULL::text[]) OR o.merchant_id = public.current_merchant_id();
REVOKE ALL ON public.store_revenue_report FROM anon;
GRANT SELECT ON public.store_revenue_report TO authenticated;

-- 6 leads: normalise phone first (forms send 10 digits; expert form may include spaces/+91), then limit
CREATE OR REPLACE FUNCTION public.lead_guard()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE _n int;
BEGIN
  NEW.phone := regexp_replace(coalesce(NEW.phone,''), '[\s\-()]', '', 'g');
  IF NEW.phone ~ '^91[6-9][0-9]{9}$' THEN NEW.phone := '+' || NEW.phone; END IF;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE regexp_replace(phone, ''^\+91'', '''') = regexp_replace($1, ''^\+91'', '''') AND created_at > now() - interval ''24 hours''', TG_TABLE_NAME)
    INTO _n USING NEW.phone;
  IF _n >= 3 THEN RAISE EXCEPTION 'Too many submissions from this phone. Please try again tomorrow.'; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER a_lead_guard BEFORE INSERT ON public.city_interest_leads FOR EACH ROW EXECUTE FUNCTION public.lead_guard();
CREATE TRIGGER a_lead_guard BEFORE INSERT ON public.expert_leads FOR EACH ROW EXECUTE FUNCTION public.lead_guard();
CREATE TRIGGER a_lead_guard BEFORE INSERT ON public.business_interest_leads FOR EACH ROW EXECUTE FUNCTION public.lead_guard();

ALTER TABLE public.city_interest_leads
  ADD CONSTRAINT cil_phone_chk CHECK (phone ~ '^(\+91)?[6-9][0-9]{9}$') NOT VALID,
  ADD CONSTRAINT cil_len_chk CHECK (length(coalesce(name,''))<=500 AND length(coalesce(phone,''))<=500 AND length(coalesce(city,''))<=500) NOT VALID;
ALTER TABLE public.expert_leads
  ADD CONSTRAINT el_phone_chk CHECK (phone ~ '^(\+91)?[6-9][0-9]{9}$') NOT VALID,
  ADD CONSTRAINT el_len_chk CHECK (length(coalesce(name,''))<=500 AND length(coalesce(phone,''))<=500 AND length(coalesce(area,''))<=500 AND length(coalesce(email,''))<=500 AND length(coalesce(status,''))<=500) NOT VALID;
ALTER TABLE public.business_interest_leads
  ADD CONSTRAINT bil_phone_chk CHECK (phone ~ '^(\+91)?[6-9][0-9]{9}$') NOT VALID,
  ADD CONSTRAINT bil_len_chk CHECK (length(coalesce(business_name,''))<=500 AND length(coalesce(owner_name,''))<=500 AND length(coalesce(phone,''))<=500 AND length(coalesce(category_interested,''))<=500 AND length(coalesce(city,''))<=500) NOT VALID;

CREATE OR REPLACE FUNCTION public.submit_demand_request(_services text[], _city text, _area text DEFAULT NULL::text, _lat numeric DEFAULT NULL::numeric, _lng numeric DEFAULT NULL::numeric, _phone text DEFAULT NULL::text, _source text DEFAULT 'outside-city'::text, _address_text text DEFAULT NULL::text, _wanted_names text[] DEFAULT NULL::text[])
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _svc text[]; _ph text; _id uuid; _dup boolean := false; _n int;
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
    SELECT count(*) INTO _n FROM public.waitlist_requests
     WHERE created_at > now() - interval '24 hours'
       AND (user_id = _uid OR (_ph IS NOT NULL AND right(regexp_replace(coalesce(phone,''),'\D','','g'),10) = right(regexp_replace(_ph,'\D','','g'),10)));
    IF _n >= 3 THEN RAISE EXCEPTION 'Too many requests from this phone. Please try again tomorrow.'; END IF;
    INSERT INTO public.users (id) VALUES (_uid) ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.waitlist_requests (user_id, services, city, area, latitude, longitude, phone, source, address_text)
    VALUES (_uid, _svc, trim(_city), nullif(trim(_area),''), _lat, _lng, _ph, _source, _address_text)
    RETURNING id INTO _id;
  END IF;
  IF _wanted_names IS NOT NULL THEN PERFORM demand_add_names_core(_id, _wanted_names); END IF;
  RETURN jsonb_build_object('ok', true, 'duplicate', _dup, 'id', _id);
END $function$;

-- 7
DROP POLICY IF EXISTS catalog_images_public_read ON storage.objects;
CREATE POLICY catalog_images_owner_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'catalog-images' AND (
  public.is_active_staff(auth.uid(), NULL::text[])
  OR (public.current_merchant_id() IS NOT NULL AND (
      (storage.foldername(name))[1] = (public.current_merchant_id())::text
      OR ((storage.foldername(name))[1] = '_thumbs' AND (storage.foldername(name))[2] = (public.current_merchant_id())::text)))
));

-- 2 (last, so it also covers lead_guard)
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.prorettype='trigger'::regtype LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END $$;

-- 8
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;