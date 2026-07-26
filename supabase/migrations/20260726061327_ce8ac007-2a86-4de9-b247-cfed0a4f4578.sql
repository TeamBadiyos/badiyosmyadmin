
-- Device tokens for push notifications
CREATE TABLE public.device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_type text NOT NULL CHECK (user_type IN ('customer','expert','staff')),
  user_id uuid NOT NULL,
  fcm_token text NOT NULL UNIQUE,
  platform text NOT NULL CHECK (platform IN ('android','web','ios')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_device_tokens_user ON public.device_tokens(user_type, user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_tokens TO authenticated;
GRANT ALL ON public.device_tokens TO service_role;

ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

-- Helper: resolve caller identity across customer/expert/staff
CREATE OR REPLACE FUNCTION public.resolve_caller_identity(_auth_uid uuid)
RETURNS TABLE(user_type text, user_id uuid)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _id uuid;
BEGIN
  IF _auth_uid IS NULL THEN RETURN; END IF;

  SELECT id INTO _id FROM public.staff_users WHERE auth_user_id = _auth_uid AND status='active' LIMIT 1;
  IF _id IS NOT NULL THEN user_type := 'staff'; user_id := _id; RETURN NEXT; RETURN; END IF;

  SELECT id INTO _id FROM public.experts WHERE auth_user_id = _auth_uid LIMIT 1;
  IF _id IS NOT NULL THEN user_type := 'expert'; user_id := _id; RETURN NEXT; RETURN; END IF;

  SELECT id INTO _id FROM public.users WHERE id = _auth_uid LIMIT 1;
  IF _id IS NOT NULL THEN user_type := 'customer'; user_id := _id; RETURN NEXT; RETURN; END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.resolve_caller_identity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_caller_identity(uuid) TO authenticated, service_role;

-- RLS: users can manage only their own tokens (resolved via identity)
CREATE POLICY "Users manage own device tokens (select)" ON public.device_tokens
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.resolve_caller_identity(auth.uid()) r
    WHERE r.user_type = device_tokens.user_type AND r.user_id = device_tokens.user_id
  )
);

CREATE POLICY "Users manage own device tokens (insert)" ON public.device_tokens
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.resolve_caller_identity(auth.uid()) r
    WHERE r.user_type = device_tokens.user_type AND r.user_id = device_tokens.user_id
  )
);

CREATE POLICY "Users manage own device tokens (update)" ON public.device_tokens
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.resolve_caller_identity(auth.uid()) r
    WHERE r.user_type = device_tokens.user_type AND r.user_id = device_tokens.user_id
  )
);

CREATE POLICY "Users manage own device tokens (delete)" ON public.device_tokens
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.resolve_caller_identity(auth.uid()) r
    WHERE r.user_type = device_tokens.user_type AND r.user_id = device_tokens.user_id
  )
);

CREATE TRIGGER trg_device_tokens_updated_at
BEFORE UPDATE ON public.device_tokens
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Registration RPC
CREATE OR REPLACE FUNCTION public.register_device_token(p_fcm_token text, p_platform text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _type text;
  _id uuid;
  _row_id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_fcm_token IS NULL OR btrim(p_fcm_token) = '' THEN RAISE EXCEPTION 'Token required'; END IF;
  IF p_platform NOT IN ('android','web','ios') THEN RAISE EXCEPTION 'Invalid platform'; END IF;

  SELECT r.user_type, r.user_id INTO _type, _id
    FROM public.resolve_caller_identity(_uid) r LIMIT 1;
  IF _type IS NULL THEN RAISE EXCEPTION 'No profile found for user'; END IF;

  INSERT INTO public.device_tokens (user_type, user_id, fcm_token, platform, last_used_at, updated_at)
  VALUES (_type, _id, btrim(p_fcm_token), p_platform, now(), now())
  ON CONFLICT (fcm_token) DO UPDATE
    SET user_type = EXCLUDED.user_type,
        user_id = EXCLUDED.user_id,
        platform = EXCLUDED.platform,
        last_used_at = now(),
        updated_at = now()
  RETURNING id INTO _row_id;

  RETURN _row_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.register_device_token(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_device_token(text, text) TO authenticated;
