
-- ============ AGREEMENTS ============
CREATE TABLE public.agreement_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('store','restaurant','maid','washer','rider','area_partner')),
  version integer NOT NULL,
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  reacceptance_required boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(type, version)
);
GRANT SELECT ON public.agreement_templates TO authenticated;
GRANT ALL ON public.agreement_templates TO service_role;
ALTER TABLE public.agreement_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read templates" ON public.agreement_templates FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

CREATE TABLE public.agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_type text NOT NULL CHECK (party_type IN ('merchant','expert','partner','applicant')),
  party_id uuid NOT NULL,
  template_type text NOT NULL,
  template_id uuid NOT NULL REFERENCES public.agreement_templates(id),
  template_version integer NOT NULL,
  title text NOT NULL DEFAULT '',
  rendered_body text NOT NULL,
  vals jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','accepted','expired')),
  is_reacceptance boolean NOT NULL DEFAULT false,
  signed_method text CHECK (signed_method IN ('otp','paper')),
  accepted_at timestamptz,
  accepted_phone text,
  accepted_ip text,
  accepted_device text,
  paper_path text,
  otp_hash text,
  otp_expires_at timestamptz,
  otp_attempts integer NOT NULL DEFAULT 0,
  sent_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agreements_party_idx ON public.agreements(party_type, party_id, template_type, created_at DESC);
GRANT SELECT ON public.agreements TO authenticated;
GRANT ALL ON public.agreements TO service_role;
ALTER TABLE public.agreements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read agreements" ON public.agreements FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));
REVOKE SELECT (otp_hash) ON public.agreements FROM authenticated;

CREATE TABLE public.party_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_type text NOT NULL,
  party_id uuid NOT NULL,
  auth_user_id uuid,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  data jsonb NOT NULL DEFAULT '{}',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX party_notifications_user_idx ON public.party_notifications(auth_user_id, created_at DESC);
GRANT SELECT, UPDATE ON public.party_notifications TO authenticated;
GRANT ALL ON public.party_notifications TO service_role;
ALTER TABLE public.party_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own notifications read" ON public.party_notifications FOR SELECT TO authenticated USING (auth_user_id = auth.uid());
CREATE POLICY "own notifications mark read" ON public.party_notifications FOR UPDATE TO authenticated USING (auth_user_id = auth.uid()) WITH CHECK (auth_user_id = auth.uid());

-- seed v1 templates
INSERT INTO public.agreement_templates(type, version, title, body) VALUES
('store',1,'Store Merchant Agreement', E'# Store Merchant Agreement\n\nThis agreement is made on {{date}} between badiyos and **{{business_name}}** (owner: {{name}}), {{city}}.\n\n## Commission\nbadiyos will charge a commission of {{commission_pct}}% on each order.\n\n## Term\nFrom {{start_date}} until terminated by either party.\n\n## Signature\nAccepted by {{name}}.'),
('restaurant',1,'Restaurant Partner Agreement', E'# Restaurant Partner Agreement\n\nThis agreement is made on {{date}} between badiyos and **{{business_name}}** (owner: {{name}}), {{city}}.\n\n## Commission\nbadiyos will charge a commission of {{commission_pct}}% on each order.\n\n## Term\nFrom {{start_date}} until terminated by either party.\n\n## Signature\nAccepted by {{name}}.'),
('maid',1,'Clean Home Expert Agreement', E'# Clean Home Expert Agreement\n\nThis agreement is made on {{date}} between badiyos and **{{name}}**, working in {{zone}}, {{city}}.\n\n## Work\nThe Expert will provide home cleaning services booked through badiyos.\n\n## Term\nFrom {{start_date}}.\n\n## Signature\nAccepted by {{name}}.'),
('washer',1,'Clean Auto Expert Agreement', E'# Clean Auto Expert Agreement\n\nThis agreement is made on {{date}} between badiyos and **{{name}}**, working in {{zone}}, {{city}}.\n\n## Work\nThe Expert will provide car and bike cleaning services booked through badiyos.\n\n## Term\nFrom {{start_date}}.\n\n## Signature\nAccepted by {{name}}.'),
('rider',1,'Rider Agreement', E'# Rider Agreement\n\nThis agreement is made on {{date}} between badiyos and **{{name}}**, working in {{zone}}, {{city}}.\n\n## Work\nThe Rider will deliver parcels and orders assigned through badiyos.\n\n## Term\nFrom {{start_date}}.\n\n## Signature\nAccepted by {{name}}.'),
('area_partner',1,'Area Partner Agreement', E'# Area Partner Agreement\n\nThis agreement is made on {{date}} between badiyos and **{{name}}** for {{zone}}, {{city}}.\n\n## Fees\nFranchise fee: ₹{{fee_amount}}. Security deposit: ₹{{deposit_amount}}.\n\n## Term\nFrom {{start_date}} to {{end_date}}.\n\n## Signature\nAccepted by {{name}}.');

