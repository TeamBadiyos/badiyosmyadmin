INSERT INTO public.service_flags (service_key, city, label, is_active, status, hours_enabled, last_order_buffer_minutes, sort_order)
SELECT 'wash', city, 'badiyos Clean Auto', is_active, status, hours_enabled, last_order_buffer_minutes, 1
FROM public.service_flags WHERE service_key='clean' AND NOT EXISTS (SELECT 1 FROM public.service_flags WHERE service_key='wash');

INSERT INTO public.service_hours (service_flag_id, weekday, open_time, close_time, is_closed)
SELECT w.id, h.weekday, h.open_time, h.close_time, h.is_closed
FROM public.service_hours h
JOIN public.service_flags c ON c.id=h.service_flag_id AND c.service_key='clean'
JOIN public.service_flags w ON w.service_key='wash' AND w.city=c.city
WHERE NOT EXISTS (SELECT 1 FROM public.service_hours x WHERE x.service_flag_id=w.id AND x.weekday=h.weekday);

INSERT INTO public.ops_settings (key, value, label)
VALUES ('wash_instant_booking_enabled','1','Clean Auto: Book Now')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.instant_booking_enabled(_g text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN _g='wash'
    THEN coalesce(trim(both '"' from (SELECT value::text FROM public.ops_settings WHERE key='wash_instant_booking_enabled')),'1') <> '0'
    ELSE public.instant_booking_enabled() END
$$;
REVOKE ALL ON FUNCTION public.instant_booking_enabled(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.instant_booking_enabled(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.service_slot_allowed(_service_key text, _date date, _slot text, _duration_minutes integer DEFAULT 60)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  st jsonb; f record; start_at timestamptz; end_at timestamptz;
  ldate date; ldow int; hr record; start_t time; end_t time; _first int; _last int; _h int;
begin
  st := public.service_effective_state(_service_key, null, now());
  if (st->>'status') <> 'live' then
    return jsonb_build_object('ok', false, 'reason_code', st->>'reason_code',
      'next_open_at', st->>'next_open_at', 'resume_at', st->>'resume_at');
  end if;
  start_at := public.slot_start_ist(_date, _slot);
  if start_at is null and not public.instant_booking_enabled(_service_key) then
    return jsonb_build_object('ok', false, 'reason_code', 'instant_paused',
      'message', 'Instant bookings are currently full due to high demand. Please pick a scheduled slot.');
  end if;
  if start_at is not null and public.slot_is_fully_booked(_service_key, _date, _slot, _duration_minutes) then
    return jsonb_build_object('ok', false, 'reason_code', 'slot_full',
      'message', 'This slot is fully booked. Please select another slot.');
  end if;
  if start_at is not null then
    _first := public.get_ops_num('slot_first_start_hour', 10)::int;
    _last  := public.get_ops_num('slot_last_start_hour', 18)::int;
    _h := extract(hour from (start_at at time zone 'Asia/Kolkata'))::int;
    if _h < _first or _h > _last then
      return jsonb_build_object('ok', false, 'reason_code', 'outside_slot_window', 'first_hour', _first, 'last_hour', _last);
    end if;
  end if;
  select * into f from public.service_flags where service_key = _service_key and city = 'Latur' order by created_at limit 1;
  if not found or not coalesce(f.hours_enabled, false) then
    return jsonb_build_object('ok', true, 'reason_code', 'live');
  end if;
  if start_at is null then start_at := now(); end if;
  end_at := start_at + make_interval(mins => greatest(coalesce(_duration_minutes, 60), 1));
  if start_at < now() - interval '10 minutes' then
    return jsonb_build_object('ok', false, 'reason_code', 'slot_passed');
  end if;
  ldate := (start_at at time zone 'Asia/Kolkata')::date;
  ldow := extract(dow from (start_at at time zone 'Asia/Kolkata'))::int;
  start_t := (start_at at time zone 'Asia/Kolkata')::time;
  end_t := (end_at at time zone 'Asia/Kolkata')::time;
  if exists (select 1 from public.service_holidays h where (h.service_flag_id = f.id or h.service_flag_id is null)
               and ldate between h.start_date and coalesce(h.end_date, h.start_date)) then
    return jsonb_build_object('ok', false, 'reason_code', 'holiday', 'next_open_at', public.service_next_open(f.id, start_at));
  end if;
  if f.closed_today_date = ldate and (f.closed_until is null or f.closed_until > start_at) then
    return jsonb_build_object('ok', false, 'reason_code', 'closed_today',
      'next_open_at', coalesce(f.closed_until, public.service_next_open(f.id, start_at)));
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

CREATE OR REPLACE FUNCTION public.bookings_check_slot_capacity()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _bypass text; _paid text; _g text;
BEGIN
  begin _bypass := current_setting('app.booking_bypass', true); exception when others then _bypass := null; end;
  begin _paid := current_setting('app.booking_paid_recovery', true); exception when others then _paid := null; end;
  IF _bypass = 'on' OR _paid = 'on' THEN RETURN NEW; END IF;
  _g := public.booking_capacity_group(NEW.service_category_id, NEW.service_label);
  IF coalesce(NEW.slot_type,'now') = 'now' THEN
    IF NOT public.instant_booking_enabled(_g) THEN
      RAISE EXCEPTION 'Instant bookings are currently full due to high demand. Please pick a scheduled slot.' USING errcode='check_violation';
    END IF;
  ELSIF NEW.scheduled_date IS NOT NULL AND public.slot_is_fully_booked(_g, NEW.scheduled_date, NEW.scheduled_time_slot, NEW.service_duration_minutes) THEN
    RAISE EXCEPTION 'This slot is now fully booked. Please select another slot.' USING errcode='check_violation';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.bookings_check_service_flag()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _city text; _active boolean; _g text;
begin
  if coalesce(NEW.is_training, false) then return NEW; end if;
  select coalesce(z.city, a.city) into _city from public.addresses a left join public.zones z on z.id = NEW.zone_id where a.id = NEW.address_id;
  if _city is null then select city into _city from public.zones where id = NEW.zone_id; end if;
  if _city is null then return NEW; end if;
  _g := CASE WHEN public.booking_capacity_group(NEW.service_category_id, NEW.service_label)='wash' THEN 'wash' ELSE 'clean' END;
  select is_active into _active from public.service_flags where service_key = _g and lower(city) = lower(_city);
  if _active is not null and _active = false then
    raise exception 'This service is currently unavailable in %', _city using errcode = 'check_violation';
  end if;
  return NEW;
end $function$;

DO $$
DECLARE _src text;
BEGIN
  _src := pg_get_functiondef('public.bookings_before_insert'::regproc);
  _src := replace(_src, $x$public.service_slot_allowed('clean', NEW.scheduled_date$x$,
    $x$public.service_slot_allowed(CASE WHEN public.booking_capacity_group(coalesce(NEW.service_category_id,_spo.category_id), NEW.service_label)='wash' THEN 'wash' ELSE 'clean' END, NEW.scheduled_date$x$);
  IF position('booking_capacity_group' in _src)=0 THEN RAISE EXCEPTION 'patch failed'; END IF;
  EXECUTE _src;
END $$;