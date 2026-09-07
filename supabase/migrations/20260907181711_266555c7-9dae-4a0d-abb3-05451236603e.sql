CREATE TABLE public.account_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  email text,
  reason text,
  status text NOT NULL DEFAULT 'pending',
  staff_note text,
  handled_by uuid REFERENCES public.staff_users(id),
  handled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.account_deletion_requests TO authenticated;
GRANT ALL ON public.account_deletion_requests TO service_role;

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view deletion requests"
ON public.account_deletion_requests FOR SELECT TO authenticated
USING (public.is_active_staff(auth.uid(), NULL::text[]));

CREATE TRIGGER update_account_deletion_requests_updated_at
BEFORE UPDATE ON public.account_deletion_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.staff_update_deletion_request(
  _request_id uuid,
  _status text,
  _note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff uuid;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), NULL::text[]) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  IF _status NOT IN ('pending','in_progress','completed','rejected') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;
  SELECT id INTO v_staff FROM public.staff_users WHERE auth_user_id = auth.uid() LIMIT 1;

  UPDATE public.account_deletion_requests
  SET status = _status,
      staff_note = COALESCE(_note, staff_note),
      handled_by = v_staff,
      handled_at = CASE WHEN _status IN ('completed','rejected') THEN now() ELSE handled_at END
  WHERE id = _request_id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, after_state)
  VALUES (auth.uid(), 'deletion_request_' || _status, 'account_deletion_requests', _request_id,
          jsonb_build_object('status', _status, 'note', _note));
END;
$$;

REVOKE ALL ON FUNCTION public.staff_update_deletion_request(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.staff_update_deletion_request(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.staff_update_deletion_request(uuid, text, text) TO authenticated;