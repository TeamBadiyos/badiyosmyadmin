
-- EXPERTS extensions
ALTER TABLE public.experts
  ADD COLUMN IF NOT EXISTS photo_url text,
  ADD COLUMN IF NOT EXISTS kyc_aadhaar_url text,
  ADD COLUMN IF NOT EXISTS kyc_pan_url text,
  ADD COLUMN IF NOT EXISTS kyc_address_proof_url text,
  ADD COLUMN IF NOT EXISTS kyc_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS kyc_rejection_reason text,
  ADD COLUMN IF NOT EXISTS bank_account_number text,
  ADD COLUMN IF NOT EXISTS bank_ifsc text,
  ADD COLUMN IF NOT EXISTS bank_account_holder_name text,
  ADD COLUMN IF NOT EXISTS level text NOT NULL DEFAULT 'bronze',
  ADD COLUMN IF NOT EXISTS security_deposit_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS wallet_balance numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS address text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='experts_kyc_status_check') THEN
    ALTER TABLE public.experts ADD CONSTRAINT experts_kyc_status_check
      CHECK (kyc_status IN ('pending','approved','rejected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='experts_level_check') THEN
    ALTER TABLE public.experts ADD CONSTRAINT experts_level_check
      CHECK (level IN ('bronze','silver','gold','diamond'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='experts_security_deposit_status_check') THEN
    ALTER TABLE public.experts ADD CONSTRAINT experts_security_deposit_status_check
      CHECK (security_deposit_status IN ('pending','collected','adjusted'));
  END IF;
END $$;

-- AREA PARTNERS extensions
ALTER TABLE public.area_partners
  ADD COLUMN IF NOT EXISTS zone_id uuid REFERENCES public.zones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS setup_fee_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS commission_rate numeric NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='area_partners_setup_fee_status_check') THEN
    ALTER TABLE public.area_partners ADD CONSTRAINT area_partners_setup_fee_status_check
      CHECK (setup_fee_status IN ('pending','paid'));
  END IF;
END $$;

-- Helper: is-staff-with-role
CREATE OR REPLACE FUNCTION public.is_active_staff(_uid uuid, _roles text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff_users
     WHERE auth_user_id = _uid AND status='active'
       AND (_roles IS NULL OR role = ANY(_roles))
  );
$$;

-- STORAGE policies: only active staff can read/write the two private buckets
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Staff can read expert files') THEN
    DROP POLICY "Staff can read expert files" ON storage.objects;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Staff can write expert files') THEN
    DROP POLICY "Staff can write expert files" ON storage.objects;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Staff can update expert files') THEN
    DROP POLICY "Staff can update expert files" ON storage.objects;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Staff can delete expert files') THEN
    DROP POLICY "Staff can delete expert files" ON storage.objects;
  END IF;
END $$;

CREATE POLICY "Staff can read expert files" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id IN ('expert-kyc-docs','expert-photos')
    AND public.is_active_staff(auth.uid(), NULL)
  );

CREATE POLICY "Staff can write expert files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id IN ('expert-kyc-docs','expert-photos')
    AND public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager'])
  );

CREATE POLICY "Staff can update expert files" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id IN ('expert-kyc-docs','expert-photos')
    AND public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager'])
  );

CREATE POLICY "Staff can delete expert files" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id IN ('expert-kyc-docs','expert-photos')
    AND public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager'])
  );

