REVOKE EXECUTE ON FUNCTION public.zv2_outer_pockets(uuid), public.staff_set_zone_outer_pockets(uuid,jsonb,numeric) FROM anon, public;
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
  INSERT INTO audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), 'zone.outer_pockets', 'zones', _zid, _before, jsonb_build_object('outer_pockets',_pockets,'outer_pocket_fee',_fee));
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE EXECUTE ON FUNCTION public.staff_set_zone_outer_pockets(uuid,jsonb,numeric) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.staff_set_zone_outer_pockets(uuid,jsonb,numeric) TO authenticated;