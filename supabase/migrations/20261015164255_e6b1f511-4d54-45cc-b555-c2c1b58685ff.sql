CREATE OR REPLACE FUNCTION public.staff_send_campaign_test(_id uuid, _phone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _c public.marketing_campaigns%ROWTYPE; _uid uuid; _devices int; _secret text; _url text;
  _link text; _route text; _coupon text; _digits text;
BEGIN
  PERFORM public.offers_require_writer();
  SELECT * INTO _c FROM public.marketing_campaigns WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Campaign not found'; END IF;
  _digits := right(regexp_replace(coalesce(_phone,''), '\D', '', 'g'), 10);
  IF length(_digits) <> 10 THEN RAISE EXCEPTION 'Enter a 10-digit phone number'; END IF;
  SELECT u.id INTO _uid FROM public.users u
   WHERE u.deleted_at IS NULL AND right(regexp_replace(coalesce(u.phone,''), '\D', '', 'g'), 10) = _digits LIMIT 1;
  IF _uid IS NULL THEN RAISE EXCEPTION 'No customer account with this phone number'; END IF;
  SELECT count(*) INTO _devices FROM public.device_tokens WHERE user_id = _uid AND user_type = 'customer';
  IF _devices = 0 THEN RAISE EXCEPTION 'This phone has no app installed / no registered device'; END IF;
  _link := COALESCE(NULLIF(_c.deep_link, ''), 'offers');
  IF _link LIKE 'offer:%' THEN _route := 'offers'; _coupon := NULLIF(substr(_link, 7), '');
  ELSE _route := _link; _coupon := NULL; END IF;
  SELECT value INTO _secret FROM public.edge_runtime_config WHERE key = 'push_trigger_secret';
  SELECT value INTO _url FROM public.edge_runtime_config WHERE key = 'push_endpoint_url';
  IF _url IS NULL OR _url = '' THEN _url := 'https://user.badiyos.com/api/public/push/send'; END IF;
  IF _secret IS NULL OR _secret = '' THEN RAISE EXCEPTION 'Push service not configured'; END IF;
  PERFORM net.http_post(
    url := _url,
    headers := jsonb_build_object('content-type','application/json','x-internal-secret', _secret),
    body := jsonb_build_object('user_type','customer','user_id',_uid,'alert_type','general',
      'title', '[TEST] ' || _c.title, 'body', COALESCE(_c.body,''),
      'data', jsonb_strip_nulls(jsonb_build_object('route',_route,'alert_type','general','coupon_code',_coupon,'campaign_id',_id,'test','1'))));
  RETURN jsonb_build_object('devices', _devices);
END; $function$;
REVOKE ALL ON FUNCTION public.staff_send_campaign_test(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_send_campaign_test(uuid, text) TO authenticated, service_role;