CREATE TABLE public.service_slot_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_key text NOT NULL DEFAULT 'clean',
  slot_date date NOT NULL,
  start_hour int NOT NULL,
  status text NOT NULL DEFAULT 'fully_booked',
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_key, slot_date, start_hour)
);
GRANT SELECT ON public.service_slot_overrides TO anon, authenticated;
GRANT ALL ON public.service_slot_overrides TO service_role;
ALTER TABLE public.service_slot_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read slot overrides" ON public.service_slot_overrides FOR SELECT USING (true);

INSERT INTO public.ops_settings(key, value, label) VALUES ('instant_booking_enabled','1','Instant / Book Now bookings enabled')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.slot_is_fully_booked(_service_key text, _date date, _slot text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.service_slot_overrides o
    WHERE o.service_key = coalesce(_service_key,'clean') AND o.slot_date = _date AND o.status = 'fully_booked'
      AND o.start_hour = extract(hour from (public.slot_start_ist(_date, _slot) at time zone 'Asia/Kolkata'))::int)
$$;

CREATE OR REPLACE FUNCTION public.instant_booking_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT value FROM public.ops_settings WHERE key='instant_booking_enabled'),'1') <> '0'
$$;
GRANT EXECUTE ON FUNCTION public.slot_is_fully_booked(text,date,text), public.instant_booking_enabled() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_fully_booked_slots(_service_key text, _from date, _to date)
RETURNS TABLE(slot_date date, start_hour int) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT slot_date, start_hour FROM public.service_slot_overrides
   WHERE service_key = coalesce(_service_key,'clean') AND status='fully_booked' AND slot_date BETWEEN _from AND _to
$$;
GRANT EXECUTE ON FUNCTION public.list_fully_booked_slots(text,date,date) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.staff_set_slot_full(_date date, _start_hour int, _full boolean, _reason text DEFAULT NULL, _service_key text DEFAULT 'clean')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _start_hour < 0 OR _start_hour > 23 THEN RAISE EXCEPTION 'Invalid slot'; END IF;
  IF _full THEN
    INSERT INTO public.service_slot_overrides(service_key, slot_date, start_hour, status, reason, created_by)
    VALUES (_service_key, _date, _start_hour, 'fully_booked', _reason, _uid)
    ON CONFLICT (service_key, slot_date, start_hour) DO UPDATE SET status='fully_booked', reason=excluded.reason, created_by=_uid, created_at=now();
  ELSE
    DELETE FROM public.service_slot_overrides WHERE service_key=_service_key AND slot_date=_date AND start_hour=_start_hour;
  END IF;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, CASE WHEN _full THEN 'slot_marked_full' ELSE 'slot_reopened' END, 'service_slot_overrides', NULL, NULL,
    jsonb_build_object('date', _date, 'start_hour', _start_hour, 'reason', _reason, 'service_key', _service_key));
END $$;
GRANT EXECUTE ON FUNCTION public.staff_set_slot_full(date,int,boolean,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.bookings_check_slot_capacity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF coalesce(NEW.slot_type,'now') = 'now' THEN
    IF NOT public.instant_booking_enabled() THEN
      RAISE EXCEPTION 'Instant bookings are currently full due to high demand. Please pick a scheduled slot.' USING errcode='check_violation';
    END IF;
  ELSIF NEW.scheduled_date IS NOT NULL AND public.slot_is_fully_booked('clean', NEW.scheduled_date, NEW.scheduled_time_slot) THEN
    RAISE EXCEPTION 'This slot is now fully booked. Please select another slot.' USING errcode='check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bookings_check_slot_capacity BEFORE INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.bookings_check_slot_capacity();

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

  if start_at is null and not public.instant_booking_enabled() then
    return jsonb_build_object('ok', false, 'reason_code', 'instant_paused',
      'message', 'Instant bookings are currently full due to high demand. Please pick a scheduled slot.');
  end if;
  if start_at is not null and public.slot_is_fully_booked(_service_key, _date, _slot) then
    return jsonb_build_object('ok', false, 'reason_code', 'slot_full',
      'message', 'This slot is fully booked. Please select another slot.');
  end if;

  if start_at is not null then
    _first := public.get_ops_num('slot_first_start_hour', 10)::int;
    _last  := public.get_ops_num('slot_last_start_hour', 18)::int;
    _h := extract(hour from (start_at at time zone 'Asia/Kolkata'))::int;
    if _h < _first or _h > _last then
      return jsonb_build_object('ok', false, 'reason_code', 'outside_slot_window',
        'first_hour', _first, 'last_hour', _last);
    end if;
  end if;

  select * into f from public.service_flags
   where service_key = _service_key and city = 'Latur' order by created_at limit 1;
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

  if exists (select 1 from public.service_holidays h
             where (h.service_flag_id = f.id or h.service_flag_id is null)
               and ldate between h.start_date and coalesce(h.end_date, h.start_date)) then
    return jsonb_build_object('ok', false, 'reason_code', 'holiday',
      'next_open_at', public.service_next_open(f.id, start_at));
  end if;
  if f.closed_today_date = ldate and (f.closed_until is null or f.closed_until > start_at) then
    return jsonb_build_object('ok', false, 'reason_code', 'closed_today',
      'next_open_at', coalesce(f.closed_until, public.service_next_open(f.id, start_at)));
  end if;

  select * into hr from public.service_hours where service_flag_id = f.id and weekday = ldow;
  if not found then return jsonb_build_object('ok', true, 'reason_code', 'live'); end if;
  if hr.is_closed then
    return jsonb_build_object('ok', false, 'reason_code', 'weekly_off',
      'next_open_at', public.service_next_open(f.id, start_at));
  end if;
  if start_t < hr.open_time or end_t > hr.close_time then
    return jsonb_build_object('ok', false, 'reason_code', 'outside_hours',
      'open_time', hr.open_time, 'close_time', hr.close_time,
      'next_open_at', public.service_next_open(f.id, start_at));
  end if;
  return jsonb_build_object('ok', true, 'reason_code', 'live');
end $function$;