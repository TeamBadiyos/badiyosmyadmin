-- 1. Capacity groups: 'clean' = Maid, 'wash' = Car/Bike Wash
CREATE OR REPLACE FUNCTION public.booking_capacity_group(_category_id uuid, _label text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public.service_categories sc WHERE sc.slug='car-bike-wash' AND (
      sc.id = _category_id OR (_category_id IS NULL AND EXISTS (
        SELECT 1 FROM public.service_price_options spo JOIN public.services sv ON sv.id=spo.service_id
         WHERE sv.category_id=sc.id AND lower(spo.label)=lower(coalesce(_label,'')))))
  ) THEN 'wash' ELSE 'clean' END
$$;
GRANT EXECUTE ON FUNCTION public.booking_capacity_group(uuid,text) TO authenticated, anon;

-- 2. Weekday defaults per group
CREATE TABLE IF NOT EXISTS public.slot_capacity_weekday (
  service_key text NOT NULL CHECK (service_key IN ('clean','wash')),
  weekday int NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  capacity int NOT NULL CHECK (capacity BETWEEN 0 AND 500),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (service_key, weekday)
);
GRANT SELECT ON public.slot_capacity_weekday TO authenticated;
GRANT ALL ON public.slot_capacity_weekday TO service_role;
ALTER TABLE public.slot_capacity_weekday ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read weekday capacity" ON public.slot_capacity_weekday FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

ALTER TABLE public.service_daily_capacity DROP CONSTRAINT IF EXISTS service_daily_capacity_group_chk;
ALTER TABLE public.service_daily_capacity ADD CONSTRAINT service_daily_capacity_group_chk CHECK (service_key IN ('clean','wash'));

CREATE OR REPLACE FUNCTION public.staff_set_weekday_capacity(_service_key text, _weekday int, _capacity int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _service_key NOT IN ('clean','wash') THEN RAISE EXCEPTION 'Invalid group'; END IF;
  IF _capacity IS NULL THEN
    DELETE FROM public.slot_capacity_weekday WHERE service_key=_service_key AND weekday=_weekday;
  ELSE
    INSERT INTO public.slot_capacity_weekday(service_key, weekday, capacity, updated_by)
    VALUES (_service_key, _weekday, _capacity, auth.uid())
    ON CONFLICT (service_key, weekday) DO UPDATE SET capacity=EXCLUDED.capacity, updated_by=EXCLUDED.updated_by, updated_at=now();
  END IF;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, after_state)
  VALUES (auth.uid(), 'slot_weekday_capacity_set', 'slot_capacity_weekday', NULL,
          jsonb_build_object('group',_service_key,'weekday',_weekday,'capacity',_capacity));
