ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_audience_check;
ALTER TABLE public.coupons ADD CONSTRAINT coupons_audience_check CHECK (audience = ANY (ARRAY['all','targeted','referral_reward','new_customers','existing_customers']));

CREATE OR REPLACE FUNCTION public.customer_completed_orders(_user_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT count(*)::int FROM public.bookings
   WHERE user_id = _user_id AND status = 'completed' AND COALESCE(is_training,false) = false;
$$;
REVOKE EXECUTE ON FUNCTION public.customer_completed_orders(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.campaign_audience_match(_audience text, _uid uuid, _targets uuid[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN _audience = 'specific_users' THEN _uid = ANY (COALESCE(_targets, ARRAY[]::uuid[]))
    WHEN _audience = 'all' THEN true
    WHEN _audience = 'new_customers' THEN public.customer_completed_orders(_uid) = 0
    WHEN _audience = 'existing_customers' THEN public.customer_completed_orders(_uid) >= 1
    ELSE EXISTS (SELECT 1 FROM public.addresses a WHERE a.user_id = _uid AND a.city ILIKE _audience)
  END;
$$;
REVOKE EXECUTE ON FUNCTION public.campaign_audience_match(text, uuid, uuid[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.coupon_quote_core(_user_id uuid, _code text, _base_amount numeric, _duration_minutes integer DEFAULT NULL::integer, _category_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE c public.coupons%ROWTYPE; _used int; _disc numeric; _grant public.customer_coupons%ROWTYPE; _orders int;
BEGIN
  IF _user_id IS NULL OR _code IS NULL OR btrim(_code) = '' THEN
    RETURN jsonb_build_object('ok',false,'reason','invalid_code');
  END IF;
  PERFORM public.coupon_reconcile_user_reservations(_user_id);
  SELECT * INTO c FROM public.coupons WHERE upper(btrim(code)) = upper(btrim(_code)) AND is_active = true LIMIT 1;
  IF c.id IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','invalid_code'); END IF;
  IF c.valid_from > now() OR (c.valid_until IS NOT NULL AND c.valid_until <= now()) THEN
    RETURN jsonb_build_object('ok',false,'reason','expired');
  END IF;
  IF c.applicable_category_ids IS NOT NULL AND cardinality(c.applicable_category_ids) > 0
     AND (_category_id IS NULL OR NOT (_category_id = ANY(c.applicable_category_ids))) THEN
    RETURN jsonb_build_object('ok',false,'reason','not_applicable');
  END IF;
  IF COALESCE(_base_amount,0) < COALESCE(c.min_order_amount,0) THEN
    RETURN jsonb_build_object('ok',false,'reason','min_order','min_order_amount',c.min_order_amount);
  END IF;
  IF c.total_usage_limit IS NOT NULL AND COALESCE(c.used_count,0) >= c.total_usage_limit THEN
    RETURN jsonb_build_object('ok',false,'reason','exhausted');
  END IF;
  SELECT count(*) INTO _used FROM public.coupon_redemptions
   WHERE coupon_id = c.id AND user_id = _user_id AND status = 'applied';
  IF _used >= GREATEST(COALESCE(c.per_user_limit,1),1) THEN
    RETURN jsonb_build_object('ok',false,'reason','already_used');
  END IF;
  IF c.audience IN ('new_customers','existing_customers') THEN
    _orders := public.customer_completed_orders(_user_id);
    IF c.audience = 'new_customers' AND _orders > 0 THEN
      RETURN jsonb_build_object('ok',false,'reason','not_eligible','message','Valid only on your first booking');
    END IF;
    IF c.audience = 'existing_customers' AND _orders < 1 THEN
      RETURN jsonb_build_object('ok',false,'reason','not_eligible','message','Valid only for customers with a completed booking');
    END IF;
  ELSIF c.audience <> 'all' THEN
    SELECT * INTO _grant FROM public.customer_coupons WHERE coupon_id = c.id AND user_id = _user_id LIMIT 1;
    IF _grant.id IS NULL OR _grant.status <> 'available' OR (_grant.expires_at IS NOT NULL AND _grant.expires_at <= now()) THEN
      RETURN jsonb_build_object('ok',false,'reason','not_eligible');
    END IF;
  END IF;
  IF c.discount_type = 'flat' THEN
    _disc := c.discount_value;
  ELSIF c.discount_type = 'percent' THEN
    _disc := round(COALESCE(_base_amount,0) * c.discount_value / 100.0, 2);
    IF c.max_discount IS NOT NULL THEN _disc := LEAST(_disc, c.max_discount); END IF;
  ELSE
    IF COALESCE(_duration_minutes,0) <= 0 THEN RETURN jsonb_build_object('ok',false,'reason','not_applicable'); END IF;
    _disc := round(COALESCE(_base_amount,0) * LEAST(c.discount_value, _duration_minutes) / _duration_minutes::numeric, 2);
    IF c.max_discount IS NOT NULL THEN _disc := LEAST(_disc, c.max_discount); END IF;
  END IF;
  _disc := LEAST(GREATEST(COALESCE(_disc,0),0), COALESCE(_base_amount,0));
  IF _disc <= 0 THEN RETURN jsonb_build_object('ok',false,'reason','no_discount'); END IF;
  RETURN jsonb_build_object('ok',true,'coupon_id',c.id,'code',c.code,'title',c.title,'discount',_disc,'discount_type',c.discount_type);
END; $function$;

CREATE OR REPLACE FUNCTION public.staff_campaign_audience_preview(_audience text, _target_user_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _total integer := 0; _reachable integer := 0;
BEGIN
  PERFORM public.offers_caller_role();
  SELECT count(*), count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM public.device_tokens d WHERE d.user_id = u.id AND d.user_type = 'customer'))
    INTO _total, _reachable
  FROM public.users u
  WHERE u.deleted_at IS NULL AND public.campaign_audience_match(_audience, u.id, _target_user_ids);
  RETURN jsonb_build_object('total', _total, 'reachable', _reachable, 'unreachable', _total - _reachable);
END; $function$;

CREATE OR REPLACE FUNCTION public.staff_send_campaign(_id uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _role text; _city text; _before jsonb; _row public.marketing_campaigns%ROWTYPE;
  _total integer := 0; _rec record; _route text; _coupon text; _has_token boolean;
  _delivery_id uuid; _secret text; _audience text; _targets uuid[]; _url text; _link text;
BEGIN
  _role := public.offers_require_writer();
  SELECT to_jsonb(c) INTO _before FROM public.marketing_campaigns c WHERE c.id = _id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Campaign not found'; END IF;
  IF (_before->>'status') = 'sent' THEN RAISE EXCEPTION 'Campaign already sent'; END IF;

  _audience := COALESCE(_before->>'audience', 'all');
  SELECT c.target_user_ids INTO _targets FROM public.marketing_campaigns c WHERE c.id = _id;

  IF _audience = 'specific_users' THEN
    IF _targets IS NULL OR array_length(_targets, 1) IS NULL THEN
      RAISE EXCEPTION 'This campaign has no customers selected';
    END IF;
  ELSIF _role = 'ops_manager' THEN
    _city := public.offers_caller_city(auth.uid());
    IF _city IS NULL OR _audience <> _city THEN
      RAISE EXCEPTION 'You can only send campaigns for your own city';
    END IF;
  END IF;

  _link := COALESCE(NULLIF(_before->>'deep_link', ''), 'offers');
  IF _link LIKE 'offer:%' THEN
    _route := 'offers'; _coupon := NULLIF(substr(_link, 7), '');
  ELSE
    _route := _link; _coupon := NULL;
  END IF;
  SELECT value INTO _secret FROM public.edge_runtime_config WHERE key = 'push_trigger_secret';
  SELECT value INTO _url FROM public.edge_runtime_config WHERE key = 'push_endpoint_url';
  IF _url IS NULL OR _url = '' THEN _url := 'https://user.badiyos.com/api/public/push/send'; END IF;

  FOR _rec IN
    SELECT DISTINCT u.id FROM public.users u
    WHERE u.deleted_at IS NULL AND public.campaign_audience_match(_audience, u.id, _targets)
  LOOP
    SELECT EXISTS (SELECT 1 FROM public.device_tokens d WHERE d.user_id = _rec.id AND d.user_type = 'customer') INTO _has_token;
    INSERT INTO public.campaign_deliveries (campaign_id, user_id, status, error)
    VALUES (_id, _rec.id,
      CASE WHEN _has_token THEN 'queued' ELSE 'failed' END,
      CASE WHEN _has_token THEN NULL ELSE 'App not installed / no registered device' END)
    ON CONFLICT (campaign_id, user_id) DO UPDATE SET status = EXCLUDED.status, error = EXCLUDED.error
    RETURNING id INTO _delivery_id;

    IF _has_token AND _secret IS NOT NULL AND _secret <> '' THEN
      BEGIN
        PERFORM net.http_post(
          url := _url,
          headers := jsonb_build_object('content-type','application/json','x-internal-secret', _secret),
          body := jsonb_build_object(
            'user_type','customer', 'user_id', _rec.id, 'alert_type','general',
            'title', _before->>'title', 'body', COALESCE(_before->>'body',''),
            'campaign_delivery_id', _delivery_id,
            'data', jsonb_strip_nulls(jsonb_build_object('route', _route, 'alert_type', 'general', 'coupon_code', _coupon, 'campaign_id', _id))
          ));
      EXCEPTION WHEN OTHERS THEN
        UPDATE public.campaign_deliveries SET status = 'failed', error = 'Push request failed: ' || SQLERRM WHERE id = _delivery_id;
      END;
    ELSIF _has_token THEN
      UPDATE public.campaign_deliveries SET status = 'failed', error = 'Push service not configured' WHERE id = _delivery_id;
    END IF;
    _total := _total + 1;
  END LOOP;

  UPDATE public.marketing_campaigns SET status = 'sent', sent_at = now(), recipients_count = _total,
    starts_at = COALESCE(starts_at, now()), updated_at = now()
  WHERE id = _id RETURNING * INTO _row;
  PERFORM public.offers_audit('campaign_sent', 'marketing_campaigns', _id, _before, to_jsonb(_row));
  RETURN _total;
END; $function$;