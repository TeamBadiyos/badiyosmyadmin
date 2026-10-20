CREATE OR REPLACE FUNCTION public.list_fully_booked_slots(_service_key text, _from date, _to date, _city_id uuid)
 RETURNS TABLE(slot_date date, start_hour integer, start_minute integer)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE d date; _first int; _last int; _step int; _g text := CASE WHEN _service_key IN ('wash','clean_auto') THEN 'wash' ELSE 'clean' END; _cid uuid := COALESCE(_city_id, public.default_city_id());
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
      WHERE EXISTS (SELECT 1 FROM generate_series(g, g+_step-30, 30) h
                      LEFT JOIN public.slot_busy_by_half(_g, d, _cid) b ON b.start_min = h
                     WHERE coalesce(b.busy,0) >= public.slot_band_capacity(_g, d, h, _cid))
        AND NOT EXISTS (SELECT 1 FROM public.service_slot_overrides o WHERE o.service_key=_g AND o.city_id=_cid AND o.slot_date=d AND o.start_hour*60+o.start_minute=g AND o.status='fully_booked');
    d := d + 1;
  END LOOP;
END $function$;