END $$;
REVOKE ALL ON FUNCTION public.staff_set_weekday_capacity(text,int,int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_set_weekday_capacity(text,int,int) TO authenticated;

-- date override > weekday default > global default
CREATE OR REPLACE FUNCTION public.slot_capacity_for(_service_key text, _date date)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE _mode text; _c int; _g text := CASE WHEN _service_key='wash' THEN 'wash' ELSE 'clean' END;
BEGIN
  SELECT value INTO _mode FROM public.ops_settings WHERE key='slot_capacity_mode';
  IF _g='clean' AND coalesce(_mode,'manual')='live' AND _date=(now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    SELECT count(*) INTO _c FROM public.experts WHERE status='active' AND coalesce(is_online,false);
    RETURN _c;
  END IF;
  SELECT capacity INTO _c FROM public.service_daily_capacity WHERE service_key=_g AND cap_date=_date;
  IF FOUND THEN RETURN _c; END IF;
  SELECT capacity INTO _c FROM public.slot_capacity_weekday WHERE service_key=_g AND weekday=extract(dow from _date)::int;
  IF FOUND THEN RETURN _c; END IF;
  RETURN coalesce(public.get_ops_num('default_slot_capacity', 5)::int, 5);
END $$;

-- busy count only for bookings in the same group
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
       AND public.booking_capacity_group(service_category_id, service_label) = CASE WHEN _service_key='wash' THEN 'wash' ELSE 'clean' END
  )
  SELECT m, count(*)::int FROM b, generate_series(0, 1410, 30) m
   WHERE (s AT TIME ZONE 'Asia/Kolkata')::date = _date
     AND (_date + make_interval(mins => m)) < ((s AT TIME ZONE 'Asia/Kolkata') + make_interval(mins => dur))
     AND (_date + make_interval(mins => m + 30)) > (s AT TIME ZONE 'Asia/Kolkata')
   GROUP BY m
$$;

CREATE OR REPLACE FUNCTION public.bookings_check_slot_capacity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
declare _bypass text; _paid text;
BEGIN
  begin _bypass := current_setting('app.booking_bypass', true); exception when others then _bypass := null; end;
  begin _paid := current_setting('app.booking_paid_recovery', true); exception when others then _paid := null; end;
  IF _bypass = 'on' OR _paid = 'on' THEN RETURN NEW; END IF;
  IF coalesce(NEW.slot_type,'now') = 'now' THEN
    IF NOT public.instant_booking_enabled() THEN
      RAISE EXCEPTION 'Instant bookings are currently full due to high demand. Please pick a scheduled slot.' USING errcode='check_violation';
    END IF;
  ELSIF NEW.scheduled_date IS NOT NULL AND public.slot_is_fully_booked(
          public.booking_capacity_group(NEW.service_category_id, NEW.service_label),
          NEW.scheduled_date, NEW.scheduled_time_slot, NEW.service_duration_minutes) THEN
    RAISE EXCEPTION 'This slot is now fully booked. Please select another slot.' USING errcode='check_violation';
  END IF;
  RETURN NEW;
END $$;

-- 3. Delivery riders = same rule as dispatch: active expert with an approved skill required by an active courier vehicle
CREATE OR REPLACE FUNCTION public.is_delivery_rider(_expert_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM public.partner_skills ps JOIN public.courier_vehicle_types vt ON vt.required_skill=ps.service_category_id
                  WHERE ps.expert_id=_expert_id AND ps.status='approved' AND vt.is_active)
$$;
GRANT EXECUTE ON FUNCTION public.is_delivery_rider(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rider_pool_stats()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH r AS (SELECT e.id, coalesce(e.is_busy,false) OR EXISTS (SELECT 1 FROM public.courier_orders c WHERE c.assigned_expert_id=e.id
                    AND c.status IN ('DRIVER_ASSIGNED','ARRIVED_PICKUP','PICKED_UP','IN_TRANSIT')) AS busy
               FROM public.experts e WHERE e.status='active' AND e.is_online AND public.is_delivery_rider(e.id))
  SELECT CASE WHEN public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager','area_partner'])
    THEN jsonb_build_object('online',(SELECT count(*) FROM r),'busy',(SELECT count(*) FILTER (WHERE busy) FROM r),
                            'free',(SELECT count(*) FILTER (WHERE NOT busy) FROM r)) END
$$;
REVOKE ALL ON FUNCTION public.rider_pool_stats() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rider_pool_stats() TO authenticated;

CREATE OR REPLACE FUNCTION public.experts_capacity_freed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF coalesce(NEW.is_online,false) AND NOT coalesce(NEW.is_busy,false)
     AND (coalesce(OLD.is_busy,false) OR NOT coalesce(OLD.is_online,false))
     AND public.is_delivery_rider(NEW.id)
     AND EXISTS (SELECT 1 FROM public.notify_requests WHERE status='waiting' AND service_type IN ('store','food','parcel')) THEN
    PERFORM public.notify_capacity_available('store');
    PERFORM public.notify_capacity_available('food');
    PERFORM public.notify_capacity_available('parcel');
  END IF;
  RETURN NEW;
END $$;

-- 4. Notify-me readable by ops_manager too
DROP POLICY IF EXISTS "nr_read" ON public.notify_requests;
CREATE POLICY "nr_read" ON public.notify_requests FOR SELECT TO authenticated
  USING (customer_id = auth.uid() OR public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));