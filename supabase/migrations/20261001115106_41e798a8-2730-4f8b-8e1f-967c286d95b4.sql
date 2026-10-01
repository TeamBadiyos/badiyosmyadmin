DROP FUNCTION IF EXISTS public.staff_upsert_coupon(uuid,text,text,text,text,numeric,numeric,numeric,timestamptz,timestamptz,integer,integer,text);

CREATE OR REPLACE FUNCTION public.staff_upsert_coupon(_id uuid, _code text, _title text, _description text, _discount_type text, _discount_value numeric, _max_discount numeric, _min_order_amount numeric, _valid_from timestamptz, _valid_until timestamptz, _total_usage_limit integer, _per_user_limit integer, _audience text, _show_in_list boolean DEFAULT true)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _before jsonb; _row public.coupons%ROWTYPE;
BEGIN
  PERFORM public.offers_require_writer();
  IF _id IS NULL THEN
    INSERT INTO public.coupons (code, title, description, discount_type, discount_value, max_discount,
      min_order_amount, valid_from, valid_until, total_usage_limit, per_user_limit, audience, show_in_list, created_by)
    VALUES (upper(btrim(_code)), _title, _description, _discount_type, _discount_value, _max_discount,
      COALESCE(_min_order_amount,0), COALESCE(_valid_from, now()), _valid_until, _total_usage_limit,
      COALESCE(_per_user_limit,1), COALESCE(_audience,'all'), COALESCE(_show_in_list,true), auth.uid())
    RETURNING * INTO _row;
    PERFORM public.offers_audit('coupon_created','coupons',_row.id,NULL,to_jsonb(_row));
  ELSE
    SELECT to_jsonb(c) INTO _before FROM public.coupons c WHERE c.id=_id;
    IF _before IS NULL THEN RAISE EXCEPTION 'Coupon not found'; END IF;
    UPDATE public.coupons SET code=upper(btrim(_code)), title=_title, description=_description,
      discount_type=_discount_type, discount_value=_discount_value, max_discount=_max_discount,
      min_order_amount=COALESCE(_min_order_amount,0), valid_from=COALESCE(_valid_from,valid_from),
      valid_until=_valid_until, total_usage_limit=_total_usage_limit, per_user_limit=COALESCE(_per_user_limit,1),
      audience=COALESCE(_audience,'all'), show_in_list=COALESCE(_show_in_list,show_in_list), updated_at=now()
    WHERE id=_id RETURNING * INTO _row;
    PERFORM public.offers_audit('coupon_updated','coupons',_row.id,_before,to_jsonb(_row));
  END IF;
  RETURN _row.id;
END $$;

CREATE POLICY "Staff delete phone grants" ON public.coupon_phone_grants FOR DELETE TO authenticated
  USING (offers_caller_role(auth.uid()) IS NOT NULL);

CREATE OR REPLACE FUNCTION public.staff_coupon_grant_phones(_id uuid, _phones text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _p text; _d text; _uid uuid; _granted int:=0; _pending int:=0; _invalid int:=0; _dup int:=0; _n int;
BEGIN
  PERFORM public.offers_require_writer();
  IF NOT EXISTS (SELECT 1 FROM coupons WHERE id=_id) THEN RAISE EXCEPTION 'Coupon not found'; END IF;
  FOREACH _p IN ARRAY COALESCE(_phones, '{}') LOOP
    _d := right(regexp_replace(COALESCE(_p,''),'\D','','g'),10);
    IF length(_d) <> 10 THEN _invalid:=_invalid+1; CONTINUE; END IF;
    SELECT id INTO _uid FROM users WHERE deleted_at IS NULL
      AND right(regexp_replace(COALESCE(phone,''),'\D','','g'),10)=_d LIMIT 1;
    IF _uid IS NOT NULL THEN
      INSERT INTO customer_coupons(user_id,coupon_id,source,status)
      VALUES (_uid,_id,'staff_grant','available') ON CONFLICT (user_id,coupon_id) DO NOTHING;
      GET DIAGNOSTICS _n = ROW_COUNT;
      IF _n>0 THEN _granted:=_granted+1; ELSE _dup:=_dup+1; END IF;
    ELSE
      INSERT INTO coupon_phone_grants(coupon_id,phone10,created_by)
      VALUES (_id,_d,auth.uid()) ON CONFLICT (coupon_id,phone10) DO NOTHING;
      GET DIAGNOSTICS _n = ROW_COUNT;
      IF _n>0 THEN _pending:=_pending+1; ELSE _dup:=_dup+1; END IF;
    END IF;
  END LOOP;
  PERFORM public.offers_audit('coupon_customers_granted','coupons',_id,NULL,
    jsonb_build_object('granted',_granted,'pending',_pending,'invalid',_invalid,'duplicate',_dup));
  RETURN jsonb_build_object('granted',_granted,'pending',_pending,'invalid',_invalid,'duplicate',_dup);
END $$;

CREATE OR REPLACE FUNCTION public.staff_coupon_revoke_grant(_coupon_id uuid, _kind text, _grant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _before jsonb;
BEGIN
  PERFORM public.offers_require_writer();
  IF _kind='customer' THEN
    DELETE FROM customer_coupons WHERE id=_grant_id AND coupon_id=_coupon_id AND status<>'used'
      RETURNING to_jsonb(customer_coupons.*) INTO _before;
  ELSIF _kind='phone' THEN
    DELETE FROM coupon_phone_grants WHERE id=_grant_id AND coupon_id=_coupon_id AND converted_at IS NULL
      RETURNING to_jsonb(coupon_phone_grants.*) INTO _before;
  ELSE RAISE EXCEPTION 'Invalid kind'; END IF;
  IF _before IS NULL THEN RAISE EXCEPTION 'Grant not found or already used'; END IF;
  PERFORM public.offers_audit('coupon_customer_removed','coupons',_coupon_id,_before,NULL);
END $$;

REVOKE ALL ON FUNCTION public.staff_upsert_coupon(uuid,text,text,text,text,numeric,numeric,numeric,timestamptz,timestamptz,integer,integer,text,boolean) FROM anon, public;
REVOKE ALL ON FUNCTION public.staff_coupon_grant_phones(uuid,text[]) FROM anon, public;
REVOKE ALL ON FUNCTION public.staff_coupon_revoke_grant(uuid,text,uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.staff_upsert_coupon(uuid,text,text,text,text,numeric,numeric,numeric,timestamptz,timestamptz,integer,integer,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_coupon_grant_phones(uuid,text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_coupon_revoke_grant(uuid,text,uuid) TO authenticated;