-- render placeholders
CREATE OR REPLACE FUNCTION public.agreement_render(_body text, _vals jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE k text; v text; r text := _body;
BEGIN
  FOR k, v IN SELECT key, value FROM jsonb_each_text(coalesce(_vals,'{}')) LOOP
    r := replace(r, '{{' || k || '}}', coalesce(v,''));
  END LOOP;
  RETURN r;
END $$;

-- ============ PARTNER PAYMENTS ============
CREATE TABLE public.partner_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('franchise_fee','security_deposit','renewal_fee','other')),
  amount numeric(12,2) NOT NULL,
  gst_pct numeric(6,2) NOT NULL DEFAULT 0,
  gst_amount numeric(12,2) NOT NULL DEFAULT 0,
  paid_on date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
  mode text NOT NULL CHECK (mode IN ('bank','upi','cash')),
  reference text,
  receipt_path text,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX partner_payments_partner_idx ON public.partner_payments(partner_id, paid_on DESC);
GRANT SELECT ON public.partner_payments TO authenticated;
GRANT ALL ON public.partner_payments TO service_role;
ALTER TABLE public.partner_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read partner payments" ON public.partner_payments FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager','finance']));

INSERT INTO public.tax_settings(key, label, rate_pct, is_active) VALUES ('franchise_fee_gst','Franchise fee GST',18,true)
ON CONFLICT (key) DO NOTHING;

-- ============ EXPERT APPLICATIONS ============
CREATE TABLE public.expert_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL UNIQUE,
  phone text,
  name text,
  photo_path text,
  address text,
  preferred_zone_id uuid REFERENCES public.zones(id),
  work_types text[] NOT NULL DEFAULT '{}',
  documents jsonb NOT NULL DEFAULT '{}',
  bank_account_number text,
  bank_ifsc text,
  bank_account_holder_name text,
  upi_id text,
  step integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','query_raised','approved','rejected')),
  query_reason text,
  query_note text,
  reject_reason text,
  expert_id uuid REFERENCES public.experts(id),
  submitted_at timestamptz,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.expert_applications TO authenticated;
GRANT ALL ON public.expert_applications TO service_role;
ALTER TABLE public.expert_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own application read" ON public.expert_applications FOR SELECT TO authenticated USING (auth_user_id = auth.uid());
CREATE POLICY "staff read applications" ON public.expert_applications FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

