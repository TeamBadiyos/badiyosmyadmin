
-- Helper: is the caller an active super_admin?
CREATE OR REPLACE FUNCTION public.is_super_admin_user()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff_users
    WHERE auth_user_id = auth.uid()
      AND status = 'active'
      AND role = 'super_admin'
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_super_admin_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin_user() TO authenticated, service_role;

-- 1. Edit user profile (name / email / language)
CREATE OR REPLACE FUNCTION public.staff_update_user(
  _user_id uuid,
  _full_name text,
  _email text,
  _preferred_language text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _before public.users%ROWTYPE;
  _name text := nullif(btrim(_full_name), '');
  _mail text := nullif(btrim(_email), '');
  _lang text := coalesce(nullif(btrim(_preferred_language), ''), 'en');
BEGIN
  IF NOT public.is_super_admin_user() THEN
    RAISE EXCEPTION 'Forbidden: super admin only';
  END IF;
  IF _name IS NULL THEN
    RAISE EXCEPTION 'Name is required';
  END IF;
  IF _mail IS NOT NULL AND _mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Invalid email address';
  END IF;
  IF _lang NOT IN ('en', 'hi') THEN
    RAISE EXCEPTION 'Unsupported language';
  END IF;

  SELECT * INTO _before FROM public.users WHERE id = _user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  UPDATE public.users
  SET full_name = _name,
      email = _mail,
      preferred_language = _lang,
      updated_at = now()
  WHERE id = _user_id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (
    auth.uid(),
    'update_user',
    'users',
    _user_id::text,
    jsonb_build_object('full_name', _before.full_name, 'email', _before.email, 'preferred_language', _before.preferred_language),
    jsonb_build_object('full_name', _name, 'email', _mail, 'preferred_language', _lang)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.staff_update_user(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_update_user(uuid, text, text, text) TO authenticated, service_role;

-- 2. Soft delete / restore
CREATE OR REPLACE FUNCTION public.staff_set_user_deleted(_user_id uuid, _deleted boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _before public.users%ROWTYPE;
  _active integer;
BEGIN
  IF NOT public.is_super_admin_user() THEN
    RAISE EXCEPTION 'Forbidden: super admin only';
  END IF;

  SELECT * INTO _before FROM public.users WHERE id = _user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF _deleted THEN
    SELECT count(*) INTO _active
    FROM public.bookings
    WHERE user_id = _user_id
      AND status NOT IN ('completed', 'cancelled', 'rejected', 'expired', 'refunded');
    IF _active > 0 THEN
      RAISE EXCEPTION 'User has % active booking(s). Complete or cancel them first.', _active;
    END IF;
    UPDATE public.users SET deleted_at = now(), updated_at = now() WHERE id = _user_id;
  ELSE
    UPDATE public.users SET deleted_at = null, updated_at = now() WHERE id = _user_id;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (
    auth.uid(),
    CASE WHEN _deleted THEN 'soft_delete_user' ELSE 'restore_user' END,
    'users',
    _user_id::text,
    jsonb_build_object('deleted_at', _before.deleted_at, 'full_name', _before.full_name, 'phone', _before.phone),
    jsonb_build_object('deleted', _deleted)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.staff_set_user_deleted(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_set_user_deleted(uuid, boolean) TO authenticated, service_role;

-- 3. Permanent delete (typed phone confirmation; PII purge, financial history anonymized)
CREATE OR REPLACE FUNCTION public.staff_permanently_delete_user(_user_id uuid, _confirm_phone text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _before public.users%ROWTYPE;
  _history integer;
BEGIN
  IF NOT public.is_super_admin_user() THEN
    RAISE EXCEPTION 'Forbidden: super admin only';
  END IF;

  SELECT * INTO _before FROM public.users WHERE id = _user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF nullif(btrim(coalesce(_confirm_phone, '')), '') IS NULL
     OR btrim(_confirm_phone) <> coalesce(_before.phone, '') THEN
    RAISE EXCEPTION 'Confirmation phone number does not match';
  END IF;

  -- Personal data purge
  DELETE FROM public.device_tokens WHERE user_id = _user_id AND user_type = 'customer';
  DELETE FROM public.device_sessions WHERE user_id = _user_id AND user_type = 'customer';
  DELETE FROM public.support_tickets WHERE user_id = _user_id;
  DELETE FROM public.waitlist_requests WHERE user_id = _user_id;
  DELETE FROM public.referral_transactions WHERE referrer_id = _user_id OR referred_user_id = _user_id;
  DELETE FROM public.customer_coupons WHERE user_id = _user_id;
  IF _before.phone IS NOT NULL THEN
    DELETE FROM public.account_deletion_requests WHERE phone = _before.phone;
  END IF;
  DELETE FROM public.addresses WHERE user_id = _user_id;

  SELECT (SELECT count(*) FROM public.bookings WHERE user_id = _user_id)
       + (SELECT count(*) FROM public.merchant_orders WHERE user_id = _user_id)
  INTO _history;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (
    auth.uid(),
    'permanently_delete_user',
    'users',
    _user_id::text,
    jsonb_build_object('full_name', _before.full_name, 'phone', _before.phone, 'email', _before.email),
    jsonb_build_object('mode', CASE WHEN _history > 0 THEN 'anonymized' ELSE 'purge' END, 'financial_rows', _history)
  );

  -- Always mask PII; the row itself is removed by the caller via auth-admin delete when there is no history
  UPDATE public.users
  SET full_name = 'Deleted User',
      email = null,
      phone = null,
      avatar_url = null,
      pin_hash = null,
      referral_code = null,
      referred_by = null,
      deleted_at = now(),
      updated_at = now()
  WHERE id = _user_id;

  RETURN jsonb_build_object('ok', true, 'has_history', _history > 0, 'financial_rows', _history);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.staff_permanently_delete_user(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_permanently_delete_user(uuid, text) TO authenticated, service_role;
