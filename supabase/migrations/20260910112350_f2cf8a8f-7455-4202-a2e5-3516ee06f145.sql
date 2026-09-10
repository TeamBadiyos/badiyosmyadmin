
CREATE TABLE IF NOT EXISTS public.staff_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notif_key text NOT NULL UNIQUE,
  kind text NOT NULL,
  title text NOT NULL,
  detail text,
  target text NOT NULL DEFAULT 'dashboard',
  target_id uuid,
  event_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.staff_notifications TO authenticated;
GRANT ALL ON public.staff_notifications TO service_role;
ALTER TABLE public.staff_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff read notifications" ON public.staff_notifications;
CREATE POLICY "staff read notifications" ON public.staff_notifications
  FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid(), NULL));

CREATE TABLE IF NOT EXISTS public.staff_notification_state (
  auth_user_id uuid NOT NULL,
  notification_id uuid NOT NULL REFERENCES public.staff_notifications(id) ON DELETE CASCADE,
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (auth_user_id, notification_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_notification_state TO authenticated;
GRANT ALL ON public.staff_notification_state TO service_role;
ALTER TABLE public.staff_notification_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff own notification state" ON public.staff_notification_state;
CREATE POLICY "staff own notification state" ON public.staff_notification_state
  FOR ALL TO authenticated
  USING (auth_user_id = auth.uid() AND public.is_active_staff(auth.uid(), NULL))
  WITH CHECK (auth_user_id = auth.uid() AND public.is_active_staff(auth.uid(), NULL));

CREATE INDEX IF NOT EXISTS idx_staff_notifications_event_at ON public.staff_notifications(event_at DESC);

DROP TRIGGER IF EXISTS trg_staff_notification_state_updated ON public.staff_notification_state;
CREATE TRIGGER trg_staff_notification_state_updated
  BEFORE UPDATE ON public.staff_notification_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Build notifications from live conditions (idempotent on notif_key)
CREATE OR REPLACE FUNCTION public.staff_sync_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_active_staff(auth.uid(), NULL) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  INSERT INTO public.staff_notifications (notif_key, kind, title, detail, target, target_id, event_at)
  SELECT 'ticket:'||t.id, 'support',
         'Support ticket ('||coalesce(t.source,'customer')||')',
         left(coalesce(t.message,''), 160), 'support', t.id, t.created_at
  FROM public.support_tickets t
  WHERE t.status IN ('open','in_progress')
  ON CONFLICT (notif_key) DO NOTHING;

  INSERT INTO public.staff_notifications (notif_key, kind, title, detail, target, target_id, event_at)
  SELECT 'emergency:'||e.id, 'emergency', 'Emergency alert',
         coalesce(e.notes,'An expert raised an emergency alert.'), 'emergency', e.id, e.created_at
  FROM public.emergency_alerts e
  WHERE e.status = 'open'
  ON CONFLICT (notif_key) DO NOTHING;

  INSERT INTO public.staff_notifications (notif_key, kind, title, detail, target, target_id, event_at)
  SELECT 'needs_expert:'||b.id, 'needs_expert', 'Booking needs an expert',
         coalesce(b.service_label,'Booking')||' — no expert accepted nearby',
         'bookings', b.id, coalesce(b.dispatch_exhausted_at, b.created_at)
  FROM public.bookings b
  WHERE b.status IN ('confirmed','accepted')
    AND b.assigned_expert_id IS NULL
    AND b.deleted_at IS NULL
    AND b.dispatch_exhausted_at IS NOT NULL
  ON CONFLICT (notif_key) DO NOTHING;

  INSERT INTO public.staff_notifications (notif_key, kind, title, detail, target, target_id, event_at)
  SELECT 'extension:'||x.id, 'extension', 'Extension awaiting approval',
         'Customer requested +'||x.extra_minutes||' minutes.', 'bookings', x.booking_id, x.created_at
  FROM public.booking_extensions x
  WHERE x.approval_status = 'pending'
  ON CONFLICT (notif_key) DO NOTHING;

  INSERT INTO public.staff_notifications (notif_key, kind, title, detail, target, target_id, event_at)
  SELECT 'merchant:'||m.id, 'merchant', 'Merchant awaiting approval',
         coalesce(m.store_name,'New store')||' — '||coalesce(m.city,'')||' ('||m.status||')',
         'merchants', m.id, m.created_at
  FROM public.merchants m
  WHERE m.status IN ('pending','submitted','under_review')
  ON CONFLICT (notif_key) DO NOTHING;

  INSERT INTO public.staff_notifications (notif_key, kind, title, detail, target, target_id, event_at)
  SELECT 'skill:'||s.id, 'skill', 'Skill request awaiting approval',
         coalesce(e.name,'An expert')||' requested a new skill.', 'skills', s.id, s.created_at
  FROM public.partner_skills s
  LEFT JOIN public.experts e ON e.id = s.expert_id
  WHERE s.status = 'pending'
  ON CONFLICT (notif_key) DO NOTHING;

  INSERT INTO public.staff_notifications (notif_key, kind, title, detail, target, target_id, event_at)
  SELECT 'expert:'||x.id, 'expert', 'Expert awaiting approval',
         coalesce(x.name,'New expert')||' — '||coalesce(x.phone,''), 'experts', x.id, x.created_at
  FROM public.experts x
  WHERE x.status IN ('pending','pending_approval') OR x.kyc_status = 'pending'
  ON CONFLICT (notif_key) DO NOTHING;

  INSERT INTO public.staff_notifications (notif_key, kind, title, detail, target, target_id, event_at)
  SELECT 'deletion:'||d.id, 'deletion', 'Account deletion request',
         coalesce(d.phone,'')||coalesce(' — '||d.reason,''), 'deletion-requests', d.id, d.created_at
  FROM public.account_deletion_requests d
  WHERE d.status = 'pending'
  ON CONFLICT (notif_key) DO NOTHING;

  INSERT INTO public.staff_notifications (notif_key, kind, title, detail, target, target_id, event_at)
  SELECT 'lead_business:'||l.id, 'lead', 'New business interest lead',
         coalesce(l.business_name,'')||' — '||coalesce(l.city,'')||' ('||coalesce(l.phone,'')||')',
         'interest-leads', l.id, l.created_at
  FROM public.business_interest_leads l
  WHERE l.created_at > now() - interval '30 days'
  ON CONFLICT (notif_key) DO NOTHING;

  INSERT INTO public.staff_notifications (notif_key, kind, title, detail, target, target_id, event_at)
  SELECT 'lead_city:'||l.id, 'lead', 'New city interest lead',
         coalesce(l.name,'')||' — '||coalesce(l.city,'')||' ('||coalesce(l.phone,'')||')',
         'interest-leads', l.id, l.created_at
  FROM public.city_interest_leads l
  WHERE l.created_at > now() - interval '30 days'
  ON CONFLICT (notif_key) DO NOTHING;

  INSERT INTO public.staff_notifications (notif_key, kind, title, detail, target, target_id, event_at)
  SELECT 'lead_expert:'||l.id, 'lead', 'New expert application lead',
         coalesce(l.name,'')||' — '||coalesce(l.area,'')||' ('||coalesce(l.phone,'')||')',
         'experts', l.id, l.created_at
  FROM public.expert_leads l
  WHERE coalesce(l.status,'new') = 'new'
  ON CONFLICT (notif_key) DO NOTHING;

  INSERT INTO public.staff_notifications (notif_key, kind, title, detail, target, target_id, event_at)
  SELECT 'lead_partner:'||l.id, 'lead', 'New area partner lead',
         coalesce(l.name,'')||' — '||coalesce(l.area,'')||' ('||coalesce(l.phone,'')||')',
         'partners', l.id, l.created_at
  FROM public.area_partner_leads l
  WHERE coalesce(l.status,'new') = 'new'
  ON CONFLICT (notif_key) DO NOTHING;

  INSERT INTO public.staff_notifications (notif_key, kind, title, detail, target, target_id, event_at)
  SELECT 'waitlist:'||w.id, 'waitlist', 'New waitlist request',
         coalesce(w.city,'')||coalesce(' — '||w.address_text,''), 'waitlist', w.id, w.created_at
  FROM public.waitlist_requests w
  WHERE coalesce(w.status,'pending') = 'pending'
  ON CONFLICT (notif_key) DO NOTHING;

  INSERT INTO public.staff_notifications (notif_key, kind, title, detail, target, target_id, event_at)
  SELECT 'payout:'||p.id, 'payout', 'Payout batch awaiting payment',
         coalesce(p.batch_type,'expert')||' batch '||p.week_start||' — ₹'||round(coalesce(p.total_amount,0)),
         'wallets', p.id, p.created_at
  FROM public.payout_batches p
  WHERE p.status = 'pending'
  ON CONFLICT (notif_key) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_list_notifications(_filter text DEFAULT 'unread')
RETURNS TABLE (
  id uuid, notif_key text, kind text, title text, detail text,
  target text, target_id uuid, event_at timestamptz,
  read_at timestamptz, dismissed_at timestamptz, unread_total integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _unread integer;
BEGIN
  IF NOT public.is_active_staff(_uid, NULL) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT count(*) INTO _unread
  FROM public.staff_notifications n
  LEFT JOIN public.staff_notification_state s
    ON s.notification_id = n.id AND s.auth_user_id = _uid
  WHERE s.read_at IS NULL AND s.dismissed_at IS NULL;

  RETURN QUERY
  SELECT n.id, n.notif_key, n.kind, n.title, n.detail, n.target, n.target_id, n.event_at,
         s.read_at, s.dismissed_at, _unread
  FROM public.staff_notifications n
  LEFT JOIN public.staff_notification_state s
    ON s.notification_id = n.id AND s.auth_user_id = _uid
  WHERE CASE
    WHEN _filter = 'unread' THEN s.read_at IS NULL AND s.dismissed_at IS NULL
    WHEN _filter = 'dismissed' THEN s.dismissed_at IS NOT NULL
    ELSE s.dismissed_at IS NULL
  END
  ORDER BY n.event_at DESC
  LIMIT 100;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_mark_notification_read(_id uuid, _read boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_active_staff(auth.uid(), NULL) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  INSERT INTO public.staff_notification_state (auth_user_id, notification_id, read_at)
  VALUES (auth.uid(), _id, CASE WHEN _read THEN now() ELSE NULL END)
  ON CONFLICT (auth_user_id, notification_id)
  DO UPDATE SET read_at = CASE WHEN _read THEN now() ELSE NULL END, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_mark_all_notifications_read()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_active_staff(auth.uid(), NULL) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  INSERT INTO public.staff_notification_state (auth_user_id, notification_id, read_at)
  SELECT auth.uid(), n.id, now() FROM public.staff_notifications n
  ON CONFLICT (auth_user_id, notification_id)
  DO UPDATE SET read_at = coalesce(public.staff_notification_state.read_at, now()), updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_dismiss_notification(_id uuid, _dismissed boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_active_staff(auth.uid(), NULL) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  INSERT INTO public.staff_notification_state (auth_user_id, notification_id, read_at, dismissed_at)
  VALUES (auth.uid(), _id, now(), CASE WHEN _dismissed THEN now() ELSE NULL END)
  ON CONFLICT (auth_user_id, notification_id)
  DO UPDATE SET dismissed_at = CASE WHEN _dismissed THEN now() ELSE NULL END,
                read_at = coalesce(public.staff_notification_state.read_at, now()),
                updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_clear_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_active_staff(auth.uid(), NULL) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  INSERT INTO public.staff_notification_state (auth_user_id, notification_id, read_at, dismissed_at)
  SELECT auth.uid(), n.id, now(), now() FROM public.staff_notifications n
  ON CONFLICT (auth_user_id, notification_id)
  DO UPDATE SET dismissed_at = now(),
                read_at = coalesce(public.staff_notification_state.read_at, now()),
                updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.staff_sync_notifications() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_list_notifications(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_mark_notification_read(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_mark_all_notifications_read() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_dismiss_notification(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_clear_notifications() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.staff_sync_notifications() TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_list_notifications(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_mark_notification_read(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_mark_all_notifications_read() TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_dismiss_notification(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_clear_notifications() TO authenticated;
