CREATE TABLE public.booking_broadcast_pings (
  booking_id uuid NOT NULL,
  expert_id uuid NOT NULL,
  last_pinged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (booking_id, expert_id)
);
GRANT ALL ON public.booking_broadcast_pings TO service_role;
ALTER TABLE public.booking_broadcast_pings ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.rebroadcast_open_bookings(_expert_id uuid DEFAULT NULL, _min_gap_minutes integer DEFAULT 5)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; _n integer := 0; _max numeric;
BEGIN
  SELECT max_radius_km INTO _max FROM public.dispatch_config LIMIT 1;
  _max := COALESCE(_max, 15);
  FOR r IN
    SELECT b.id AS booking_id, e.id AS expert_id, b.service_duration_minutes AS dur
    FROM public.bookings b
    JOIN public.experts e ON e.is_online AND COALESCE(e.is_busy,false) = false
      AND e.status = 'active'
      AND e.mode = (CASE WHEN COALESCE(b.is_training,false) THEN 'TRAINING' ELSE 'LIVE' END)
      AND e.current_lat IS NOT NULL AND e.current_lng IS NOT NULL
      AND (_expert_id IS NULL OR e.id = _expert_id)
    WHERE b.status = 'accepted' AND b.assigned_expert_id IS NULL
      AND b.broadcast_started_at IS NOT NULL
      AND b.booking_lat IS NOT NULL AND b.booking_lng IS NOT NULL
      AND public.haversine_km(e.current_lat, e.current_lng, b.booking_lat, b.booking_lng)
          <= GREATEST(COALESCE(b.current_search_radius_km, 0), _max)
      AND (b.service_category_id IS NULL OR EXISTS (
        SELECT 1 FROM public.partner_skills ps WHERE ps.expert_id = e.id
          AND ps.status = 'approved' AND ps.service_category_id = b.service_category_id))
      AND NOT EXISTS (SELECT 1 FROM public.booking_broadcast_pings p
        WHERE p.booking_id = b.id AND p.expert_id = e.id
          AND p.last_pinged_at > now() - make_interval(mins => _min_gap_minutes))
  LOOP
    PERFORM public.notify_expert_broadcast(r.expert_id, r.booking_id, 'New booking nearby',
      CASE WHEN r.dur IS NULL THEN 'A' WHEN r.dur >= 60 AND r.dur % 60 = 0 THEN (r.dur/60)::text||'h' ELSE r.dur::text||' min' END
      || ' booking available near you — tap to view.');
    INSERT INTO public.booking_broadcast_pings(booking_id, expert_id, last_pinged_at)
      VALUES (r.booking_id, r.expert_id, now())
      ON CONFLICT (booking_id, expert_id) DO UPDATE SET last_pinged_at = now();
    _n := _n + 1;
  END LOOP;
  DELETE FROM public.booking_broadcast_pings WHERE last_pinged_at < now() - interval '1 day';
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.rebroadcast_open_bookings(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rebroadcast_open_bookings(uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.experts_on_became_available()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.is_online AND COALESCE(NEW.is_busy,false) = false AND NEW.status = 'active'
     AND (NOT COALESCE(OLD.is_online,false) OR COALESCE(OLD.is_busy,false)) THEN
    BEGIN
      PERFORM public.rebroadcast_open_bookings(NEW.id, 0);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[experts_on_became_available] %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_expert_became_available ON public.experts;
CREATE TRIGGER trg_expert_became_available AFTER UPDATE OF is_online, is_busy ON public.experts
FOR EACH ROW EXECUTE FUNCTION public.experts_on_became_available();