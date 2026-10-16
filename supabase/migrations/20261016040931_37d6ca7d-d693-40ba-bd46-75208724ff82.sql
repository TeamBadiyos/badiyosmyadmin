
-- per-city storage for day overrides and slot-full marks
ALTER TABLE public.service_daily_capacity ADD COLUMN IF NOT EXISTS city_id uuid REFERENCES public.cities(id) ON DELETE CASCADE;
ALTER TABLE public.service_slot_overrides ADD COLUMN IF NOT EXISTS city_id uuid REFERENCES public.cities(id) ON DELETE CASCADE;
UPDATE public.service_daily_capacity SET city_id = public.default_city_id() WHERE city_id IS NULL;
UPDATE public.service_slot_overrides SET city_id = public.default_city_id() WHERE city_id IS NULL;
ALTER TABLE public.service_daily_capacity ALTER COLUMN city_id SET DEFAULT public.default_city_id(), ALTER COLUMN city_id SET NOT NULL;
ALTER TABLE public.service_slot_overrides ALTER COLUMN city_id SET DEFAULT public.default_city_id(), ALTER COLUMN city_id SET NOT NULL;
ALTER TABLE public.service_daily_capacity DROP CONSTRAINT IF EXISTS service_daily_capacity_service_key_cap_date_key;
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT i.relname FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid
           WHERE x.indrelid='public.service_slot_overrides'::regclass AND x.indisunique AND NOT x.indisprimary LOOP
    BEGIN EXECUTE format('ALTER TABLE public.service_slot_overrides DROP CONSTRAINT %I', r.relname);
    EXCEPTION WHEN others THEN EXECUTE format('DROP INDEX public.%I', r.relname); END;
  END LOOP;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS service_daily_capacity_city_key_date_uq ON public.service_daily_capacity(city_id, service_key, cap_date);
CREATE UNIQUE INDEX IF NOT EXISTS service_slot_overrides_city_slot_uq ON public.service_slot_overrides(city_id, service_key, slot_date, start_hour, start_minute);

