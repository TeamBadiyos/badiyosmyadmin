CREATE TABLE public.service_daily_capacity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_key text NOT NULL DEFAULT 'clean',
  cap_date date NOT NULL,
  capacity integer NOT NULL CHECK (capacity >= 0 AND capacity <= 500),
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_key, cap_date)
);
GRANT SELECT ON public.service_daily_capacity TO authenticated;
GRANT ALL ON public.service_daily_capacity TO service_role;
ALTER TABLE public.service_daily_capacity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read daily capacity" ON public.service_daily_capacity FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

INSERT INTO public.ops_settings(key, value, label) VALUES
  ('slot_capacity_enabled','0','Auto slot capacity'), ('default_slot_capacity','5','Default maids per day'), ('slot_capacity_mode','manual','Slot capacity mode')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.slot_capacity_for(_service_key text, _date date)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _mode text; _c int;
BEGIN
  SELECT value INTO _mode FROM public.ops_settings WHERE key='slot_capacity_mode';
  IF coalesce(_mode,'manual') = 'live' AND _date = (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    SELECT count(*) INTO _c FROM public.experts WHERE status='active' AND coalesce(is_online,false);
    RETURN _c;
  END IF;
  SELECT capacity INTO _c FROM public.service_daily_capacity
   WHERE service_key=coalesce(_service_key,'clean') AND cap_date=_date;
  IF FOUND THEN RETURN _c; END IF;
  RETURN coalesce(public.get_ops_num('default_slot_capacity', 5)::int, 5);
END $$;

-- Busy maids per hour (IST) for a date; multi-hour bookings count in every hour they cover.
CREATE OR REPLACE FUNCTION public.slot_busy_by_hour(_service_key text, _date date)
RETURNS TABLE(start_hour integer, busy integer) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH b AS (
    SELECT coalesce(public.slot_start_ist(scheduled_date, scheduled_time_slot), created_at) AS s,
           greatest(coalesce(service_duration_minutes, 60), 1) AS dur
      FROM public.bookings
     WHERE status <> 'cancelled'
       AND (scheduled_date = _date OR (scheduled_date IS NULL AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = _date))
  )
  SELECT h, count(*)::int FROM b, generate_series(0,23) h
   WHERE (s AT TIME ZONE 'Asia/Kolkata')::date = _date
     AND (_date + make_time(h,0,0)) < ((s AT TIME ZONE 'Asia/Kolkata') + make_interval(mins => dur))
     AND (_date + make_time(h,0,0) + interval '1 hour') > (s AT TIME ZONE 'Asia/Kolkata')
   GROUP BY h
$$;

CREATE OR REPLACE FUNCTION public.slot_is_fully_booked(_service_key text, _date date, _slot text, _duration_minutes integer)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _st timestamptz; _h int; _n int; _cap int;
BEGIN
  _st := public.slot_start_ist(_date, _slot);
  IF _st IS NULL THEN RETURN false; END IF;
  _h := extract(hour from (_st AT TIME ZONE 'Asia/Kolkata'))::int;
  IF EXISTS (SELECT 1 FROM public.service_slot_overrides o WHERE o.service_key=coalesce(_service_key,'clean')
             AND o.slot_date=_date AND o.status='fully_booked' AND o.start_hour=_h) THEN RETURN true; END IF;
  IF coalesce((SELECT value FROM public.ops_settings WHERE key='slot_capacity_enabled'),'0') <> '1' THEN RETURN false; END IF;
  _n := greatest(ceil(coalesce(_duration_minutes,60)/60.0)::int, 1);
  _cap := public.slot_capacity_for(_service_key, _date);
  RETURN EXISTS (SELECT 1 FROM generate_series(_h, least(_h+_n-1, 23)) g
     LEFT JOIN public.slot_busy_by_hour(_service_key, _date) b ON b.start_hour = g
     WHERE coalesce(b.busy,0) >= _cap);
END $$;

CREATE OR REPLACE FUNCTION public.slot_is_fully_booked(_service_key text, _date date, _slot text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.slot_is_fully_booked(_service_key, _date, _slot, 60)
$$;

CREATE OR REPLACE FUNCTION public.list_fully_booked_slots(_service_key text, _from date, _to date)
RETURNS TABLE(slot_date date, start_hour integer) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d date; _cap int; _first int; _last int;
BEGIN
  RETURN QUERY SELECT o.slot_date, o.start_hour FROM public.service_slot_overrides o
   WHERE o.service_key=coalesce(_service_key,'clean') AND o.status='fully_booked' AND o.slot_date BETWEEN _from AND _to;
  IF coalesce((SELECT value FROM public.ops_settings WHERE key='slot_capacity_enabled'),'0') <> '1' THEN RETURN; END IF;
  IF _to - _from > 31 THEN _to := _from + 31; END IF;
  _first := public.get_ops_num('slot_first_start_hour', 10)::int;
  _last := public.get_ops_num('slot_last_start_hour', 18)::int;
  d := _from;
  WHILE d <= _to LOOP
    _cap := public.slot_capacity_for(_service_key, d);
    RETURN QUERY SELECT d, g FROM generate_series(_first,_last) g
      LEFT JOIN public.slot_busy_by_hour(_service_key, d) b ON b.start_hour=g
      WHERE coalesce(b.busy,0) >= _cap
        AND NOT EXISTS (SELECT 1 FROM public.service_slot_overrides o WHERE o.service_key=coalesce(_service_key,'clean') AND o.slot_date=d AND o.start_hour=g AND o.status='fully_booked');
    d := d + 1;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.bookings_check_slot_capacity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(NEW.slot_type,'now') = 'now' THEN
    IF NOT public.instant_booking_enabled() THEN
      RAISE EXCEPTION 'Instant bookings are currently full due to high demand. Please pick a scheduled slot.' USING errcode='check_violation';
    END IF;
  ELSIF NEW.scheduled_date IS NOT NULL AND public.slot_is_fully_booked('clean', NEW.scheduled_date, NEW.scheduled_time_slot, NEW.service_duration_minutes) THEN
    RAISE EXCEPTION 'This slot is now fully booked. Please select another slot.' USING errcode='check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.staff_set_daily_capacity(_date date, _capacity integer, _service_key text DEFAULT 'clean')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _capacity IS NULL THEN
    DELETE FROM public.service_daily_capacity WHERE service_key=_service_key AND cap_date=_date;
  ELSE
    IF _capacity < 0 OR _capacity > 500 THEN RAISE EXCEPTION 'Maid count must be between 0 and 500'; END IF;
    INSERT INTO public.service_daily_capacity(service_key, cap_date, capacity, updated_by)
    VALUES (_service_key, _date, _capacity, _uid)
    ON CONFLICT (service_key, cap_date) DO UPDATE SET capacity=excluded.capacity, updated_by=_uid, updated_at=now();
  END IF;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'daily_capacity_set', 'service_daily_capacity', NULL, NULL,
    jsonb_build_object('date', _date, 'capacity', _capacity, 'service_key', _service_key));
END $$;

REVOKE EXECUTE ON FUNCTION public.bookings_check_slot_capacity() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_set_daily_capacity(date,integer,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_set_daily_capacity(date,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.slot_is_fully_booked(text,date,text,integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.slot_busy_by_hour(text,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.slot_capacity_for(text,date) TO authenticated;