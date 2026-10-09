CREATE TABLE public.merchant_store_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  user_id uuid,
  session_id text,
  visited_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.merchant_store_visits TO authenticated;
GRANT ALL ON public.merchant_store_visits TO service_role;
ALTER TABLE public.merchant_store_visits ENABLE ROW LEVEL SECURITY;
CREATE INDEX msv_merchant_time ON public.merchant_store_visits(merchant_id, visited_at DESC);
CREATE INDEX msv_merchant_user ON public.merchant_store_visits(merchant_id, user_id);

CREATE POLICY "Staff read store visits" ON public.merchant_store_visits FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.staff_users s WHERE s.auth_user_id = auth.uid() AND s.status='active'));
CREATE POLICY "Merchant reads own store visits" ON public.merchant_store_visits FOR SELECT TO authenticated
USING (merchant_id = public.current_merchant_id());

CREATE OR REPLACE FUNCTION public.record_merchant_store_visit(_merchant_id uuid, _session_id text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL AND coalesce(_session_id,'') = '' THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM merchants WHERE id=_merchant_id) THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM merchant_store_visits v WHERE v.merchant_id=_merchant_id
     AND v.visited_at > now() - interval '15 minutes'
     AND ((_uid IS NOT NULL AND v.user_id=_uid) OR (_uid IS NULL AND v.session_id=_session_id))) THEN
    RETURN false;
  END IF;
  INSERT INTO merchant_store_visits(merchant_id,user_id,session_id) VALUES (_merchant_id,_uid,left(_session_id,100));
  RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION public.record_merchant_store_visit(uuid,text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_merchant_store_analytics(_merchant_id uuid, _days int DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE _from timestamptz; _today date := (now() AT TIME ZONE 'Asia/Kolkata')::date; r jsonb;
BEGIN
  IF NOT (EXISTS (SELECT 1 FROM staff_users s WHERE s.auth_user_id=auth.uid() AND s.status='active')
          OR _merchant_id = current_merchant_id()) THEN
    RAISE EXCEPTION 'insufficient_role';
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
END $$;
GRANT EXECUTE ON FUNCTION public.get_merchant_store_analytics(uuid,int) TO authenticated;