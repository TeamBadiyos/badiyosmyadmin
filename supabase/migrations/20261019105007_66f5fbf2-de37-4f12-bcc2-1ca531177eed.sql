ALTER TABLE public.zones ADD COLUMN IF NOT EXISTS outer_pockets jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS outer_pocket_fee numeric NOT NULL DEFAULT 20;

CREATE OR REPLACE FUNCTION public.zone_in_pocket(_lat float8, _lng float8, _pockets jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT coalesce(bool_or(public.point_in_ring(_lat,_lng,p)),false)
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_pockets)='array' THEN _pockets ELSE '[]'::jsonb END) p $$;

CREATE OR REPLACE FUNCTION public.zone_decide(_lat double precision, _lng double precision, _city uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','extensions' AS $function$
DECLARE z record; _c uuid := _city; _pol text;
BEGIN
  IF _lat IS NOT NULL AND _lng IS NOT NULL THEN
    SELECT id, zone_type, travel_fee, travel_fee_services, outer_pockets, outer_pocket_fee INTO z FROM public.zones
     WHERE deleted_at IS NULL AND status='active' AND is_active AND public.point_in_ring(_lat,_lng,boundary)
     ORDER BY CASE zone_type WHEN 'not_serviceable' THEN 0 ELSE 1 END, created_at DESC LIMIT 1;
    IF z.id IS NOT NULL THEN
      IF z.zone_type='not_serviceable' THEN
        RETURN jsonb_build_object('zone_id',z.id,'zone_type','not_serviceable','travel_fee',0,'travel_fee_services','[]'::jsonb,'outside_zone',false);
      END IF;
      IF z.zone_type='core' AND public.zone_in_pocket(_lat,_lng,z.outer_pockets) THEN
        RETURN jsonb_build_object('zone_id',z.id,'zone_type','outer','travel_fee',z.outer_pocket_fee,
          'travel_fee_services', to_jsonb(z.travel_fee_services),'outside_zone',false,'outer_pocket',true);
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
END $function$;

CREATE OR REPLACE FUNCTION public.zv2_outer_pockets(_city uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM zv2_require(_city);
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('cell',c.id,'pockets',z.outer_pockets,'fee',z.outer_pocket_fee))
    FROM zone_draft_cells c JOIN zones z ON z.id=c.live_zone_id WHERE c.city_id=_city),'[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.staff_set_zone_outer_pockets(_cell uuid, _pockets jsonb, _fee numeric) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _zid uuid; _city uuid; _before jsonb; p jsonb;
BEGIN
  SELECT live_zone_id, city_id INTO _zid, _city FROM zone_draft_cells WHERE id=_cell;
  IF _city IS NULL THEN RAISE EXCEPTION 'Zone not found'; END IF;
  PERFORM zv2_require(_city, true);
  IF _zid IS NULL THEN RAISE EXCEPTION 'This zone is not live yet. Use "Use these zones" first.'; END IF;
  IF _fee IS NULL OR _fee < 0 OR _fee > 1000 THEN RAISE EXCEPTION 'Travel Fee must be 0–1000'; END IF;
  IF jsonb_typeof(coalesce(_pockets,'[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'Invalid pockets'; END IF;
  FOR p IN SELECT * FROM jsonb_array_elements(coalesce(_pockets,'[]'::jsonb)) LOOP
    IF jsonb_typeof(p) <> 'array' OR jsonb_array_length(p) < 3 THEN RAISE EXCEPTION 'Each outer area needs at least 3 points'; END IF;
  END LOOP;
  SELECT jsonb_build_object('outer_pockets',outer_pockets,'outer_pocket_fee',outer_pocket_fee) INTO _before FROM zones WHERE id=_zid;
  UPDATE zones SET outer_pockets=coalesce(_pockets,'[]'::jsonb), outer_pocket_fee=_fee WHERE id=_zid;
  INSERT INTO audit_logs(actor_id, action, entity_type, entity_id, before, after)
  VALUES (auth.uid(), 'zone.outer_pockets', 'zone', _zid, _before, jsonb_build_object('outer_pockets',_pockets,'outer_pocket_fee',_fee));
  RETURN jsonb_build_object('ok',true);
END $$;
GRANT EXECUTE ON FUNCTION public.zv2_outer_pockets(uuid), public.staff_set_zone_outer_pockets(uuid,jsonb,numeric) TO authenticated;