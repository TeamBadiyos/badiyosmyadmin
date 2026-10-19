
-- A. zone fields
ALTER TABLE public.zones
  ADD COLUMN IF NOT EXISTS zone_type text NOT NULL DEFAULT 'core',
  ADD COLUMN IF NOT EXISTS travel_fee numeric NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS travel_fee_services text[] NOT NULL DEFAULT ARRAY['clean','auto_care'],
  ADD COLUMN IF NOT EXISTS expert_share_pct numeric NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.zones DROP CONSTRAINT IF EXISTS zones_zone_type_chk;
ALTER TABLE public.zones ADD CONSTRAINT zones_zone_type_chk CHECK (zone_type IN ('core','outer','not_serviceable'));

-- D. booking columns
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS travel_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS travel_fee_gst numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS travel_expert_share_pct numeric;

-- C. ray-casting point in polygon (no PostGIS)
CREATE OR REPLACE FUNCTION public.point_in_ring(_lat double precision, _lng double precision, _ring jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE n int; i int; j int; xi float8; yi float8; xj float8; yj float8; inside boolean := false;
BEGIN
  IF _ring IS NULL OR jsonb_typeof(_ring) <> 'array' THEN RETURN false; END IF;
  n := jsonb_array_length(_ring); IF n < 3 THEN RETURN false; END IF;
  j := n - 1;
  FOR i IN 0..n-1 LOOP
    xi := (_ring->i->>'lng')::float8; yi := (_ring->i->>'lat')::float8;
    xj := (_ring->j->>'lng')::float8; yj := (_ring->j->>'lat')::float8;
    IF ((yi > _lat) <> (yj > _lat)) AND (_lng < (xj - xi) * (_lat - yi) / NULLIF(yj - yi, 0) + xi) THEN inside := NOT inside; END IF;
    j := i;
  END LOOP;
  RETURN inside;
END $$;

CREATE OR REPLACE FUNCTION public.resolve_zone(_lat double precision, _lng double precision)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE z record;
BEGIN
  IF _lat IS NULL OR _lng IS NULL THEN
    RETURN jsonb_build_object('zone_id',NULL,'zone_type','not_serviceable','travel_fee',0,'travel_fee_services','[]'::jsonb);
  END IF;
  SELECT id, zone_type, travel_fee, travel_fee_services INTO z FROM public.zones
   WHERE deleted_at IS NULL AND status='active' AND is_active AND public.point_in_ring(_lat,_lng,boundary)
   ORDER BY CASE zone_type WHEN 'not_serviceable' THEN 0 ELSE 1 END, created_at DESC LIMIT 1;
  IF z.id IS NULL OR z.zone_type='not_serviceable' THEN
    RETURN jsonb_build_object('zone_id',z.id,'zone_type','not_serviceable','travel_fee',0,'travel_fee_services','[]'::jsonb);
  END IF;
  RETURN jsonb_build_object('zone_id',z.id,'zone_type',z.zone_type,
    'travel_fee', CASE WHEN z.zone_type='outer' THEN z.travel_fee ELSE 0 END,
    'travel_fee_services', to_jsonb(z.travel_fee_services));
END $$;
GRANT EXECUTE ON FUNCTION public.resolve_zone(double precision,double precision) TO anon, authenticated, service_role;

-- D. server-side travel fee on insert (fires after trg_bookings_before_insert, before finalize)
CREATE OR REPLACE FUNCTION public.bookings_travel_fee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r jsonb; _svc text; _bypass text; _zid uuid;
BEGIN
  _bypass := current_setting('app.booking_bypass', true);
  NEW.travel_fee := 0; NEW.travel_fee_gst := 0; NEW.travel_expert_share_pct := NULL;
  r := public.resolve_zone(NEW.booking_lat::float8, NEW.booking_lng::float8);
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
DROP TRIGGER IF EXISTS trg_bookings_travel_fee ON public.bookings;
CREATE TRIGGER trg_bookings_travel_fee BEFORE INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.bookings_travel_fee();

-- lock travel fields on update unless server bypass
CREATE OR REPLACE FUNCTION public.bookings_travel_fee_lock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF current_setting('app.booking_bypass', true) IS DISTINCT FROM 'on' THEN
    NEW.travel_fee := OLD.travel_fee; NEW.travel_fee_gst := OLD.travel_fee_gst; NEW.travel_expert_share_pct := OLD.travel_expert_share_pct;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.bookings_travel_fee_lock() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_bookings_travel_fee_lock ON public.bookings;
CREATE TRIGGER trg_bookings_travel_fee_lock BEFORE UPDATE OF travel_fee, travel_fee_gst, travel_expert_share_pct ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.bookings_travel_fee_lock();

-- total = service + GST + travel + travel GST (gst_amount stays service GST)
CREATE OR REPLACE FUNCTION public.bookings_finalize_amounts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _taxable numeric; _gst_exact numeric; _tr numeric;
BEGIN
  _taxable := GREATEST(COALESCE(NEW.price,0) - COALESCE(NEW.discount_amount,0), 0);
  _gst_exact := _taxable * COALESCE(NEW.gst_percent,0) / 100.0;
  _tr := COALESCE(NEW.travel_fee,0) + COALESCE(NEW.travel_fee_gst,0);
  NEW.total_amount := round(_taxable + _gst_exact + _tr);
  NEW.gst_amount := NEW.total_amount - _taxable - _tr;
  RETURN NEW;
END; $function$;

-- F. expert travel pay (completed only)
CREATE OR REPLACE FUNCTION public.booking_travel_payout(_booking_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((SELECT round(travel_fee * COALESCE(travel_expert_share_pct,100) / 100.0, 2)
    FROM public.bookings WHERE id=_booking_id AND status='completed'),0) $$;
GRANT EXECUTE ON FUNCTION public.booking_travel_payout(uuid) TO authenticated, service_role;

DO $$ DECLARE d text; n text; BEGIN
  d := pg_get_functiondef('public.resolve_booking_payouts(uuid)'::regprocedure);
  n := replace(d, '_ep := GREATEST(COALESCE(_ep, 0) + _ext + _adj, 0);', '_ep := GREATEST(COALESCE(_ep, 0) + _ext + _adj, 0) + public.booking_travel_payout(_booking_id);');
  IF n = d THEN RAISE EXCEPTION 'resolve_booking_payouts patch failed'; END IF;
  EXECUTE n;
  d := pg_get_functiondef('public.fin_issue_invoice(text,uuid,date)'::regprocedure);
  n := replace(d, $r$'taxable',_taxable,'gst_pct',coalesce(b.gst_percent,0),'gst',_gst));$r$,
   $r$'taxable',_taxable-coalesce(b.travel_fee,0)-coalesce(b.travel_fee_gst,0),'gst_pct',coalesce(b.gst_percent,0),'gst',_gst));
  IF coalesce(b.travel_fee,0)>0 THEN
    _lines:=_lines||jsonb_build_object('desc','Travel fee','sac',fin_sac(CASE WHEN _svc='clean_auto' THEN 'wash' ELSE 'maid' END),'taxable',b.travel_fee,'gst_pct',coalesce(b.gst_percent,0),'gst',coalesce(b.travel_fee_gst,0));
    _gst:=_gst+coalesce(b.travel_fee_gst,0); _taxable:=_total-_gst;
  END IF;$r$);
  IF n = d THEN RAISE EXCEPTION 'fin_issue_invoice patch failed'; END IF;
  EXECUTE n;
