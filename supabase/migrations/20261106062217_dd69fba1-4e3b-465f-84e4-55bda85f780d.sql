
CREATE TABLE public.wa_broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_name text NOT NULL,
  media_url text,
  media_filename text,
  params jsonb NOT NULL DEFAULT '[]'::jsonb,
  include_all_customers boolean NOT NULL DEFAULT false,
  link_code text,
  total int NOT NULL DEFAULT 0,
  sent int NOT NULL DEFAULT 0,
  failed int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','done')),
  is_test boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.wa_broadcast_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id uuid NOT NULL REFERENCES public.wa_broadcasts(id) ON DELETE CASCADE,
  customer_id uuid,
  phone text NOT NULL,
  name text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','delivered','read','failed')),
  error text,
  claimed_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  replied_at timestamptz,
  reply_text text,
  button_text text,
  booked_at timestamptz,
  booking_id uuid,
  UNIQUE (broadcast_id, phone)
);
CREATE INDEX wa_recipients_phone_sent_idx ON public.wa_broadcast_recipients (phone, sent_at DESC);
CREATE INDEX wa_recipients_broadcast_status_idx ON public.wa_broadcast_recipients (broadcast_id, status);
CREATE TRIGGER a00_phone_std BEFORE INSERT OR UPDATE ON public.wa_broadcast_recipients
  FOR EACH ROW EXECUTE FUNCTION public.trg_phone_std('phone');

CREATE TABLE public.wa_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at timestamptz NOT NULL DEFAULT now(),
  event_type text,
  phone text,
  raw jsonb,
  signature_valid boolean NOT NULL DEFAULT false,
  matched_recipient_id uuid
);
CREATE INDEX wa_webhook_events_received_idx ON public.wa_webhook_events (received_at DESC);
CREATE TRIGGER a00_phone_std BEFORE INSERT OR UPDATE ON public.wa_webhook_events
  FOR EACH ROW EXECUTE FUNCTION public.trg_phone_std('phone');

CREATE TABLE public.wa_link_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_code text NOT NULL,
  clicked_at timestamptz NOT NULL DEFAULT now(),
  user_agent text
);
CREATE INDEX wa_link_clicks_code_idx ON public.wa_link_clicks (link_code, clicked_at);

ALTER TABLE public.wa_broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_broadcast_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_link_clicks ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.wa_broadcasts, public.wa_broadcast_recipients, public.wa_webhook_events, public.wa_link_clicks TO authenticated;
GRANT ALL ON public.wa_broadcasts, public.wa_broadcast_recipients, public.wa_webhook_events, public.wa_link_clicks TO service_role;

CREATE POLICY wa_broadcasts_staff_read ON public.wa_broadcasts FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));
CREATE POLICY wa_recipients_staff_read ON public.wa_broadcast_recipients FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));
CREATE POLICY wa_events_super_read ON public.wa_webhook_events FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin']));
CREATE POLICY wa_clicks_staff_read ON public.wa_link_clicks FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

-- Claim a batch of pending recipients so parallel runs never double-send.
CREATE OR REPLACE FUNCTION public.wa_claim_pending(_broadcast_id uuid, _limit int)
RETURNS SETOF public.wa_broadcast_recipients
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.wa_broadcast_recipients r SET claimed_at = now()
  WHERE r.id IN (
    SELECT id FROM public.wa_broadcast_recipients
    WHERE broadcast_id = _broadcast_id AND status = 'pending'
      AND (claimed_at IS NULL OR claimed_at < now() - interval '5 minutes')
    ORDER BY id LIMIT _limit FOR UPDATE SKIP LOCKED)
  RETURNING r.*;
$$;

CREATE OR REPLACE FUNCTION public.wa_refresh_counts(_broadcast_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.wa_broadcasts b SET
    sent = (SELECT count(*) FROM public.wa_broadcast_recipients WHERE broadcast_id = b.id AND status IN ('sent','delivered','read')),
    failed = (SELECT count(*) FROM public.wa_broadcast_recipients WHERE broadcast_id = b.id AND status = 'failed'),
    status = CASE WHEN EXISTS (SELECT 1 FROM public.wa_broadcast_recipients WHERE broadcast_id = b.id AND status = 'pending') THEN 'sending' ELSE 'done' END
  WHERE b.id = _broadcast_id;
$$;

-- Booked attribution: first booking within 3 days after the message was sent.
CREATE OR REPLACE FUNCTION public.wa_attribute_bookings()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  UPDATE public.wa_broadcast_recipients r SET booked_at = x.created_at, booking_id = x.id
  FROM (
    SELECT DISTINCT ON (r2.id) r2.id AS rid, b.id, b.created_at
    FROM public.wa_broadcast_recipients r2
    JOIN public.bookings b ON b.user_id = r2.customer_id
      AND b.deleted_at IS NULL
      AND b.created_at >= r2.sent_at AND b.created_at < r2.sent_at + interval '3 days'
    WHERE r2.customer_id IS NOT NULL AND r2.booked_at IS NULL AND r2.sent_at IS NOT NULL
    ORDER BY r2.id, b.created_at
  ) x
  WHERE r.id = x.rid;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.wa_claim_pending(uuid,int), public.wa_refresh_counts(uuid), public.wa_attribute_bookings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_claim_pending(uuid,int), public.wa_refresh_counts(uuid), public.wa_attribute_bookings() TO service_role;

CREATE POLICY broadcast_media_staff_upload ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'broadcast-media' AND public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));
