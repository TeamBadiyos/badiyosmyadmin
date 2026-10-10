CREATE OR REPLACE FUNCTION public.slot_busy_by_hour(_service_key text, _date date)
 RETURNS TABLE(start_hour integer, busy integer)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT greatest(coalesce((SELECT nullif(value::text,'')::text FROM public.ops_settings WHERE key='booking_buffer_minutes' LIMIT 1), '30')::text::numeric::int, 0) AS buf
  ), b AS (
    SELECT coalesce(public.slot_start_ist(scheduled_date, scheduled_time_slot), created_at) AS s,
           greatest(coalesce(service_duration_minutes, 60), 1) + (SELECT buf FROM cfg) AS dur
      FROM public.bookings
     WHERE status <> 'cancelled'
       AND (scheduled_date = _date OR (scheduled_date IS NULL AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = _date))
  )
  SELECT h, count(*)::int FROM b, generate_series(0,23) h
   WHERE (s AT TIME ZONE 'Asia/Kolkata')::date = _date
     AND (_date + make_time(h,0,0)) < ((s AT TIME ZONE 'Asia/Kolkata') + make_interval(mins => dur))
     AND (_date + make_time(h,0,0) + interval '1 hour') > (s AT TIME ZONE 'Asia/Kolkata')
   GROUP BY h
$function$;