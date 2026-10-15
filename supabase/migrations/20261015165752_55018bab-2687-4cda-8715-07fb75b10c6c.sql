ALTER TABLE public.support_ticket_messages
  ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS attachment_url text;
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS assigned_staff_id uuid;

-- Customers/experts/merchants never see internal notes
DROP POLICY IF EXISTS "Users can view messages of own tickets" ON public.support_ticket_messages;
CREATE POLICY "Users can view messages of own tickets" ON public.support_ticket_messages
  FOR SELECT TO authenticated
  USING (NOT is_internal AND EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = support_ticket_messages.ticket_id AND t.user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.support_ticket_message_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _ticket public.support_tickets%ROWTYPE;
BEGIN
  IF NEW.is_internal THEN RETURN NEW; END IF;
  SELECT * INTO _ticket FROM public.support_tickets WHERE id = NEW.ticket_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF NEW.sender_type = 'staff' THEN
    UPDATE public.support_tickets SET last_message_at = NEW.created_at, updated_at = now(), unread_for_customer = true,
      status = CASE WHEN status = 'resolved' THEN status ELSE 'answered' END WHERE id = NEW.ticket_id;
    BEGIN
      PERFORM public.notify_push_event('customer', _ticket.user_id, 'support_reply', 'badiyos Support replied',
        left(NEW.body, 120), jsonb_build_object('ticket_id', NEW.ticket_id, 'route', 'support'));
    EXCEPTION WHEN OTHERS THEN RAISE WARNING '[support reply notify] %', SQLERRM; END;
  ELSE
    UPDATE public.support_tickets SET last_message_at = NEW.created_at, updated_at = now(), unread_for_customer = false,
      status = CASE WHEN status = 'answered' THEN 'open' ELSE status END WHERE id = NEW.ticket_id;
  END IF;
  RETURN NEW;
END $$;

-- Customer app marks staff messages seen when it reads them
CREATE OR REPLACE FUNCTION public.support_mark_seen_by_user(_ticket_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM support_tickets WHERE id=_ticket_id AND user_id=auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  UPDATE support_ticket_messages SET seen_at = now() WHERE ticket_id=_ticket_id AND sender_type='staff' AND seen_at IS NULL AND NOT is_internal;
  UPDATE support_tickets SET unread_for_customer=false WHERE id=_ticket_id;
END $$;
REVOKE ALL ON FUNCTION public.support_mark_seen_by_user(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.support_mark_seen_by_user(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_mark_ticket_seen(_ticket_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  UPDATE support_ticket_messages SET seen_at = now() WHERE ticket_id=_ticket_id AND sender_type<>'staff' AND seen_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION public.staff_mark_ticket_seen(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_mark_ticket_seen(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_add_support_note(_ticket_id uuid, _body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _id uuid; _clean text := btrim(coalesce(_body,''));
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _clean = '' THEN RAISE EXCEPTION 'Note is empty'; END IF;
  INSERT INTO support_ticket_messages(ticket_id, sender_type, sender_id, body, is_internal, seen_at)
  VALUES (_ticket_id, 'staff', auth.uid(), _clean, true, now()) RETURNING id INTO _id;
  INSERT INTO audit_logs(actor_id, action, target_table, target_id, after_state)
  VALUES (auth.uid(), 'add_support_note', 'support_ticket_messages', _id, jsonb_build_object('ticket_id',_ticket_id,'body',_clean));
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.staff_add_support_note(uuid,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_add_support_note(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_assign_support_ticket(_ticket_id uuid, _staff_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  UPDATE support_tickets SET assigned_staff_id=_staff_id, updated_at=now() WHERE id=_ticket_id;
  INSERT INTO audit_logs(actor_id, action, target_table, target_id, after_state)
  VALUES (auth.uid(), 'assign_support_ticket', 'support_tickets', _ticket_id, jsonb_build_object('assigned_staff_id',_staff_id));
END $$;
REVOKE ALL ON FUNCTION public.staff_assign_support_ticket(uuid,uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_assign_support_ticket(uuid,uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.support_quick_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_quick_replies TO authenticated;
GRANT ALL ON public.support_quick_replies TO service_role;
ALTER TABLE public.support_quick_replies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage quick replies" ON public.support_quick_replies FOR ALL TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']))
  WITH CHECK (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));
INSERT INTO public.support_quick_replies(title, body, sort_order) VALUES
 ('Greeting','Namaste! Badiyos Support here. How can we help you?',1),
 ('Checking','Thanks for waiting — we are checking this for you and will update in a few minutes.',2),
 ('Delay','Sorry for the delay. Your Expert/rider is on the way and will reach shortly.',3),
 ('Refund','Your refund has been started. It reaches your account in 5–7 working days.',4),
 ('Resolved','Glad we could help! Closing this chat now. Reach out anytime.',5);