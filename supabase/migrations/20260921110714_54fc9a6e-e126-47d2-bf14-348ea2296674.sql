CREATE OR REPLACE FUNCTION public.staff_send_campaign(_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _role text;
  _city text;
  _before jsonb;
  _row public.marketing_campaigns%ROWTYPE;
  _total integer := 0;
  _rec record;
  _route text;
  _has_token boolean;
  _delivery_id uuid;
  _secret text;
  _audience text;
  _targets uuid[];
  _url text;
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

  _route := COALESCE(NULLIF(_before->>'deep_link', ''), 'offers');
  SELECT value INTO _secret FROM public.edge_runtime_config WHERE key = 'push_trigger_secret';
  SELECT value INTO _url FROM public.edge_runtime_config WHERE key = 'push_endpoint_url';
  IF _url IS NULL OR _url = '' THEN
    _url := 'https://user.badiyos.com/api/public/push/send';
  END IF;

  FOR _rec IN
    SELECT DISTINCT u.id
    FROM public.users u
    WHERE u.deleted_at IS NULL
      AND (
        CASE
          WHEN _audience = 'specific_users' THEN u.id = ANY (_targets)
          WHEN _audience = 'all' THEN true
          ELSE EXISTS (
            SELECT 1 FROM public.addresses a
            WHERE a.user_id = u.id AND a.city ILIKE _audience
          )
        END
      )
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.device_tokens d
      WHERE d.user_id = _rec.id AND d.user_type = 'customer'
    ) INTO _has_token;

    INSERT INTO public.campaign_deliveries (campaign_id, user_id, status, error)
    VALUES (
      _id, _rec.id,
      CASE WHEN _has_token THEN 'queued' ELSE 'failed' END,
      CASE WHEN _has_token THEN NULL ELSE 'App not installed / no registered device' END
    )
    ON CONFLICT (campaign_id, user_id) DO UPDATE
      SET status = EXCLUDED.status, error = EXCLUDED.error
    RETURNING id INTO _delivery_id;

    IF _has_token AND _secret IS NOT NULL AND _secret <> '' THEN
      BEGIN
        PERFORM net.http_post(
          url := _url,
          headers := jsonb_build_object('content-type','application/json','x-internal-secret', _secret),
          body := jsonb_build_object(
            'user_type','customer',
            'user_id', _rec.id,
            'alert_type','general',
            'title', _before->>'title',
            'body', COALESCE(_before->>'body',''),
            'campaign_delivery_id', _delivery_id,
            'data', jsonb_build_object('route', _route, 'alert_type', 'general')
          )
        );
      EXCEPTION WHEN OTHERS THEN
        UPDATE public.campaign_deliveries
           SET status = 'failed', error = 'Push request failed: ' || SQLERRM
         WHERE id = _delivery_id;
      END;
    ELSIF _has_token THEN
      UPDATE public.campaign_deliveries
         SET status = 'failed', error = 'Push service not configured'
       WHERE id = _delivery_id;
    END IF;

    _total := _total + 1;
  END LOOP;

  UPDATE public.marketing_campaigns SET
    status = 'sent',
    sent_at = now(),
    recipients_count = _total,
    starts_at = COALESCE(starts_at, now()),
    updated_at = now()
  WHERE id = _id RETURNING * INTO _row;

  PERFORM public.offers_audit('campaign_sent', 'marketing_campaigns', _id, _before, to_jsonb(_row));
  RETURN _total;
END;
$function$;