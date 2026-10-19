CREATE OR REPLACE FUNCTION public.slot_busy_by_half(_service_key text, _date date, _city uuid)
 RETURNS TABLE(start_min integer, busy integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT greatest(coalesce((SELECT nullif(trim(both '"' from value::text),'') FROM public.ops_settings WHERE key='booking_buffer_minutes' LIMIT 1),'30')::numeric::int,0) AS buf
  ), raw AS (
    SELECT coalesce(public.slot_start_ist(scheduled_date, scheduled_time_slot), created_at) AS sched,
           greatest(coalesce(service_duration_minutes,60),1) AS dur,
           status, started_at, service_end_at
      FROM public.bookings
     WHERE status <> 'cancelled'
       AND city_id = COALESCE(_city, public.default_city_id())
       AND (scheduled_date = _date OR (scheduled_date IS NULL AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = _date))
       AND public.booking_capacity_group(service_category_id, service_label) = CASE WHEN _service_key='wash' THEN 'wash' ELSE 'clean' END
  ), b AS (
    SELECT sched AS s,
      CASE
        WHEN started_at IS NOT NULL AND status = 'completed' THEN
          coalesce(service_end_at, started_at + make_interval(mins => dur))
        WHEN started_at IS NOT NULL THEN
          greatest(coalesce(service_end_at, started_at + make_interval(mins => dur)), now())
        WHEN status IN ('expert_assigned','on_the_way','arrived','need_expert','pending','confirmed') AND now() > sched THEN
          now() + make_interval(mins => dur)
        ELSE sched + make_interval(mins => dur)
      END + make_interval(mins => (SELECT buf FROM cfg)) AS e
    FROM raw
  )
  SELECT m, count(*)::int FROM b, generate_series(0, 1410, 30) m
   WHERE (s AT TIME ZONE 'Asia/Kolkata')::date = _date
     AND (_date + make_interval(mins => m)) < (e AT TIME ZONE 'Asia/Kolkata')
     AND (_date + make_interval(mins => m + 30)) > (s AT TIME ZONE 'Asia/Kolkata')
   GROUP BY m $function$;