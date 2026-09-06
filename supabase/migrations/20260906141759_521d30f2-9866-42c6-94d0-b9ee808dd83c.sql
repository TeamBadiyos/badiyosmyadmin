
-- ===== Support tickets =====
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'customer',
  ADD COLUMN IF NOT EXISTS internal_note text,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES public.staff_users(id),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP POLICY IF EXISTS "Staff can view all tickets" ON public.support_tickets;
CREATE POLICY "Staff can view all tickets" ON public.support_tickets
  FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

CREATE OR REPLACE FUNCTION public.staff_update_support_ticket(
  _ticket_id uuid, _status text, _note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid(); _staff_id uuid; _before jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _status NOT IN ('open','in_progress','resolved') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  SELECT id INTO _staff_id FROM public.staff_users WHERE auth_user_id = _uid;

  SELECT to_jsonb(t) INTO _before FROM public.support_tickets t WHERE t.id = _ticket_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Ticket not found'; END IF;

  UPDATE public.support_tickets
     SET status = _status,
         internal_note = COALESCE(_note, internal_note),
         resolved_at = CASE WHEN _status = 'resolved' THEN COALESCE(resolved_at, now()) ELSE NULL END,
         resolved_by = CASE WHEN _status = 'resolved' THEN _staff_id ELSE NULL END,
         updated_at = now()
   WHERE id = _ticket_id;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES(_uid, 'update_support_ticket', 'support_tickets', _ticket_id, _before,
         jsonb_build_object('status', _status, 'internal_note', _note));
END $$;

REVOKE ALL ON FUNCTION public.staff_update_support_ticket(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_update_support_ticket(uuid, text, text) TO authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.support_tickets;

-- ===== Ops settings + stale online detection =====
CREATE TABLE IF NOT EXISTS public.ops_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  label text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ops_settings TO authenticated;
GRANT ALL ON public.ops_settings TO service_role;
ALTER TABLE public.ops_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read ops settings" ON public.ops_settings;
CREATE POLICY "Staff can read ops settings" ON public.ops_settings
  FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

INSERT INTO public.ops_settings(key, value, label)
VALUES ('expert_stale_online_minutes', '1440', 'Minutes of inactivity before an online expert is auto-marked offline')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.staff_set_ops_setting(_key text, _value text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ops_settings WHERE key = _key) THEN
    RAISE EXCEPTION 'Unknown setting';
  END IF;
  UPDATE public.ops_settings SET value = _value, updated_at = now() WHERE key = _key;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES(_uid, 'update_ops_setting', 'ops_settings', NULL, NULL,
         jsonb_build_object('key', _key, 'value', _value));
END $$;

REVOKE ALL ON FUNCTION public.staff_set_ops_setting(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_set_ops_setting(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.expire_stale_online_experts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _minutes int; _count int;
BEGIN
  SELECT COALESCE(NULLIF(value,'')::int, 1440) INTO _minutes
    FROM public.ops_settings WHERE key = 'expert_stale_online_minutes';
  _minutes := COALESCE(_minutes, 1440);

  WITH upd AS (
    UPDATE public.experts
       SET is_online = false
     WHERE is_online = true
       AND COALESCE(location_updated_at, to_timestamp(0)) < now() - make_interval(mins => _minutes)
    RETURNING id
  )
  SELECT count(*) INTO _count FROM upd;
  RETURN _count;
END $$;

REVOKE ALL ON FUNCTION public.expire_stale_online_experts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_online_experts() TO service_role;

CREATE OR REPLACE FUNCTION public.staff_force_expert_offline(_expert_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  UPDATE public.experts SET is_online = false WHERE id = _expert_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES(_uid, 'force_expert_offline', 'experts', _expert_id, NULL,
         jsonb_build_object('is_online', false));
END $$;

REVOKE ALL ON FUNCTION public.staff_force_expert_offline(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_force_expert_offline(uuid) TO authenticated;

SELECT cron.schedule('expire-stale-online-experts', '0 * * * *',
  $$SELECT public.expire_stale_online_experts();$$);
