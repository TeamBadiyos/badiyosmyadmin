ALTER TABLE public.service_slot_overrides ADD COLUMN IF NOT EXISTS start_minute int NOT NULL DEFAULT 0;
DO $$ DECLARE c text; BEGIN
  SELECT conname INTO c FROM pg_constraint WHERE conrelid='public.service_slot_overrides'::regclass AND contype='u' LIMIT 1;
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE public.service_slot_overrides DROP CONSTRAINT %I', c); END IF;
END $$;
DROP INDEX IF EXISTS public.service_slot_overrides_service_key_slot_date_start_hour_key;
CREATE UNIQUE INDEX IF NOT EXISTS sso_unique_slot ON public.service_slot_overrides(service_key, slot_date, start_hour, start_minute);

INSERT INTO public.ops_settings(key, value, label) VALUES ('slot_step_minutes', to_jsonb('30'::text), 'Slot step (minutes)') ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.slot_step() RETURNS int LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT CASE WHEN coalesce(public.get_ops_num('slot_step_minutes',30)::int,30) = 60 THEN 60 ELSE 30 END
$$;

-- busy maids per 30-min window (start_min = minutes since midnight IST)
CREATE OR REPLACE FUNCTION public.slot_busy_by_half(_service_key text, _date date)
RETURNS TABLE(start_min int, busy int) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH cfg AS (
    SELECT greatest(coalesce((SELECT nullif(trim(both '"' from value::text),'') FROM public.ops_settings WHERE key='booking_buffer_minutes' LIMIT 1),'30')::numeric::int,0) AS buf
  ), b AS (
    SELECT coalesce(public.slot_start_ist(scheduled_date, scheduled_time_slot), created_at) AS s,
           greatest(coalesce(service_duration_minutes,60),1) + (SELECT buf FROM cfg) AS dur
      FROM public.bookings
     WHERE status <> 'cancelled'
       AND (scheduled_date = _date OR (scheduled_date IS NULL AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = _date))
  )
  SELECT m, count(*)::int FROM b, generate_series(0, 1410, 30) m
   WHERE (s AT TIME ZONE 'Asia/Kolkata')::date = _date
     AND (_date + make_interval(mins => m)) < ((s AT TIME ZONE 'Asia/Kolkata') + make_interval(mins => dur))
     AND (_date + make_interval(mins => m + 30)) > (s AT TIME ZONE 'Asia/Kolkata')
   GROUP BY m
$$;
GRANT EXECUTE ON FUNCTION public.slot_busy_by_half(text,date) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.slot_is_fully_booked(_service_key text, _date date, _slot text, _duration_minutes integer)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE _st timestamptz; _m int; _n int; _cap int;
BEGIN
  _st := public.slot_start_ist(_date, _slot);
  IF _st IS NULL THEN RETURN false; END IF;
  _m := (extract(hour from (_st AT TIME ZONE 'Asia/Kolkata'))::int*60 + extract(minute from (_st AT TIME ZONE 'Asia/Kolkata'))::int);
  _m := (_m/30)*30;
  IF EXISTS (SELECT 1 FROM public.service_slot_overrides o WHERE o.service_key=coalesce(_service_key,'clean')
             AND o.slot_date=_date AND o.status='fully_booked' AND o.start_hour*60+o.start_minute=_m) THEN RETURN true; END IF;
  IF coalesce(trim(both '"' from (SELECT value::text FROM public.ops_settings WHERE key='slot_capacity_enabled')),'0') <> '1' THEN RETURN false; END IF;
  _n := greatest(ceil(coalesce(_duration_minutes,60)/30.0)::int, 1);
  _cap := public.slot_capacity_for(_service_key, _date);
  RETURN EXISTS (SELECT 1 FROM generate_series(_m, least(_m + (_n-1)*30, 1410), 30) g
     LEFT JOIN public.slot_busy_by_half(_service_key, _date) b ON b.start_min = g
     WHERE coalesce(b.busy,0) >= _cap);
END $$;

DROP FUNCTION IF EXISTS public.list_fully_booked_slots(text,date,date);
CREATE FUNCTION public.list_fully_booked_slots(_service_key text, _from date, _to date)
RETURNS TABLE(slot_date date, start_hour int, start_minute int) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE d date; _cap int; _first int; _last int; _step int;
BEGIN
  RETURN QUERY SELECT o.slot_date, o.start_hour, o.start_minute FROM public.service_slot_overrides o
   WHERE o.service_key=coalesce(_service_key,'clean') AND o.status='fully_booked' AND o.slot_date BETWEEN _from AND _to;
  IF coalesce(trim(both '"' from (SELECT value::text FROM public.ops_settings WHERE key='slot_capacity_enabled')),'0') <> '1' THEN RETURN; END IF;
  IF _to - _from > 31 THEN _to := _from + 31; END IF;
  _first := public.get_ops_num('slot_first_start_hour',10)::int*60;
  _last := public.get_ops_num('slot_last_start_hour',18)::int*60;
  _step := public.slot_step();
  d := _from;
  WHILE d <= _to LOOP
    _cap := public.slot_capacity_for(_service_key, d);
    RETURN QUERY SELECT d, (g/60)::int, (g%60)::int FROM generate_series(_first,_last,_step) g
      WHERE EXISTS (SELECT 1 FROM public.slot_busy_by_half(_service_key, d) b WHERE b.start_min >= g AND b.start_min < g+_step AND b.busy >= _cap)
        AND NOT EXISTS (SELECT 1 FROM public.service_slot_overrides o WHERE o.service_key=coalesce(_service_key,'clean') AND o.slot_date=d AND o.start_hour*60+o.start_minute=g AND o.status='fully_booked');
    d := d + 1;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.list_fully_booked_slots(text,date,date) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.staff_set_slot_full(date,int,boolean,text,text);
CREATE FUNCTION public.staff_set_slot_full(_date date, _start_hour int, _full boolean, _reason text DEFAULT NULL, _service_key text DEFAULT 'clean', _start_minute int DEFAULT 0)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _start_hour < 0 OR _start_hour > 23 OR _start_minute NOT IN (0,30) THEN RAISE EXCEPTION 'Invalid slot'; END IF;
  IF _full THEN
    INSERT INTO public.service_slot_overrides(service_key, slot_date, start_hour, start_minute, status, reason, created_by)
    VALUES (_service_key, _date, _start_hour, _start_minute, 'fully_booked', _reason, _uid)
    ON CONFLICT (service_key, slot_date, start_hour, start_minute) DO UPDATE SET status='fully_booked', reason=excluded.reason, created_by=_uid, created_at=now();
  ELSE
    DELETE FROM public.service_slot_overrides WHERE service_key=_service_key AND slot_date=_date AND start_hour=_start_hour AND start_minute=_start_minute;
  END IF;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, CASE WHEN _full THEN 'slot_marked_full' ELSE 'slot_reopened' END, 'service_slot_overrides', NULL, NULL,
    jsonb_build_object('date',_date,'start_hour',_start_hour,'start_minute',_start_minute,'reason',_reason,'service_key',_service_key));
END $$;
REVOKE ALL ON FUNCTION public.staff_set_slot_full(date,int,boolean,text,text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_set_slot_full(date,int,boolean,text,text,int) TO authenticated;