-- ============ PARTY HELPERS ============
CREATE OR REPLACE FUNCTION public.party_auth_user(_party_type text, _party_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE _party_type
    WHEN 'merchant' THEN (SELECT auth_user_id FROM merchants WHERE id=_party_id)
    WHEN 'expert' THEN (SELECT auth_user_id FROM experts WHERE id=_party_id)
    WHEN 'partner' THEN (SELECT auth_user_id FROM partners WHERE id=_party_id)
    WHEN 'applicant' THEN (SELECT auth_user_id FROM expert_applications WHERE id=_party_id)
  END $$;

CREATE OR REPLACE FUNCTION public.party_notify(_party_type text, _party_id uuid, _kind text, _title text, _body text, _data jsonb DEFAULT '{}')
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO party_notifications(party_type, party_id, auth_user_id, kind, title, body, data)
  VALUES (_party_type, _party_id, public.party_auth_user(_party_type,_party_id), _kind, _title, _body, coalesce(_data,'{}')) $$;

CREATE OR REPLACE FUNCTION public.agreement_values(_party_type text, _party_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb; _today text := to_char((now() AT TIME ZONE 'Asia/Kolkata')::date,'DD Mon YYYY');
BEGIN
  IF _party_type='merchant' THEN
    SELECT jsonb_build_object('name',coalesce(m.owner_name,m.store_name),'business_name',m.store_name,
      'city',coalesce(m.city,z.city,'Latur'),'zone',coalesce(z.name,''),
      'commission_pct',coalesce(m.commission_pct,m.commission_value,0)::text,
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
END $$;

-- template types a party needs
CREATE OR REPLACE FUNCTION public.party_agreement_types(_party_type text, _party_id uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE _party_type
    WHEN 'merchant' THEN ARRAY[(SELECT CASE WHEN service_type='food' THEN 'restaurant' ELSE 'store' END FROM merchants WHERE id=_party_id)]
    WHEN 'partner' THEN ARRAY['area_partner']
    WHEN 'applicant' THEN (SELECT array_agg(CASE w WHEN 'maid' THEN 'maid' WHEN 'washer' THEN 'washer' ELSE 'rider' END) FROM expert_applications a, unnest(a.work_types) w WHERE a.id=_party_id)
    WHEN 'expert' THEN (SELECT coalesce(array_agg(DISTINCT t),'{}') FROM (
        SELECT CASE c.slug WHEN 'car-bike-wash' THEN 'washer' WHEN 'courier-delivery' THEN 'rider' WHEN 'bulk-delivery' THEN 'rider' ELSE 'maid' END t
        FROM partner_skills s JOIN service_categories c ON c.id=s.service_category_id
        WHERE s.expert_id=_party_id AND s.status='approved') x)
  END $$;

-- issue (internal)
CREATE OR REPLACE FUNCTION public.agreement_issue(_party_type text, _party_id uuid, _type text, _reaccept boolean DEFAULT false, _by uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t agreement_templates; v jsonb; _id uuid;
BEGIN
  SELECT * INTO t FROM agreement_templates WHERE type=_type ORDER BY version DESC LIMIT 1;
  IF t.id IS NULL THEN RAISE EXCEPTION 'No template for %', _type; END IF;
  v := public.agreement_values(_party_type, _party_id);
  UPDATE agreements SET status='expired' WHERE party_type=_party_type AND party_id=_party_id AND template_type=_type AND status='sent';
  INSERT INTO agreements(party_type, party_id, template_type, template_id, template_version, title, rendered_body, vals, is_reacceptance, sent_by)
  VALUES (_party_type, _party_id, _type, t.id, t.version, t.title, public.agreement_render(t.body, v), v, _reaccept, _by) RETURNING id INTO _id;
  PERFORM public.party_notify(_party_type, _party_id, CASE WHEN _reaccept THEN 'agreement_reaccept' ELSE 'agreement_sent' END,
    CASE WHEN _reaccept THEN 'Updated agreement — please accept again' ELSE 'Please review and accept your badiyos agreement' END,
    t.title, jsonb_build_object('agreement_id', _id));
  RETURN _id;
END $$;
REVOKE EXECUTE ON FUNCTION public.agreement_issue(text,uuid,text,boolean,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.party_notify(text,uuid,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.agreement_values(text,uuid) FROM PUBLIC, anon, authenticated;

-- ============ STAFF RPCs: agreements ============
CREATE OR REPLACE FUNCTION public.staff_save_agreement_template(_type text, _title text, _body text, _reaccept boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _v int; _id uuid; _n int := 0; r record;
BEGIN
  IF NOT public.is_super_admin_user() THEN RAISE EXCEPTION 'Only super admin can edit agreements'; END IF;
  SELECT coalesce(max(version),0)+1 INTO _v FROM agreement_templates WHERE type=_type;
  INSERT INTO agreement_templates(type, version, title, body, reacceptance_required, created_by)
  VALUES (_type, _v, _title, _body, _reaccept, auth.uid()) RETURNING id INTO _id;
  IF _reaccept THEN
    FOR r IN SELECT DISTINCT ON (party_type, party_id) party_type, party_id FROM agreements
      WHERE template_type=_type AND status='accepted' ORDER BY party_type, party_id, created_at DESC LOOP
      PERFORM public.agreement_issue(r.party_type, r.party_id, _type, true, auth.uid()); _n := _n + 1;
    END LOOP;
  END IF;
  INSERT INTO audit_logs(actor_id, action, target_table, target_id, after_state)
  VALUES (auth.uid(), 'agreement_template_saved', 'agreement_templates', _id, jsonb_build_object('type',_type,'version',_v,'reaccept',_reaccept,'resent',_n));
  RETURN jsonb_build_object('version',_v,'resent',_n);
END $$;

CREATE OR REPLACE FUNCTION public.staff_send_agreement(_party_type text, _party_id uuid, _type text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t text; _n int := 0;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  FOREACH t IN ARRAY coalesce(CASE WHEN _type IS NOT NULL THEN ARRAY[_type] END, public.party_agreement_types(_party_type,_party_id), '{}') LOOP
    PERFORM public.agreement_issue(_party_type, _party_id, t, false, auth.uid()); _n := _n+1;
  END LOOP;
  IF _n = 0 THEN RAISE EXCEPTION 'No agreement type applies (expert has no approved skill yet)'; END IF;
  INSERT INTO audit_logs(actor_id, action, target_table, target_id, after_state)
  VALUES (auth.uid(), 'agreement_sent', _party_type, _party_id, jsonb_build_object('count',_n,'type',_type));
  RETURN _n;
END $$;

CREATE OR REPLACE FUNCTION public.staff_mark_agreement_paper(_agreement_id uuid, _path text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  UPDATE agreements SET status='accepted', signed_method='paper', paper_path=_path, accepted_at=now()
   WHERE id=_agreement_id AND status <> 'expired';
  IF NOT FOUND THEN RAISE EXCEPTION 'Agreement not found or expired'; END IF;
  INSERT INTO audit_logs(actor_id, action, target_table, target_id, after_state)
  VALUES (auth.uid(), 'agreement_signed_on_paper', 'agreements', _agreement_id, jsonb_build_object('path',_path));
END $$;

CREATE OR REPLACE FUNCTION public.staff_party_agreements(_party_type text, _party_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(a) - 'otp_hash' ORDER BY a.created_at DESC) FROM agreements a WHERE party_type=_party_type AND party_id=_party_id),'[]');
END $$;

CREATE OR REPLACE FUNCTION public.staff_list_unsigned_agreements()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY x->>'party_type', x->>'name') FROM (
    SELECT jsonb_build_object('party_type',p.pt,'party_id',p.id,'name',p.name,'phone',p.phone,'template_type',t,
      'last_status',(SELECT CASE WHEN a.status='sent' AND a.is_reacceptance THEN 'pending_reacceptance' ELSE a.status END FROM agreements a WHERE a.party_type=p.pt AND a.party_id=p.id AND a.template_type=t ORDER BY created_at DESC LIMIT 1),
      'last_sent',(SELECT max(created_at) FROM agreements a WHERE a.party_type=p.pt AND a.party_id=p.id AND a.template_type=t)) x
    FROM (
      SELECT 'merchant' pt, id, store_name name, phone FROM merchants WHERE deleted_at IS NULL AND status='approved'
      UNION ALL SELECT 'expert', id, name, phone FROM experts WHERE status='active'
      UNION ALL SELECT 'partner', id, name, phone FROM partners WHERE status='active'
    ) p, unnest(public.party_agreement_types(p.pt, p.id)) t
    WHERE t IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM agreements a WHERE a.party_type=p.pt AND a.party_id=p.id AND a.template_type=t
        AND ((a.status='accepted' AND NOT EXISTS (SELECT 1 FROM agreements b WHERE b.party_type=a.party_type AND b.party_id=a.party_id AND b.template_type=a.template_type AND b.created_at>a.created_at AND b.status='sent'))))
  ) q),'[]');
END $$;

-- ============ APP RPCs: agreements ============
CREATE OR REPLACE FUNCTION public.app_my_agreements()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'template_type',a.template_type,'title',a.title,'version',a.template_version,
     'body',a.rendered_body,'status',CASE WHEN a.status='sent' AND a.is_reacceptance THEN 'pending_reacceptance' ELSE a.status END,
     'accepted_at',a.accepted_at,'signed_method',a.signed_method,'created_at',a.created_at) ORDER BY a.created_at DESC),'[]')
  FROM agreements a WHERE public.party_auth_user(a.party_type, a.party_id) = auth.uid() AND a.status <> 'expired' $$;

CREATE OR REPLACE FUNCTION public.app_agreement_request_otp(_agreement_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a agreements; _code text := lpad((floor(random()*1000000))::int::text, 6, '0'); _phone text;
BEGIN
  SELECT * INTO a FROM agreements WHERE id=_agreement_id;
  IF a.id IS NULL OR public.party_auth_user(a.party_type,a.party_id) IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Not found'; END IF;
  IF a.status <> 'sent' THEN RAISE EXCEPTION 'Agreement is not awaiting acceptance'; END IF;
  _phone := coalesce((SELECT phone FROM auth.users WHERE id=auth.uid()), '');
  UPDATE agreements SET otp_hash=encode(extensions.digest(_code || id::text,'sha256'),'hex'), otp_expires_at=now()+interval '10 minutes', otp_attempts=0 WHERE id=a.id;
  -- Hand the code to the existing OTP sender (same table used by phone login).
  INSERT INTO otp_codes(phone, code, expires_at) VALUES (_phone, _code, now()+interval '10 minutes');
  RETURN jsonb_build_object('sent_to', right(_phone,4), 'expires_in_seconds', 600);
END $$;

CREATE OR REPLACE FUNCTION public.app_agreement_accept(_agreement_id uuid, _otp text, _device text DEFAULT NULL, _ip text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a agreements; _ip2 text;
BEGIN
  SELECT * INTO a FROM agreements WHERE id=_agreement_id FOR UPDATE;
  IF a.id IS NULL OR public.party_auth_user(a.party_type,a.party_id) IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Not found'; END IF;
  IF a.status <> 'sent' THEN RAISE EXCEPTION 'Agreement is not awaiting acceptance'; END IF;
  IF a.otp_hash IS NULL OR a.otp_expires_at < now() THEN RAISE EXCEPTION 'OTP expired, request a new one'; END IF;
  IF a.otp_attempts >= 5 THEN RAISE EXCEPTION 'Too many attempts, request a new OTP'; END IF;
  IF encode(extensions.digest(_otp || a.id::text,'sha256'),'hex') <> a.otp_hash THEN
    UPDATE agreements SET otp_attempts=otp_attempts+1 WHERE id=a.id; RAISE EXCEPTION 'Wrong OTP';
  END IF;
  BEGIN _ip2 := coalesce(_ip, (current_setting('request.headers', true)::jsonb)->>'x-forwarded-for'); EXCEPTION WHEN others THEN _ip2 := _ip; END;
  UPDATE agreements SET status='accepted', signed_method='otp', accepted_at=now(), otp_hash=NULL,
    accepted_phone=(SELECT phone FROM auth.users WHERE id=auth.uid()), accepted_device=left(_device,300), accepted_ip=left(_ip2,100)
   WHERE id=a.id;
  RETURN jsonb_build_object('ok',true,'accepted_at',now());
END $$;

-- onboarding triggers
CREATE OR REPLACE FUNCTION public.agreements_on_merchant_approved() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status='approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    BEGIN PERFORM public.agreement_issue('merchant', NEW.id, CASE WHEN NEW.service_type='food' THEN 'restaurant' ELSE 'store' END, false, auth.uid());
    EXCEPTION WHEN others THEN RAISE WARNING 'agreement issue failed: %', SQLERRM; END;
  END IF; RETURN NEW;
END $$;
CREATE TRIGGER merchants_issue_agreement AFTER UPDATE OF status ON public.merchants FOR EACH ROW EXECUTE FUNCTION public.agreements_on_merchant_approved();

CREATE OR REPLACE FUNCTION public.agreements_on_partner_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN PERFORM public.agreement_issue('partner', NEW.id, 'area_partner', false, auth.uid());
  EXCEPTION WHEN others THEN RAISE WARNING 'agreement issue failed: %', SQLERRM; END;
  RETURN NEW;
END $$;
CREATE TRIGGER partners_issue_agreement AFTER INSERT ON public.partners FOR EACH ROW EXECUTE FUNCTION public.agreements_on_partner_insert();

-- expert: issue when a skill is approved and no agreement of that type exists yet
CREATE OR REPLACE FUNCTION public.agreements_on_skill_approved() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t text;
BEGIN
  IF NEW.status='approved' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'approved') THEN
    SELECT CASE c.slug WHEN 'car-bike-wash' THEN 'washer' WHEN 'courier-delivery' THEN 'rider' WHEN 'bulk-delivery' THEN 'rider' ELSE 'maid' END
      INTO t FROM service_categories c WHERE c.id=NEW.service_category_id;
    IF t IS NOT NULL AND NOT EXISTS (SELECT 1 FROM agreements WHERE party_type='expert' AND party_id=NEW.expert_id AND template_type=t AND status<>'expired') THEN
      BEGIN PERFORM public.agreement_issue('expert', NEW.expert_id, t, false, auth.uid());
      EXCEPTION WHEN others THEN RAISE WARNING 'agreement issue failed: %', SQLERRM; END;
    END IF;
  END IF; RETURN NEW;
END $$;
CREATE TRIGGER partner_skills_issue_agreement AFTER INSERT OR UPDATE OF status ON public.partner_skills FOR EACH ROW EXECUTE FUNCTION public.agreements_on_skill_approved();

-- ============ STAFF RPCs: partner payments ============
CREATE OR REPLACE FUNCTION public.staff_add_partner_payment(_partner_id uuid, _type text, _amount numeric, _paid_on date, _mode text, _reference text, _receipt_path text, _note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _pct numeric := 0; _gst numeric := 0; _id uuid;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager','finance']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _amount IS NULL OR _amount = 0 THEN RAISE EXCEPTION 'Amount required'; END IF;
  IF _type <> 'security_deposit' AND _amount < 0 THEN RAISE EXCEPTION 'Only deposit refunds can be negative'; END IF;
  IF _type <> 'security_deposit' THEN
    _pct := coalesce((SELECT rate_pct FROM tax_settings WHERE key='franchise_fee_gst' AND is_active), 0);
    _gst := round(_amount * _pct / 100, 2);
  END IF;
  INSERT INTO partner_payments(partner_id, type, amount, gst_pct, gst_amount, paid_on, mode, reference, receipt_path, note, created_by)
  VALUES (_partner_id, _type, _amount, _pct, _gst, coalesce(_paid_on, (now() AT TIME ZONE 'Asia/Kolkata')::date), _mode, nullif(_reference,''), nullif(_receipt_path,''), nullif(_note,''), auth.uid())
  RETURNING id INTO _id;
  INSERT INTO audit_logs(actor_id, action, target_table, target_id, after_state)
  VALUES (auth.uid(), 'partner_payment_added', 'partner_payments', _id, jsonb_build_object('partner_id',_partner_id,'type',_type,'amount',_amount,'gst',_gst));
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.fin_partner_fees(_from date, _to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager','finance']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  RETURN jsonb_build_object(
    'rows', coalesce((SELECT jsonb_agg(jsonb_build_object('id',pp.id,'partner_id',pp.partner_id,'partner_name',p.name,'type',pp.type,'amount',pp.amount,
        'gst_pct',pp.gst_pct,'gst_amount',pp.gst_amount,'paid_on',pp.paid_on,'mode',pp.mode,'reference',pp.reference,'note',pp.note) ORDER BY pp.paid_on DESC, pp.created_at DESC)
      FROM partner_payments pp JOIN partners p ON p.id=pp.partner_id WHERE pp.paid_on BETWEEN _from AND _to),'[]'),
    'fee_income', (SELECT coalesce(sum(amount),0) FROM partner_payments WHERE type<>'security_deposit' AND paid_on BETWEEN _from AND _to),
    'fee_gst', (SELECT coalesce(sum(gst_amount),0) FROM partner_payments WHERE type<>'security_deposit' AND paid_on BETWEEN _from AND _to),
    'deposits_in', (SELECT coalesce(sum(amount),0) FROM partner_payments WHERE type='security_deposit' AND amount>0 AND paid_on BETWEEN _from AND _to),
    'deposits_refunded', (SELECT coalesce(-sum(amount),0) FROM partner_payments WHERE type='security_deposit' AND amount<0 AND paid_on BETWEEN _from AND _to),
    'deposits_held', (SELECT coalesce(sum(amount),0) FROM partner_payments WHERE type='security_deposit'));
END $$;

-- ============ APP RPCs: expert application ============
CREATE OR REPLACE FUNCTION public.app_expert_application_get()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a expert_applications;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  SELECT * INTO a FROM expert_applications WHERE auth_user_id=auth.uid();
  IF a.id IS NULL THEN
    INSERT INTO expert_applications(auth_user_id, phone) VALUES (auth.uid(), (SELECT phone FROM auth.users WHERE id=auth.uid())) RETURNING * INTO a;
  END IF;
  RETURN to_jsonb(a) || jsonb_build_object(
    'live', (SELECT mode='LIVE' FROM experts WHERE id=a.expert_id),
    'agreements', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'template_type',template_type,'title',title,'body',rendered_body,'status',status,'accepted_at',accepted_at)),'[]')
                   FROM agreements WHERE party_type='applicant' AND party_id=a.id AND status<>'expired'));