-- city ops reader (city's own row only)
CREATE OR REPLACE FUNCTION public.city_ops_num(_city uuid, _key text, _default numeric)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(NULLIF(regexp_replace(COALESCE((SELECT value FROM public.city_ops_settings
    WHERE city_id = COALESCE(_city, public.default_city_id()) AND key = _key), ''), '[^0-9.\-]', '', 'g'), '')::numeric, _default) $$;
CREATE OR REPLACE FUNCTION public.city_ops_text(_city uuid, _key text, _default text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(NULLIF(trim(both '"' from (SELECT value FROM public.city_ops_settings
    WHERE city_id = COALESCE(_city, public.default_city_id()) AND key = _key)), ''), _default) $$;

CREATE OR REPLACE FUNCTION public.slot_step(_city uuid)
RETURNS integer LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT CASE WHEN public.city_ops_num(_city,'slot_step_minutes',30)::int = 60 THEN 60 ELSE 30 END $$;
CREATE OR REPLACE FUNCTION public.slot_step()
RETURNS integer LANGUAGE sql STABLE SET search_path TO 'public' AS $$ SELECT public.slot_step(public.default_city_id()) $$;

CREATE OR REPLACE FUNCTION public.instant_free_expert_count(_city uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT count(*)::int FROM public.experts WHERE status='active' AND is_online = true AND COALESCE(is_busy,false) = false
    AND city_id = COALESCE(_city, public.default_city_id()) $$;

CREATE OR REPLACE FUNCTION public.instant_booking_enabled(_g text, _city uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN _g='wash'
    THEN public.city_ops_text(_city,'wash_instant_booking_enabled','1') <> '0'
    ELSE public.city_ops_text(_city,'instant_booking_enabled','1') <> '0'
     AND (coalesce(trim(both '"' from (SELECT value::text FROM public.ops_settings WHERE key='instant_auto_by_experts')),'1') = '0'
          OR public.instant_free_expert_count(_city) > 0) END $$;
CREATE OR REPLACE FUNCTION public.instant_booking_enabled(_g text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT public.instant_booking_enabled(_g, public.default_city_id()) $$;
CREATE OR REPLACE FUNCTION public.instant_booking_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT public.instant_booking_enabled('clean', public.default_city_id()) $$;

CREATE OR REPLACE FUNCTION public.slot_band_of(_service_key text, _min integer, _city uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN _min < public.city_ops_num(_city, CASE WHEN _service_key='wash' THEN 'wash' ELSE 'clean' END || '_band_morning_end', 660) THEN 'morning'
    WHEN _min < public.city_ops_num(_city, CASE WHEN _service_key='wash' THEN 'wash' ELSE 'clean' END || '_band_day_end', 960) THEN 'day'
    ELSE 'evening' END $$;
CREATE OR REPLACE FUNCTION public.slot_band_of(_service_key text, _min integer)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT public.slot_band_of(_service_key, _min, public.default_city_id()) $$;

CREATE OR REPLACE FUNCTION public.slot_capacity_for(_service_key text, _date date, _city uuid)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _c int; _g text := CASE WHEN _service_key='wash' THEN 'wash' ELSE 'clean' END; _cid uuid := COALESCE(_city, public.default_city_id());
BEGIN
  IF _g='clean' AND public.city_ops_text(_cid,'slot_capacity_mode','manual')='live' AND _date=(now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    SELECT count(*) INTO _c FROM public.experts WHERE status='active' AND coalesce(is_online,false) AND city_id=_cid;
    RETURN _c;
  END IF;
  RETURN coalesce(public.city_ops_num(_cid, CASE WHEN _g='wash' THEN 'wash_default_slot_capacity' ELSE 'default_slot_capacity' END, 5)::int, 5);
END $$;
CREATE OR REPLACE FUNCTION public.slot_capacity_for(_service_key text, _date date)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT public.slot_capacity_for(_service_key, _date, public.default_city_id()) $$;

CREATE OR REPLACE FUNCTION public.slot_band_capacity(_service_key text, _date date, _min integer, _city uuid)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _g text := CASE WHEN _service_key='wash' THEN 'wash' ELSE 'clean' END; _b text; _c int; _cid uuid := COALESCE(_city, public.default_city_id());
BEGIN
  _b := public.slot_band_of(_g, _min, _cid);
  SELECT CASE _b WHEN 'morning' THEN morning_cap WHEN 'day' THEN day_cap ELSE evening_cap END INTO _c
    FROM public.service_daily_capacity WHERE service_key=_g AND cap_date=_date AND city_id=_cid;
  IF _c IS NOT NULL THEN RETURN _c; END IF;
  RETURN public.slot_capacity_for(_g, _date, _cid);
END $$;
CREATE OR REPLACE FUNCTION public.slot_band_capacity(_service_key text, _date date, _min integer)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT public.slot_band_capacity(_service_key, _date, _min, public.default_city_id()) $$;

CREATE OR REPLACE FUNCTION public.slot_busy_by_half(_service_key text, _date date, _city uuid)
RETURNS TABLE(start_min integer, busy integer) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH cfg AS (
    SELECT greatest(coalesce((SELECT nullif(trim(both '"' from value::text),'') FROM public.ops_settings WHERE key='booking_buffer_minutes' LIMIT 1),'30')::numeric::int,0) AS buf
  ), b AS (
    SELECT coalesce(public.slot_start_ist(scheduled_date, scheduled_time_slot), created_at) AS s,
           greatest(coalesce(service_duration_minutes,60),1) + (SELECT buf FROM cfg) AS dur
      FROM public.bookings
     WHERE status <> 'cancelled'
       AND city_id = COALESCE(_city, public.default_city_id())
       AND (scheduled_date = _date OR (scheduled_date IS NULL AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = _date))
       AND public.booking_capacity_group(service_category_id, service_label) = CASE WHEN _service_key='wash' THEN 'wash' ELSE 'clean' END
  )
  SELECT m, count(*)::int FROM b, generate_series(0, 1410, 30) m
   WHERE (s AT TIME ZONE 'Asia/Kolkata')::date = _date
     AND (_date + make_interval(mins => m)) < ((s AT TIME ZONE 'Asia/Kolkata') + make_interval(mins => dur))
     AND (_date + make_interval(mins => m + 30)) > (s AT TIME ZONE 'Asia/Kolkata')
   GROUP BY m $$;
CREATE OR REPLACE FUNCTION public.slot_busy_by_half(_service_key text, _date date)
RETURNS TABLE(start_min integer, busy integer) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT * FROM public.slot_busy_by_half(_service_key, _date, public.default_city_id()) $$;

CREATE OR REPLACE FUNCTION public.slot_is_fully_booked(_service_key text, _date date, _slot text, _duration_minutes integer, _city uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _st timestamptz; _m int; _n int; _g text := CASE WHEN _service_key='wash' THEN 'wash' ELSE 'clean' END; _cid uuid := COALESCE(_city, public.default_city_id());
BEGIN
  _st := public.slot_start_ist(_date, _slot);
  IF _st IS NULL THEN RETURN false; END IF;
  _m := (extract(hour from (_st AT TIME ZONE 'Asia/Kolkata'))::int*60 + extract(minute from (_st AT TIME ZONE 'Asia/Kolkata'))::int);
  _m := (_m/30)*30;
  IF EXISTS (SELECT 1 FROM public.service_slot_overrides o WHERE o.service_key=_g AND o.city_id=_cid
             AND o.slot_date=_date AND o.status='fully_booked' AND o.start_hour*60+o.start_minute=_m) THEN RETURN true; END IF;
  IF public.city_ops_text(_cid,'slot_capacity_enabled','0') <> '1' THEN RETURN false; END IF;
  _n := greatest(ceil(coalesce(_duration_minutes,60)/30.0)::int, 1);
  RETURN EXISTS (SELECT 1 FROM generate_series(_m, least(_m + (_n-1)*30, 1410), 30) g
     LEFT JOIN public.slot_busy_by_half(_g, _date, _cid) b ON b.start_min = g
     WHERE coalesce(b.busy,0) >= public.slot_band_capacity(_g, _date, g, _cid));
END $$;
CREATE OR REPLACE FUNCTION public.slot_is_fully_booked(_service_key text, _date date, _slot text, _duration_minutes integer)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT public.slot_is_fully_booked(_service_key, _date, _slot, _duration_minutes, public.default_city_id()) $$;

CREATE OR REPLACE FUNCTION public.list_fully_booked_slots(_service_key text, _from date, _to date, _city_id uuid)
RETURNS TABLE(slot_date date, start_hour integer, start_minute integer) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d date; _first int; _last int; _step int; _g text := CASE WHEN _service_key='wash' THEN 'wash' ELSE 'clean' END; _cid uuid := COALESCE(_city_id, public.default_city_id());
BEGIN
  RETURN QUERY SELECT o.slot_date, o.start_hour, o.start_minute FROM public.service_slot_overrides o
   WHERE o.service_key=_g AND o.city_id=_cid AND o.status='fully_booked' AND o.slot_date BETWEEN _from AND _to;
  IF public.city_ops_text(_cid,'slot_capacity_enabled','0') <> '1' THEN RETURN; END IF;
  IF _to - _from > 31 THEN _to := _from + 31; END IF;
  _first := public.city_ops_num(_cid,'slot_first_start_hour',10)::int*60;
  _last := public.city_ops_num(_cid,'slot_last_start_hour',18)::int*60;
  _step := public.slot_step(_cid);
  d := _from;
  WHILE d <= _to LOOP
    RETURN QUERY SELECT d, (g/60)::int, (g%60)::int FROM generate_series(_first,_last,_step) g
      WHERE EXISTS (SELECT 1 FROM public.slot_busy_by_half(_g, d, _cid) b WHERE b.start_min >= g AND b.start_min < g+_step
                      AND b.busy >= public.slot_band_capacity(_g, d, b.start_min, _cid))
        AND NOT EXISTS (SELECT 1 FROM public.service_slot_overrides o WHERE o.service_key=_g AND o.city_id=_cid AND o.slot_date=d AND o.start_hour*60+o.start_minute=g AND o.status='fully_booked');
    d := d + 1;
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.list_fully_booked_slots(_service_key text, _from date, _to date)
RETURNS TABLE(slot_date date, start_hour integer, start_minute integer) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT * FROM public.list_fully_booked_slots(_service_key, _from, _to, public.default_city_id()) $$;

CREATE OR REPLACE FUNCTION public.city_name_of(_city uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT name FROM public.cities WHERE id = COALESCE(_city, public.default_city_id()) $$;

CREATE OR REPLACE FUNCTION public.service_instant_allowed(_service_key text, _duration_minutes integer, _city_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
declare st jsonb; f record; hr record; start_at timestamptz := now(); end_at timestamptz; ldow int; start_t time; end_t time;
  _cid uuid := COALESCE(_city_id, public.default_city_id());
begin
  st := public.service_effective_state(_service_key, public.city_name_of(_cid), now());
  if not coalesce((st->>'can_order')::boolean, true) then
    return jsonb_build_object('ok', false, 'reason_code', coalesce(st->>'reason_code','closed'),
      'next_open_at', st->>'next_open_at', 'close_time', st->>'close_time');
  end if;
  select * into f from public.service_flags where service_key = _service_key and city_id = _cid order by created_at limit 1;
  if not found or not coalesce(f.hours_enabled, false) then return jsonb_build_object('ok', true, 'reason_code', 'live'); end if;
  end_at := start_at + make_interval(mins => greatest(coalesce(_duration_minutes, 60), 1));
  ldow := extract(dow from (start_at at time zone 'Asia/Kolkata'))::int;
  start_t := (start_at at time zone 'Asia/Kolkata')::time; end_t := (end_at at time zone 'Asia/Kolkata')::time;
  select * into hr from public.service_hours where service_flag_id = f.id and weekday = ldow;
  if not found then return jsonb_build_object('ok', true, 'reason_code', 'live'); end if;
  if hr.is_closed or start_t < hr.open_time or end_t > hr.close_time
     or (end_at at time zone 'Asia/Kolkata')::date <> (start_at at time zone 'Asia/Kolkata')::date then
    return jsonb_build_object('ok', false, 'reason_code', 'outside_hours', 'open_time', hr.open_time, 'close_time', hr.close_time,
      'next_open_at', public.service_next_open(f.id, start_at));
  end if;
  return jsonb_build_object('ok', true, 'reason_code', 'live');
end $$;
CREATE OR REPLACE FUNCTION public.service_instant_allowed(_service_key text, _duration_minutes integer DEFAULT 60)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT public.service_instant_allowed(_service_key, _duration_minutes, public.default_city_id()) $$;

CREATE OR REPLACE FUNCTION public.service_slot_allowed(_service_key text, _date date, _slot text, _duration_minutes integer, _city_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
declare st jsonb; f record; start_at timestamptz; end_at timestamptz;
  ldate date; ldow int; hr record; start_t time; end_t time; _first int; _last int; _h int;
  _cid uuid := COALESCE(_city_id, public.default_city_id());
begin
  st := public.service_effective_state(_service_key, public.city_name_of(_cid), now());
  if (st->>'status') <> 'live' then
    return jsonb_build_object('ok', false, 'reason_code', st->>'reason_code', 'next_open_at', st->>'next_open_at', 'resume_at', st->>'resume_at');
  end if;
  start_at := public.slot_start_ist(_date, _slot);
  if start_at is null and not public.instant_booking_enabled(_service_key, _cid) then
    return jsonb_build_object('ok', false, 'reason_code', 'instant_paused',
      'message', 'Instant bookings are currently full due to high demand. Please pick a scheduled slot.');
  end if;
  if start_at is not null and public.slot_is_fully_booked(_service_key, _date, _slot, _duration_minutes, _cid) then
    return jsonb_build_object('ok', false, 'reason_code', 'slot_full', 'message', 'This slot is fully booked. Please select another slot.');
  end if;
  if start_at is not null then
    _first := public.city_ops_num(_cid,'slot_first_start_hour', 10)::int;
    _last  := public.city_ops_num(_cid,'slot_last_start_hour', 18)::int;
    _h := extract(hour from (start_at at time zone 'Asia/Kolkata'))::int;
    if _h < _first or _h > _last then
      return jsonb_build_object('ok', false, 'reason_code', 'outside_slot_window', 'first_hour', _first, 'last_hour', _last);
    end if;
  end if;
  select * into f from public.service_flags where service_key = _service_key and city_id = _cid order by created_at limit 1;
  if not found or not coalesce(f.hours_enabled, false) then return jsonb_build_object('ok', true, 'reason_code', 'live'); end if;
  if start_at is null then start_at := now(); end if;
  end_at := start_at + make_interval(mins => greatest(coalesce(_duration_minutes, 60), 1));
  if start_at < now() - interval '10 minutes' then return jsonb_build_object('ok', false, 'reason_code', 'slot_passed'); end if;
  ldate := (start_at at time zone 'Asia/Kolkata')::date;
  ldow := extract(dow from (start_at at time zone 'Asia/Kolkata'))::int;
  start_t := (start_at at time zone 'Asia/Kolkata')::time; end_t := (end_at at time zone 'Asia/Kolkata')::time;
  if exists (select 1 from public.service_holidays h where (h.service_flag_id = f.id or h.service_flag_id is null)
               and ldate between h.start_date and coalesce(h.end_date, h.start_date)) then
    return jsonb_build_object('ok', false, 'reason_code', 'holiday', 'next_open_at', public.service_next_open(f.id, start_at));
  end if;
  if f.closed_today_date = ldate and (f.closed_until is null or f.closed_until > start_at) then
    return jsonb_build_object('ok', false, 'reason_code', 'closed_today', 'next_open_at', coalesce(f.closed_until, public.service_next_open(f.id, start_at)));
  end if;
  select * into hr from public.service_hours where service_flag_id = f.id and weekday = ldow;
  if not found then return jsonb_build_object('ok', true, 'reason_code', 'live'); end if;
  if hr.is_closed then
    return jsonb_build_object('ok', false, 'reason_code', 'weekly_off', 'next_open_at', public.service_next_open(f.id, start_at));
  end if;
  if start_t < hr.open_time or end_t > hr.close_time then
    return jsonb_build_object('ok', false, 'reason_code', 'outside_hours', 'open_time', hr.open_time, 'close_time', hr.close_time,
      'next_open_at', public.service_next_open(f.id, start_at));
  end if;
  return jsonb_build_object('ok', true, 'reason_code', 'live');
end $$;
CREATE OR REPLACE FUNCTION public.service_slot_allowed(_service_key text, _date date, _slot text, _duration_minutes integer DEFAULT 60)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT public.service_slot_allowed(_service_key, _date, _slot, _duration_minutes, public.default_city_id()) $$;

-- booking triggers: use the booking's own city
CREATE OR REPLACE FUNCTION public.bookings_check_slot_capacity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _bypass text; _paid text; _g text;
BEGIN
  begin _bypass := current_setting('app.booking_bypass', true); exception when others then _bypass := null; end;
  begin _paid := current_setting('app.booking_paid_recovery', true); exception when others then _paid := null; end;
  IF _bypass = 'on' OR _paid = 'on' THEN RETURN NEW; END IF;
  _g := public.booking_capacity_group(NEW.service_category_id, NEW.service_label);
  IF coalesce(NEW.slot_type,'now') = 'now' THEN
    IF NOT public.instant_booking_enabled(_g, NEW.city_id) THEN
      RAISE EXCEPTION 'Instant bookings are currently full due to high demand. Please pick a scheduled slot.' USING errcode='check_violation';
    END IF;
  ELSIF NEW.scheduled_date IS NOT NULL AND public.slot_is_fully_booked(_g, NEW.scheduled_date, NEW.scheduled_time_slot, NEW.service_duration_minutes, NEW.city_id) THEN
    RAISE EXCEPTION 'This slot is now fully booked. Please select another slot.' USING errcode='check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.bookings_check_service_flag()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _active boolean; _g text;
begin
  if coalesce(NEW.is_training, false) then return NEW; end if;
  _g := CASE WHEN public.booking_capacity_group(NEW.service_category_id, NEW.service_label)='wash' THEN 'wash' ELSE 'clean' END;
  select is_active into _active from public.service_flags where service_key = _g and city_id = COALESCE(NEW.city_id, public.default_city_id());
  if _active is not null and _active = false then
    raise exception 'This service is currently unavailable in %', public.city_name_of(NEW.city_id) using errcode = 'check_violation';
  end if;
  return NEW;
end $$;

-- patch bookings_before_insert call to pass the booking city
DO $$ DECLARE d text; BEGIN
  SELECT pg_get_functiondef('public.bookings_before_insert()'::regprocedure) INTO d;
  d := replace(d, 'NEW.scheduled_date, NEW.scheduled_time_slot, _duration);', 'NEW.scheduled_date, NEW.scheduled_time_slot, _duration, NEW.city_id);');
  IF position('_duration, NEW.city_id)' in d) = 0 THEN RAISE EXCEPTION 'bookings_before_insert patch failed'; END IF;
  EXECUTE d;
END $$;

-- staff slot tools, per city
CREATE OR REPLACE FUNCTION public.staff_slot_band_summary(_service_key text, _date date, _city_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _g text := CASE WHEN _service_key='wash' THEN 'wash' ELSE 'clean' END;
  _cid uuid := COALESCE(_city_id, public.default_city_id());
  _me int := public.city_ops_num(_cid, _g || '_band_morning_end',660)::int;
  _de int := public.city_ops_num(_cid, _g || '_band_day_end',960)::int;
  _first int := public.city_ops_num(_cid,'slot_first_start_hour',10)::int*60;
  _last int := public.city_ops_num(_cid,'slot_last_start_hour',18)::int*60;
  _o record; _res jsonb := '[]'::jsonb; _b text; _s int; _e int; _cap int; _booked int; _full boolean;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager','area_partner']) OR NOT public.staff_can_city(_cid) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT * INTO _o FROM public.service_daily_capacity WHERE service_key=_g AND cap_date=_date AND city_id=_cid;
  FOREACH _b IN ARRAY ARRAY['morning','day','evening'] LOOP
    _s := CASE _b WHEN 'morning' THEN 0 WHEN 'day' THEN _me ELSE _de END;
    _e := CASE _b WHEN 'morning' THEN _me WHEN 'day' THEN _de ELSE 1440 END;
    _cap := public.slot_band_capacity(_g, _date, _s, _cid);
    SELECT count(*) INTO _booked FROM public.bookings bk
     WHERE bk.status <> 'cancelled' AND bk.scheduled_date=_date AND bk.city_id=_cid
       AND public.booking_capacity_group(bk.service_category_id, bk.service_label)=_g
       AND (extract(hour from (public.slot_start_ist(bk.scheduled_date, bk.scheduled_time_slot) AT TIME ZONE 'Asia/Kolkata'))*60
            + extract(minute from (public.slot_start_ist(bk.scheduled_date, bk.scheduled_time_slot) AT TIME ZONE 'Asia/Kolkata'))) >= _s
       AND (extract(hour from (public.slot_start_ist(bk.scheduled_date, bk.scheduled_time_slot) AT TIME ZONE 'Asia/Kolkata'))*60
            + extract(minute from (public.slot_start_ist(bk.scheduled_date, bk.scheduled_time_slot) AT TIME ZONE 'Asia/Kolkata'))) < _e;
    SELECT NOT EXISTS (SELECT 1 FROM generate_series(greatest(_s,_first), least(_e-30,_last), 30) g
                        LEFT JOIN public.slot_busy_by_half(_g,_date,_cid) x ON x.start_min=g
                        WHERE coalesce(x.busy,0) < _cap)
           AND greatest(_s,_first) <= least(_e-30,_last) INTO _full;
    _res := _res || jsonb_build_object('band',_b,'start_min',_s,'end_min',_e,'capacity',_cap,'booked',_booked,'full',coalesce(_full,false),
      'override', CASE _b WHEN 'morning' THEN _o.morning_cap WHEN 'day' THEN _o.day_cap ELSE _o.evening_cap END);
  END LOOP;
  RETURN jsonb_build_object('bands',_res,'default_cap',public.slot_capacity_for(_g,_date,_cid),'morning_end',_me,'day_end',_de);
END $$;
CREATE OR REPLACE FUNCTION public.staff_slot_band_summary(_service_key text, _date date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT public.staff_slot_band_summary(_service_key, _date, public.default_city_id()) $$;

CREATE OR REPLACE FUNCTION public.staff_set_band_capacity(_service_key text, _date date, _morning integer, _day integer, _evening integer, _city_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _g text := CASE WHEN _service_key='wash' THEN 'wash' ELSE 'clean' END;
BEGIN
  IF _uid IS NULL OR NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) OR _city_id IS NULL OR NOT public.staff_can_city(_city_id) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF (_morning IS NOT NULL AND (_morning<0 OR _morning>500)) OR (_day IS NOT NULL AND (_day<0 OR _day>500)) OR (_evening IS NOT NULL AND (_evening<0 OR _evening>500)) THEN
    RAISE EXCEPTION 'Count must be between 0 and 500';
  END IF;
  IF _morning IS NULL AND _day IS NULL AND _evening IS NULL THEN
    DELETE FROM public.service_daily_capacity WHERE service_key=_g AND cap_date=_date AND city_id=_city_id;
  ELSE
    INSERT INTO public.service_daily_capacity(city_id, service_key, cap_date, capacity, morning_cap, day_cap, evening_cap, updated_by)
    VALUES (_city_id, _g, _date, greatest(coalesce(_morning,0),coalesce(_day,0),coalesce(_evening,0)), _morning, _day, _evening, _uid)
    ON CONFLICT (city_id, service_key, cap_date) DO UPDATE SET capacity=excluded.capacity, morning_cap=excluded.morning_cap,
      day_cap=excluded.day_cap, evening_cap=excluded.evening_cap, updated_by=_uid, updated_at=now();
  END IF;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'band_capacity_set', 'service_daily_capacity', _city_id, NULL,
    jsonb_build_object('group',_g,'date',_date,'morning',_morning,'day',_day,'evening',_evening,'city_id',_city_id));
END $$;
DROP FUNCTION IF EXISTS public.staff_set_band_capacity(text, date, integer, integer, integer);
DROP FUNCTION IF EXISTS public.staff_set_daily_capacity(date, integer, text);

CREATE OR REPLACE FUNCTION public.staff_set_slot_full(_date date, _start_hour integer, _full boolean, _reason text, _service_key text, _start_minute integer, _city_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _g text := CASE WHEN _service_key='wash' THEN 'wash' ELSE 'clean' END;
BEGIN
  IF _uid IS NULL OR NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) OR _city_id IS NULL OR NOT public.staff_can_city(_city_id) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _start_hour < 0 OR _start_hour > 23 OR _start_minute NOT IN (0,30) THEN RAISE EXCEPTION 'Invalid slot'; END IF;
  IF _full THEN
    INSERT INTO public.service_slot_overrides(city_id, service_key, slot_date, start_hour, start_minute, status, reason, created_by)
    VALUES (_city_id, _g, _date, _start_hour, _start_minute, 'fully_booked', _reason, _uid)
    ON CONFLICT (city_id, service_key, slot_date, start_hour, start_minute) DO UPDATE SET status='fully_booked', reason=excluded.reason, created_by=_uid, created_at=now();
  ELSE
    DELETE FROM public.service_slot_overrides WHERE city_id=_city_id AND service_key=_g AND slot_date=_date AND start_hour=_start_hour AND start_minute=_start_minute;
  END IF;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, CASE WHEN _full THEN 'slot_marked_full' ELSE 'slot_reopened' END, 'service_slot_overrides', _city_id, NULL,
    jsonb_build_object('date',_date,'start_hour',_start_hour,'start_minute',_start_minute,'reason',_reason,'service_key',_g,'city_id',_city_id));
END $$;
DROP FUNCTION IF EXISTS public.staff_set_slot_full(date, integer, boolean, text, text, integer);

-- grants
REVOKE ALL ON FUNCTION public.city_ops_num(uuid,text,numeric), public.city_ops_text(uuid,text,text), public.slot_step(uuid),
  public.instant_free_expert_count(uuid), public.instant_booking_enabled(text,uuid), public.slot_band_of(text,integer,uuid),
  public.slot_capacity_for(text,date,uuid), public.slot_band_capacity(text,date,integer,uuid), public.slot_busy_by_half(text,date,uuid),
  public.slot_is_fully_booked(text,date,text,integer,uuid), public.city_name_of(uuid),
  public.service_instant_allowed(text,integer,uuid), public.service_slot_allowed(text,date,text,integer,uuid),
  public.staff_slot_band_summary(text,date,uuid), public.staff_set_band_capacity(text,date,integer,integer,integer,uuid),
  public.staff_set_slot_full(date,integer,boolean,text,text,integer,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.city_ops_num(uuid,text,numeric), public.city_ops_text(uuid,text,text), public.slot_step(uuid),
  public.instant_free_expert_count(uuid), public.instant_booking_enabled(text,uuid), public.slot_band_of(text,integer,uuid),
  public.slot_capacity_for(text,date,uuid), public.slot_band_capacity(text,date,integer,uuid), public.slot_busy_by_half(text,date,uuid),
  public.slot_is_fully_booked(text,date,text,integer,uuid), public.city_name_of(uuid) TO authenticated, service_role, cc_reader;
GRANT EXECUTE ON FUNCTION public.list_fully_booked_slots(text,date,date,uuid) TO anon, authenticated, service_role, cc_reader;
GRANT EXECUTE ON FUNCTION public.service_instant_allowed(text,integer,uuid), public.service_slot_allowed(text,date,text,integer,uuid),
  public.staff_slot_band_summary(text,date,uuid), public.staff_set_band_capacity(text,date,integer,integer,integer,uuid),
  public.staff_set_slot_full(date,integer,boolean,text,text,integer,uuid) TO authenticated, service_role, cc_reader;

-- retire the shared copy: stop mirroring and remove the shared rows
DROP TRIGGER IF EXISTS city_ops_mirror ON public.city_ops_settings;
DELETE FROM public.ops_settings WHERE key = ANY(public.city_ops_keys());
