
ALTER TABLE public.waitlist_requests
  ADD COLUMN IF NOT EXISTS notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS notify_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_waitlist_status_city_created
  ON public.waitlist_requests (status, city, created_at DESC);

CREATE TABLE IF NOT EXISTS public.waitlist_notify_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  waitlist_id uuid NOT NULL REFERENCES public.waitlist_requests(id) ON DELETE CASCADE,
  expert_id uuid REFERENCES public.experts(id) ON DELETE SET NULL,
  city text,
  segment_id uuid,
  channel text NOT NULL DEFAULT 'push',
  whatsapp_status text NOT NULL DEFAULT 'pending',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.waitlist_notify_events TO authenticated;
GRANT ALL ON public.waitlist_notify_events TO service_role;

ALTER TABLE public.waitlist_notify_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read waitlist notify events" ON public.waitlist_notify_events;
CREATE POLICY "Staff can read waitlist notify events"
  ON public.waitlist_notify_events FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), NULL::text[]));

CREATE INDEX IF NOT EXISTS idx_waitlist_notify_events_pending
  ON public.waitlist_notify_events (whatsapp_status, created_at);

CREATE OR REPLACE FUNCTION public.notify_customer_user_push(
  _user_id uuid, _title text, _body text, _route text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions'
AS $$
DECLARE
  _base text := 'https://dkneclwmmjlqswovtqno.supabase.co/functions/v1';
  _secret text;
BEGIN
  IF _user_id IS NULL THEN RETURN; END IF;
  SELECT value INTO _secret FROM public.edge_runtime_config WHERE key = 'push_trigger_secret';
  IF _secret IS NULL OR _secret = '' THEN RETURN; END IF;

  PERFORM net.http_post(
    url := _base || '/send-push-notification',
    headers := jsonb_build_object('content-type','application/json','x-internal-secret', _secret),
    body := jsonb_build_object(
      'user_type','customer',
      'user_id', _user_id,
      'title', _title,
      'body', _body,
      'data', jsonb_build_object('route', _route)
    )
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[notify_customer_user_push] failed for user %: %', _user_id, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_customer_user_push(uuid, text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notify_waitlist_for_expert(_expert_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions'
AS $$
DECLARE
  e record;
  w record;
  _count integer := 0;
BEGIN
  SELECT * INTO e FROM public.experts WHERE id = _expert_id;
  IF e.id IS NULL OR e.status <> 'active' OR COALESCE(e.is_online,false) = false
     OR COALESCE(e.is_busy,false) = true THEN
    RETURN 0;
  END IF;

  FOR w IN
    SELECT wr.*
      FROM public.waitlist_requests wr
     WHERE wr.notified_at IS NULL
       AND COALESCE(wr.status,'pending') IN ('pending','waiting')
       AND wr.created_at > now() - interval '7 days'
       AND wr.user_id IS NOT NULL
       AND (
         wr.segment_id IS NULL
         OR EXISTS (
           SELECT 1 FROM public.partner_skills ps
             JOIN public.service_categories sc ON sc.id = ps.service_category_id
            WHERE ps.expert_id = e.id
              AND ps.status = 'approved'
              AND sc.segment_id = wr.segment_id
         )
       )
       AND (
         CASE
           WHEN wr.latitude IS NOT NULL AND wr.longitude IS NOT NULL
                AND e.current_lat IS NOT NULL AND e.current_lng IS NOT NULL
             THEN public.haversine_km(e.current_lat, e.current_lng, wr.latitude, wr.longitude)
                  <= COALESCE(
                       (SELECT dc.broadcast_radius_km FROM public.dispatch_config dc
                         WHERE lower(dc.city) = lower(COALESCE(wr.city,'')) LIMIT 1),
                       (SELECT dc.broadcast_radius_km FROM public.dispatch_config dc LIMIT 1),
                       5)
           ELSE wr.city IS NOT NULL AND e.address IS NOT NULL
                AND lower(e.address) LIKE '%' || lower(wr.city) || '%'
         END
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.waitlist_notify_events ev
          WHERE ev.created_at > now() - interval '15 minutes'
            AND COALESCE(lower(ev.city),'') = COALESCE(lower(wr.city),'')
            AND COALESCE(ev.segment_id, '00000000-0000-0000-0000-000000000000'::uuid)
                = COALESCE(wr.segment_id, '00000000-0000-0000-0000-000000000000'::uuid)
       )
     LIMIT 200
  LOOP
    PERFORM public.notify_customer_user_push(
      w.user_id,
      'An expert is available near you',
      'Good news — an expert is now free in your area. Tap to book.',
      '/home'
    );

    INSERT INTO public.waitlist_notify_events (waitlist_id, expert_id, city, segment_id, channel, payload)
    VALUES (
      w.id, e.id, w.city, w.segment_id, 'push',
      jsonb_build_object(
        'phone', (SELECT u.phone FROM public.users u WHERE u.id = w.user_id),
        'name',  (SELECT u.name  FROM public.users u WHERE u.id = w.user_id),
        'city', w.city,
        'area', w.address_text
      )
    );

    UPDATE public.waitlist_requests
       SET notified_at = now(), notify_count = COALESCE(notify_count,0) + 1
     WHERE id = w.id;

    _count := _count + 1;
  END LOOP;

  RETURN _count;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[notify_waitlist_for_expert] failed for expert %: %', _expert_id, SQLERRM;
  RETURN _count;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_waitlist_for_expert(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.experts_after_availability_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF (COALESCE(OLD.is_online,false) = false AND COALESCE(NEW.is_online,false) = true)
     OR (COALESCE(OLD.is_busy,false) = true AND COALESCE(NEW.is_busy,false) = false
         AND COALESCE(NEW.is_online,false) = true) THEN
    BEGIN
      PERFORM public.notify_waitlist_for_expert(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[experts_after_availability_change] %', SQLERRM;
    END;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_experts_waitlist_notify ON public.experts;
CREATE TRIGGER trg_experts_waitlist_notify
AFTER UPDATE OF is_online, is_busy ON public.experts
FOR EACH ROW EXECUTE FUNCTION public.experts_after_availability_change();

CREATE OR REPLACE FUNCTION public.staff_notify_waitlist_area(_city text, _segment_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE w record; _count integer := 0;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), NULL::text[]) THEN RAISE EXCEPTION 'Not authorised'; END IF;

  FOR w IN
    SELECT * FROM public.waitlist_requests wr
     WHERE wr.notified_at IS NULL
       AND COALESCE(wr.status,'pending') IN ('pending','waiting')
       AND wr.user_id IS NOT NULL
       AND (_city IS NULL OR lower(COALESCE(wr.city,'')) = lower(_city))
       AND (_segment_id IS NULL OR wr.segment_id = _segment_id)
     LIMIT 500
  LOOP
    PERFORM public.notify_customer_user_push(
      w.user_id,
      'An expert is available near you',
      'Good news — an expert is now free in your area. Tap to book.',
      '/home'
    );
    INSERT INTO public.waitlist_notify_events (waitlist_id, city, segment_id, channel, payload)
    VALUES (w.id, w.city, w.segment_id, 'push',
      jsonb_build_object(
        'phone', (SELECT u.phone FROM public.users u WHERE u.id = w.user_id),
        'name',  (SELECT u.name  FROM public.users u WHERE u.id = w.user_id),
        'city', w.city, 'area', w.address_text, 'manual', true));
    UPDATE public.waitlist_requests
       SET notified_at = now(), notify_count = COALESCE(notify_count,0) + 1
     WHERE id = w.id;
    _count := _count + 1;
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'waitlist_manual_notify', 'waitlist_requests', NULL,
          jsonb_build_object('city', _city, 'segment_id', _segment_id, 'notified', _count));

  RETURN _count;
END;
$$;

REVOKE ALL ON FUNCTION public.staff_notify_waitlist_area(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_notify_waitlist_area(text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.system_pending_waitlist_whatsapp()
RETURNS TABLE (event_id uuid, city text, phone text, customer_name text, template_name text, numbers text[])
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT ev.id,
         ev.city,
         ev.payload->>'phone',
         ev.payload->>'name',
         (SELECT dc.aisensy_template_name FROM public.dispatch_config dc
           WHERE lower(dc.city) = lower(COALESCE(ev.city,'')) LIMIT 1),
         ARRAY[COALESCE(ev.payload->>'phone','')]::text[]
    FROM public.waitlist_notify_events ev
   WHERE ev.whatsapp_status = 'pending'
     AND COALESCE(ev.payload->>'phone','') <> ''
   ORDER BY ev.created_at
   LIMIT 100;
$$;

CREATE OR REPLACE FUNCTION public.system_mark_waitlist_whatsapp(_event_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$
  UPDATE public.waitlist_notify_events SET whatsapp_status = 'sent' WHERE id = _event_id;
$$;

REVOKE ALL ON FUNCTION public.system_pending_waitlist_whatsapp() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.system_mark_waitlist_whatsapp(uuid) FROM PUBLIC, anon, authenticated;