END $$;

CREATE OR REPLACE FUNCTION public.app_expert_application_save(_patch jsonb, _step integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a expert_applications;
BEGIN
  SELECT * INTO a FROM expert_applications WHERE auth_user_id=auth.uid() FOR UPDATE;
  IF a.id IS NULL THEN PERFORM public.app_expert_application_get(); SELECT * INTO a FROM expert_applications WHERE auth_user_id=auth.uid(); END IF;
  IF a.status NOT IN ('draft','query_raised') THEN RAISE EXCEPTION 'Application can no longer be edited'; END IF;
  IF _patch ? 'work_types' AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_patch->'work_types') w WHERE w NOT IN ('maid','washer','rider')) THEN
    RAISE EXCEPTION 'Invalid work type'; END IF;
  UPDATE expert_applications SET
    name = CASE WHEN _patch ? 'name' THEN _patch->>'name' ELSE name END,
    photo_path = CASE WHEN _patch ? 'photo_path' THEN _patch->>'photo_path' ELSE photo_path END,
    address = CASE WHEN _patch ? 'address' THEN _patch->>'address' ELSE address END,
    preferred_zone_id = CASE WHEN _patch ? 'preferred_zone_id' THEN (_patch->>'preferred_zone_id')::uuid ELSE preferred_zone_id END,
    work_types = CASE WHEN _patch ? 'work_types' THEN ARRAY(SELECT DISTINCT jsonb_array_elements_text(_patch->'work_types')) ELSE work_types END,
    documents = CASE WHEN _patch ? 'documents' THEN documents || (_patch->'documents') ELSE documents END,
    bank_account_number = CASE WHEN _patch ? 'bank_account_number' THEN _patch->>'bank_account_number' ELSE bank_account_number END,
    bank_ifsc = CASE WHEN _patch ? 'bank_ifsc' THEN upper(_patch->>'bank_ifsc') ELSE bank_ifsc END,
    bank_account_holder_name = CASE WHEN _patch ? 'bank_account_holder_name' THEN _patch->>'bank_account_holder_name' ELSE bank_account_holder_name END,
    upi_id = CASE WHEN _patch ? 'upi_id' THEN _patch->>'upi_id' ELSE upi_id END,
    step = coalesce(_step, step), updated_at = now()
  WHERE id=a.id;
  RETURN public.app_expert_application_get();
