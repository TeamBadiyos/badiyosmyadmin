ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_discount_type_check;
ALTER TABLE public.coupons ADD CONSTRAINT coupons_discount_type_check CHECK (discount_type IN ('flat','percent','free_minutes','free_service'));
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS free_price_option_id uuid REFERENCES public.service_price_options(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.staff_set_coupon_free_service(_id uuid, _price_option_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _before jsonb; _row public.coupons%ROWTYPE;
BEGIN
  PERFORM public.offers_require_writer();
  SELECT to_jsonb(c) INTO _before FROM public.coupons c WHERE c.id=_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Coupon not found'; END IF;
  IF _before->>'discount_type' = 'free_service' AND _price_option_id IS NULL THEN
    RAISE EXCEPTION 'Choose the free service';
  END IF;
  IF _price_option_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM service_price_options WHERE id=_price_option_id) THEN
    RAISE EXCEPTION 'Service not found';
  END IF;
  UPDATE public.coupons SET free_price_option_id = CASE WHEN discount_type='free_service' THEN _price_option_id END, updated_at=now()
   WHERE id=_id RETURNING * INTO _row;
  PERFORM public.offers_audit('coupon_free_service_set','coupons',_id,_before,to_jsonb(_row));
END $$;
REVOKE ALL ON FUNCTION public.staff_set_coupon_free_service(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_set_coupon_free_service(uuid,uuid) TO authenticated;

DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.coupon_quote_core(uuid,text,numeric,integer,uuid)'::regprocedure);
  IF position('ELSIF c.discount_type = ''free_service''' in d) = 0 THEN
    d := replace(d, E'    IF c.max_discount IS NOT NULL THEN _disc := LEAST(_disc, c.max_discount); END IF;\n  ELSE',
      E'    IF c.max_discount IS NOT NULL THEN _disc := LEAST(_disc, c.max_discount); END IF;\n  ELSIF c.discount_type = ''free_service'' THEN\n    IF c.free_price_option_id IS NULL OR NOT EXISTS (\n      SELECT 1 FROM service_price_options o JOIN services s ON s.id=o.service_id\n       WHERE o.id=c.free_price_option_id AND (_category_id IS NULL OR s.category_id=_category_id)\n         AND round(COALESCE((SELECT cp.customer_price FROM city_price_options cp WHERE cp.price_option_id=o.id AND cp.customer_price=round(COALESCE(_base_amount,0),2) LIMIT 1), o.customer_price),2) = round(COALESCE(_base_amount,0),2)) THEN\n      RETURN jsonb_build_object(''ok'',false,''reason'',''not_applicable'');\n    END IF;\n    _disc := COALESCE(_base_amount,0);\n  ELSE');
    IF position('free_service' in d) = 0 THEN RAISE EXCEPTION 'coupon_quote_core patch failed'; END IF;
    EXECUTE d;
  END IF;

  d := pg_get_functiondef('public.staff_send_campaign(uuid)'::regprocedure);
  d := replace(d, $$'title', _before->>'title', 'body', COALESCE(_before->>'body',''),$$,
                  $$'title', _before->>'title', 'body', COALESCE(_before->>'body',''), 'image', NULLIF(_before->>'image_url',''),$$);
  d := replace(d, $$'coupon_code', _coupon, 'campaign_id', _id))$$,
                  $$'coupon_code', _coupon, 'campaign_id', _id, 'image', NULLIF(_before->>'image_url',''), 'image_url', NULLIF(_before->>'image_url','')))$$);
  IF position('''image''' in d) = 0 THEN RAISE EXCEPTION 'send_campaign patch failed'; END IF;
  EXECUTE d;

  d := pg_get_functiondef('public.staff_send_campaign_test(uuid,text)'::regprocedure);
  d := replace(d, $$'body', COALESCE(_c.body,''),$$, $$'body', COALESCE(_c.body,''), 'image', NULLIF(_c.image_url,''),$$);
  d := replace(d, $$'campaign_id',_id,'test','1')$$, $$'campaign_id',_id,'test','1','image',NULLIF(_c.image_url,''),'image_url',NULLIF(_c.image_url,''))$$);
  IF position('''image''' in d) = 0 THEN RAISE EXCEPTION 'send_campaign_test patch failed'; END IF;
  EXECUTE d;
END $do$;