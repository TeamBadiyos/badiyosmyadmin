CREATE OR REPLACE FUNCTION public.staff_set_expert_growth_partner(_expert_id uuid, _partner_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := public.partner_require_admin(); _old uuid;
BEGIN
  SELECT onboarded_by_partner_id INTO _old FROM public.experts WHERE id=_expert_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expert not found'; END IF;
  IF _partner_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.partners WHERE id=_partner_id
       AND (program='growth' OR (program IN ('zone_franchise','city_master') AND growth_plan_id IS NOT NULL))) THEN
    RAISE EXCEPTION 'Choose a partner with a Growth plan'; END IF;
  UPDATE public.experts SET onboarded_by_partner_id=_partner_id WHERE id=_expert_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid,'expert_growth_partner_set','experts',_expert_id, jsonb_build_object('partner_id',_old), jsonb_build_object('partner_id',_partner_id));
END $$;