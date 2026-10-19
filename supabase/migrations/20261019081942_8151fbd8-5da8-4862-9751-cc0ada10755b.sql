-- raw point-in-zone lookup (unchanged logic of old resolve_zone, plus city)
CREATE OR REPLACE FUNCTION public.zone_decide(_lat double precision, _lng double precision, _city uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','extensions' AS $$
DECLARE z record; _c uuid := _city; _pol text;
BEGIN
  IF _lat IS NOT NULL AND _lng IS NOT NULL THEN
    SELECT id, zone_type, travel_fee, travel_fee_services INTO z FROM public.zones
     WHERE deleted_at IS NULL AND status='active' AND is_active AND public.point_in_ring(_lat,_lng,boundary)
     ORDER BY CASE zone_type WHEN 'not_serviceable' THEN 0 ELSE 1 END, created_at DESC LIMIT 1;
    IF z.id IS NOT NULL THEN
      IF z.zone_type='not_serviceable' THEN
        RETURN jsonb_build_object('zone_id',z.id,'zone_type','not_serviceable','travel_fee',0,'travel_fee_services','[]'::jsonb,'outside_zone',false);
      END IF;
      RETURN jsonb_build_object('zone_id',z.id,'zone_type',z.zone_type,
        'travel_fee', CASE WHEN z.zone_type='outer' THEN z.travel_fee ELSE 0 END,
        'travel_fee_services', to_jsonb(z.travel_fee_services),'outside_zone',false);
    END IF;
    IF _c IS NULL THEN
      BEGIN
        SELECT cb.city_id INTO _c FROM city_boundaries cb WHERE ST_Intersects(cb.geom, ST_SetSRID(ST_MakePoint(_lng,_lat),4326)) LIMIT 1;
      EXCEPTION WHEN others THEN _c := NULL; END;
    END IF;
  END IF;
  _pol := public.outside_zone_policy(coalesce(_c, public.default_city_id()));
  IF _pol='block' THEN
    RETURN jsonb_build_object('zone_id',NULL,'zone_type','not_serviceable','travel_fee',0,'travel_fee_services','[]'::jsonb,'outside_zone',false);
  ELSIF _pol='allow_outer' THEN
    RETURN jsonb_build_object('zone_id',NULL,'zone_type','outer','travel_fee',20,'travel_fee_services','["clean","auto_care"]'::jsonb,'outside_zone',true);
  END IF;
  RETURN jsonb_build_object('zone_id',NULL,'zone_type','core','travel_fee',0,'travel_fee_services','[]'::jsonb,'outside_zone',true);
END $$;
REVOKE ALL ON FUNCTION public.zone_decide(double precision,double precision,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zone_decide(double precision,double precision,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_zone(_lat double precision, _lng double precision)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.zone_decide(_lat,_lng,NULL) $$;
GRANT EXECUTE ON FUNCTION public.resolve_zone(double precision,double precision) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bookings_travel_fee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r jsonb; _svc text; _bypass text; _zid uuid;
BEGIN
  _bypass := current_setting('app.booking_bypass', true);
  NEW.travel_fee := 0; NEW.travel_fee_gst := 0; NEW.travel_expert_share_pct := NULL; NEW.outside_zone := false;
  r := public.zone_decide(NEW.booking_lat::float8, NEW.booking_lng::float8, NEW.city_id);
  IF r->>'zone_type' = 'not_serviceable' THEN
    IF _bypass IS DISTINCT FROM 'on' AND NOT coalesce(NEW.is_training,false) THEN
      RAISE EXCEPTION 'NOT_SERVICEABLE: We don''t serve this address yet / या पत्त्यावर अजून सेवा उपलब्ध नाही' USING errcode='check_violation';
    END IF;
    RETURN NEW;
  END IF;
  NEW.outside_zone := coalesce((r->>'outside_zone')::boolean,false);
  _zid := (r->>'zone_id')::uuid;
  IF NEW.zone_id IS NULL AND _zid IS NOT NULL THEN NEW.zone_id := _zid; END IF;
  _svc := CASE WHEN public.booking_capacity_group(NEW.service_category_id, NEW.service_label)='wash' THEN 'auto_care' ELSE 'clean' END;
  IF r->>'zone_type'='outer' AND (r->'travel_fee_services') ? _svc AND NOT coalesce(NEW.is_training,false) THEN
    NEW.travel_fee := coalesce((r->>'travel_fee')::numeric,0);
    NEW.travel_fee_gst := round(NEW.travel_fee * coalesce(NEW.gst_percent,0) / 100.0, 2);
    IF _zid IS NOT NULL THEN
      SELECT expert_share_pct INTO NEW.travel_expert_share_pct FROM public.zones WHERE id=_zid;
    ELSE
      NEW.travel_expert_share_pct := 100;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.bookings_travel_fee() FROM PUBLIC, anon, authenticated;