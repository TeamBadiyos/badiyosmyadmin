ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS outside_zone boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.outside_zone_policy(_city uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN v IN ('allow','allow_outer','block') THEN v ELSE 'allow' END
  FROM (SELECT coalesce(public.app_ops_value(_city,'outside_zone_policy'),'allow') v) s $$;
GRANT EXECUTE ON FUNCTION public.outside_zone_policy(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bookings_travel_fee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r jsonb; _svc text; _bypass text; _zid uuid; _pol text;
BEGIN
  _bypass := current_setting('app.booking_bypass', true);
  NEW.travel_fee := 0; NEW.travel_fee_gst := 0; NEW.travel_expert_share_pct := NULL; NEW.outside_zone := false;
  r := public.resolve_zone(NEW.booking_lat::float8, NEW.booking_lng::float8);
  IF r->>'zone_type' = 'not_serviceable' AND r->>'zone_id' IS NULL THEN
    -- address is in no zone: follow the city's Outside-zone setting
    _pol := public.outside_zone_policy(NEW.city_id);
    IF _pol = 'block' THEN
      IF _bypass IS DISTINCT FROM 'on' AND NOT coalesce(NEW.is_training,false) THEN
        RAISE EXCEPTION 'NOT_SERVICEABLE: We don''t serve this address yet / या पत्त्यावर अजून सेवा उपलब्ध नाही' USING errcode='check_violation';
      END IF;
      RETURN NEW;
    END IF;
    NEW.outside_zone := true;
    IF _pol = 'allow_outer' AND NOT coalesce(NEW.is_training,false) THEN
      NEW.travel_fee := 20;
      NEW.travel_fee_gst := round(20 * coalesce(NEW.gst_percent,0) / 100.0, 2);
      NEW.travel_expert_share_pct := 100;
    END IF;
    RETURN NEW;
  END IF;
  IF r->>'zone_type' = 'not_serviceable' THEN
    IF _bypass IS DISTINCT FROM 'on' AND NOT coalesce(NEW.is_training,false) THEN
      RAISE EXCEPTION 'NOT_SERVICEABLE: We don''t serve this address yet / या पत्त्यावर अजून सेवा उपलब्ध नाही' USING errcode='check_violation';
    END IF;
    RETURN NEW;
  END IF;
  _zid := (r->>'zone_id')::uuid;
  IF NEW.zone_id IS NULL THEN NEW.zone_id := _zid; END IF;
  _svc := CASE WHEN public.booking_capacity_group(NEW.service_category_id, NEW.service_label)='wash' THEN 'auto_care' ELSE 'clean' END;
  IF r->>'zone_type'='outer' AND (r->'travel_fee_services') ? _svc AND NOT coalesce(NEW.is_training,false) THEN
    NEW.travel_fee := coalesce((r->>'travel_fee')::numeric,0);
    NEW.travel_fee_gst := round(NEW.travel_fee * coalesce(NEW.gst_percent,0) / 100.0, 2);
    SELECT expert_share_pct INTO NEW.travel_expert_share_pct FROM public.zones WHERE id=_zid;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.bookings_travel_fee() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.staff_set_outside_zone_policy(_city uuid, _policy text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _before text;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin']) THEN RAISE EXCEPTION 'Only super admin can change this'; END IF;
  IF _policy NOT IN ('allow','allow_outer','block') THEN RAISE EXCEPTION 'Invalid option'; END IF;
  _before := public.outside_zone_policy(_city);
  INSERT INTO public.city_ops_settings(city_id, key, value, updated_at, updated_by) VALUES (_city,'outside_zone_policy',_policy,now(),auth.uid())
  ON CONFLICT (city_id,key) DO UPDATE SET value=EXCLUDED.value, updated_at=now(), updated_by=auth.uid();
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(),'outside_zone_policy_update','city_ops_settings',_city, jsonb_build_object('policy',_before), jsonb_build_object('policy',_policy));
  RETURN _policy;
END $$;
REVOKE ALL ON FUNCTION public.staff_set_outside_zone_policy(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_set_outside_zone_policy(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.zv2_outside_zone_bookings(_city uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  RETURN jsonb_build_object('policy', public.outside_zone_policy(_city), 'pins', coalesce((
    SELECT jsonb_agg(jsonb_build_object('id',id,'number',booking_number,'lat',booking_lat,'lng',booking_lng,'at',created_at,'status',status) ORDER BY created_at DESC)
    FROM public.bookings WHERE outside_zone AND city_id=_city AND created_at > now() - interval '30 days'
      AND booking_lat IS NOT NULL AND booking_lng IS NOT NULL AND deleted_at IS NULL),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.zv2_outside_zone_bookings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.zv2_outside_zone_bookings(uuid) TO authenticated;

-- Which neighbours an edit would trim (and their franchise partner)
CREATE OR REPLACE FUNCTION public.zv2_trim_preview(_city uuid, _cell uuid, _geojson jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $$
DECLARE g extensions.geometry; b extensions.geometry;
BEGIN
  PERFORM zv2_require(_city);
  IF _cell IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT geom INTO b FROM city_boundaries WHERE city_id=_city;
  g := zv2_clean(ST_SetSRID(ST_GeomFromGeoJSON(_geojson::text),4326));
  IF g IS NULL OR b IS NULL THEN RETURN '[]'::jsonb; END IF;
  g := zv2_clean(ST_Intersection(g,b));
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,
      'lose_m2', round(ST_Area(ST_Intersection(c.geom,g)::geography)),
      'partner',(SELECT p.name FROM partners p WHERE p.zone_id=c.live_zone_id AND coalesce(p.status,'') NOT IN ('exited','terminated') LIMIT 1)))
    FROM zone_draft_cells c WHERE c.city_id=_city AND c.id<>_cell AND ST_Intersects(c.geom,g)
      AND ST_Area(ST_Intersection(c.geom,g)::geography) > 50),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.zv2_trim_preview(uuid,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.zv2_trim_preview(uuid,uuid,jsonb) TO authenticated;

-- Guard inside zv2_save_zone: trimming a franchise-partner zone needs the confirmed path
DO $$ DECLARE d text; n text; BEGIN
  d := pg_get_functiondef('public.zv2_save_zone(uuid,uuid,text,text,jsonb)'::regprocedure);
  n := replace(d, 'update zone_draft_cells set geom=ng, updated_at=now() where id=n.id;',
   'if current_setting(''app.zv2_trim_ok'', true) is distinct from ''on'' and exists (select 1 from partners p join zone_draft_cells c2 on c2.live_zone_id=p.zone_id where c2.id=n.id and coalesce(p.status,'''') not in (''exited'',''terminated'')) then
        raise exception ''Zone "%" has a franchise partner. Confirm the trim with a reason.'', n.name;
      end if;
      insert into audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
      values (auth.uid(), ''zones_v2_trim_neighbour'', ''zone_draft_cells'', n.id,
        jsonb_build_object(''boundary'', ST_AsGeoJSON(n.geom)::jsonb),
        jsonb_build_object(''boundary'', ST_AsGeoJSON(ng)::jsonb, ''reason'', nullif(current_setting(''app.zv2_trim_reason'', true),''''), ''by_edit_of'', _cell));
      update zone_draft_cells set geom=ng, updated_at=now() where id=n.id;');
  IF n = d THEN RAISE EXCEPTION 'zv2_save_zone patch failed'; END IF;
  EXECUTE n;
END $$;

CREATE OR REPLACE FUNCTION public.zv2_save_zone_confirmed(_city uuid, _cell uuid, _name text, _colour text, _geojson jsonb, _reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $$
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin']) THEN RAISE EXCEPTION 'Only super admin can trim a franchise partner zone'; END IF;
  IF coalesce(trim(_reason),'')='' THEN RAISE EXCEPTION 'Reason required'; END IF;
  PERFORM set_config('app.zv2_trim_ok','on',true);
  PERFORM set_config('app.zv2_trim_reason',trim(_reason),true);
  RETURN public.zv2_save_zone(_city,_cell,_name,_colour,_geojson);
END $$;
REVOKE ALL ON FUNCTION public.zv2_save_zone_confirmed(uuid,uuid,text,text,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.zv2_save_zone_confirmed(uuid,uuid,text,text,jsonb,text) TO authenticated;

-- Travel pay per expert in a payout batch period
CREATE OR REPLACE FUNCTION public.staff_payout_batch_travel(_batch_id uuid) RETURNS TABLE(owner_id uuid, travel numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _b payout_batches;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT * INTO _b FROM payout_batches WHERE id=_batch_id;
  RETURN QUERY SELECT bk.assigned_expert_id, sum(round(bk.travel_fee * coalesce(bk.travel_expert_share_pct,100)/100.0,2))
    FROM bookings bk WHERE bk.status='completed' AND coalesce(bk.travel_fee,0)>0 AND bk.assigned_expert_id IS NOT NULL
      AND coalesce(bk.service_end_at,bk.updated_at) >= (_b.week_start::timestamp AT TIME ZONE 'Asia/Kolkata')
      AND coalesce(bk.service_end_at,bk.updated_at) <  ((_b.week_end+1)::timestamp AT TIME ZONE 'Asia/Kolkata')
    GROUP BY bk.assigned_expert_id;
END $$;
REVOKE ALL ON FUNCTION public.staff_payout_batch_travel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_payout_batch_travel(uuid) TO authenticated;