
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.experts ADD COLUMN IF NOT EXISTS pin_hash text;
ALTER TABLE public.users   ADD COLUMN IF NOT EXISTS pin_hash text;

-- Lockouts keyed by normalized phone (digits only, no leading +)
CREATE TABLE IF NOT EXISTS public.pin_login_lockouts (
  phone text PRIMARY KEY,
  failed_attempts int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.pin_login_lockouts TO service_role;
ALTER TABLE public.pin_login_lockouts ENABLE ROW LEVEL SECURITY;
-- No policies for anon/authenticated: only service_role (edge function) touches it.

-- ---------------------------------------------------------------
-- set_login_pin: authenticated user sets/resets their own PIN
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_login_pin(p_pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _hash text;
  _expert_id uuid;
  _user_id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'PIN must be exactly 4 digits';
  END IF;

  _hash := crypt(p_pin, gen_salt('bf', 10));

  -- Expert row (linked via auth_user_id)
  SELECT id INTO _expert_id FROM public.experts WHERE auth_user_id = _uid LIMIT 1;
  IF _expert_id IS NOT NULL THEN
    UPDATE public.experts SET pin_hash = _hash WHERE id = _expert_id;
  END IF;

  -- Customer row (users.id = auth.uid())
  SELECT id INTO _user_id FROM public.users WHERE id = _uid LIMIT 1;
  IF _user_id IS NOT NULL THEN
    PERFORM set_config('app.users_bypass', 'on', true);
    UPDATE public.users SET pin_hash = _hash WHERE id = _user_id;
    PERFORM set_config('app.users_bypass', 'off', true);
  END IF;

  IF _expert_id IS NULL AND _user_id IS NULL THEN
    RAISE EXCEPTION 'No profile found for current user';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_login_pin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_login_pin(text) TO authenticated;

-- ---------------------------------------------------------------
-- verify_login_pin: used by edge function (service_role only).
-- Enforces lockout, verifies bcrypt hash, returns the auth_user_id
-- on match. Never reveals whether the phone exists.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_login_pin(
  p_phone text,
  p_pin text,
  p_user_type text
) RETURNS TABLE (
  auth_user_id uuid,
  status text,             -- 'ok' | 'invalid' | 'locked' | 'no_pin'
  retry_after_seconds int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _phone text := regexp_replace(coalesce(p_phone,''), '\D', '', 'g');
  _hash text;
  _auth_id uuid;
  _lock record;
  _match boolean := false;
  _new_attempts int;
BEGIN
  auth_user_id := NULL; status := 'invalid'; retry_after_seconds := 0;

  IF _phone = '' OR p_pin IS NULL OR p_pin !~ '^[0-9]{4}$' THEN RETURN NEXT; RETURN; END IF;
  IF p_user_type NOT IN ('customer','expert') THEN RETURN NEXT; RETURN; END IF;

  -- Check lockout
  SELECT * INTO _lock FROM public.pin_login_lockouts WHERE phone = _phone;
  IF _lock.phone IS NOT NULL AND _lock.locked_until IS NOT NULL AND _lock.locked_until > now() THEN
    status := 'locked';
    retry_after_seconds := GREATEST(1, EXTRACT(EPOCH FROM (_lock.locked_until - now()))::int);
    RETURN NEXT; RETURN;
  END IF;

  -- Lookup hash by phone + type
  IF p_user_type = 'expert' THEN
    SELECT e.pin_hash, e.auth_user_id INTO _hash, _auth_id
      FROM public.experts e
     WHERE regexp_replace(coalesce(e.phone,''), '\D', '', 'g') = _phone
       AND e.status = 'active'
     LIMIT 1;
  ELSE
    -- Customers: users.phone (stored as digits, matching get_auth_user_id_by_phone convention)
    SELECT u.pin_hash, u.id INTO _hash, _auth_id
      FROM public.users u
     WHERE regexp_replace(coalesce(u.phone,''), '\D', '', 'g') = _phone
     LIMIT 1;
  END IF;

  IF _hash IS NOT NULL AND _auth_id IS NOT NULL THEN
    _match := (_hash = crypt(p_pin, _hash));
  END IF;

  IF _match THEN
    -- Reset counter on success
    DELETE FROM public.pin_login_lockouts WHERE phone = _phone;
    auth_user_id := _auth_id;
    status := 'ok';
    RETURN NEXT; RETURN;
  END IF;

  -- Failed attempt (also on unknown phone, to avoid enumeration timing)
  INSERT INTO public.pin_login_lockouts(phone, failed_attempts, updated_at)
    VALUES(_phone, 1, now())
  ON CONFLICT (phone) DO UPDATE
    SET failed_attempts = public.pin_login_lockouts.failed_attempts + 1,
        updated_at = now()
  RETURNING failed_attempts INTO _new_attempts;

  IF _new_attempts >= 5 THEN
    UPDATE public.pin_login_lockouts
       SET locked_until = now() + interval '15 minutes',
           failed_attempts = 0,
           updated_at = now()
     WHERE phone = _phone;
    status := 'locked';
    retry_after_seconds := 15 * 60;
    RETURN NEXT; RETURN;
  END IF;

  status := CASE WHEN _hash IS NULL THEN 'invalid' ELSE 'invalid' END;
  RETURN NEXT; RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_login_pin(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_login_pin(text,text,text) TO service_role;
