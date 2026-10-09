DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.bookings_before_insert'::regproc);
  d := replace(d, $s$if _bypass is distinct from 'on' and not public.service_hours_bypass() then$s$,
                  $s$if _bypass is distinct from 'on' and not public.service_hours_bypass() and not coalesce(NEW.is_training, false) then$s$);
  IF position('coalesce(NEW.is_training, false) then' in d) = 0 THEN RAISE EXCEPTION 'patch target not found'; END IF;
  EXECUTE d;
END $do$;

CREATE OR REPLACE FUNCTION public.bookings_check_slot_capacity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(NEW.is_training, false) THEN RETURN NEW; END IF;
  IF coalesce(NEW.slot_type,'now') = 'now' THEN
    IF NOT public.instant_booking_enabled() THEN
      RAISE EXCEPTION 'Instant bookings are currently full due to high demand. Please pick a scheduled slot.' USING errcode='check_violation';
    END IF;
  ELSIF NEW.scheduled_date IS NOT NULL AND public.slot_is_fully_booked('clean', NEW.scheduled_date, NEW.scheduled_time_slot, NEW.service_duration_minutes) THEN
    RAISE EXCEPTION 'This slot is now fully booked. Please select another slot.' USING errcode='check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.bookings_check_service_flag()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _city text; _active boolean;
begin
  if coalesce(NEW.is_training, false) then return NEW; end if;
  select coalesce(z.city, a.city) into _city
    from public.addresses a
    left join public.zones z on z.id = NEW.zone_id
   where a.id = NEW.address_id;
  if _city is null then
    select city into _city from public.zones where id = NEW.zone_id;
  end if;
  if _city is null then return NEW; end if;
  select is_active into _active from public.service_flags
   where service_key = 'clean' and lower(city) = lower(_city);
  if _active is not null and _active = false then
    raise exception 'This service is currently unavailable in %', _city using errcode = 'check_violation';
  end if;
  return NEW;
end $function$;

REVOKE EXECUTE ON FUNCTION public.bookings_check_slot_capacity() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bookings_check_service_flag() FROM public, anon, authenticated;