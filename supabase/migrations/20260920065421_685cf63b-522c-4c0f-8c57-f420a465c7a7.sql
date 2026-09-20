
-- 1) Staff reply RPC
CREATE OR REPLACE FUNCTION public.staff_send_support_message(_ticket_id uuid, _body text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _before jsonb; _msg_id uuid; _clean text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  _clean := btrim(COALESCE(_body, ''));
  IF _clean = '' THEN RAISE EXCEPTION 'Message is empty'; END IF;

  SELECT to_jsonb(t) INTO _before FROM public.support_tickets t WHERE t.id = _ticket_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Ticket not found'; END IF;
  IF COALESCE(_before->>'status','') = 'resolved' THEN
    RAISE EXCEPTION 'Ticket is resolved. Reopen it to reply.';
  END IF;

  INSERT INTO public.support_ticket_messages(ticket_id, sender_type, sender_id, body)
  VALUES (_ticket_id, 'staff', _uid, _clean)
  RETURNING id INTO _msg_id;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES(_uid, 'send_support_message', 'support_ticket_messages', _msg_id, _before,
         jsonb_build_object('ticket_id', _ticket_id, 'body', _clean));

  RETURN _msg_id;
END $function$;

REVOKE ALL ON FUNCTION public.staff_send_support_message(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_send_support_message(uuid, text) TO authenticated, service_role;

-- 2) Allow 'answered' status in the staff update RPC
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
  IF _status NOT IN ('open','in_progress','answered','resolved') THEN RAISE EXCEPTION 'Invalid status'; END IF;
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

-- 3) Customers cannot post on a resolved ticket (no silent reopen)
DROP POLICY IF EXISTS "Users can write on own tickets" ON public.support_ticket_messages;
CREATE POLICY "Users can write on own tickets"
ON public.support_ticket_messages
FOR INSERT TO authenticated
WITH CHECK (
  sender_type = 'customer'
  AND sender_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.support_tickets t
    WHERE t.id = support_ticket_messages.ticket_id
      AND t.user_id = auth.uid()
      AND t.status <> 'resolved'
  )
);

-- 4) Trigger: keep reopen behaviour only for non-resolved tickets
CREATE OR REPLACE FUNCTION public.support_ticket_message_after_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _ticket public.support_tickets%ROWTYPE;
BEGIN
  SELECT * INTO _ticket FROM public.support_tickets WHERE id = NEW.ticket_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF NEW.sender_type = 'staff' THEN
    UPDATE public.support_tickets
       SET last_message_at = NEW.created_at,
           updated_at = now(),
           unread_for_customer = true,
           status = CASE WHEN status = 'resolved' THEN status ELSE 'answered' END
     WHERE id = NEW.ticket_id;

    BEGIN
      PERFORM public.notify_push_event(
        'customer', _ticket.user_id, 'support_reply',
        'badiyos Support replied',
        left(NEW.body, 120),
        jsonb_build_object('ticket_id', NEW.ticket_id, 'route', 'support')
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[support reply notify] %', SQLERRM;
    END;
  ELSE
    UPDATE public.support_tickets
       SET last_message_at = NEW.created_at,
           updated_at = now(),
           unread_for_customer = false,
           status = CASE WHEN status = 'answered' THEN 'open' ELSE status END
     WHERE id = NEW.ticket_id;
  END IF;

  RETURN NEW;
END $function$;
