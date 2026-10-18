ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS agreement_fee_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agreement_deposit_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agreement_required boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.merchant_onboarding_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  require_signed_agreement boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT ON public.merchant_onboarding_settings TO authenticated;
GRANT ALL ON public.merchant_onboarding_settings TO service_role;
ALTER TABLE public.merchant_onboarding_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read onboarding settings" ON public.merchant_onboarding_settings FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager','finance']));
INSERT INTO public.merchant_onboarding_settings(id) VALUES (true) ON CONFLICT DO NOTHING;

-- Is the store allowed to be live as far as the agreement is concerned?
CREATE OR REPLACE FUNCTION public.merchant_agreement_ok(_m uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT NOT coalesce((SELECT require_signed_agreement FROM merchant_onboarding_settings LIMIT 1), true)
      OR NOT coalesce((SELECT agreement_required FROM merchants WHERE id=_m), false)
      OR EXISTS (SELECT 1 FROM agreements a WHERE a.party_type='merchant' AND a.party_id=_m AND a.status='accepted'
                   AND NOT EXISTS (SELECT 1 FROM agreements b WHERE b.party_type='merchant' AND b.party_id=_m
                                     AND b.template_type=a.template_type AND b.status='sent' AND b.created_at>a.created_at))
$$;
GRANT EXECUTE ON FUNCTION public.merchant_agreement_ok(uuid) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.staff_set_merchant_agreement_setting(_require boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _old boolean;
BEGIN
  IF NOT public.is_super_admin_user() THEN RAISE EXCEPTION 'Only super admin can change this'; END IF;
  SELECT require_signed_agreement INTO _old FROM merchant_onboarding_settings;
  UPDATE merchant_onboarding_settings SET require_signed_agreement=_require, updated_at=now(), updated_by=auth.uid();
  INSERT INTO audit_logs(actor_id, action, target_table, before_state, after_state)
  VALUES (auth.uid(), 'merchant_agreement_setting', 'merchant_onboarding_settings',
          jsonb_build_object('require_signed_agreement',_old), jsonb_build_object('require_signed_agreement',_require));
END $$;
REVOKE ALL ON FUNCTION public.staff_set_merchant_agreement_setting(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_set_merchant_agreement_setting(boolean) TO authenticated;

-- Staff set fee/deposit shown in the agreement
CREATE OR REPLACE FUNCTION public.staff_set_merchant_agreement_terms(_merchant_id uuid, _fee numeric, _deposit numeric) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _b jsonb;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF coalesce(_fee,0) < 0 OR coalesce(_deposit,0) < 0 THEN RAISE EXCEPTION 'Amounts cannot be negative'; END IF;
  SELECT jsonb_build_object('fee',agreement_fee_amount,'deposit',agreement_deposit_amount) INTO _b FROM merchants WHERE id=_merchant_id;
  IF _b IS NULL THEN RAISE EXCEPTION 'Store not found'; END IF;
  UPDATE merchants SET agreement_fee_amount=coalesce(_fee,0), agreement_deposit_amount=coalesce(_deposit,0), updated_at=now() WHERE id=_merchant_id;
  INSERT INTO audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), 'merchant_agreement_terms', 'merchants', _merchant_id, _b, jsonb_build_object('fee',_fee,'deposit',_deposit));
END $$;
REVOKE ALL ON FUNCTION public.staff_set_merchant_agreement_terms(uuid,numeric,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_set_merchant_agreement_terms(uuid,numeric,numeric) TO authenticated;

-- Merchant values now include fee and deposit
CREATE OR REPLACE FUNCTION public.agreement_values(_party_type text, _party_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r jsonb; _today text := to_char((now() AT TIME ZONE 'Asia/Kolkata')::date,'DD Mon YYYY');
BEGIN
  IF _party_type='merchant' THEN
    SELECT jsonb_build_object('name',coalesce(m.owner_name,m.store_name),'business_name',m.store_name,
      'city',coalesce(m.city,z.city,'Latur'),'zone',coalesce(z.name,''),
      'commission_pct',coalesce(m.commission_pct,m.commission_value,0)::text,
      'fee_amount', CASE WHEN coalesce(m.agreement_fee_amount,0)>0 THEN '₹' || trim(to_char(m.agreement_fee_amount,'FM99,99,99,990.##')) ELSE 'Nil' END,
      'deposit_amount', CASE WHEN coalesce(m.agreement_deposit_amount,0)>0 THEN '₹' || trim(to_char(m.agreement_deposit_amount,'FM99,99,99,990.##')) ELSE 'Nil' END,
      'start_date',to_char(coalesce(m.approved_at,now()) AT TIME ZONE 'Asia/Kolkata','DD Mon YYYY'))
      INTO r FROM merchants m LEFT JOIN zones z ON z.id=m.zone_id WHERE m.id=_party_id;
  ELSIF _party_type='expert' THEN
    SELECT jsonb_build_object('name',e.name,'business_name','','city',coalesce(z.city,'Latur'),'zone',coalesce(z.name,''),
      'start_date',to_char(coalesce(e.joining_date,(e.created_at AT TIME ZONE 'Asia/Kolkata')::date),'DD Mon YYYY'))
      INTO r FROM experts e LEFT JOIN zones z ON z.id=e.zone_id WHERE e.id=_party_id;
  ELSIF _party_type='applicant' THEN
    SELECT jsonb_build_object('name',coalesce(a.name,''),'business_name','','city',coalesce(z.city,'Latur'),'zone',coalesce(z.name,''),
      'start_date',_today) INTO r FROM expert_applications a LEFT JOIN zones z ON z.id=a.preferred_zone_id WHERE a.id=_party_id;
  ELSIF _party_type='partner' THEN
    SELECT jsonb_build_object('name',p.name,'business_name','','city',coalesce(p.city,z.city,'Latur'),'zone',coalesce(z.name,''),
      'fee_amount',coalesce((SELECT sum(amount) FROM partner_payments WHERE partner_id=p.id AND type IN ('franchise_fee','renewal_fee')), p.fee_paid, 0)::text,
      'deposit_amount',coalesce((SELECT sum(amount) FROM partner_payments WHERE partner_id=p.id AND type='security_deposit'),0)::text,
      'start_date',coalesce(to_char(p.agreement_start,'DD Mon YYYY'),''),'end_date',coalesce(to_char(p.agreement_end,'DD Mon YYYY'),''))
      INTO r FROM partners p LEFT JOIN zones z ON z.id=p.zone_id WHERE p.id=_party_id;
  END IF;
  IF r IS NULL THEN RAISE EXCEPTION 'Not found'; END IF;
  RETURN jsonb_build_object('commission_pct','','fee_amount','','deposit_amount','','end_date','') || r || jsonb_build_object('date',_today);
END $function$;

-- On approval: mark agreement required, then issue it (with commission/fee/deposit already set)
CREATE OR REPLACE FUNCTION public.agreements_on_merchant_approved()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status='approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    IF NOT EXISTS (SELECT 1 FROM agreements WHERE party_type='merchant' AND party_id=NEW.id AND status='accepted') THEN
      UPDATE merchants SET agreement_required=true WHERE id=NEW.id AND NOT agreement_required;
      BEGIN PERFORM public.agreement_issue('merchant', NEW.id, CASE WHEN NEW.service_type='food' THEN 'restaurant' ELSE 'store' END, false, auth.uid());
      EXCEPTION WHEN others THEN RAISE WARNING 'agreement issue failed: %', SQLERRM; END;
    END IF;
  END IF; RETURN NEW;
END $function$;

-- No agreement before approval
CREATE OR REPLACE FUNCTION public.app_merchant_issue_signup_agreement()
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _m merchants; _type text; _id uuid;
BEGIN
  SELECT * INTO _m FROM merchants WHERE auth_user_id = auth.uid() AND deleted_at IS NULL LIMIT 1;
  IF _m.id IS NULL THEN RAISE EXCEPTION 'merchant_not_found'; END IF;
  IF _m.status <> 'approved' THEN RETURN NULL; END IF;  -- agreement comes after approval
  _type := CASE WHEN _m.service_type = 'food' THEN 'restaurant' ELSE 'store' END;
  SELECT id INTO _id FROM agreements
   WHERE party_type = 'merchant' AND party_id = _m.id AND template_type = _type AND status <> 'expired'
   ORDER BY created_at DESC LIMIT 1;
  IF _id IS NOT NULL THEN RETURN _id; END IF;
  RETURN public.agreement_issue('merchant', _m.id, _type, false, NULL);
END $function$;

-- Merchant app: where am I in onboarding?
CREATE OR REPLACE FUNCTION public.app_merchant_onboarding_state() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE _m merchants; _a agreements;
BEGIN
  SELECT * INTO _m FROM merchants WHERE auth_user_id=auth.uid() AND deleted_at IS NULL LIMIT 1;
  IF _m.id IS NULL THEN RETURN jsonb_build_object('stage','not_registered'); END IF;
  SELECT * INTO _a FROM agreements WHERE party_type='merchant' AND party_id=_m.id AND status<>'expired' ORDER BY created_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'stage', CASE
      WHEN _m.status IN ('draft','rejected') THEN 'registration'
      WHEN _m.status <> 'approved' THEN 'under_review'
      WHEN NOT public.merchant_agreement_ok(_m.id) THEN 'sign_agreement'
      ELSE 'live' END,
    'merchant_status', _m.status,
    'agreement_id', _a.id, 'agreement_status', _a.status);
END $$;
REVOKE ALL ON FUNCTION public.app_merchant_onboarding_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_merchant_onboarding_state() TO authenticated;

-- Hide from customer app until signed
CREATE OR REPLACE FUNCTION public.app_store_live(_m uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM merchants WHERE id=_m AND deleted_at IS NULL AND status='approved' AND coalesce(store_enabled,true)
    AND latitude IS NOT NULL AND longitude IS NOT NULL) AND public.merchant_agreement_ok(_m) $function$;

DO $do$ DECLARE d text; f text; BEGIN
  FOREACH f IN ARRAY ARRAY['public.app_commerce_home(text,uuid,double precision,double precision,uuid)','public.app_commerce_search(text,uuid,text,double precision,double precision)'] LOOP
    d := pg_get_functiondef(f::regprocedure);
    IF d LIKE '%m.latitude IS NOT NULL AND m.longitude IS NOT NULL%' AND d NOT LIKE '%merchant_agreement_ok%' THEN
      d := replace(d, 'm.latitude IS NOT NULL AND m.longitude IS NOT NULL', 'm.latitude IS NOT NULL AND m.longitude IS NOT NULL AND public.merchant_agreement_ok(m.id)');
      EXECUTE d;
    END IF;
  END LOOP;
  -- approval push no longer claims the store is live
  d := pg_get_functiondef('public.staff_decide_merchant(uuid,text,text)'::regprocedure);
  d := replace(d, 'Your store is live on Badiyos. You can start taking orders.', 'Your store is approved. Please review and sign your badiyos agreement to go live.');
  EXECUTE d;
END $do$;