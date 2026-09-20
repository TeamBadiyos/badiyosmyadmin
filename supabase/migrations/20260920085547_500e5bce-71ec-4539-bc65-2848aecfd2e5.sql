CREATE OR REPLACE FUNCTION public.staff_upsert_expert(_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _id uuid;
  _before jsonb;
  _after jsonb;
  _name text; _phone text; _zone uuid; _level text; _status text; _address text;
  _photo text; _acc text; _ifsc text; _holder text; _ref uuid; _has_ref boolean;
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
  _has_ref := _payload ? 'referred_by_expert_id';
  _ref := NULLIF(_payload->>'referred_by_expert_id','')::uuid;

  IF _name = '' THEN RAISE EXCEPTION 'Name required'; END IF;
  IF _phone = '' THEN RAISE EXCEPTION 'Phone required'; END IF;
  IF _level NOT IN ('bronze','silver','gold','diamond') THEN RAISE EXCEPTION 'Invalid level'; END IF;
  IF _status NOT IN ('active','inactive') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  IF _ref IS NOT NULL AND _id IS NOT NULL AND _ref = _id THEN
    RAISE EXCEPTION 'An expert cannot refer themselves';
  END IF;
  IF _ref IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.experts WHERE id = _ref) THEN
    RAISE EXCEPTION 'Referring expert not found';
  END IF;

  IF _id IS NULL THEN
    INSERT INTO public.experts (
      name, phone, zone_id, level, status, address, photo_url,
      bank_account_number, bank_ifsc, bank_account_holder_name,
      kyc_aadhaar_url, kyc_pan_url, kyc_address_proof_url, referred_by_expert_id
    )
    VALUES (
      _name, _phone, _zone, _level, _status, _address, _photo,
      _acc, _ifsc, _holder,
      NULLIF(_payload->>'kyc_aadhaar_url',''),
      NULLIF(_payload->>'kyc_pan_url',''),
      NULLIF(_payload->>'kyc_address_proof_url',''),
      _ref
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
      kyc_address_proof_url = COALESCE(NULLIF(_payload->>'kyc_address_proof_url',''), kyc_address_proof_url),
      referred_by_expert_id = CASE WHEN _has_ref THEN _ref ELSE referred_by_expert_id END
    WHERE id = _id;
  END IF;

  SELECT to_jsonb(e) INTO _after FROM public.experts e WHERE id = _id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, CASE WHEN _before IS NULL THEN 'create_expert' ELSE 'update_expert' END,
          'experts', _id, _before, _after);
  RETURN _id;
END $function$;

REVOKE EXECUTE ON FUNCTION public.staff_upsert_expert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_upsert_expert(jsonb) TO authenticated, service_role;