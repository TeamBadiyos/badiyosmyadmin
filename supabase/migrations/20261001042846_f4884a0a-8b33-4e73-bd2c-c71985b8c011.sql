
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name text NOT NULL,
  customer_phone text NOT NULL CHECK (customer_phone ~ '^[0-9]{10}$'),
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reg_number text NOT NULL UNIQUE CHECK (reg_number = upper(reg_number) AND reg_number !~ '\s'),
  vehicle_type text NOT NULL CHECK (vehicle_type IN ('car','bike')),
  make_model text, insurer text,
  insurance_expiry date, puc_expiry date,
  consent_reminder boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'whatsapp_expert',
  expert_id uuid REFERENCES public.experts(id) ON DELETE SET NULL,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  photos text[] NOT NULL DEFAULT '{}',
  archived boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.vehicles TO authenticated;
GRANT ALL ON public.vehicles TO service_role;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ops read vehicles" ON public.vehicles FOR SELECT TO authenticated USING (public.courier_is_ops_staff());

CREATE TABLE public.vehicle_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL UNIQUE REFERENCES public.vehicles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','called','quote_sent','renewed','lost')),
  next_followup_date date,
  assigned_to uuid REFERENCES public.staff_users(id) ON DELETE SET NULL,
  renewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.vehicle_leads TO authenticated;
GRANT ALL ON public.vehicle_leads TO service_role;
ALTER TABLE public.vehicle_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ops read vehicle leads" ON public.vehicle_leads FOR SELECT TO authenticated USING (public.courier_is_ops_staff());

CREATE TABLE public.vehicle_lead_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.vehicle_leads(id) ON DELETE CASCADE,
  author_id uuid,
  author_name text,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.vehicle_lead_notes TO authenticated;
GRANT ALL ON public.vehicle_lead_notes TO service_role;
ALTER TABLE public.vehicle_lead_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ops read vehicle notes" ON public.vehicle_lead_notes FOR SELECT TO authenticated USING (public.courier_is_ops_staff());

CREATE INDEX vehicles_ins_exp_idx ON public.vehicles(insurance_expiry);
CREATE INDEX vehicle_leads_followup_idx ON public.vehicle_leads(next_followup_date);

CREATE OR REPLACE FUNCTION public.staff_upsert_vehicle(
  _id uuid, _customer_name text, _customer_phone text, _reg_number text, _vehicle_type text,
  _make_model text, _insurer text, _insurance_expiry date, _puc_expiry date,
  _consent boolean, _expert_id uuid, _booking_id uuid, _photos text[]
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_phone text := right(regexp_replace(coalesce(_customer_phone,''), '\D', '', 'g'), 10);
  v_reg text := upper(regexp_replace(coalesce(_reg_number,''), '[^A-Za-z0-9]', '', 'g'));
  v_user uuid; v_existing uuid; v_before jsonb; v_row public.vehicles;
BEGIN
  IF NOT public.courier_is_ops_staff() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF length(v_phone) <> 10 THEN RAISE EXCEPTION 'Mobile must have 10 digits'; END IF;
  IF length(v_reg) < 4 THEN RAISE EXCEPTION 'Valid vehicle number required'; END IF;
  IF coalesce(trim(_customer_name),'') = '' THEN RAISE EXCEPTION 'Customer name required'; END IF;
  IF _vehicle_type NOT IN ('car','bike') THEN RAISE EXCEPTION 'Type must be car or bike'; END IF;

  SELECT id INTO v_user FROM public.users
   WHERE deleted_at IS NULL AND right(regexp_replace(coalesce(phone,''),'\D','','g'),10) = v_phone
   ORDER BY created_at LIMIT 1;

  IF _id IS NULL THEN
    SELECT id INTO v_existing FROM public.vehicles WHERE reg_number = v_reg;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('id', v_existing, 'duplicate', true);
    END IF;
    INSERT INTO public.vehicles(customer_name, customer_phone, user_id, reg_number, vehicle_type, make_model,
      insurer, insurance_expiry, puc_expiry, consent_reminder, expert_id, booking_id, photos, created_by)
    VALUES (trim(_customer_name), v_phone, v_user, v_reg, _vehicle_type, nullif(trim(_make_model),''),
      nullif(trim(_insurer),''), _insurance_expiry, _puc_expiry, coalesce(_consent,false), _expert_id, _booking_id,
      coalesce(_photos,'{}'), auth.uid())
    RETURNING * INTO v_row;
    INSERT INTO public.vehicle_leads(vehicle_id, next_followup_date)
    VALUES (v_row.id, CASE WHEN _insurance_expiry IS NOT NULL THEN greatest(current_date, _insurance_expiry - 30) END);
    INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
    VALUES (auth.uid(), 'create_vehicle', 'vehicles', v_row.id, NULL, to_jsonb(v_row));
    RETURN jsonb_build_object('id', v_row.id, 'duplicate', false);
  END IF;

  SELECT to_jsonb(v.*) INTO v_before FROM public.vehicles v WHERE id = _id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'Vehicle not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.vehicles WHERE reg_number = v_reg AND id <> _id) THEN
    RAISE EXCEPTION 'Another vehicle already has number %', v_reg;
  END IF;
  UPDATE public.vehicles SET customer_name = trim(_customer_name), customer_phone = v_phone, user_id = v_user,
    reg_number = v_reg, vehicle_type = _vehicle_type, make_model = nullif(trim(_make_model),''),
    insurer = nullif(trim(_insurer),''), insurance_expiry = _insurance_expiry, puc_expiry = _puc_expiry,
    consent_reminder = coalesce(_consent,false), expert_id = _expert_id, booking_id = _booking_id,
    photos = coalesce(_photos, photos), updated_at = now()
  WHERE id = _id RETURNING * INTO v_row;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), 'update_vehicle', 'vehicles', _id, v_before, to_jsonb(v_row));
  RETURN jsonb_build_object('id', _id, 'duplicate', false);
