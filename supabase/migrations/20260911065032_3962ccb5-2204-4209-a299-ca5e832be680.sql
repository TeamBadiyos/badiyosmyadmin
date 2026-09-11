CREATE OR REPLACE FUNCTION public.staff_sync_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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

  -- Auto-resolve: remove notifications whose source work is no longer outstanding.
  DELETE FROM public.staff_notifications n
  WHERE n.notif_key NOT IN (
    SELECT 'ticket:'||t.id FROM public.support_tickets t WHERE t.status IN ('open','in_progress')
    UNION ALL SELECT 'emergency:'||e.id FROM public.emergency_alerts e WHERE e.status = 'open'
    UNION ALL SELECT 'needs_expert:'||b.id FROM public.bookings b
      WHERE b.status IN ('confirmed','accepted') AND b.assigned_expert_id IS NULL
        AND b.deleted_at IS NULL AND b.dispatch_exhausted_at IS NOT NULL
    UNION ALL SELECT 'extension:'||x.id FROM public.booking_extensions x WHERE x.approval_status = 'pending'
    UNION ALL SELECT 'merchant:'||m.id FROM public.merchants m WHERE m.status IN ('pending','submitted','under_review')
    UNION ALL SELECT 'skill:'||s.id FROM public.partner_skills s WHERE s.status = 'pending'
    UNION ALL SELECT 'expert:'||x.id FROM public.experts x WHERE x.status IN ('pending','pending_approval') OR x.kyc_status = 'pending'
    UNION ALL SELECT 'deletion:'||d.id FROM public.account_deletion_requests d WHERE d.status = 'pending'
    UNION ALL SELECT 'lead_business:'||l.id FROM public.business_interest_leads l WHERE l.created_at > now() - interval '30 days'
    UNION ALL SELECT 'lead_city:'||l.id FROM public.city_interest_leads l WHERE l.created_at > now() - interval '30 days'
    UNION ALL SELECT 'lead_expert:'||l.id FROM public.expert_leads l WHERE coalesce(l.status,'new') = 'new'
    UNION ALL SELECT 'lead_partner:'||l.id FROM public.area_partner_leads l WHERE coalesce(l.status,'new') = 'new'
    UNION ALL SELECT 'waitlist:'||w.id FROM public.waitlist_requests w WHERE coalesce(w.status,'pending') = 'pending'
    UNION ALL SELECT 'payout:'||p.id FROM public.payout_batches p WHERE p.status = 'pending'
  );
END;
$fn$;