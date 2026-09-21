-- 1) status vocabulary: queued | delivered | failed
ALTER TABLE public.campaign_deliveries DROP CONSTRAINT IF EXISTS campaign_deliveries_status_chk;
UPDATE public.campaign_deliveries SET status = 'delivered' WHERE status = 'sent';
ALTER TABLE public.campaign_deliveries
  ADD CONSTRAINT campaign_deliveries_status_chk
  CHECK (status = ANY (ARRAY['queued'::text, 'delivered'::text, 'failed'::text]));

-- 2) audience preview (read-only)
CREATE OR REPLACE FUNCTION public.staff_campaign_audience_preview(_audience text)
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
      _audience = 'all'
      OR EXISTS (
        SELECT 1 FROM public.addresses a
        WHERE a.user_id = u.id AND a.city ILIKE _audience
      )
    );

  RETURN jsonb_build_object(
    'total', _total,
    'reachable', _reachable,
    'unreachable', _total - _reachable
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.staff_campaign_audience_preview(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_campaign_audience_preview(text) TO authenticated, service_role;

-- 3) send campaign: queue rows first, push carries the delivery id so the
--    edge function can write back the real FCM outcome.
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
  _base text := 'https://dkneclwmmjlqswovtqno.supabase.co/functions/v1';
BEGIN
  _role := public.offers_require_writer();

  SELECT to_jsonb(c) INTO _before FROM public.marketing_campaigns c WHERE c.id = _id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Campaign not found'; END IF;
  IF (_before->>'status') = 'sent' THEN RAISE EXCEPTION 'Campaign already sent'; END IF;

  IF _role = 'ops_manager' THEN
    _city := public.offers_caller_city(auth.uid());
    IF _city IS NULL OR (_before->>'audience') <> _city THEN
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
        (_before->>'audience') = 'all'
        OR EXISTS (
          SELECT 1 FROM public.addresses a
          WHERE a.user_id = u.id
            AND a.city ILIKE (_before->>'audience')
        )
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