END $$;

-- B. edit zone pricing (super_admin / ops_manager), audited
CREATE OR REPLACE FUNCTION public.staff_set_zone_pricing(_cell uuid, _zone_type text, _travel_fee numeric, _services text[], _expert_share_pct numeric, _is_active boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _zid uuid; _before jsonb; _after jsonb; _city uuid;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT live_zone_id, city_id INTO _zid, _city FROM public.zone_draft_cells WHERE id=_cell;
  IF _zid IS NULL THEN SELECT id, city_id INTO _zid, _city FROM public.zones WHERE id=_cell AND deleted_at IS NULL; END IF;
  IF _zid IS NULL THEN RAISE EXCEPTION 'This zone is not live yet. Use "Use these zones" first.'; END IF;
  IF _zone_type NOT IN ('core','outer','not_serviceable') THEN RAISE EXCEPTION 'Invalid type'; END IF;
  IF _travel_fee IS NULL OR _travel_fee < 0 OR _travel_fee > 1000 THEN RAISE EXCEPTION 'Travel Fee must be 0–1000'; END IF;
  IF _expert_share_pct IS NULL OR _expert_share_pct < 0 OR _expert_share_pct > 100 THEN RAISE EXCEPTION 'Expert share must be 0–100%%'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(coalesce(_services,'{}')) s WHERE s NOT IN ('clean','auto_care')) THEN RAISE EXCEPTION 'Invalid service'; END IF;
  SELECT jsonb_build_object('zone_type',zone_type,'travel_fee',travel_fee,'travel_fee_services',travel_fee_services,'expert_share_pct',expert_share_pct,'is_active',is_active) INTO _before FROM public.zones WHERE id=_zid;
  UPDATE public.zones SET zone_type=_zone_type, travel_fee=_travel_fee, travel_fee_services=coalesce(_services,'{}'),
    expert_share_pct=_expert_share_pct, is_active=coalesce(_is_active,true) WHERE id=_zid;
  SELECT jsonb_build_object('zone_type',zone_type,'travel_fee',travel_fee,'travel_fee_services',travel_fee_services,'expert_share_pct',expert_share_pct,'is_active',is_active) INTO _after FROM public.zones WHERE id=_zid;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(),'zone_pricing_update','zones',_zid,_before,_after);
  RETURN public.zv2_state(_city);
