
-- 1. per-recipient delivery status
ALTER TABLE public.campaign_deliveries
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS error text;

DO $$ BEGIN
  ALTER TABLE public.campaign_deliveries
    ADD CONSTRAINT campaign_deliveries_status_chk
    CHECK (status = ANY (ARRAY['sent','delivered','failed']));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. role helper for offers module
CREATE OR REPLACE FUNCTION public.offers_caller_role(_uid uuid DEFAULT auth.uid())
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.role
  FROM public.staff_users s
  WHERE s.auth_user_id = _uid
    AND s.status = 'active'
    AND s.role IN ('super_admin','ops_manager')
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.offers_caller_city(_uid uuid DEFAULT auth.uid())
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT z.city
  FROM public.staff_users s
  JOIN public.zones z ON z.id = s.zone_id
  WHERE s.auth_user_id = _uid AND s.status = 'active'
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.offers_caller_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.offers_caller_city(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.offers_require_writer()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _role text;
BEGIN
  _role := public.offers_caller_role(auth.uid());
  IF _role IS NULL THEN
    RAISE EXCEPTION 'Forbidden: offers management requires super_admin or ops_manager';
  END IF;
  RETURN _role;
END;
$$;

-- 3. tighten write access: staff read, writes only through the RPCs below
DROP POLICY IF EXISTS "Staff manage coupons" ON public.coupons;
CREATE POLICY "Staff read coupons" ON public.coupons
  FOR SELECT TO authenticated USING (is_active_staff(auth.uid(), NULL::text[]));

DROP POLICY IF EXISTS "Staff manage granted coupons" ON public.customer_coupons;
CREATE POLICY "Staff write granted coupons" ON public.customer_coupons
  FOR ALL TO authenticated
  USING (public.offers_caller_role(auth.uid()) IS NOT NULL)
  WITH CHECK (public.offers_caller_role(auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Staff manage milestone programs" ON public.referral_milestone_programs;
CREATE POLICY "Staff read milestone programs" ON public.referral_milestone_programs
  FOR SELECT TO authenticated USING (is_active_staff(auth.uid(), NULL::text[]));

DROP POLICY IF EXISTS "Staff manage campaigns" ON public.marketing_campaigns;
CREATE POLICY "Staff read campaigns" ON public.marketing_campaigns
  FOR SELECT TO authenticated USING (is_active_staff(auth.uid(), NULL::text[]));

-- 4. audit helper
CREATE OR REPLACE FUNCTION public.offers_audit(
  _action text, _table text, _target uuid, _before jsonb, _after jsonb
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), _action, _table, _target, _before, _after)
$$;

-- 5. coupon RPCs
CREATE OR REPLACE FUNCTION public.staff_upsert_coupon(
  _id uuid,
  _code text,
  _title text,
  _description text,
  _discount_type text,
  _discount_value numeric,
  _max_discount numeric,
  _min_order_amount numeric,
  _valid_from timestamptz,
  _valid_until timestamptz,
  _total_usage_limit integer,
  _per_user_limit integer,
  _audience text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _before jsonb; _row public.coupons%ROWTYPE;
BEGIN
  PERFORM public.offers_require_writer();

  IF _id IS NULL THEN
    INSERT INTO public.coupons (
      code, title, description, discount_type, discount_value, max_discount,
      min_order_amount, valid_from, valid_until, total_usage_limit, per_user_limit,
      audience, created_by
    ) VALUES (
      upper(btrim(_code)), _title, _description, _discount_type, _discount_value, _max_discount,
      COALESCE(_min_order_amount, 0), COALESCE(_valid_from, now()), _valid_until,
      _total_usage_limit, COALESCE(_per_user_limit, 1), COALESCE(_audience, 'all'), auth.uid()
    ) RETURNING * INTO _row;
    PERFORM public.offers_audit('coupon_created', 'coupons', _row.id, NULL, to_jsonb(_row));
  ELSE
    SELECT to_jsonb(c) INTO _before FROM public.coupons c WHERE c.id = _id;
    IF _before IS NULL THEN RAISE EXCEPTION 'Coupon not found'; END IF;
    UPDATE public.coupons SET
      code = upper(btrim(_code)),
      title = _title,
      description = _description,
      discount_type = _discount_type,
      discount_value = _discount_value,
      max_discount = _max_discount,
      min_order_amount = COALESCE(_min_order_amount, 0),
      valid_from = COALESCE(_valid_from, valid_from),
      valid_until = _valid_until,
      total_usage_limit = _total_usage_limit,
      per_user_limit = COALESCE(_per_user_limit, 1),
      audience = COALESCE(_audience, 'all'),
      updated_at = now()
    WHERE id = _id RETURNING * INTO _row;
    PERFORM public.offers_audit('coupon_updated', 'coupons', _row.id, _before, to_jsonb(_row));
  END IF;

  RETURN _row.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_set_coupon_active(_id uuid, _active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _before jsonb; _row public.coupons%ROWTYPE;
BEGIN
  PERFORM public.offers_require_writer();
  SELECT to_jsonb(c) INTO _before FROM public.coupons c WHERE c.id = _id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Coupon not found'; END IF;
  UPDATE public.coupons SET is_active = _active, updated_at = now()
  WHERE id = _id RETURNING * INTO _row;
  PERFORM public.offers_audit(
    CASE WHEN _active THEN 'coupon_resumed' ELSE 'coupon_paused' END,
    'coupons', _id, _before, to_jsonb(_row));
END;
$$;

-- 6. milestone RPCs
CREATE OR REPLACE FUNCTION public.staff_upsert_milestone_program(
  _id uuid,
  _name text,
  _description text,
  _required_referrals integer,
  _reward_discount_type text,
  _reward_discount_value numeric,
  _reward_max_discount numeric,
  _reward_min_order_amount numeric,
  _reward_validity_days integer
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _before jsonb; _row public.referral_milestone_programs%ROWTYPE;
BEGIN
  PERFORM public.offers_require_writer();

  IF _id IS NULL THEN
    INSERT INTO public.referral_milestone_programs (
      name, description, required_referrals, reward_discount_type, reward_discount_value,
      reward_max_discount, reward_min_order_amount, reward_validity_days
    ) VALUES (
      _name, _description, _required_referrals, _reward_discount_type, _reward_discount_value,
      _reward_max_discount, COALESCE(_reward_min_order_amount, 0), COALESCE(_reward_validity_days, 30)
    ) RETURNING * INTO _row;
    PERFORM public.offers_audit('milestone_created', 'referral_milestone_programs', _row.id, NULL, to_jsonb(_row));
  ELSE
    SELECT to_jsonb(p) INTO _before FROM public.referral_milestone_programs p WHERE p.id = _id;
    IF _before IS NULL THEN RAISE EXCEPTION 'Milestone not found'; END IF;
    UPDATE public.referral_milestone_programs SET
      name = _name,
      description = _description,
      required_referrals = _required_referrals,
      reward_discount_type = _reward_discount_type,
      reward_discount_value = _reward_discount_value,
      reward_max_discount = _reward_max_discount,
      reward_min_order_amount = COALESCE(_reward_min_order_amount, 0),
      reward_validity_days = COALESCE(_reward_validity_days, 30),
      updated_at = now()
    WHERE id = _id RETURNING * INTO _row;
    PERFORM public.offers_audit('milestone_updated', 'referral_milestone_programs', _row.id, _before, to_jsonb(_row));
  END IF;

  RETURN _row.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_set_milestone_active(_id uuid, _active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _before jsonb; _row public.referral_milestone_programs%ROWTYPE;
BEGIN
  PERFORM public.offers_require_writer();
  SELECT to_jsonb(p) INTO _before FROM public.referral_milestone_programs p WHERE p.id = _id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Milestone not found'; END IF;
  UPDATE public.referral_milestone_programs SET is_active = _active, updated_at = now()
  WHERE id = _id RETURNING * INTO _row;
  PERFORM public.offers_audit(
    CASE WHEN _active THEN 'milestone_resumed' ELSE 'milestone_paused' END,
    'referral_milestone_programs', _id, _before, to_jsonb(_row));
END;
$$;

-- 7. campaign RPCs
CREATE OR REPLACE FUNCTION public.staff_upsert_campaign(
  _id uuid,
  _title text,
  _body text,
  _image_url text,
  _deep_link text,
  _audience text,
  _coupon_id uuid,
  _show_in_offers boolean
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _role text; _city text; _before jsonb; _row public.marketing_campaigns%ROWTYPE;
BEGIN
  _role := public.offers_require_writer();
  IF _role = 'ops_manager' THEN
    _city := public.offers_caller_city(auth.uid());
    IF _city IS NULL THEN
      RAISE EXCEPTION 'Your account has no assigned city, so city campaigns cannot be created';
    END IF;
    IF COALESCE(_audience, 'all') <> _city THEN
      RAISE EXCEPTION 'You can only create campaigns for your city (%)', _city;
    END IF;
  END IF;

  IF _id IS NULL THEN
    INSERT INTO public.marketing_campaigns (
      title, body, image_url, deep_link, audience, coupon_id, show_in_offers, status, created_by
    ) VALUES (
      _title, _body, NULLIF(_image_url, ''), NULLIF(_deep_link, ''), COALESCE(_audience, 'all'),
      _coupon_id, COALESCE(_show_in_offers, true), 'draft', auth.uid()
    ) RETURNING * INTO _row;
    PERFORM public.offers_audit('campaign_created', 'marketing_campaigns', _row.id, NULL, to_jsonb(_row));
  ELSE
    SELECT to_jsonb(c) INTO _before FROM public.marketing_campaigns c WHERE c.id = _id;
    IF _before IS NULL THEN RAISE EXCEPTION 'Campaign not found'; END IF;
    IF (_before->>'status') = 'sent' THEN
      RAISE EXCEPTION 'A campaign that has already been sent cannot be edited';
    END IF;
    UPDATE public.marketing_campaigns SET
      title = _title,
      body = _body,
      image_url = NULLIF(_image_url, ''),
      deep_link = NULLIF(_deep_link, ''),
      audience = COALESCE(_audience, 'all'),
      coupon_id = _coupon_id,
      show_in_offers = COALESCE(_show_in_offers, true),
      updated_at = now()
    WHERE id = _id RETURNING * INTO _row;
    PERFORM public.offers_audit('campaign_updated', 'marketing_campaigns', _row.id, _before, to_jsonb(_row));
  END IF;

  RETURN _row.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_send_campaign(_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _role text;
  _city text;
  _before jsonb;
  _row public.marketing_campaigns%ROWTYPE;
  _sent integer := 0;
  _rec record;
  _route text;
  _has_token boolean;
BEGIN
  _role := public.offers_require_writer();

  SELECT to_jsonb(c) INTO _before FROM public.marketing_campaigns c WHERE c.id = _id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Campaign not found'; END IF;
  IF (_before->>'status') = 'sent' THEN RAISE EXCEPTION 'Campaign already sent'; END IF;

  IF _role = 'ops_manager' THEN
    _city := public.offers_caller_city(auth.uid());
    IF _city IS NULL OR (_before->>'audience') <> _city THEN
      RAISE EXCEPTION 'You can only send campaigns for your own city';
    END IF;
  END IF;

  _route := COALESCE(NULLIF(_before->>'deep_link', ''), 'offers');

  FOR _rec IN
    SELECT DISTINCT u.id
    FROM public.users u
    WHERE u.deleted_at IS NULL
      AND (
        (_before->>'audience') = 'all'
        OR EXISTS (
          SELECT 1 FROM public.addresses a
          WHERE a.user_id = u.id
            AND a.city ILIKE (_before->>'audience')
        )
      )
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.device_tokens d
      WHERE d.user_id = _rec.id AND d.user_type = 'customer'
    ) INTO _has_token;

    INSERT INTO public.campaign_deliveries (campaign_id, user_id, status, error)
    VALUES (
      _id, _rec.id,
      CASE WHEN _has_token THEN 'sent' ELSE 'failed' END,
      CASE WHEN _has_token THEN NULL ELSE 'No registered device' END
    )
    ON CONFLICT (campaign_id, user_id) DO NOTHING;

    IF _has_token THEN
      PERFORM public.notify_customer_user_push(
        _rec.id, _before->>'title', COALESCE(_before->>'body', ''), _route
      );
    END IF;

    _sent := _sent + 1;
  END LOOP;

  UPDATE public.marketing_campaigns SET
    status = 'sent',
    sent_at = now(),
    recipients_count = _sent,
    starts_at = COALESCE(starts_at, now()),
    updated_at = now()
  WHERE id = _id RETURNING * INTO _row;

  PERFORM public.offers_audit('campaign_sent', 'marketing_campaigns', _id, _before, to_jsonb(_row));
  RETURN _sent;
END;
$$;

REVOKE ALL ON FUNCTION public.staff_upsert_coupon(uuid, text, text, text, text, numeric, numeric, numeric, timestamptz, timestamptz, integer, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_set_coupon_active(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_upsert_milestone_program(uuid, text, text, integer, text, numeric, numeric, numeric, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_set_milestone_active(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_upsert_campaign(uuid, text, text, text, text, text, uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_send_campaign(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.offers_audit(text, text, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.offers_require_writer() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.staff_upsert_coupon(uuid, text, text, text, text, numeric, numeric, numeric, timestamptz, timestamptz, integer, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_set_coupon_active(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_upsert_milestone_program(uuid, text, text, integer, text, numeric, numeric, numeric, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_set_milestone_active(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_upsert_campaign(uuid, text, text, text, text, text, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_send_campaign(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.offers_require_writer() TO authenticated;
