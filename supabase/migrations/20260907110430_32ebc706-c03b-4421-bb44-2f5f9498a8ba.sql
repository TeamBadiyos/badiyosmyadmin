DROP FUNCTION IF EXISTS public.staff_update_support_ticket(uuid, text, text);

CREATE OR REPLACE FUNCTION public.staff_update_support_ticket(_ticket_id uuid, _status text, _note text DEFAULT NULL::text, _resolution text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _staff_id uuid; _before jsonb; _submitter uuid; _actor text; _msg text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _status NOT IN ('open','in_progress','resolved') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  SELECT id INTO _staff_id FROM public.staff_users WHERE auth_user_id = _uid;

  SELECT to_jsonb(t), t.user_id INTO _before, _submitter FROM public.support_tickets t WHERE t.id = _ticket_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Ticket not found'; END IF;

  UPDATE public.support_tickets
     SET status = _status,
         internal_note = COALESCE(_note, internal_note),
         resolution_summary = CASE WHEN _status = 'resolved' THEN COALESCE(_resolution, resolution_summary) ELSE resolution_summary END,
         resolved_at = CASE WHEN _status = 'resolved' THEN COALESCE(resolved_at, now()) ELSE NULL END,
         resolved_by = CASE WHEN _status = 'resolved' THEN _staff_id ELSE NULL END,
         updated_at = now()
   WHERE id = _ticket_id;

  IF _status = 'resolved' AND _submitter IS NOT NULL
     AND COALESCE(_before->>'status','') <> 'resolved' THEN
    _msg := COALESCE(NULLIF(_resolution,''), NULLIF(_note,''), 'Your support request has been resolved.');
    IF EXISTS (SELECT 1 FROM public.experts e WHERE e.auth_user_id = _submitter) THEN
      _actor := 'expert';
    ELSIF EXISTS (SELECT 1 FROM public.merchants m WHERE m.auth_user_id = _submitter) THEN
      _actor := 'merchant';
    ELSE
      _actor := 'customer';
    END IF;
    BEGIN
      PERFORM public.notify_push_event(
        _actor, _submitter, 'ticket_resolved',
        'Support request resolved', _msg,
        jsonb_build_object('route', 'help', 'ticket_id', _ticket_id)
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[ticket_resolved notify] %', SQLERRM;
    END;
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES(_uid, 'update_support_ticket', 'support_tickets', _ticket_id, _before,
         jsonb_build_object('status', _status, 'internal_note', _note, 'resolution_summary', _resolution));
END $function$;

CREATE OR REPLACE FUNCTION public.notify_expert_assigned()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE _label text;
BEGIN
  IF NEW.assigned_expert_id IS NOT NULL
     AND (OLD.assigned_expert_id IS DISTINCT FROM NEW.assigned_expert_id)
     AND NEW.status = 'expert_assigned' THEN
    _label := COALESCE(NEW.service_label, 'A new job');
    BEGIN
      PERFORM public.notify_expert_push(
        NEW.assigned_expert_id,
        'New job assigned',
        _label || ' has been assigned to you. Tap to view details.',
        'booking/' || NEW.id::text
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[notify_expert_assigned] %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $function$;