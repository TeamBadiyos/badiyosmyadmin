CREATE OR REPLACE FUNCTION public.notify_push_event(_user_type text, _user_id uuid, _alert_type text, _title text, _body text, _data jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $$
DECLARE _url text; _secret text;
BEGIN
  BEGIN
    IF _user_id IS NULL THEN RETURN; END IF;
    SELECT value INTO _secret FROM public.edge_runtime_config WHERE key = 'push_trigger_secret';
    IF _secret IS NULL OR _secret = '' THEN RETURN; END IF;
    IF _user_type = 'expert' AND _alert_type IN ('new_order','assigned','broadcast','extension_request','courier_offer') THEN
      -- Expert job offers: data-only sender (no notification block)
      _url := 'https://dkneclwmmjlqswovtqno.supabase.co/functions/v1/send-push-notification';
    ELSE
      SELECT value INTO _url FROM public.edge_runtime_config WHERE key = 'push_endpoint_url';
      IF _url IS NULL OR _url = '' THEN _url := 'https://user.badiyos.com/api/public/push/send'; END IF;
    END IF;
    PERFORM net.http_post(url := _url,
      headers := jsonb_build_object('content-type','application/json','x-internal-secret', _secret),
      body := jsonb_build_object('user_type',_user_type,'user_id',_user_id,'alert_type',_alert_type,
        'title',_title,'body',_body,
        'data', COALESCE(_data,'{}'::jsonb) || jsonb_build_object('alert_type',_alert_type)));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[notify_push_event] % failed for %: %', _alert_type, _user_id, SQLERRM;
  END;
END $$;

CREATE OR REPLACE FUNCTION public.notify_expert_broadcast(_expert_id uuid, _booking_id uuid, _title text, _body text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $$
DECLARE b record; _timeout int := 60;
BEGIN
  IF _expert_id IS NULL THEN RETURN; END IF;
  BEGIN
    INSERT INTO public.booking_broadcast_pings(booking_id, expert_id, last_pinged_at)
    VALUES (_booking_id, _expert_id, now())
    ON CONFLICT (booking_id, expert_id) DO UPDATE SET last_pinged_at = now();
  EXCEPTION WHEN others THEN NULL; END;
  SELECT id, address, service_label, duration_hours INTO b FROM public.bookings WHERE id = _booking_id;
  PERFORM public.notify_expert_alert(_expert_id, 'new_order', _title, _body,
    jsonb_strip_nulls(jsonb_build_object('booking_id', _booking_id, 'type','new_booking_broadcast',
      'route','booking/' || _booking_id::text,
      'address', split_part(coalesce(b.address,''), ',', 1),
      'duration', CASE WHEN b.duration_hours IS NOT NULL THEN b.duration_hours::text || 'H' END,
      'accept_timeout_seconds', _timeout::text,
      'expires_at', to_char((now() + make_interval(secs => _timeout)) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))));
EXCEPTION WHEN others THEN RAISE WARNING '[notify_expert_broadcast] %', SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION public.notify_expert_assigned()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.assigned_expert_id IS NOT NULL
     AND (OLD.assigned_expert_id IS DISTINCT FROM NEW.assigned_expert_id)
     AND NEW.status = 'expert_assigned' THEN
    BEGIN
      PERFORM public.notify_expert_alert(NEW.assigned_expert_id, 'assigned', 'New job assigned',
        COALESCE(NEW.service_label,'A new job') || ' has been assigned to you. Tap to view details.',
        jsonb_strip_nulls(jsonb_build_object('booking_id', NEW.id, 'route','booking/' || NEW.id::text,
          'address', split_part(coalesce(NEW.address,''), ',', 1),
          'accept_timeout_seconds','60')));
    EXCEPTION WHEN OTHERS THEN RAISE WARNING '[notify_expert_assigned] %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $$;