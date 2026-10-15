
ALTER TABLE public.service_daily_capacity
  ADD COLUMN IF NOT EXISTS morning_cap int, ADD COLUMN IF NOT EXISTS day_cap int, ADD COLUMN IF NOT EXISTS evening_cap int;

INSERT INTO public.ops_settings(key, value, label) VALUES
  ('wash_default_slot_capacity', coalesce((SELECT value FROM public.ops_settings WHERE key='default_slot_capacity'),'5'), 'Washers per day'),
  ('clean_band_morning_end', '660', 'Clean Home: Morning ends (min)'),
  ('clean_band_day_end', '960', 'Clean Home: Day ends (min)'),
  ('wash_band_morning_end', '660', 'Clean Auto: Morning ends (min)'),
  ('wash_band_day_end', '960', 'Clean Auto: Day ends (min)')
ON CONFLICT (key) DO NOTHING;

-- Remove weekday capacity completely
DROP FUNCTION IF EXISTS public.staff_set_weekday_capacity(text,int,int);
DROP TABLE IF EXISTS public.slot_capacity_weekday;

CREATE OR REPLACE FUNCTION public.slot_band_of(_service_key text, _min int)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT CASE
    WHEN _min < public.get_ops_num(CASE WHEN _service_key='wash' THEN 'wash' ELSE 'clean' END || '_band_morning_end', 660) THEN 'morning'
    WHEN _min < public.get_ops_num(CASE WHEN _service_key='wash' THEN 'wash' ELSE 'clean' END || '_band_day_end', 960) THEN 'day'
    ELSE 'evening' END
$$;

