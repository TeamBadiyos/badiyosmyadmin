ALTER TABLE public.dispatch_config ADD COLUMN IF NOT EXISTS no_accept_minutes jsonb;
UPDATE public.dispatch_config SET no_accept_minutes = jsonb_build_object(
  'maid', greatest(1, round(no_accept_alert_threshold_seconds/60.0)),
  'wash', greatest(1, round(no_accept_alert_threshold_seconds/60.0)),
  'store', greatest(1, round(no_accept_alert_threshold_seconds/60.0)),
  'food', greatest(1, round(no_accept_alert_threshold_seconds/60.0)),
  'parcel', greatest(1, round(no_accept_alert_threshold_seconds/60.0)))
WHERE no_accept_minutes IS NULL;

-- Keep the legacy seconds column (used by the booking no-accept check) derived from the per-service value.
CREATE OR REPLACE FUNCTION public.dispatch_config_sync_threshold() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.no_accept_minutes ? 'maid' THEN
    NEW.no_accept_alert_threshold_seconds := greatest(30, (NEW.no_accept_minutes->>'maid')::numeric * 60)::int;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS dispatch_config_sync_threshold ON public.dispatch_config;
CREATE TRIGGER dispatch_config_sync_threshold BEFORE INSERT OR UPDATE ON public.dispatch_config
FOR EACH ROW EXECUTE FUNCTION public.dispatch_config_sync_threshold();

-- Dispatch alerts feed the staff notification bell.
CREATE OR REPLACE FUNCTION public.dispatch_alert_to_notification() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.staff_notifications (notif_key, kind, title, detail, target, target_id, event_at)
  VALUES ('dispatch:'||NEW.id, 'dispatch',
    CASE WHEN NEW.alert_type = 'no_accept' THEN 'No expert accepted' ELSE 'No expert available' END,
    'Waiting too long' || coalesce(' · '||NEW.city, ''),
    'bookings', NEW.booking_id, NEW.triggered_at)
  ON CONFLICT (notif_key) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS dispatch_alert_to_notification ON public.dispatch_alert_events;
CREATE TRIGGER dispatch_alert_to_notification AFTER INSERT ON public.dispatch_alert_events
FOR EACH ROW EXECUTE FUNCTION public.dispatch_alert_to_notification();

INSERT INTO public.staff_notifications (notif_key, kind, title, detail, target, target_id, event_at)
SELECT 'dispatch:'||e.id, 'dispatch',
  CASE WHEN e.alert_type = 'no_accept' THEN 'No expert accepted' ELSE 'No expert available' END,
  'Waiting too long' || coalesce(' · '||e.city, ''), 'bookings', e.booking_id, e.triggered_at
FROM public.dispatch_alert_events e WHERE e.triggered_at > now() - interval '2 days'
ON CONFLICT (notif_key) DO NOTHING;

-- Support chat image attachments: path = <ticket_id>/<file>
CREATE POLICY "Staff upload support attachments" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'support-attachments' AND public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));
CREATE POLICY "Staff read support attachments" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'support-attachments' AND public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));
CREATE POLICY "Ticket owner reads support attachments" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'support-attachments' AND EXISTS (
  SELECT 1 FROM public.support_tickets t WHERE t.id::text = (storage.foldername(name))[1] AND t.user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.staff_send_support_attachment(_ticket_id uuid, _path text, _body text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF split_part(_path, '/', 1) <> _ticket_id::text THEN RAISE EXCEPTION 'Invalid attachment path'; END IF;
  INSERT INTO public.support_ticket_messages (ticket_id, sender_type, body, attachment_url)
  VALUES (_ticket_id, 'staff', coalesce(nullif(trim(_body), ''), 'Photo'), _path);
  UPDATE public.support_tickets SET status = 'answered', updated_at = now() WHERE id = _ticket_id AND status <> 'resolved';
END $$;
REVOKE ALL ON FUNCTION public.staff_send_support_attachment(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_send_support_attachment(uuid, text, text) TO authenticated;