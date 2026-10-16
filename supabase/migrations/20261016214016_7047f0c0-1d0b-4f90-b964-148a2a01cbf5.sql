CREATE OR REPLACE FUNCTION public.staff_set_city_price(_city_id uuid, _opt uuid, _patch jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _before jsonb; _after jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_users WHERE auth_user_id=auth.uid() AND status='active' AND role IN ('super_admin','ops_manager')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF NOT (_city_id = ANY (public.staff_allowed_city_ids())) THEN RAISE EXCEPTION 'City not allowed'; END IF;
  SELECT to_jsonb(c) INTO _before FROM public.city_price_options c WHERE city_id=_city_id AND price_option_id=_opt;
  INSERT INTO public.city_price_options(city_id, price_option_id, customer_price, strikethrough_price, expert_payout, partner_commission, is_active)
  SELECT _city_id, o.id, o.customer_price, o.strikethrough_price, COALESCE(o.expert_payout,0), COALESCE(o.partner_commission,0), o.is_active
    FROM public.service_price_options o WHERE o.id=_opt
  ON CONFLICT DO NOTHING;
  UPDATE public.city_price_options SET
    customer_price = COALESCE((_patch->>'customer_price')::numeric, customer_price),
    strikethrough_price = CASE WHEN _patch ? 'strikethrough_price' THEN NULLIF(_patch->>'strikethrough_price','')::numeric ELSE strikethrough_price END,
    expert_payout = COALESCE((_patch->>'expert_payout')::numeric, expert_payout),
    partner_commission = COALESCE((_patch->>'partner_commission')::numeric, partner_commission),
    is_active = COALESCE((_patch->>'is_active')::boolean, is_active)
  WHERE city_id=_city_id AND price_option_id=_opt
  RETURNING to_jsonb(city_price_options.*) INTO _after;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), 'city_price.update', 'city_price_options', _opt, _before, _after);
END $function$;

CREATE OR REPLACE FUNCTION public.staff_save_banner(_p jsonb)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _id uuid := nullif(_p->>'id','')::uuid; _before jsonb; _after jsonb;
BEGIN
  PERFORM staff_require_banner_staff();
  IF coalesce(trim(_p->>'title'),'')='' THEN RAISE EXCEPTION 'Title required'; END IF;
  IF coalesce(trim(_p->>'image_path'),'')='' THEN RAISE EXCEPTION 'Image required'; END IF;
  IF nullif(_p->>'starts_at','') IS NOT NULL AND nullif(_p->>'ends_at','') IS NOT NULL
     AND (_p->>'ends_at')::date < (_p->>'starts_at')::date THEN RAISE EXCEPTION 'End date is before start date'; END IF;
  IF _id IS NULL THEN
    INSERT INTO app_banners(title,image_path,app_tab,link_type,link_target,city_id,starts_at,ends_at,is_active,display_order)
    VALUES (trim(_p->>'title'), _p->>'image_path', coalesce(_p->>'app_tab','all'), coalesce(_p->>'link_type','none'),
      CASE WHEN coalesce(_p->>'link_type','none')='none' THEN NULL ELSE nullif(_p->>'link_target','') END,
      nullif(_p->>'city_id','')::uuid, nullif(_p->>'starts_at','')::date, nullif(_p->>'ends_at','')::date,
      coalesce((_p->>'is_active')::boolean,true), coalesce((SELECT max(display_order)+1 FROM app_banners),0))
    RETURNING id INTO _id;
  ELSE
    SELECT to_jsonb(b) INTO _before FROM app_banners b WHERE id=_id;
    UPDATE app_banners SET title=trim(_p->>'title'), image_path=_p->>'image_path', app_tab=coalesce(_p->>'app_tab','all'),
      link_type=coalesce(_p->>'link_type','none'),
      link_target=CASE WHEN coalesce(_p->>'link_type','none')='none' THEN NULL ELSE nullif(_p->>'link_target','') END,
      city_id=nullif(_p->>'city_id','')::uuid, starts_at=nullif(_p->>'starts_at','')::date, ends_at=nullif(_p->>'ends_at','')::date,
      is_active=coalesce((_p->>'is_active')::boolean,is_active), updated_at=now()
    WHERE id=_id;
  END IF;
  SELECT to_jsonb(b) INTO _after FROM app_banners b WHERE id=_id;
  INSERT INTO audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), CASE WHEN _before IS NULL THEN 'banner_create' ELSE 'banner_update' END, 'app_banners', _id, _before, _after);
  RETURN _id;
END $function$;