-- Daily default (per group), or date override's overall number
CREATE OR REPLACE FUNCTION public.slot_capacity_for(_service_key text, _date date)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE _mode text; _c int; _g text := CASE WHEN _service_key='wash' THEN 'wash' ELSE 'clean' END;
BEGIN
  SELECT value INTO _mode FROM public.ops_settings WHERE key='slot_capacity_mode';
  IF _g='clean' AND coalesce(_mode,'manual')='live' AND _date=(now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    SELECT count(*) INTO _c FROM public.experts WHERE status='active' AND coalesce(is_online,false);
    RETURN _c;
  END IF;
  RETURN coalesce(public.get_ops_num(CASE WHEN _g='wash' THEN 'wash_default_slot_capacity' ELSE 'default_slot_capacity' END, 5)::int, 5);
END $$;

-- Capacity of the band a half-hour slot falls in: date override for that band > daily number
CREATE OR REPLACE FUNCTION public.slot_band_capacity(_service_key text, _date date, _min int)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE _g text := CASE WHEN _service_key='wash' THEN 'wash' ELSE 'clean' END; _b text; _c int;
BEGIN
  _b := public.slot_band_of(_g, _min);
  SELECT CASE _b WHEN 'morning' THEN morning_cap WHEN 'day' THEN day_cap ELSE evening_cap END INTO _c
    FROM public.service_daily_capacity WHERE service_key=_g AND cap_date=_date;
  IF _c IS NOT NULL THEN RETURN _c; END IF;
  RETURN public.slot_capacity_for(_g, _date);
END $$;

CREATE OR REPLACE FUNCTION public.slot_is_fully_booked(_service_key text, _date date, _slot text, _duration_minutes integer)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE _st timestamptz; _m int; _n int; _g text := CASE WHEN _service_key='wash' THEN 'wash' ELSE 'clean' END;
BEGIN
  _st := public.slot_start_ist(_date, _slot);
  IF _st IS NULL THEN RETURN false; END IF;
  _m := (extract(hour from (_st AT TIME ZONE 'Asia/Kolkata'))::int*60 + extract(minute from (_st AT TIME ZONE 'Asia/Kolkata'))::int);
  _m := (_m/30)*30;
  IF EXISTS (SELECT 1 FROM public.service_slot_overrides o WHERE o.service_key=coalesce(_service_key,'clean')
             AND o.slot_date=_date AND o.status='fully_booked' AND o.start_hour*60+o.start_minute=_m) THEN RETURN true; END IF;
  IF coalesce(trim(both '"' from (SELECT value::text FROM public.ops_settings WHERE key='slot_capacity_enabled')),'0') <> '1' THEN RETURN false; END IF;
  _n := greatest(ceil(coalesce(_duration_minutes,60)/30.0)::int, 1);
  RETURN EXISTS (SELECT 1 FROM generate_series(_m, least(_m + (_n-1)*30, 1410), 30) g
     LEFT JOIN public.slot_busy_by_half(_g, _date) b ON b.start_min = g
     WHERE coalesce(b.busy,0) >= public.slot_band_capacity(_g, _date, g));
END $$;

CREATE OR REPLACE FUNCTION public.list_fully_booked_slots(_service_key text, _from date, _to date)
RETURNS TABLE(slot_date date, start_hour int, start_minute int) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE d date; _first int; _last int; _step int; _g text := CASE WHEN _service_key='wash' THEN 'wash' ELSE 'clean' END;
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
    RETURN QUERY SELECT d, (g/60)::int, (g%60)::int FROM generate_series(_first,_last,_step) g
      WHERE EXISTS (SELECT 1 FROM public.slot_busy_by_half(_g, d) b WHERE b.start_min >= g AND b.start_min < g+_step
                      AND b.busy >= public.slot_band_capacity(_g, d, b.start_min))
        AND NOT EXISTS (SELECT 1 FROM public.service_slot_overrides o WHERE o.service_key=coalesce(_service_key,'clean') AND o.slot_date=d AND o.start_hour*60+o.start_minute=g AND o.status='fully_booked');
    d := d + 1;
  END LOOP;
END $$;

-- Staff: set/clear the three band counts for one date
CREATE OR REPLACE FUNCTION public.staff_set_band_capacity(_service_key text, _date date, _morning int, _day int, _evening int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _uid uuid := auth.uid(); _g text := CASE WHEN _service_key='wash' THEN 'wash' ELSE 'clean' END;
BEGIN
  IF _uid IS NULL OR NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF (_morning IS NOT NULL AND (_morning<0 OR _morning>500)) OR (_day IS NOT NULL AND (_day<0 OR _day>500)) OR (_evening IS NOT NULL AND (_evening<0 OR _evening>500)) THEN
    RAISE EXCEPTION 'Count must be between 0 and 500';
  END IF;
  IF _morning IS NULL AND _day IS NULL AND _evening IS NULL THEN
    DELETE FROM public.service_daily_capacity WHERE service_key=_g AND cap_date=_date;
  ELSE
    INSERT INTO public.service_daily_capacity(service_key, cap_date, capacity, morning_cap, day_cap, evening_cap, updated_by)
    VALUES (_g, _date, greatest(coalesce(_morning,0),coalesce(_day,0),coalesce(_evening,0)), _morning, _day, _evening, _uid)
    ON CONFLICT (service_key, cap_date) DO UPDATE SET capacity=excluded.capacity, morning_cap=excluded.morning_cap,
      day_cap=excluded.day_cap, evening_cap=excluded.evening_cap, updated_by=_uid, updated_at=now();
  END IF;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'band_capacity_set', 'service_daily_capacity', NULL, NULL,
    jsonb_build_object('group',_g,'date',_date,'morning',_morning,'day',_day,'evening',_evening));
END $$;

-- Staff: per-band summary for a date
CREATE OR REPLACE FUNCTION public.staff_slot_band_summary(_service_key text, _date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE _g text := CASE WHEN _service_key='wash' THEN 'wash' ELSE 'clean' END;
  _me int := public.get_ops_num(CASE WHEN _service_key='wash' THEN 'wash' ELSE 'clean' END || '_band_morning_end',660)::int;
  _de int := public.get_ops_num(CASE WHEN _service_key='wash' THEN 'wash' ELSE 'clean' END || '_band_day_end',960)::int;
  _first int := public.get_ops_num('slot_first_start_hour',10)::int*60;
  _last int := public.get_ops_num('slot_last_start_hour',18)::int*60;
  _o record; _res jsonb := '[]'::jsonb; _b text; _s int; _e int; _cap int; _booked int; _full boolean;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager','area_partner']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT * INTO _o FROM public.service_daily_capacity WHERE service_key=_g AND cap_date=_date;
  FOREACH _b IN ARRAY ARRAY['morning','day','evening'] LOOP
    _s := CASE _b WHEN 'morning' THEN 0 WHEN 'day' THEN _me ELSE _de END;
    _e := CASE _b WHEN 'morning' THEN _me WHEN 'day' THEN _de ELSE 1440 END;
    _cap := public.slot_band_capacity(_g, _date, _s);
    SELECT count(*) INTO _booked FROM public.bookings bk
     WHERE bk.status <> 'cancelled' AND bk.scheduled_date=_date
       AND public.booking_capacity_group(bk.service_category_id, bk.service_label)=_g
       AND (extract(hour from (public.slot_start_ist(bk.scheduled_date, bk.scheduled_time_slot) AT TIME ZONE 'Asia/Kolkata'))*60
            + extract(minute from (public.slot_start_ist(bk.scheduled_date, bk.scheduled_time_slot) AT TIME ZONE 'Asia/Kolkata'))) >= _s
       AND (extract(hour from (public.slot_start_ist(bk.scheduled_date, bk.scheduled_time_slot) AT TIME ZONE 'Asia/Kolkata'))*60
            + extract(minute from (public.slot_start_ist(bk.scheduled_date, bk.scheduled_time_slot) AT TIME ZONE 'Asia/Kolkata'))) < _e;
    SELECT NOT EXISTS (SELECT 1 FROM generate_series(greatest(_s,_first), least(_e-30,_last), 30) g
                        LEFT JOIN public.slot_busy_by_half(_g,_date) x ON x.start_min=g
                        WHERE coalesce(x.busy,0) < _cap)
           AND greatest(_s,_first) <= least(_e-30,_last) INTO _full;
    _res := _res || jsonb_build_object('band',_b,'start_min',_s,'end_min',_e,'capacity',_cap,'booked',_booked,'full',coalesce(_full,false),
      'override', CASE _b WHEN 'morning' THEN _o.morning_cap WHEN 'day' THEN _o.day_cap ELSE _o.evening_cap END);
  END LOOP;
  RETURN jsonb_build_object('bands',_res,'default_cap',public.slot_capacity_for(_g,_date),'morning_end',_me,'day_end',_de);
END $$;

REVOKE ALL ON FUNCTION public.staff_set_band_capacity(text,date,int,int,int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_set_band_capacity(text,date,int,int,int) TO authenticated;
REVOKE ALL ON FUNCTION public.staff_slot_band_summary(text,date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_slot_band_summary(text,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.slot_band_capacity(text,date,int), public.slot_band_of(text,int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_fully_booked_slots(text,date,date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.slot_is_fully_booked(text,date,text,integer) TO anon, authenticated;
