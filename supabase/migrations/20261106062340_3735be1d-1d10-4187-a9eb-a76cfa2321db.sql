CREATE OR REPLACE FUNCTION public.wa_broadcast_list(_limit int DEFAULT 100)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb) FROM (
    SELECT b.id, b.campaign_name, b.created_at, b.status, b.is_test, b.total, b.sent, b.failed, b.link_code,
      (SELECT count(*) FROM wa_broadcast_recipients r WHERE r.broadcast_id=b.id AND (r.delivered_at IS NOT NULL OR r.read_at IS NOT NULL OR r.status IN ('delivered','read'))) AS delivered,
      (SELECT count(*) FROM wa_broadcast_recipients r WHERE r.broadcast_id=b.id AND (r.read_at IS NOT NULL OR r.status='read')) AS read,
      (SELECT count(*) FROM wa_broadcast_recipients r WHERE r.broadcast_id=b.id AND r.replied_at IS NOT NULL) AS replied,
      (SELECT count(*) FROM wa_broadcast_recipients r WHERE r.broadcast_id=b.id AND r.booked_at IS NOT NULL) AS booked,
      CASE WHEN b.link_code IS NULL THEN 0 ELSE
        (SELECT count(*) FROM wa_link_clicks c WHERE c.link_code=b.link_code AND c.clicked_at >= b.created_at) END AS clicks
    FROM wa_broadcasts b ORDER BY b.created_at DESC LIMIT _limit
  ) x;
$$;
REVOKE ALL ON FUNCTION public.wa_broadcast_list(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_broadcast_list(int) TO service_role;