DROP FUNCTION IF EXISTS public.wa_broadcast_list(int);
DROP TABLE IF EXISTS public.wa_webhook_events;

UPDATE public.wa_broadcast_recipients SET status = 'sent' WHERE status IN ('delivered','read');
ALTER TABLE public.wa_broadcast_recipients DROP CONSTRAINT IF EXISTS wa_broadcast_recipients_status_check;
ALTER TABLE public.wa_broadcast_recipients ADD CONSTRAINT wa_broadcast_recipients_status_check
  CHECK (status IN ('pending','sending','sent','failed'));
ALTER TABLE public.wa_broadcast_recipients
  DROP COLUMN IF EXISTS delivered_at, DROP COLUMN IF EXISTS read_at,
  DROP COLUMN IF EXISTS replied_at, DROP COLUMN IF EXISTS reply_text, DROP COLUMN IF EXISTS button_text;

DROP FUNCTION IF EXISTS public.wa_claim_pending(uuid,int);
CREATE FUNCTION public.wa_claim_pending(_broadcast_id uuid, _limit int)
RETURNS SETOF public.wa_broadcast_recipients
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Release rows stuck in 'sending' > 5 min where no AiSensy success was recorded.
  UPDATE public.wa_broadcast_recipients SET status = 'pending', claimed_at = NULL
  WHERE broadcast_id = _broadcast_id AND status = 'sending' AND sent_at IS NULL
    AND claimed_at < now() - interval '5 minutes';
  -- Atomic claim: only rows this call locks are returned and sent.
  RETURN QUERY
  UPDATE public.wa_broadcast_recipients r SET status = 'sending', claimed_at = now()
  WHERE r.id IN (
    SELECT id FROM public.wa_broadcast_recipients
    WHERE broadcast_id = _broadcast_id AND status = 'pending'
    ORDER BY id LIMIT _limit FOR UPDATE SKIP LOCKED)
  RETURNING r.*;
END $$;

CREATE OR REPLACE FUNCTION public.wa_refresh_counts(_broadcast_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.wa_broadcasts b SET
    sent = (SELECT count(*) FROM public.wa_broadcast_recipients WHERE broadcast_id = b.id AND status = 'sent'),
    failed = (SELECT count(*) FROM public.wa_broadcast_recipients WHERE broadcast_id = b.id AND status = 'failed'),
    status = CASE WHEN EXISTS (SELECT 1 FROM public.wa_broadcast_recipients WHERE broadcast_id = b.id AND status IN ('pending','sending')) THEN 'sending' ELSE 'done' END
  WHERE b.id = _broadcast_id;
$$;

CREATE FUNCTION public.wa_broadcast_list(_limit int DEFAULT 100)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb) FROM (
    SELECT b.id, b.campaign_name, b.created_at, b.status, b.is_test, b.total, b.sent, b.failed, b.link_code,
      (SELECT count(*) FROM wa_broadcast_recipients r WHERE r.broadcast_id=b.id AND r.booked_at IS NOT NULL) AS booked,
      CASE WHEN b.link_code IS NULL THEN 0 ELSE
        (SELECT count(*) FROM wa_link_clicks c WHERE c.link_code=b.link_code AND c.clicked_at >= b.created_at) END AS clicks
    FROM wa_broadcasts b ORDER BY b.created_at DESC LIMIT _limit
  ) x;
$$;

REVOKE ALL ON FUNCTION public.wa_claim_pending(uuid,int), public.wa_refresh_counts(uuid), public.wa_broadcast_list(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_claim_pending(uuid,int), public.wa_refresh_counts(uuid), public.wa_broadcast_list(int) TO service_role;