END $$;

CREATE OR REPLACE FUNCTION public.expert_application_missing(_a public.expert_applications)
RETURNS text[] LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN coalesce(_a.name,'')='' THEN 'name' END,
    CASE WHEN coalesce(_a.photo_path,'')='' THEN 'photo' END,
    CASE WHEN coalesce(_a.address,'')='' THEN 'address' END,
    CASE WHEN _a.preferred_zone_id IS NULL THEN 'zone' END,
    CASE WHEN cardinality(_a.work_types)=0 THEN 'work_types' END,
    CASE WHEN coalesce(_a.documents->>'aadhaar','')='' THEN 'aadhaar' END,
    CASE WHEN coalesce(_a.documents->>'pan','')='' THEN 'pan' END,
    CASE WHEN coalesce(_a.upi_id,'')='' AND (coalesce(_a.bank_account_number,'')='' OR coalesce(_a.bank_ifsc,'')='') THEN 'bank_or_upi' END,
    CASE WHEN 'rider'=ANY(_a.work_types) AND coalesce(_a.documents->>'driving_licence','')='' THEN 'driving_licence' END,
    CASE WHEN 'rider'=ANY(_a.work_types) AND coalesce(_a.documents->>'vehicle_rc','')='' THEN 'vehicle_rc' END
  ], NULL) $$;

