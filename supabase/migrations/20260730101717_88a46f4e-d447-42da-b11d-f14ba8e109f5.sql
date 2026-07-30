ALTER TABLE public.area_partners
  ADD COLUMN IF NOT EXISTS photo_url text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS kyc_aadhaar_url text,
  ADD COLUMN IF NOT EXISTS kyc_pan_url text,
  ADD COLUMN IF NOT EXISTS kyc_address_proof_url text,
  ADD COLUMN IF NOT EXISTS kyc_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS kyc_rejection_reason text,
  ADD COLUMN IF NOT EXISTS bank_account_number text,
  ADD COLUMN IF NOT EXISTS bank_ifsc text,
  ADD COLUMN IF NOT EXISTS bank_account_holder_name text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS delete_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'area_partners_kyc_status_check'
  ) THEN
    ALTER TABLE public.area_partners
      ADD CONSTRAINT area_partners_kyc_status_check
      CHECK (kyc_status IN ('pending','approved','rejected'));
  END IF;
END $$;

-- Storage policies for area partner buckets
DROP POLICY IF EXISTS "Staff can read area partner files" ON storage.objects;
CREATE POLICY "Staff can read area partner files"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = ANY (ARRAY['area-partner-kyc-docs','area-partner-photos'])
  AND public.is_active_staff(auth.uid(), NULL::text[])
);

DROP POLICY IF EXISTS "Staff can write area partner files" ON storage.objects;
CREATE POLICY "Staff can write area partner files"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = ANY (ARRAY['area-partner-kyc-docs','area-partner-photos'])
  AND public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager'])
);

DROP POLICY IF EXISTS "Staff can update area partner files" ON storage.objects;
CREATE POLICY "Staff can update area partner files"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = ANY (ARRAY['area-partner-kyc-docs','area-partner-photos'])
  AND public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager'])
);

DROP POLICY IF EXISTS "Staff can delete area partner files" ON storage.objects;
CREATE POLICY "Staff can delete area partner files"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = ANY (ARRAY['area-partner-kyc-docs','area-partner-photos'])
  AND public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager'])
);

-- Extended upsert
CREATE OR REPLACE FUNCTION public.staff_upsert_area_partner(_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    INSERT INTO public.area_partners (
      name, phone, setup_fee_status, commission_rate, status,
      photo_url, address, kyc_aadhaar_url, kyc_pan_url, kyc_address_proof_url,
      bank_account_number, bank_ifsc, bank_account_holder_name
    )
    VALUES (
      _name, _phone, _fee, _rate, _status,
      NULLIF(btrim(coalesce(_payload->>'photo_url','')),''),
      NULLIF(btrim(coalesce(_payload->>'address','')),''),
      NULLIF(btrim(coalesce(_payload->>'kyc_aadhaar_url','')),''),
      NULLIF(btrim(coalesce(_payload->>'kyc_pan_url','')),''),
      NULLIF(btrim(coalesce(_payload->>'kyc_address_proof_url','')),''),
      NULLIF(btrim(coalesce(_payload->>'bank_account_number','')),''),
      NULLIF(upper(btrim(coalesce(_payload->>'bank_ifsc',''))),''),
      NULLIF(btrim(coalesce(_payload->>'bank_account_holder_name','')),'')
    )
    RETURNING id INTO _id;
    _before := NULL;
  ELSE
    SELECT to_jsonb(a) INTO _before FROM public.area_partners a WHERE id=_id;
    IF _before IS NULL THEN RAISE EXCEPTION 'Area partner not found'; END IF;
    IF (_before->>'deleted_at') IS NOT NULL THEN RAISE EXCEPTION 'Area partner has been deleted'; END IF;
    UPDATE public.area_partners
       SET name=_name, phone=_phone, setup_fee_status=_fee,
           commission_rate=_rate, status=_status,
           photo_url = CASE WHEN _payload ? 'photo_url' THEN NULLIF(btrim(coalesce(_payload->>'photo_url','')),'') ELSE photo_url END,
           address = CASE WHEN _payload ? 'address' THEN NULLIF(btrim(coalesce(_payload->>'address','')),'') ELSE address END,
           kyc_aadhaar_url = CASE WHEN _payload ? 'kyc_aadhaar_url' THEN NULLIF(btrim(coalesce(_payload->>'kyc_aadhaar_url','')),'') ELSE kyc_aadhaar_url END,
           kyc_pan_url = CASE WHEN _payload ? 'kyc_pan_url' THEN NULLIF(btrim(coalesce(_payload->>'kyc_pan_url','')),'') ELSE kyc_pan_url END,
           kyc_address_proof_url = CASE WHEN _payload ? 'kyc_address_proof_url' THEN NULLIF(btrim(coalesce(_payload->>'kyc_address_proof_url','')),'') ELSE kyc_address_proof_url END,
           bank_account_number = CASE WHEN _payload ? 'bank_account_number' THEN NULLIF(btrim(coalesce(_payload->>'bank_account_number','')),'') ELSE bank_account_number END,
           bank_ifsc = CASE WHEN _payload ? 'bank_ifsc' THEN NULLIF(upper(btrim(coalesce(_payload->>'bank_ifsc',''))),'') ELSE bank_ifsc END,
           bank_account_holder_name = CASE WHEN _payload ? 'bank_account_holder_name' THEN NULLIF(btrim(coalesce(_payload->>'bank_account_holder_name','')),'') ELSE bank_account_holder_name END
     WHERE id=_id;
  END IF;

  SELECT to_jsonb(a) INTO _after FROM public.area_partners a WHERE id=_id;
  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, CASE WHEN _before IS NULL THEN 'create_area_partner' ELSE 'update_area_partner' END,
          'area_partners', _id, _before, _after);
  RETURN _id;
END $function$;

-- KYC decision
CREATE OR REPLACE FUNCTION public.staff_area_partner_kyc_decision(_partner_id uuid, _decision text, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  SELECT to_jsonb(a) INTO _before FROM public.area_partners a WHERE id=_partner_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Area partner not found'; END IF;

  UPDATE public.area_partners
     SET kyc_status = _decision,
         kyc_rejection_reason = CASE WHEN _decision='rejected' THEN btrim(_reason) ELSE NULL END
   WHERE id = _partner_id;

  SELECT to_jsonb(a) INTO _after FROM public.area_partners a WHERE id=_partner_id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'kyc_' || _decision, 'area_partners', _partner_id, _before, _after);
END $function$;

-- Soft delete
CREATE OR REPLACE FUNCTION public.staff_soft_delete_area_partner(_partner_id uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _before jsonb;
  _after jsonb;
  _zones int := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION 'Reason required'; END IF;

  SELECT to_jsonb(a) INTO _before FROM public.area_partners a WHERE id = _partner_id FOR UPDATE;
  IF _before IS NULL THEN RAISE EXCEPTION 'Area partner not found'; END IF;
  IF (_before->>'deleted_at') IS NOT NULL THEN RAISE EXCEPTION 'Area partner already deleted'; END IF;

  UPDATE public.zones SET assigned_area_partner_id = NULL WHERE assigned_area_partner_id = _partner_id;
  GET DIAGNOSTICS _zones = ROW_COUNT;

  UPDATE public.area_partners
     SET deleted_at = now(),
         deleted_by = _uid,
         delete_reason = btrim(_reason),
         status = 'inactive',
         zone_id = NULL
   WHERE id = _partner_id;

  SELECT to_jsonb(a) INTO _after FROM public.area_partners a WHERE id = _partner_id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'soft_delete_area_partner', 'area_partners', _partner_id, _before,
          _after || jsonb_build_object('zones_unassigned', _zones));
END $function$;