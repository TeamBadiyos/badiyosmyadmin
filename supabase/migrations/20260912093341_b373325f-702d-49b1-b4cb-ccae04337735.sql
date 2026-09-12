
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
           WHEN COALESCE(wr.latitude,0) <> 0 AND COALESCE(wr.longitude,0) <> 0
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