-- issue the agreements for the applicant's work types (called by app before submit)
CREATE OR REPLACE FUNCTION public.app_expert_application_agreements()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a expert_applications; t text;
BEGIN
  SELECT * INTO a FROM expert_applications WHERE auth_user_id=auth.uid();
  IF a.id IS NULL OR a.status NOT IN ('draft','query_raised') THEN RAISE EXCEPTION 'No editable application'; END IF;
  IF cardinality(a.work_types)=0 THEN RAISE EXCEPTION 'Choose work types first'; END IF;
  FOREACH t IN ARRAY public.party_agreement_types('applicant', a.id) LOOP
    IF NOT EXISTS (SELECT 1 FROM agreements WHERE party_type='applicant' AND party_id=a.id AND template_type=t AND status IN ('sent','accepted')) THEN
      PERFORM public.agreement_issue('applicant', a.id, t, false, NULL);
    END IF;
  END LOOP;
  RETURN public.app_expert_application_get();
END $$;

CREATE OR REPLACE FUNCTION public.app_expert_application_submit()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a expert_applications; _miss text[]; t text;
BEGIN
  SELECT * INTO a FROM expert_applications WHERE auth_user_id=auth.uid() FOR UPDATE;
  IF a.id IS NULL OR a.status NOT IN ('draft','query_raised') THEN RAISE EXCEPTION 'No editable application'; END IF;
  _miss := public.expert_application_missing(a);
  FOREACH t IN ARRAY coalesce(public.party_agreement_types('applicant', a.id),'{}') LOOP
    IF NOT EXISTS (SELECT 1 FROM agreements WHERE party_type='applicant' AND party_id=a.id AND template_type=t AND status='accepted') THEN
      _miss := _miss || ('agreement_' || t); END IF;
  END LOOP;
  IF cardinality(_miss) > 0 THEN RAISE EXCEPTION 'Missing: %', array_to_string(_miss, ', '); END IF;
  UPDATE expert_applications SET status='submitted', submitted_at=now(), query_reason=NULL, query_note=NULL, updated_at=now() WHERE id=a.id;
  RETURN public.app_expert_application_get();
