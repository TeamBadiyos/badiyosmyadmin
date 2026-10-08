ALTER TABLE public.partner_commission_plans ADD COLUMN sort_order integer NOT NULL DEFAULT 0;
UPDATE public.partner_commission_plans SET sort_order = CASE name
  WHEN 'Growth Silver' THEN 1 WHEN 'Growth Gold' THEN 2 WHEN 'Growth Platinum' THEN 3
  WHEN 'Zone Franchise' THEN 4 WHEN 'City Master' THEN 5 ELSE sort_order END;

CREATE OR REPLACE FUNCTION public.staff_partner_plan_upsert(_p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := public.partner_require_admin(); _id uuid := NULLIF(_p->>'id','')::uuid; _before jsonb; _after jsonb; _l jsonb;
  _sort int;
BEGIN
  IF btrim(COALESCE(_p->>'name',''))='' THEN RAISE EXCEPTION 'Plan name required'; END IF;
  IF _p->>'partner_type' NOT IN ('growth','zone_franchise','city_master') THEN RAISE EXCEPTION 'Invalid partner type'; END IF;
  _sort := COALESCE(NULLIF(_p->>'sort_order','')::int, (SELECT COALESCE(max(sort_order),0)+1 FROM public.partner_commission_plans));
  IF _id IS NOT NULL THEN
    SELECT to_jsonb(c) || jsonb_build_object('lines',(SELECT jsonb_agg(to_jsonb(l)) FROM public.partner_plan_lines l WHERE l.plan_id=c.id))
      INTO _before FROM public.partner_commission_plans c WHERE id=_id;
    IF _before IS NULL THEN RAISE EXCEPTION 'Plan not found'; END IF;
    IF (_before->>'partner_type') <> (_p->>'partner_type') AND EXISTS (SELECT 1 FROM public.partners WHERE plan_id=_id) THEN
      RAISE EXCEPTION 'Partner type cannot change while partners use this plan'; END IF;
    UPDATE public.partner_commission_plans SET name=btrim(_p->>'name'), partner_type=_p->>'partner_type',
      suggested_fee=COALESCE(NULLIF(_p->>'suggested_fee','')::numeric,0), status=COALESCE(NULLIF(_p->>'status',''),'active'),
      sort_order=_sort, updated_at=now()
     WHERE id=_id;
  ELSE
    INSERT INTO public.partner_commission_plans(name,partner_type,suggested_fee,status,sort_order)
    VALUES (btrim(_p->>'name'), _p->>'partner_type', COALESCE(NULLIF(_p->>'suggested_fee','')::numeric,0), COALESCE(NULLIF(_p->>'status',''),'active'), _sort)
    RETURNING id INTO _id;
  END IF;
  FOR _l IN SELECT * FROM jsonb_array_elements(COALESCE(_p->'lines','[]'::jsonb)) LOOP
    IF (_l->>'pct')::numeric < 0 OR (_l->>'pct')::numeric > 100 THEN RAISE EXCEPTION '%% must be between 0 and 100'; END IF;
    INSERT INTO public.partner_plan_lines(plan_id,line_key,enabled,pct)
    VALUES (_id, _l->>'line_key', COALESCE((_l->>'enabled')::boolean,false), COALESCE((_l->>'pct')::numeric,0))
    ON CONFLICT (plan_id,line_key) DO UPDATE SET enabled=EXCLUDED.enabled, pct=EXCLUDED.pct
      WHERE partner_plan_lines.enabled IS DISTINCT FROM EXCLUDED.enabled OR partner_plan_lines.pct IS DISTINCT FROM EXCLUDED.pct;
  END LOOP;
  SELECT to_jsonb(c) || jsonb_build_object('lines',(SELECT jsonb_agg(to_jsonb(l)) FROM public.partner_plan_lines l WHERE l.plan_id=c.id))
    INTO _after FROM public.partner_commission_plans c WHERE id=_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, CASE WHEN _before IS NULL THEN 'partner_plan_create' ELSE 'partner_plan_update' END, 'partner_commission_plans', _id, _before, _after);
  RETURN _id;
END $$;