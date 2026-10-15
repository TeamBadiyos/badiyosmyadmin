CREATE TABLE public.app_banners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  image_path text NOT NULL,
  app_tab text NOT NULL DEFAULT 'all' CHECK (app_tab IN ('all','clean','store','food','parcel','rewards')),
  link_type text NOT NULL DEFAULT 'none' CHECK (link_type IN ('none','service','store','coupon','lucky_draw')),
  link_target text,
  city_id uuid,
  starts_at date,
  ends_at date,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.app_banners TO authenticated;
GRANT ALL ON public.app_banners TO service_role;
ALTER TABLE public.app_banners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read banners" ON public.app_banners FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.staff_users s WHERE s.auth_user_id = auth.uid() AND s.status='active' AND s.role IN ('super_admin','ops_manager')));

CREATE OR REPLACE FUNCTION public.staff_require_banner_staff() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM staff_users s WHERE s.auth_user_id=auth.uid() AND s.status='active' AND s.role IN ('super_admin','ops_manager')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.staff_save_banner(_p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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
  INSERT INTO audit_logs(actor_id, action, table_name, record_id, before, after)
  VALUES (auth.uid(), CASE WHEN _before IS NULL THEN 'banner_create' ELSE 'banner_update' END, 'app_banners', _id, _before, _after);
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.staff_set_banner_active(_id uuid, _active boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM staff_require_banner_staff();
  UPDATE app_banners SET is_active=_active, updated_at=now() WHERE id=_id;
  INSERT INTO audit_logs(actor_id, action, table_name, record_id, after)
  VALUES (auth.uid(), 'banner_set_active', 'app_banners', _id, jsonb_build_object('is_active',_active));
END $$;

CREATE OR REPLACE FUNCTION public.staff_delete_banner(_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _before jsonb;
BEGIN
  PERFORM staff_require_banner_staff();
  SELECT to_jsonb(b) INTO _before FROM app_banners b WHERE id=_id;
  DELETE FROM app_banners WHERE id=_id;
  INSERT INTO audit_logs(actor_id, action, table_name, record_id, before)
  VALUES (auth.uid(), 'banner_delete', 'app_banners', _id, _before);
END $$;

CREATE OR REPLACE FUNCTION public.staff_move_banner(_id uuid, _dir integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _cur int; _other uuid; _oo int;
BEGIN
  PERFORM staff_require_banner_staff();
  SELECT display_order INTO _cur FROM app_banners WHERE id=_id;
  IF _dir < 0 THEN
    SELECT id, display_order INTO _other, _oo FROM app_banners WHERE display_order < _cur ORDER BY display_order DESC LIMIT 1;
  ELSE
    SELECT id, display_order INTO _other, _oo FROM app_banners WHERE display_order > _cur ORDER BY display_order ASC LIMIT 1;
  END IF;
  IF _other IS NULL THEN RETURN; END IF;
  UPDATE app_banners SET display_order=_oo WHERE id=_id;
  UPDATE app_banners SET display_order=_cur WHERE id=_other;
END $$;

CREATE OR REPLACE FUNCTION public.app_list_banners(_tab text, _city_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'image_path',image_path,'app_tab',app_tab,
    'link_type',link_type,'link_target',link_target) ORDER BY display_order),'[]'::jsonb)
  FROM app_banners
  WHERE is_active
    AND (app_tab='all' OR app_tab=lower(coalesce(_tab,'all')))
    AND (city_id IS NULL OR city_id=_city_id)
    AND (starts_at IS NULL OR starts_at <= (now() AT TIME ZONE 'Asia/Kolkata')::date)
    AND (ends_at IS NULL OR ends_at >= (now() AT TIME ZONE 'Asia/Kolkata')::date);
$$;

REVOKE ALL ON FUNCTION public.staff_require_banner_staff() FROM public, anon;
REVOKE ALL ON FUNCTION public.staff_save_banner(jsonb) FROM public, anon;
REVOKE ALL ON FUNCTION public.staff_set_banner_active(uuid,boolean) FROM public, anon;
REVOKE ALL ON FUNCTION public.staff_delete_banner(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.staff_move_banner(uuid,integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_require_banner_staff(), public.staff_save_banner(jsonb), public.staff_set_banner_active(uuid,boolean), public.staff_delete_banner(uuid), public.staff_move_banner(uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_list_banners(text,uuid) TO anon, authenticated, service_role;