CREATE OR REPLACE FUNCTION public.compute_tds(_owner_type text, _owner_id uuid, _gross numeric)
 RETURNS TABLE(rate numeric, amount numeric, pan_last4 text, applicable boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _rate numeric := 0; _pan text;
BEGIN
  IF NOT public.get_ops_flag('tds_master_enabled') THEN
    RETURN QUERY SELECT 0::numeric, 0::numeric, NULL::text, false; RETURN;
  END IF;
  IF _owner_type NOT IN ('expert','area_partner') OR COALESCE(_gross,0) <= 0 THEN
    RETURN QUERY SELECT 0::numeric, 0::numeric, NULL::text, false; RETURN;
  END IF;

  IF _owner_type = 'expert' THEN
    SELECT e.pan_last4 INTO _pan FROM public.experts e WHERE e.id = _owner_id;
  ELSE
    SELECT a.pan_last4 INTO _pan FROM public.area_partners a WHERE a.id = _owner_id;
  END IF;

  _rate := public.get_ops_num('tds_default_rate', 2);

  RETURN QUERY SELECT _rate, round(COALESCE(_gross,0) * _rate / 100.0), _pan, true;
END $function$;

DELETE FROM public.ops_settings WHERE key IN (
  'tds_expert_enabled','tds_partner_enabled','tds_tip_enabled','tds_manual_adj_enabled',
  'tds_no_pan_rate','tds_effective_from','tds_annual_threshold','tds_rounding_rule',
  'tds_rate_service','tds_rate_incentive','tds_rate_referral','tds_rate_courier',
  'tds_rate_tip','tds_rate_manual_adj'
);