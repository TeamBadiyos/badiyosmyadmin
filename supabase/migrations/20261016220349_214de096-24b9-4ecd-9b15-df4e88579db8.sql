
-- New per-city keys: auto-cancel (already used) + last slot before closing
CREATE OR REPLACE FUNCTION public.city_ops_keys()
 RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT ARRAY['slot_capacity_enabled','slot_capacity_mode','default_slot_capacity','wash_default_slot_capacity',
    'clean_band_morning_end','clean_band_day_end','wash_band_morning_end','wash_band_day_end',
    'slot_first_start_hour','slot_last_start_hour','slot_step_minutes',
    'instant_booking_enabled','wash_instant_booking_enabled',
    'clean_auto_cancel_minutes','wash_auto_cancel_minutes',
    'clean_last_slot_before_close_minutes','wash_last_slot_before_close_minutes'] $$;

-- Slot window for a service/city/date, derived from opening hours.
CREATE OR REPLACE FUNCTION public.slot_window(_g text, _cid uuid, _date date)
 RETURNS TABLE(first_min int, last_min int)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _k text := CASE WHEN _g IN ('wash','clean_auto') THEN 'wash' ELSE 'clean' END;
  _c uuid := COALESCE(_cid, public.default_city_id()); hr record; _gap int;
BEGIN
  _gap := public.city_ops_num(_c, _k || '_last_slot_before_close_minutes', 60)::int;
  SELECT h.open_time, h.close_time, h.is_closed INTO hr
    FROM public.service_flags f JOIN public.service_hours h ON h.service_flag_id=f.id
   WHERE f.service_key=_k AND f.city_id=_c AND h.weekday=extract(dow from _date)::int
   ORDER BY f.created_at LIMIT 1;
  IF FOUND AND NOT hr.is_closed THEN
    first_min := extract(hour from hr.open_time)::int*60 + extract(minute from hr.open_time)::int;
    last_min := extract(hour from hr.close_time)::int*60 + extract(minute from hr.close_time)::int - _gap;
  ELSE
    first_min := public.city_ops_num(_c,'slot_first_start_hour',10)::int*60;
    last_min := public.city_ops_num(_c,'slot_last_start_hour',18)::int*60;
  END IF;
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION public.slot_window(text,uuid,date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.slot_window(text,uuid,date) TO authenticated, service_role;

-- Seed: keep today's last slot (closing 7 PM, last slot 6 PM => 60 min)
INSERT INTO public.city_ops_settings (city_id, key, value, updated_at)
SELECT c.id, k, '60', now() FROM public.cities c,
  unnest(ARRAY['clean_last_slot_before_close_minutes','wash_last_slot_before_close_minutes']) k
ON CONFLICT (city_id, key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.list_fully_booked_slots(_service_key text, _from date, _to date, _city_id uuid)
 RETURNS TABLE(slot_date date, start_hour integer, start_minute integer)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE d date; _first int; _last int; _step int; _g text := CASE WHEN _service_key='wash' THEN 'wash' ELSE 'clean' END; _cid uuid := COALESCE(_city_id, public.default_city_id());
BEGIN
  RETURN QUERY SELECT o.slot_date, o.start_hour, o.start_minute FROM public.service_slot_overrides o
   WHERE o.service_key=_g AND o.city_id=_cid AND o.status='fully_booked' AND o.slot_date BETWEEN _from AND _to;
  IF public.city_ops_text(_cid,'slot_capacity_enabled','0') <> '1' THEN RETURN; END IF;
  IF _to - _from > 31 THEN _to := _from + 31; END IF;
  _step := public.slot_step(_cid);
  d := _from;
  WHILE d <= _to LOOP
    SELECT w.first_min, w.last_min INTO _first, _last FROM public.slot_window(_g, _cid, d) w;
    RETURN QUERY SELECT d, (g/60)::int, (g%60)::int FROM generate_series(_first,_last,_step) g
      WHERE EXISTS (SELECT 1 FROM public.slot_busy_by_half(_g, d, _cid) b WHERE b.start_min >= g AND b.start_min < g+_step
                      AND b.busy >= public.slot_band_capacity(_g, d, b.start_min, _cid))
        AND NOT EXISTS (SELECT 1 FROM public.service_slot_overrides o WHERE o.service_key=_g AND o.city_id=_cid AND o.slot_date=d AND o.start_hour*60+o.start_minute=g AND o.status='fully_booked');
    d := d + 1;
  END LOOP;
END $function$;

CREATE OR REPLACE FUNCTION public.service_slot_allowed(_service_key text, _date date, _slot text, _duration_minutes integer, _city_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare st jsonb; f record; start_at timestamptz; end_at timestamptz;
  ldate date; ldow int; hr record; start_t time; end_t time; _first int; _last int; _m int;
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
    select w.first_min, w.last_min into _first, _last from public.slot_window(_service_key, _cid, (start_at at time zone 'Asia/Kolkata')::date) w;
    _m := extract(hour from (start_at at time zone 'Asia/Kolkata'))::int*60 + extract(minute from (start_at at time zone 'Asia/Kolkata'))::int;
    if _m < _first or _m > _last then
      return jsonb_build_object('ok', false, 'reason_code', 'outside_slot_window', 'first_hour', _first/60, 'last_hour', _last/60, 'first_min', _first, 'last_min', _last);
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
end $function$;

CREATE OR REPLACE FUNCTION public.staff_slot_band_summary(_service_key text, _date date, _city_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _g text := CASE WHEN _service_key='wash' THEN 'wash' ELSE 'clean' END;
  _cid uuid := COALESCE(_city_id, public.default_city_id());
  _me int := public.city_ops_num(_cid, _g || '_band_morning_end',660)::int;
  _de int := public.city_ops_num(_cid, _g || '_band_day_end',960)::int;
  _first int; _last int;
  _o record; _res jsonb := '[]'::jsonb; _b text; _s int; _e int; _cap int; _booked int; _full boolean;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager','area_partner']) OR NOT public.staff_can_city(_cid) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT w.first_min, w.last_min INTO _first, _last FROM public.slot_window(_g, _cid, _date) w;
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
END $function$;

-- Public hours: additive field so the app can compute the last slot
CREATE OR REPLACE FUNCTION public.app_service_hours(_service_key text, _city_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare f record; cname text; _c uuid := coalesce(_city_id,(select id from cities where is_default limit 1)); begin
  perform app_svc_key(_service_key);
  select name into cname from cities where id=_c;
  select * into f from service_flags where service_key=_service_key and city_id=_c;
  return jsonb_build_object('service_key',_service_key,'city_id',_city_id,
    'state', service_effective_state(_service_key, cname),
    'hours_enabled', f.hours_enabled,
    'last_slot_before_close_minutes', public.city_ops_num(_c, (CASE WHEN _service_key='wash' THEN 'wash' ELSE 'clean' END) || '_last_slot_before_close_minutes', 60)::int,
    'hours', coalesce((select jsonb_agg(jsonb_build_object('weekday',weekday,'open',open_time,'close',close_time,'closed',is_closed) order by weekday) from service_hours where service_flag_id=f.id),'[]'),
    'holidays', coalesce((select jsonb_agg(jsonb_build_object('start',start_date,'end',end_date,'reason',reason,'reason_mr',reason_mr) order by start_date) from service_holidays where service_flag_id=f.id and end_date>=current_date),'[]'));
end $function$;
