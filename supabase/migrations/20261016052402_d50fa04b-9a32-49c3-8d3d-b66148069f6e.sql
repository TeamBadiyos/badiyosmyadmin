CREATE OR REPLACE FUNCTION public.system_list_expired_unassigned_bookings()
 RETURNS TABLE(id uuid, price numeric, total_amount numeric, razorpay_payment_id text, broadcast_started_at timestamp with time zone, created_at timestamp with time zone, minutes integer)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT b.id, b.price, COALESCE(b.total_amount, b.price), b.razorpay_payment_id, b.broadcast_started_at, b.created_at, m.mins
  FROM public.bookings b
  CROSS JOIN LATERAL (SELECT public.auto_cancel_minutes(public.booking_capacity_group(b.service_category_id, b.service_label), b.city_id) AS mins) m
  WHERE b.status IN ('confirmed','accepted')
    AND b.assigned_expert_id IS NULL AND b.deleted_at IS NULL
    AND COALESCE(b.slot_type,'now') <> 'scheduled' AND b.scheduled_date IS NULL
    AND COALESCE(b.broadcast_started_at, b.created_at) < now() - make_interval(mins => m.mins)
  ORDER BY COALESCE(b.broadcast_started_at, b.created_at) LIMIT 50 $function$;
REVOKE ALL ON FUNCTION public.system_list_expired_unassigned_bookings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.system_list_expired_unassigned_bookings() TO service_role;

INSERT INTO public.city_ops_settings(city_id, key, value)
SELECT c.id, k, '30' FROM public.cities c, unnest(array['clean_scheduled_cancel_after_slot_minutes','wash_scheduled_cancel_after_slot_minutes']) k
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.scheduled_cancel_after_slot_minutes(_service_key text, _city_id uuid)
 RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT greatest(0, public.city_ops_num(COALESCE(_city_id, public.default_city_id()),
    CASE WHEN _service_key IN ('wash','clean_auto') THEN 'wash_scheduled_cancel_after_slot_minutes' ELSE 'clean_scheduled_cancel_after_slot_minutes' END, 30)::int) $$;
GRANT EXECUTE ON FUNCTION public.scheduled_cancel_after_slot_minutes(text, uuid) TO anon, authenticated, service_role;

DO $$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef('public.booking_journey_sweeper()'::regprocedure) INTO d;
  d := replace(d,
    'if _slot is not null and b.broadcast_started_at is not null and now() >= b.broadcast_started_at + make_interval(mins => public.booking_auto_cancel_minutes(b.id)) then',
    'if _slot is not null and now() >= _slot + make_interval(mins => public.scheduled_cancel_after_slot_minutes(public.booking_capacity_group(b.service_category_id, b.service_label), b.city_id)) then');
  IF position('scheduled_cancel_after_slot_minutes' in d) = 0 THEN RAISE EXCEPTION 'sweeper patch failed'; END IF;
  EXECUTE d;
END $$;