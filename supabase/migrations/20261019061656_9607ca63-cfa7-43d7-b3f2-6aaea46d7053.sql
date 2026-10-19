ALTER TABLE public.partner_commission_plans
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS kpi jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS rules jsonb NOT NULL DEFAULT '{"active_expert_min_hours":20,"active_expert_min_jobs":10,"rampup_days":60,"warning_after_misses":1,"inactive_after_consecutive_misses":2,"no_activity_days_to_inactive":30,"termination_after_consecutive_inactive":4,"max_suspensions_per_year":3,"renewal_min_active_months":8,"refund_window_days":7,"exit_notice_days":30,"agreement_months":12}'::jsonb;

UPDATE public.partner_commission_plans SET
 description = CASE name
  WHEN 'Mini Franchise' THEN 'Apne zone ke har Home Cleaning, Auto Care aur Delivery order pe commission. Zone mein customers aur experts badhana aapki zimmedari. Monthly KPI pura karne pe hi commission.'
  WHEN 'City Master' THEN 'Poore city ke orders pe commission. Zones aur Growth Partners tayyar karke city ko lead karna. Monthly KPI pura karne pe hi commission.'
  WHEN 'Growth Silver' THEN 'Apne laaye experts ke orders pe 2% (Delivery 1%). Min 2 active experts aur har mahine 1 naya expert zaroori.'
  WHEN 'Growth Gold' THEN 'Apne laaye experts ke orders pe 3% (Delivery 2%). Min 4 active experts aur har mahine 2 naye experts zaroori.'
  WHEN 'Growth Platinum' THEN 'Apne laaye experts ke orders pe 5% (Delivery 3%), poore city mein. Min 6 active experts aur har mahine 3 naye experts zaroori.'
  ELSE description END,
 kpi = CASE name
  WHEN 'Mini Franchise' THEN '{"min_active_experts":4,"min_new_customers":20,"min_promo_activities":2}'::jsonb
  WHEN 'City Master' THEN '{"min_active_experts":15,"min_new_customers":100,"review_meeting_required":true}'::jsonb
  WHEN 'Growth Silver' THEN '{"min_active_experts":2,"min_new_experts":1}'::jsonb
  WHEN 'Growth Gold' THEN '{"min_active_experts":4,"min_new_experts":2}'::jsonb
  WHEN 'Growth Platinum' THEN '{"min_active_experts":6,"min_new_experts":3}'::jsonb
  ELSE kpi END;

CREATE OR REPLACE FUNCTION public.staff_partner_plan_upsert(_p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := public.partner_require_admin(); _id uuid := NULLIF(_p->>'id','')::uuid; _before jsonb; _after jsonb; _l jsonb;
  _sort int; _desc text := NULLIF(btrim(COALESCE(_p->>'description','')),''); _kpi jsonb := '{}'::jsonb; _rules jsonb; _k text; _v jsonb;
BEGIN
  IF btrim(COALESCE(_p->>'name',''))='' THEN RAISE EXCEPTION 'Plan name required'; END IF;
  IF _p->>'partner_type' NOT IN ('growth','zone_franchise','city_master') THEN RAISE EXCEPTION 'Invalid partner type'; END IF;
  IF length(COALESCE(_desc,'')) > 300 THEN RAISE EXCEPTION 'Description max 300 characters'; END IF;
  FOR _k IN SELECT unnest(ARRAY['min_active_experts','min_new_experts','min_new_customers','min_promo_activities']) LOOP
    _v := _p->'kpi'->_k;
    IF _v IS NOT NULL AND jsonb_typeof(_v)='number' THEN
      IF (_v#>>'{}')::numeric < 0 OR (_v#>>'{}')::numeric <> trunc((_v#>>'{}')::numeric) THEN RAISE EXCEPTION 'KPI % must be a whole number of 0 or more', _k; END IF;
      _kpi := _kpi || jsonb_build_object(_k, (_v#>>'{}')::int);
    END IF;
  END LOOP;
  IF COALESCE((_p->'kpi'->>'review_meeting_required')::boolean,false) THEN _kpi := _kpi || '{"review_meeting_required":true}'::jsonb; END IF;
  _rules := '{"active_expert_min_hours":20,"active_expert_min_jobs":10,"rampup_days":60,"warning_after_misses":1,"inactive_after_consecutive_misses":2,"no_activity_days_to_inactive":30,"termination_after_consecutive_inactive":4,"max_suspensions_per_year":3,"renewal_min_active_months":8,"refund_window_days":7,"exit_notice_days":30,"agreement_months":12}'::jsonb;
  FOR _k IN SELECT jsonb_object_keys(_rules) LOOP
    _v := _p->'rules'->_k;
    IF _v IS NOT NULL AND jsonb_typeof(_v)='number' THEN
      IF (_v#>>'{}')::numeric < 0 OR (_v#>>'{}')::numeric <> trunc((_v#>>'{}')::numeric) THEN RAISE EXCEPTION 'Rule % must be a whole number of 0 or more', _k; END IF;
      _rules := _rules || jsonb_build_object(_k, (_v#>>'{}')::int);
    END IF;
  END LOOP;
  _sort := COALESCE(NULLIF(_p->>'sort_order','')::int, (SELECT COALESCE(max(sort_order),0)+1 FROM public.partner_commission_plans));
  IF _id IS NOT NULL THEN
    SELECT to_jsonb(c) || jsonb_build_object('lines',(SELECT jsonb_agg(to_jsonb(l)) FROM public.partner_plan_lines l WHERE l.plan_id=c.id))
      INTO _before FROM public.partner_commission_plans c WHERE id=_id;
    IF _before IS NULL THEN RAISE EXCEPTION 'Plan not found'; END IF;
    IF (_before->>'partner_type') <> (_p->>'partner_type') AND EXISTS (SELECT 1 FROM public.partners WHERE plan_id=_id) THEN
      RAISE EXCEPTION 'Partner type cannot change while partners use this plan'; END IF;
    UPDATE public.partner_commission_plans SET name=btrim(_p->>'name'), partner_type=_p->>'partner_type',
      suggested_fee=COALESCE(NULLIF(_p->>'suggested_fee','')::numeric,0), status=COALESCE(NULLIF(_p->>'status',''),'active'),
      sort_order=_sort, description=_desc, kpi=_kpi, rules=_rules, updated_at=now()
     WHERE id=_id;
  ELSE
    INSERT INTO public.partner_commission_plans(name,partner_type,suggested_fee,status,sort_order,description,kpi,rules)
    VALUES (btrim(_p->>'name'), _p->>'partner_type', COALESCE(NULLIF(_p->>'suggested_fee','')::numeric,0), COALESCE(NULLIF(_p->>'status',''),'active'), _sort, _desc, _kpi, _rules)
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