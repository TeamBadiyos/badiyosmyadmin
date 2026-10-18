DO $do$
DECLARE f text; d text;
BEGIN
  -- 3. Zone drawing/editing/city area/switch-over: super_admin only (On/Off stays for Ops)
  FOREACH f IN ARRAY ARRAY['zv2_save_zone','zv2_save_boundary','zv2_delete_cell','zv2_update_cell','zv2_set_cell_geom','zv2_merge','zv2_split','zv2_move_point','zv2_undo','zv2_fill_gaps_apply'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=f LIMIT 1;
    IF d IS NULL THEN CONTINUE; END IF;
    d := regexp_replace(d, 'zv2_require\((c\.city_id|a\.city_id|_city)\)', 'zv2_require(\1, true)', 'g');
    EXECUTE d;
  END LOOP;
  -- 2. Spin redemptions view / mark redeemed / export: Ops allowed
  FOREACH f IN ARRAY ARRAY['staff_spin_mark_redeemed','staff_spin_redemptions','staff_spin_export'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=f LIMIT 1;
    IF d IS NULL THEN CONTINUE; END IF;
    d := replace(d, 'public.is_offer_finance_user()', 'public.is_active_staff(auth.uid(), array[''super_admin'',''ops_manager''])');
    EXECUTE d;
  END LOOP;
END $do$;

-- Spin/event creation & editing super_admin only (finance role no longer exists)
CREATE OR REPLACE FUNCTION public.is_offer_finance_user() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM public.staff_users WHERE auth_user_id = auth.uid() AND status='active' AND role='super_admin') $$;

-- Coupons / offers writes super_admin only
CREATE OR REPLACE FUNCTION public.offers_require_writer() RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE _role text;
BEGIN
  _role := public.offers_caller_role(auth.uid());
  IF _role IS DISTINCT FROM 'super_admin' THEN RAISE EXCEPTION 'Forbidden: only super admin can manage coupons and offers' USING errcode='42501'; END IF;
  RETURN _role;
END $$;

-- Ops can read events + prizes (for the Redemptions view)
CREATE POLICY ops_read_spin_events ON public.spin_events FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid(), array['super_admin','ops_manager']));
CREATE POLICY ops_read_spin_prizes ON public.spin_prizes FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid(), array['super_admin','ops_manager']));

-- 4. Policy refund only for Ops
CREATE OR REPLACE FUNCTION public.staff_cancel_booking_v2(_booking_id uuid, _reason text, _destination text DEFAULT 'original', _apply_fee boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE _role text;
BEGIN
  SELECT role INTO _role FROM public.staff_users WHERE auth_user_id=auth.uid() AND status='active';
  IF _role IS NULL OR _role NOT IN ('super_admin','ops_manager') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF NOT public.staff_can_city((SELECT city_id FROM public.bookings WHERE id=_booking_id)) THEN RAISE EXCEPTION 'Not allowed for this city'; END IF;
  IF _reason IS NULL OR _reason NOT IN ('SAFETY','FRAUD','DUPLICATE','MANUAL_OVERRIDE','OTHER') THEN RAISE EXCEPTION 'Invalid reason'; END IF;
  IF _destination NOT IN ('wallet','original') THEN RAISE EXCEPTION 'Destination must be wallet or original'; END IF;
  -- Ops managers always get the system-calculated (policy) refund; waiving the fee is super_admin only.
  RETURN public.booking_cancel_core(_booking_id, 'staff', auth.uid(), _reason, _destination,
    CASE WHEN _apply_fee OR _role <> 'super_admin' THEN 'policy' ELSE 'full' END);
END $function$;

DO $do$
DECLARE d text;
BEGIN
  -- custom booking refund amount: super only
  d := pg_get_functiondef('public.staff_set_booking_refund'::regproc);
  d := replace(d, '_role NOT IN (''super_admin'',''ops_manager'',''finance'')', '_role <> ''super_admin''');
  EXECUTE d;
  -- custom parcel refund: super only
  d := pg_get_functiondef('public.staff_courier_refund'::regproc);
  d := replace(d, 'if not public.courier_is_ops_staff() then', 'if not public.is_super_admin_user() then');
  EXECUTE d;
  -- parcel force-cancel: Ops cannot pass a custom amount
  d := pg_get_functiondef('public.staff_courier_force_cancel'::regproc);
  d := replace(d, 'if not public.courier_is_ops_staff() then raise exception ''Not authorized'' using errcode=''42501''; end if;',
    'if not public.courier_is_ops_staff() then raise exception ''Not authorized'' using errcode=''42501''; end if; if _refund_amount is not null and not public.is_super_admin_user() then raise exception ''Custom refund amounts are super admin only'' using errcode=''42501''; end if;');
  EXECUTE d;
  -- store/food after-accept: Ops may pick full or none only
  d := pg_get_functiondef('public.staff_store_cancel_refund'::regproc);
  d := replace(d, 'IF _mode NOT IN (''full'',''partial'',''none'') THEN RAISE EXCEPTION ''Pick full, partial or no refund''; END IF;',
    'IF _mode NOT IN (''full'',''partial'',''none'') THEN RAISE EXCEPTION ''Pick full, partial or no refund''; END IF; IF _mode=''partial'' AND NOT public.is_super_admin_user() THEN RAISE EXCEPTION ''Partial refunds are super admin only'' USING errcode=''42501''; END IF;');
  EXECUTE d;
END $do$;

-- 6. Staff OTP login support
CREATE TABLE IF NOT EXISTS public.staff_login_otps (
  phone text PRIMARY KEY,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  sent_count int NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.staff_login_otps TO service_role;
ALTER TABLE public.staff_login_otps ENABLE ROW LEVEL SECURITY;