END $$;

CREATE OR REPLACE FUNCTION public.staff_set_vehicle_archived(_id uuid, _archived boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before jsonb; v_row public.vehicles;
BEGIN
  IF NOT public.courier_is_ops_staff() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT to_jsonb(v.*) INTO v_before FROM public.vehicles v WHERE id = _id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'Vehicle not found'; END IF;
  UPDATE public.vehicles SET archived = _archived, updated_at = now() WHERE id = _id RETURNING * INTO v_row;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), CASE WHEN _archived THEN 'archive_vehicle' ELSE 'restore_vehicle' END, 'vehicles', _id, v_before, to_jsonb(v_row));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.staff_update_vehicle_lead(
  _lead_id uuid, _status text, _next_followup_date date, _assigned_to uuid, _note text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before public.vehicle_leads; v_row public.vehicle_leads; v_name text; v_auto text := '';
  v_assignee text;
BEGIN
  IF NOT public.courier_is_ops_staff() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _status NOT IN ('new','called','quote_sent','renewed','lost') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  SELECT * INTO v_before FROM public.vehicle_leads WHERE id = _lead_id;
  IF v_before.id IS NULL THEN RAISE EXCEPTION 'Lead not found'; END IF;
  SELECT name INTO v_name FROM public.staff_users WHERE auth_user_id = auth.uid();
  UPDATE public.vehicle_leads SET status = _status, next_followup_date = _next_followup_date,
    assigned_to = _assigned_to,
    renewed_at = CASE WHEN _status = 'renewed' AND v_before.status <> 'renewed' THEN now()
                      WHEN _status <> 'renewed' THEN NULL ELSE renewed_at END,
    updated_at = now()
  WHERE id = _lead_id RETURNING * INTO v_row;
  IF v_before.status IS DISTINCT FROM _status THEN v_auto := v_auto || 'Status: ' || v_before.status || ' → ' || _status || '. '; END IF;
  IF v_before.assigned_to IS DISTINCT FROM _assigned_to THEN
    SELECT name INTO v_assignee FROM public.staff_users WHERE id = _assigned_to;
    v_auto := v_auto || 'Assigned to ' || coalesce(v_assignee,'nobody') || '. ';
  END IF;
  IF v_before.next_followup_date IS DISTINCT FROM _next_followup_date THEN
    v_auto := v_auto || 'Next follow-up: ' || coalesce(_next_followup_date::text,'none') || '. ';
  END IF;
  IF v_auto <> '' OR coalesce(trim(_note),'') <> '' THEN
    INSERT INTO public.vehicle_lead_notes(lead_id, author_id, author_name, note)
    VALUES (_lead_id, auth.uid(), v_name, trim(v_auto || coalesce(trim(_note),'')));
  END IF;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), 'update_vehicle_lead', 'vehicle_leads', _lead_id, to_jsonb(v_before),
          to_jsonb(v_row) || jsonb_build_object('note', _note));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.staff_insurance_stats()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_start date := date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date;
  v_end date := (date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata')) + interval '1 month')::date;
  v_due int; v_ren int;
BEGIN
  IF NOT public.courier_is_ops_staff() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT count(*) INTO v_due FROM public.vehicles WHERE NOT archived AND insurance_expiry >= v_start AND insurance_expiry < v_end;
  SELECT count(*) INTO v_ren FROM public.vehicle_leads l JOIN public.vehicles v ON v.id = l.vehicle_id
   WHERE l.status = 'renewed' AND (l.renewed_at AT TIME ZONE 'Asia/Kolkata')::date >= v_start
     AND (l.renewed_at AT TIME ZONE 'Asia/Kolkata')::date < v_end;
  RETURN jsonb_build_object('due', v_due, 'renewed', v_ren,
    'conversion', CASE WHEN v_due = 0 THEN 0 ELSE round(v_ren * 100.0 / v_due, 1) END);
END $$;

REVOKE ALL ON FUNCTION public.staff_upsert_vehicle(uuid,text,text,text,text,text,text,date,date,boolean,uuid,uuid,text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_set_vehicle_archived(uuid,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_update_vehicle_lead(uuid,text,date,uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_insurance_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_upsert_vehicle(uuid,text,text,text,text,text,text,date,date,boolean,uuid,uuid,text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_set_vehicle_archived(uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_update_vehicle_lead(uuid,text,date,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_insurance_stats() TO authenticated;

CREATE POLICY "ops upload vehicle docs" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'vehicle-docs' AND public.courier_is_ops_staff());
CREATE POLICY "ops read vehicle docs" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'vehicle-docs' AND public.courier_is_ops_staff());