-- RPC: upsert expert
CREATE OR REPLACE FUNCTION public.staff_upsert_expert(_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _id uuid;
  _before jsonb;
  _after jsonb;
  _name text; _phone text; _zone uuid; _level text; _status text; _address text;
  _photo text; _acc text; _ifsc text; _holder text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  _id := NULLIF(_payload->>'id','')::uuid;
  _name := btrim(coalesce(_payload->>'name',''));
  _phone := btrim(coalesce(_payload->>'phone',''));
  _zone := NULLIF(_payload->>'zone_id','')::uuid;
  _level := coalesce(_payload->>'level','bronze');
  _status := coalesce(_payload->>'status','active');
  _address := NULLIF(btrim(coalesce(_payload->>'address','')), '');
  _photo := NULLIF(_payload->>'photo_url','');
  _acc := NULLIF(btrim(coalesce(_payload->>'bank_account_number','')), '');
  _ifsc := NULLIF(upper(btrim(coalesce(_payload->>'bank_ifsc',''))), '');
  _holder := NULLIF(btrim(coalesce(_payload->>'bank_account_holder_name','')), '');

  IF _name = '' THEN RAISE EXCEPTION 'Name required'; END IF;
  IF _phone = '' THEN RAISE EXCEPTION 'Phone required'; END IF;
  IF _level NOT IN ('bronze','silver','gold','diamond') THEN RAISE EXCEPTION 'Invalid level'; END IF;
  IF _status NOT IN ('active','inactive') THEN RAISE EXCEPTION 'Invalid status'; END IF;

  IF _id IS NULL THEN
    INSERT INTO public.experts (
      name, phone, zone_id, level, status, address, photo_url,
      bank_account_number, bank_ifsc, bank_account_holder_name,
      kyc_aadhaar_url, kyc_pan_url, kyc_address_proof_url
    )
    VALUES (
      _name, _phone, _zone, _level, _status, _address, _photo,
      _acc, _ifsc, _holder,
      NULLIF(_payload->>'kyc_aadhaar_url',''),
      NULLIF(_payload->>'kyc_pan_url',''),
      NULLIF(_payload->>'kyc_address_proof_url','')
    )
    RETURNING id INTO _id;
    _before := NULL;
  ELSE
    SELECT to_jsonb(e) INTO _before FROM public.experts e WHERE id = _id;
    IF _before IS NULL THEN RAISE EXCEPTION 'Expert not found'; END IF;
    UPDATE public.experts SET
      name = _name,
      phone = _phone,
      zone_id = _zone,
      level = _level,
      status = _status,
      address = _address,
      photo_url = COALESCE(_photo, photo_url),
      bank_account_number = _acc,
      bank_ifsc = _ifsc,
      bank_account_holder_name = _holder,
      kyc_aadhaar_url = COALESCE(NULLIF(_payload->>'kyc_aadhaar_url',''), kyc_aadhaar_url),
      kyc_pan_url = COALESCE(NULLIF(_payload->>'kyc_pan_url',''), kyc_pan_url),
      kyc_address_proof_url = COALESCE(NULLIF(_payload->>'kyc_address_proof_url',''), kyc_address_proof_url)
    WHERE id = _id;
  END IF;

  SELECT to_jsonb(e) INTO _after FROM public.experts e WHERE id = _id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, CASE WHEN _before IS NULL THEN 'create_expert' ELSE 'update_expert' END,
          'experts', _id, _before, _after);
  RETURN _id;
END $$;

-- RPC: KYC decision
CREATE OR REPLACE FUNCTION public.staff_expert_kyc_decision(_expert_id uuid, _decision text, _reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _before jsonb;
  _after jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT role INTO _role FROM public.staff_users WHERE auth_user_id=_uid AND status='active';
  IF _role IS NULL OR _role NOT IN ('super_admin','ops_manager') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _decision NOT IN ('approved','rejected','pending') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
  IF _decision = 'rejected' AND coalesce(btrim(_reason),'') = '' THEN RAISE EXCEPTION 'Rejection reason required'; END IF;
  IF _decision = 'pending' AND _role <> 'super_admin' THEN RAISE EXCEPTION 'Only super_admin can reset KYC'; END IF;

  SELECT to_jsonb(e) INTO _before FROM public.experts e WHERE id=_expert_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Expert not found'; END IF;

  UPDATE public.experts
     SET kyc_status = _decision,
         kyc_rejection_reason = CASE WHEN _decision='rejected' THEN btrim(_reason) ELSE NULL END
   WHERE id = _expert_id;

  SELECT to_jsonb(e) INTO _after FROM public.experts e WHERE id=_expert_id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'kyc_' || _decision, 'experts', _expert_id, _before, _after);
END $$;

-- RPC: upsert area partner
CREATE OR REPLACE FUNCTION public.staff_upsert_area_partner(_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _id uuid;
  _name text; _phone text; _fee text; _rate numeric; _status text;
  _before jsonb; _after jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  _id := NULLIF(_payload->>'id','')::uuid;
  _name := btrim(coalesce(_payload->>'name',''));
  _phone := btrim(coalesce(_payload->>'phone',''));
  _fee := coalesce(_payload->>'setup_fee_status','pending');
  _rate := coalesce((_payload->>'commission_rate')::numeric, 0);
  _status := coalesce(_payload->>'status','active');

  IF _name = '' THEN RAISE EXCEPTION 'Name required'; END IF;
  IF _phone = '' THEN RAISE EXCEPTION 'Phone required'; END IF;
  IF _fee NOT IN ('pending','paid') THEN RAISE EXCEPTION 'Invalid setup fee status'; END IF;
  IF _status NOT IN ('active','inactive') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  IF _rate < 0 OR _rate > 100 THEN RAISE EXCEPTION 'Commission must be 0-100'; END IF;

  IF _id IS NULL THEN
    INSERT INTO public.area_partners (name, phone, setup_fee_status, commission_rate, status)
    VALUES (_name, _phone, _fee, _rate, _status)
    RETURNING id INTO _id;
    _before := NULL;
  ELSE
    SELECT to_jsonb(a) INTO _before FROM public.area_partners a WHERE id=_id;
    IF _before IS NULL THEN RAISE EXCEPTION 'Area partner not found'; END IF;
    UPDATE public.area_partners
       SET name=_name, phone=_phone, setup_fee_status=_fee,
           commission_rate=_rate, status=_status
     WHERE id=_id;
  END IF;

  SELECT to_jsonb(a) INTO _after FROM public.area_partners a WHERE id=_id;
  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, CASE WHEN _before IS NULL THEN 'create_area_partner' ELSE 'update_area_partner' END,
          'area_partners', _id, _before, _after);
  RETURN _id;
END $$;