END $$;

-- ============ STAFF RPCs: applications ============
CREATE OR REPLACE FUNCTION public.staff_list_expert_applications(_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(a) || jsonb_build_object('zone_name', z.name, 'missing', public.expert_application_missing(a),
      'agreements', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',g.id,'template_type',g.template_type,'status',g.status,'accepted_at',g.accepted_at,'title',g.title,'body',g.rendered_body,'template_version',g.template_version,'accepted_phone',g.accepted_phone,'signed_method',g.signed_method)),'[]')
                     FROM agreements g WHERE g.party_type='applicant' AND g.party_id=a.id AND g.status<>'expired'),
      'live', (SELECT mode='LIVE' FROM experts WHERE id=a.expert_id))
      ORDER BY coalesce(a.submitted_at, a.created_at) DESC)
    FROM expert_applications a LEFT JOIN zones z ON z.id=a.preferred_zone_id
    WHERE (_status IS NULL AND a.status <> 'draft') OR a.status=_status),'[]');
END $$;

CREATE OR REPLACE FUNCTION public.staff_review_expert_application(_id uuid, _action text, _reason text DEFAULT NULL, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a expert_applications; _eid uuid; w text; _cat uuid; _maid boolean;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT * INTO a FROM expert_applications WHERE id=_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Not found'; END IF;
  IF a.status NOT IN ('submitted','query_raised') THEN RAISE EXCEPTION 'Application is %', a.status; END IF;
  IF _action='query' THEN
    IF coalesce(_reason,'')='' THEN RAISE EXCEPTION 'Reason required'; END IF;
    UPDATE expert_applications SET status='query_raised', query_reason=_reason, query_note=_note, reviewed_by=auth.uid(), reviewed_at=now(), updated_at=now() WHERE id=_id;
    PERFORM public.party_notify('applicant', _id, 'application_query', 'Action needed on your application', _reason || coalesce(' — ' || _note,''));
  ELSIF _action='reject' THEN
    IF coalesce(_reason,'')='' THEN RAISE EXCEPTION 'Reason required'; END IF;
    UPDATE expert_applications SET status='rejected', reject_reason=_reason, reviewed_by=auth.uid(), reviewed_at=now(), updated_at=now() WHERE id=_id;
    PERFORM public.party_notify('applicant', _id, 'application_rejected', 'Your application was not approved', _reason);
  ELSIF _action='approve' THEN
    IF cardinality(public.expert_application_missing(a)) > 0 THEN RAISE EXCEPTION 'Application is incomplete'; END IF;
    IF EXISTS (SELECT 1 FROM experts WHERE phone=a.phone OR auth_user_id=a.auth_user_id) THEN RAISE EXCEPTION 'An Expert with this phone or login already exists'; END IF;
    _maid := 'maid' = ANY(a.work_types);
    INSERT INTO experts(name, phone, zone_id, address, auth_user_id, status, kyc_status, photo_url, kyc_aadhaar_url, kyc_pan_url,
      bank_account_number, bank_ifsc, bank_account_holder_name, approved_by, joining_date, mode)
    VALUES (a.name, a.phone, a.preferred_zone_id, a.address, a.auth_user_id, 'active', 'approved', a.photo_path, a.documents->>'aadhaar', a.documents->>'pan',
      a.bank_account_number, a.bank_ifsc, a.bank_account_holder_name, auth.uid(), (now() AT TIME ZONE 'Asia/Kolkata')::date,
      CASE WHEN _maid THEN 'TRAINING' ELSE 'LIVE' END)
    RETURNING id INTO _eid;
    INSERT INTO expert_zones(expert_id, zone_id, is_primary) VALUES (_eid, a.preferred_zone_id, true) ON CONFLICT DO NOTHING;
    -- move accepted applicant agreements onto the expert (prevents duplicate issue by the skill trigger)
    UPDATE agreements SET party_type='expert', party_id=_eid WHERE party_type='applicant' AND party_id=a.id;
    FOREACH w IN ARRAY a.work_types LOOP
      SELECT id INTO _cat FROM service_categories WHERE slug = CASE w WHEN 'maid' THEN 'home-cleaning' WHEN 'washer' THEN 'car-bike-wash' ELSE 'courier-delivery' END;
      IF _cat IS NOT NULL THEN
        INSERT INTO partner_skills(expert_id, service_category_id, status, approved_by, approved_at) VALUES (_eid, _cat, 'approved', auth.uid(), now())
        ON CONFLICT (expert_id, service_category_id) DO UPDATE SET status='approved', approved_by=auth.uid(), approved_at=now();
      END IF;
    END LOOP;
    UPDATE expert_applications SET status='approved', expert_id=_eid, reviewed_by=auth.uid(), reviewed_at=now(), updated_at=now() WHERE id=_id;
    PERFORM public.party_notify('applicant', _id, 'application_approved', 'Welcome to badiyos!',
      CASE WHEN _maid THEN 'Your application is approved. Training starts next.' ELSE 'Your application is approved. You can go live now.' END, jsonb_build_object('expert_id',_eid));
  ELSE RAISE EXCEPTION 'Unknown action';
  END IF;
  INSERT INTO audit_logs(actor_id, action, target_table, target_id, after_state)
  VALUES (auth.uid(), 'expert_application_' || _action, 'expert_applications', _id, jsonb_build_object('reason',_reason,'note',_note,'expert_id',_eid));
  RETURN jsonb_build_object('ok',true,'expert_id',_eid);
END $$;

-- ============ STORAGE POLICIES ============
-- buckets 'agreements' (paper copies), 'partner-receipts', 'expert-applications' created via tool
CREATE POLICY "staff manage agreement files" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id='agreements' AND public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']))
  WITH CHECK (bucket_id='agreements' AND public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));
CREATE POLICY "staff manage partner receipts" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id='partner-receipts' AND public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager','finance']))
  WITH CHECK (bucket_id='partner-receipts' AND public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager','finance']));
CREATE POLICY "applicant own docs" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id='expert-applications' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id='expert-applications' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "staff read applicant docs" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id='expert-applications' AND public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));
