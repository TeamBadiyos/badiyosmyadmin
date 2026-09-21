ALTER TABLE public.marketing_campaigns
  ADD COLUMN IF NOT EXISTS target_user_ids uuid[];

-- upsert with optional specific-user targeting
DROP FUNCTION IF EXISTS public.staff_upsert_campaign(uuid, text, text, text, text, text, uuid, boolean);

CREATE OR REPLACE FUNCTION public.staff_upsert_campaign(
  _id uuid,
  _title text,
  _body text,
  _image_url text,
  _deep_link text,
  _audience text,
  _coupon_id uuid,
  _show_in_offers boolean,
  _target_user_ids uuid[] DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _role text; _city text; _before jsonb; _row public.marketing_campaigns%ROWTYPE; _targets uuid[];
BEGIN
  _role := public.offers_require_writer();

  IF COALESCE(_audience, 'all') = 'specific_users' THEN
    SELECT array_agg(DISTINCT t) INTO _targets
    FROM unnest(COALESCE(_target_user_ids, ARRAY[]::uuid[])) AS t;
    IF _targets IS NULL OR array_length(_targets, 1) IS NULL THEN
      RAISE EXCEPTION 'Select at least one customer';
    END IF;
  ELSE
    _targets := NULL;
    IF _role = 'ops_manager' THEN
      _city := public.offers_caller_city(auth.uid());
      IF _city IS NULL THEN
        RAISE EXCEPTION 'Your account has no assigned city, so city campaigns cannot be created';
      END IF;
      IF COALESCE(_audience, 'all') <> _city THEN
        RAISE EXCEPTION 'You can only create campaigns for your city (%)', _city;
      END IF;
    END IF;
  END IF;

  IF _role = 'ops_manager' AND COALESCE(_audience, 'all') = 'specific_users' THEN
    _city := public.offers_caller_city(auth.uid());
    IF _city IS NULL THEN
      RAISE EXCEPTION 'Your account has no assigned city';
    END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(_targets) AS t
      WHERE NOT EXISTS (
        SELECT 1 FROM public.addresses a
        WHERE a.user_id = t AND a.city ILIKE _city
      )
    ) THEN
      RAISE EXCEPTION 'You can only send to customers in your city (%)', _city;
    END IF;
  END IF;

  IF _id IS NULL THEN
    INSERT INTO public.marketing_campaigns (
      title, body, image_url, deep_link, audience, coupon_id, show_in_offers, status, created_by, target_user_ids
    ) VALUES (
      _title, _body, NULLIF(_image_url, ''), NULLIF(_deep_link, ''), COALESCE(_audience, 'all'),
      _coupon_id, COALESCE(_show_in_offers, true), 'draft', auth.uid(), _targets
    ) RETURNING * INTO _row;
    PERFORM public.offers_audit('campaign_created', 'marketing_campaigns', _row.id, NULL, to_jsonb(_row));
  ELSE
    SELECT to_jsonb(c) INTO _before FROM public.marketing_campaigns c WHERE c.id = _id;
    IF _before IS NULL THEN RAISE EXCEPTION 'Campaign not found'; END IF;
    IF (_before->>'status') = 'sent' THEN
      RAISE EXCEPTION 'A campaign that has already been sent cannot be edited';
    END IF;
    UPDATE public.marketing_campaigns SET
      title = _title,
      body = _body,
      image_url = NULLIF(_image_url, ''),
      deep_link = NULLIF(_deep_link, ''),
      audience = COALESCE(_audience, 'all'),
      coupon_id = _coupon_id,
      show_in_offers = COALESCE(_show_in_offers, true),
      target_user_ids = _targets,
      updated_at = now()
    WHERE id = _id RETURNING * INTO _row;
    PERFORM public.offers_audit('campaign_updated', 'marketing_campaigns', _row.id, _before, to_jsonb(_row));
  END IF;

  RETURN _row.id;
END;
$$;

REVOKE ALL ON FUNCTION public.staff_upsert_campaign(uuid, text, text, text, text, text, uuid, boolean, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_upsert_campaign(uuid, text, text, text, text, text, uuid, boolean, uuid[]) TO authenticated, service_role;

-- audience preview supports an explicit list
CREATE OR REPLACE FUNCTION public.staff_campaign_audience_preview(_audience text, _target_user_ids uuid[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _total integer := 0;
  _reachable integer := 0;
BEGIN
  PERFORM public.offers_caller_role();

  SELECT count(*), count(*) FILTER (
           WHERE EXISTS (
             SELECT 1 FROM public.device_tokens d
             WHERE d.user_id = u.id AND d.user_type = 'customer'
           )
         )
    INTO _total, _reachable
  FROM public.users u
  WHERE u.deleted_at IS NULL
    AND (
      CASE
        WHEN _audience = 'specific_users'
          THEN u.id = ANY (COALESCE(_target_user_ids, ARRAY[]::uuid[]))
        WHEN _audience = 'all' THEN true
        ELSE EXISTS (
          SELECT 1 FROM public.addresses a
          WHERE a.user_id = u.id AND a.city ILIKE _audience
        )
      END
    );

  RETURN jsonb_build_object(
    'total', _total,
    'reachable', _reachable,
    'unreachable', _total - _reachable
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.staff_campaign_audience_preview(text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_campaign_audience_preview(text, uuid[]) TO authenticated, service_role;

-- send: honour specific-user audience
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
  _base text := 'https://dkneclwmmjlqswovtqno.supabase.co/functions/v1';
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
          url := _base || '/send-push-notification',
          headers := jsonb_build_object('content-type','application/json','x-internal-secret', _secret),
          body := jsonb_build_object(
            'user_type','customer',
            'user_id', _rec.id,
            'title', _before->>'title',
            'body', COALESCE(_before->>'body',''),
            'campaign_delivery_id', _delivery_id,
            'data', jsonb_build_object('route', _route)
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

REVOKE ALL ON FUNCTION public.staff_send_campaign(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_send_campaign(uuid) TO authenticated, service_role;