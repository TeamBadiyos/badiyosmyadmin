CREATE OR REPLACE FUNCTION public.notify_expert_broadcast(_expert_id uuid, _booking_id uuid, _title text, _body text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $$
DECLARE _addr text; _dur int; _timeout int := 60;
BEGIN
  IF _expert_id IS NULL THEN RETURN; END IF;
  BEGIN
    INSERT INTO public.booking_broadcast_pings(booking_id, expert_id, last_pinged_at)
    VALUES (_booking_id, _expert_id, now())
    ON CONFLICT (booking_id, expert_id) DO UPDATE SET last_pinged_at = now();
  EXCEPTION WHEN others THEN NULL; END;
  BEGIN
    SELECT coalesce(nullif(a.area,''), split_part(coalesce(a.full_address,''), ',', 1)), b.service_duration_minutes
      INTO _addr, _dur
      FROM public.bookings b LEFT JOIN public.addresses a ON a.id = b.address_id WHERE b.id = _booking_id;
  EXCEPTION WHEN others THEN NULL; END;
  PERFORM public.notify_expert_alert(_expert_id, 'new_order', _title, _body,
    jsonb_strip_nulls(jsonb_build_object('booking_id', _booking_id, 'type','new_booking_broadcast',
      'route','booking/' || _booking_id::text,
      'address', nullif(_addr,''),
      'duration', CASE WHEN _dur IS NOT NULL THEN _dur::text || ' min' END,
      'accept_timeout_seconds', _timeout::text,
      'expires_at', to_char((now() + make_interval(secs => _timeout)) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))));
END $$;

CREATE OR REPLACE FUNCTION public.notify_expert_assigned()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _addr text;
BEGIN
  IF NEW.assigned_expert_id IS NOT NULL
     AND (OLD.assigned_expert_id IS DISTINCT FROM NEW.assigned_expert_id)
     AND NEW.status = 'expert_assigned' THEN
    BEGIN
      SELECT coalesce(nullif(area,''), split_part(coalesce(full_address,''), ',', 1)) INTO _addr
        FROM public.addresses WHERE id = NEW.address_id;
      PERFORM public.notify_expert_alert(NEW.assigned_expert_id, 'assigned', 'New job assigned',
        COALESCE(NEW.service_label,'A new job') || ' has been assigned to you. Tap to view details.',
        jsonb_strip_nulls(jsonb_build_object('booking_id', NEW.id, 'route','booking/' || NEW.id::text,
          'address', nullif(_addr,''),
          'duration', CASE WHEN NEW.service_duration_minutes IS NOT NULL THEN NEW.service_duration_minutes::text || ' min' END,
          'accept_timeout_seconds','60')));
    EXCEPTION WHEN OTHERS THEN RAISE WARNING '[notify_expert_assigned] %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $$;