CREATE OR REPLACE FUNCTION public.staff_delete_event_offer(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin_user() THEN RAISE EXCEPTION 'Only super admin can delete offers' USING errcode='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.event_offers WHERE id=_id) THEN RAISE EXCEPTION 'Offer not found'; END IF;
  DELETE FROM public.event_offers WHERE id=_id;
END $$;

CREATE OR REPLACE FUNCTION public.staff_delete_spin_event(_event_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _before jsonb;
BEGIN
  IF NOT public.is_super_admin_user() THEN RAISE EXCEPTION 'Only super admin can delete Spin & Win events' USING errcode='42501'; END IF;
  SELECT to_jsonb(e) INTO _before FROM public.spin_events e WHERE id=_event_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Event not found'; END IF;
  DELETE FROM public.spin_prize_reminders WHERE draw_id IN (SELECT id FROM public.spin_draws WHERE event_id=_event_id);
  DELETE FROM public.spin_prize_tokens WHERE event_id=_event_id;
  DELETE FROM public.spin_events WHERE id=_event_id;
  PERFORM public.offers_audit('spin_event_deleted','spin_events',_event_id,_before,NULL);
END $$;

REVOKE ALL ON FUNCTION public.staff_delete_event_offer(uuid), public.staff_delete_spin_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_delete_event_offer(uuid), public.staff_delete_spin_event(uuid) TO authenticated;