END $$;
REVOKE ALL ON FUNCTION public.staff_set_zone_pricing(uuid,text,numeric,text[],numeric,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_set_zone_pricing(uuid,text,numeric,text[],numeric,boolean) TO authenticated;

-- zv2_state: include pricing + franchise partner per cell
CREATE OR REPLACE FUNCTION public.zv2_state(_city uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
declare u extensions.geometry; b extensions.geometry; filled extensions.geometry; gap extensions.geometry; barea numeric; garea numeric := 0; pct numeric := 0; ov numeric := 0; switched boolean; begin
  perform zv2_require(_city);
  select geom into b from city_boundaries where city_id=_city;
  select ST_Union(geom) into u from zone_draft_cells where city_id=_city;
  if b is not null then
    gap := ST_CollectionExtract(case when u is null then b else ST_Difference(b,u) end,3);
    barea := ST_Area(b::geography);
  elsif u is not null then
    select ST_Union(ST_MakePolygon(ST_ExteriorRing(d.geom))) into filled from ST_Dump(u) d;
    gap := ST_CollectionExtract(ST_Difference(filled,u),3);
    barea := ST_Area(filled::geography);
  end if;
  if gap is not null and not ST_IsEmpty(gap) and ST_Area(gap::geography) > 1 then
    garea := ST_Area(gap::geography); pct := round(100 * garea / nullif(barea,0), 2);
  else gap := null; end if;
  select coalesce(max(ST_Area(ST_Intersection(x.geom,y.geom)::geography)),0) into ov
    from zone_draft_cells x join zone_draft_cells y on x.city_id=y.city_id and x.id<y.id and ST_Intersects(x.geom,y.geom) where x.city_id=_city;
  switched := exists (select 1 from zone_draft_cells where city_id=_city and live_zone_id is not null);
  return jsonb_build_object(
    'boundary', case when b is null then null else ST_AsGeoJSON(b,7)::jsonb end,
    'city_area_km2', case when b is null then null else round(barea/1e6, 2) end,
    'gap', case when gap is null then null else ST_AsGeoJSON(gap,7)::jsonb end,
    'gap_pct', pct, 'gap_km2', round(garea/1e6, 3),
    'covered_pct', case when b is null then null else greatest(0, round(100 - pct, 2)) end,
    'overlap', ov > 1, 'switched', switched,
    'cells', coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'colour',c.colour,
       'area_m2', round(ST_Area(c.geom::geography)), 'geom', ST_AsGeoJSON(c.geom,7)::jsonb,
       'is_off', c.is_off and (c.off_until is null or c.off_until > now()), 'off_reason', c.off_reason, 'off_until', c.off_until, 'live', c.live_zone_id is not null,
       'zone_type', coalesce(z.zone_type,'core'), 'travel_fee', coalesce(z.travel_fee,20),
       'travel_fee_services', coalesce(to_jsonb(z.travel_fee_services), '["clean","auto_care"]'::jsonb),
       'expert_share_pct', coalesce(z.expert_share_pct,100), 'is_active', coalesce(z.is_active,true),
       'partner', (select p.name from partners p where p.zone_id=z.id and p.program='zone_franchise' order by p.created_at desc limit 1)) order by c.name)
       from zone_draft_cells c left join zones z on z.id=c.live_zone_id where c.city_id=_city),'[]'),
    'old_zones', coalesce((select jsonb_agg(jsonb_build_object('id',z.id,'name',z.name,'geom',ST_AsGeoJSON(z.geom,7)::jsonb))
       from zones z where z.city_id=_city and z.deleted_at is null and z.geom is not null
         and not exists (select 1 from zone_draft_cells c where c.live_zone_id=z.id)),'[]'));
end $function$;
