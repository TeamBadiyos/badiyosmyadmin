CREATE OR REPLACE FUNCTION public.system_list_expired_unassigned_bookings()
 RETURNS TABLE(id uuid, price numeric, total_amount numeric, razorpay_payment_id text, broadcast_started_at timestamp with time zone, created_at timestamp with time zone, minutes integer)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT b.id, b.price, COALESCE(b.total_amount, b.price), b.razorpay_payment_id, b.broadcast_started_at, b.created_at, m.mins
  FROM public.bookings b
  CROSS JOIN LATERAL (SELECT public.auto_cancel_minutes(public.booking_capacity_group(b.service_category_id, b.service_label), b.city_id) AS mins) m
  WHERE b.status IN ('confirmed','accepted')
    AND b.assigned_expert_id IS NULL AND b.deleted_at IS NULL
    AND b.broadcast_started_at IS NOT NULL
    AND b.broadcast_started_at < now() - make_interval(mins => m.mins)
  ORDER BY b.broadcast_started_at LIMIT 50 $function$;
REVOKE ALL ON FUNCTION public.system_list_expired_unassigned_bookings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.system_list_expired_unassigned_bookings() TO service_role;

DO $$ DECLARE d text; BEGIN
  SELECT pg_get_functiondef('public.booking_journey_sweeper()'::regprocedure) INTO d;
  d := replace(d,
    'if _slot is not null and now() >= _slot + make_interval(mins => public.scheduled_cancel_after_slot_minutes(public.booking_capacity_group(b.service_category_id, b.service_label), b.city_id)) then',
    'if b.broadcast_started_at is not null and now() >= b.broadcast_started_at + make_interval(mins => public.auto_cancel_minutes(public.booking_capacity_group(b.service_category_id, b.service_label), b.city_id)) then');
  IF position('scheduled_cancel_after_slot_minutes' in d) > 0 THEN RAISE EXCEPTION 'sweeper patch failed'; END IF;
  EXECUTE d;
END $$;

DROP FUNCTION IF EXISTS public.scheduled_cancel_after_slot_minutes(text, uuid);
DELETE FROM public.city_ops_settings WHERE key IN ('clean_scheduled_cancel_after_slot_minutes','wash_scheduled_cancel_after_slot_minutes');

DO $$ DECLARE d text; BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p WHERE p.proname='service_instant_allowed' AND p.pronargs=3;
  d := replace(d,
    'and coalesce((public.live_expert_counts(_service_key, _cid)->>''free'')::int, 0) < 1 then',
    'and public.instant_slot_full(_service_key, _duration_minutes, _cid) then');
  IF position('instant_slot_full' in d) = 0 THEN RAISE EXCEPTION 'instant patch failed'; END IF;
  CREATE OR REPLACE FUNCTION public.instant_slot_full(_service_key text, _duration_minutes integer, _cid uuid)
   RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $f$
  DECLARE _g text := CASE WHEN _service_key IN ('wash','clean_auto') THEN 'wash' ELSE 'clean' END;
    _l timestamp := now() AT TIME ZONE 'Asia/Kolkata'; _date date := _l::date;
    _m int := ((extract(hour from _l)::int*60 + extract(minute from _l)::int)/30)*30;
    _n int := greatest(ceil(coalesce(_duration_minutes,60)/30.0)::int,1);
  BEGIN
    IF EXISTS (SELECT 1 FROM public.service_slot_overrides o WHERE o.service_key=_g AND o.city_id=_cid
               AND o.slot_date=_date AND o.status='fully_booked' AND o.start_hour*60+o.start_minute=_m) THEN RETURN true; END IF;
    IF public.city_ops_text(_cid,'slot_capacity_enabled','0') <> '1' THEN RETURN false; END IF;
    RETURN EXISTS (SELECT 1 FROM generate_series(_m, least(_m+(_n-1)*30,1410), 30) g
      LEFT JOIN public.slot_busy_by_half(_g,_date,_cid) b ON b.start_min=g
      WHERE coalesce(b.busy,0) >= public.slot_band_capacity(_g,_date,g,_cid));
  END $f$;
  EXECUTE d;
END $$;
GRANT EXECUTE ON FUNCTION public.instant_slot_full(text, integer, uuid) TO anon, authenticated, service_role;