ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS assigned_expert_id uuid REFERENCES public.experts(id);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  action text NOT NULL,
  target_table text NOT NULL,
  target_id uuid,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read audit logs"
ON public.audit_logs
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.staff_users s
    WHERE s.auth_user_id = auth.uid() AND s.status = 'active'
  )
);

CREATE OR REPLACE FUNCTION public.staff_assign_expert(_booking_id uuid, _expert_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _is_staff boolean;
  _before jsonb;
  _after jsonb;
  _expert_ok boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.staff_users WHERE auth_user_id = _uid AND status = 'active')
    INTO _is_staff;
  IF NOT _is_staff THEN RAISE EXCEPTION 'Forbidden'; END IF;

  SELECT EXISTS (SELECT 1 FROM public.experts WHERE id = _expert_id AND status = 'active')
    INTO _expert_ok;
  IF NOT _expert_ok THEN RAISE EXCEPTION 'Expert not available'; END IF;

  SELECT to_jsonb(b) INTO _before FROM public.bookings b WHERE id = _booking_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF (_before->>'status') <> 'accepted' THEN RAISE EXCEPTION 'Booking not accepted'; END IF;

  PERFORM set_config('app.booking_bypass', 'on', true);
  UPDATE public.bookings
    SET assigned_expert_id = _expert_id,
        status = 'assigned'
    WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass', 'off', true);

  SELECT to_jsonb(b) INTO _after FROM public.bookings b WHERE id = _booking_id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'assign_expert', 'bookings', _booking_id, _before, _after);
END;
$$;

REVOKE ALL ON FUNCTION public.staff_assign_expert(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_assign_expert(uuid, uuid) TO authenticated;