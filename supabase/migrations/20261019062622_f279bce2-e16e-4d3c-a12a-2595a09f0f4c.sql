ALTER TABLE public.partners DROP CONSTRAINT IF EXISTS partners_status_check;
ALTER TABLE public.partners ADD CONSTRAINT partners_status_check CHECK (status IN ('active','warning','inactive','suspended','terminated','exited'));
ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS deposit_amount numeric,
  ADD COLUMN IF NOT EXISTS status_reason text,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_changed_by uuid,
  ADD COLUMN IF NOT EXISTS consecutive_kpi_misses int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consecutive_inactive_months int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS suspensions_this_year int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS active_months_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspension_end date,
  ADD COLUMN IF NOT EXISTS exit_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS exit_effective_date date,
  ADD COLUMN IF NOT EXISTS pan_number text,
  ADD COLUMN IF NOT EXISTS bank_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS commission_hold text CHECK (commission_hold IN ('on_hold','forfeited','payable_until')),
  ADD COLUMN IF NOT EXISTS commission_payable_until date,
  ADD COLUMN IF NOT EXISTS termination_recommended boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pending_plan_id uuid REFERENCES public.partner_commission_plans(id),
  ADD COLUMN IF NOT EXISTS pending_plan_from date,
  ADD COLUMN IF NOT EXISTS freed_zone_id uuid;
UPDATE public.partners p SET deposit_amount = COALESCE(p.deposit_amount, NULLIF(p.fee_paid,0), pl.suggested_fee)
  FROM public.partner_commission_plans pl WHERE pl.id=p.plan_id AND p.deposit_amount IS NULL;

CREATE TABLE public.partner_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  action text NOT NULL, from_status text, to_status text, reason text,
  details jsonb NOT NULL DEFAULT '{}', notice_status text,
  action_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX ON public.partner_status_history(partner_id, created_at DESC);
GRANT SELECT ON public.partner_status_history TO authenticated;
GRANT ALL ON public.partner_status_history TO service_role;
ALTER TABLE public.partner_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read partner history" ON public.partner_status_history FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));
CREATE POLICY cc_reader_all ON public.partner_status_history FOR SELECT TO cc_reader USING (true);
GRANT SELECT ON public.partner_status_history TO cc_reader;

CREATE TABLE public.partner_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  activity_date date NOT NULL,
  type text NOT NULL CHECK (type IN ('society_visit','event','pamphlet','stall','other')),
  notes text, photo_paths text[] NOT NULL DEFAULT '{}',
  added_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX ON public.partner_activities(partner_id, activity_date DESC);
GRANT SELECT ON public.partner_activities TO authenticated;
GRANT ALL ON public.partner_activities TO service_role;
ALTER TABLE public.partner_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read partner activities" ON public.partner_activities FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));
CREATE POLICY cc_reader_all ON public.partner_activities FOR SELECT TO cc_reader USING (true);
GRANT SELECT ON public.partner_activities TO cc_reader;

CREATE POLICY "partner_activities staff read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id='partner-activities' AND public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));
CREATE POLICY "partner_activities admin upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='partner-activities' AND public.is_active_staff(auth.uid(), ARRAY['super_admin']));

-- helper: record a status change / action
CREATE OR REPLACE FUNCTION public.partner_log_action(_pid uuid, _action text, _from text, _to text, _reason text, _uid uuid, _details jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO public.partner_status_history(partner_id, action, from_status, to_status, reason, details, notice_status, action_by)
  VALUES (_pid, _action, _from, _to, _reason, COALESCE(_details,'{}'), 'todo_no_whatsapp_template', _uid);
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'partner_'||_action, 'partners', _pid, jsonb_build_object('status',_from),
          jsonb_build_object('status',_to,'reason',_reason) || COALESCE(_details,'{}'));
END $$;
REVOKE ALL ON FUNCTION public.partner_log_action(uuid,text,text,text,text,uuid,jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.staff_partner_lifecycle(_partner_id uuid, _action text, _reason text, _opts jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := public.partner_require_admin(); p public.partners; pl public.partner_commission_plans;
  _rules jsonb; _today date := (now() AT TIME ZONE 'Asia/Kolkata')::date; _to text; _d jsonb := '{}';
  _fraud text[] := ARRAY['Fake orders','Self orders','Fake experts','Customer-expert ko bahar le jaana','Experts se paise lena','badiyos ke naam pe extra paise','Data misuse'];
  _new public.partner_commission_plans; _order text[] := ARRAY['Growth Silver','Growth Gold','Growth Platinum']; _mon date;
BEGIN
  IF btrim(COALESCE(_reason,''))='' THEN RAISE EXCEPTION 'Reason is required'; END IF;
  SELECT * INTO p FROM public.partners WHERE id=_partner_id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Partner not found'; END IF;
  SELECT * INTO pl FROM public.partner_commission_plans WHERE id=p.plan_id;
  _rules := COALESCE(pl.rules,'{}');
  IF p.status IN ('terminated','exited') THEN RAISE EXCEPTION 'Partner is already %', p.status; END IF;

  IF _action='warning' THEN
    _to := 'warning';
  ELSIF _action='suspend' THEN
    IF p.status='suspended' THEN RAISE EXCEPTION 'Already suspended'; END IF;
    _to := 'suspended';
    UPDATE public.partners SET suspension_end=_today+30, suspensions_this_year=suspensions_this_year+1, commission_hold='on_hold',
      termination_recommended = (suspensions_this_year+1) >= COALESCE((_rules->>'max_suspensions_per_year')::int,3)
     WHERE id=p.id;
    _d := jsonb_build_object('suspension_end',_today+30,'immediate',COALESCE((_opts->>'immediate')::boolean,false),
      'suspensions_this_year',p.suspensions_this_year+1,
      'termination_recommended',(p.suspensions_this_year+1) >= COALESCE((_rules->>'max_suspensions_per_year')::int,3));
  ELSIF _action='reactivate' THEN
    IF p.status NOT IN ('suspended','inactive') THEN RAISE EXCEPTION 'Only suspended or inactive partners can be reactivated'; END IF;
    IF p.commission_hold='on_hold' AND COALESCE(_opts->>'hold','') NOT IN ('release','forfeit') THEN RAISE EXCEPTION 'Choose Release or Forfeit for held commission'; END IF;
    _to := 'active';
    UPDATE public.partners SET suspension_end=NULL, commission_hold=NULL, last_activity_at=now() WHERE id=p.id;
    _d := jsonb_build_object('held_commission', NULLIF(_opts->>'hold',''));
  ELSIF _action='terminate' THEN
    _to := 'terminated';
    UPDATE public.partners SET
      commission_hold = CASE WHEN split_part(_reason,':',1) = ANY(_fraud) THEN 'forfeited' ELSE 'payable_until' END,
      commission_payable_until = CASE WHEN split_part(_reason,':',1) = ANY(_fraud) THEN NULL ELSE COALESCE(p.last_activity_at::date, _today) END,
      freed_zone_id = zone_id, zone_id = CASE WHEN program='zone_franchise' THEN zone_id ELSE NULL END,
      termination_recommended=false
     WHERE id=p.id;
    _d := jsonb_build_object('fraud', split_part(_reason,':',1) = ANY(_fraud), 'fee_refund', false, 'territory_freed', true);
  ELSIF _action='exit' THEN
    IF p.exit_requested_at IS NOT NULL THEN RAISE EXCEPTION 'Exit already recorded'; END IF;
    UPDATE public.partners SET exit_requested_at=now(), exit_effective_date=_today+COALESCE((_rules->>'exit_notice_days')::int,30) WHERE id=p.id;
    _to := p.status;
    _d := jsonb_build_object('exit_effective_date',_today+COALESCE((_rules->>'exit_notice_days')::int,30),
      'refund_eligible', _today - p.agreement_start <= COALESCE((_rules->>'refund_window_days')::int,7)
        AND NOT EXISTS (SELECT 1 FROM public.partner_payout_items i WHERE i.partner_id=p.id AND NOT COALESCE(i.is_deleted,false) AND i.gross_amount>0));
  ELSIF _action='renew' THEN
    IF p.active_months_count < COALESCE((_rules->>'renewal_min_active_months')::int,8) AND NOT COALESCE((_opts->>'override')::boolean,false) THEN
      RAISE EXCEPTION 'Not eligible — territory open (% of % active months)', p.active_months_count, COALESCE((_rules->>'renewal_min_active_months')::int,8); END IF;
    UPDATE public.partners SET agreement_end=(agreement_end + interval '12 months')::date, active_months_count=0, suspensions_this_year=0 WHERE id=p.id;
    _to := p.status;
    _d := jsonb_build_object('new_end',(p.agreement_end + interval '12 months')::date,'override',COALESCE((_opts->>'override')::boolean,false),'active_months',p.active_months_count);
  ELSIF _action='upgrade' THEN
    SELECT * INTO _new FROM public.partner_commission_plans WHERE id=NULLIF(_opts->>'plan_id','')::uuid;
    IF p.program<>'growth' OR _new.id IS NULL OR array_position(_order,_new.name) IS NULL OR array_position(_order,pl.name) IS NULL
       OR array_position(_order,_new.name) <= array_position(_order,pl.name) THEN
      RAISE EXCEPTION 'Only Growth Silver → Gold → Platinum upgrades are allowed'; END IF;
    IF COALESCE((_opts->>'fee_difference')::numeric,-1) < 0 THEN RAISE EXCEPTION 'Enter the fee difference'; END IF;
    _mon := _today + (8 - EXTRACT(isodow FROM _today)::int);
    UPDATE public.partners SET pending_plan_id=_new.id, pending_plan_from=_mon WHERE id=p.id;
    _to := p.status;
    _d := jsonb_build_object('from_plan',pl.name,'to_plan',_new.name,'fee_difference',(_opts->>'fee_difference')::numeric,'effective',_mon);
  ELSE RAISE EXCEPTION 'Unknown action'; END IF;

  IF _to IS DISTINCT FROM p.status THEN
    UPDATE public.partners SET status=_to, status_reason=_reason, status_changed_at=now(), status_changed_by=_uid, updated_at=now() WHERE id=p.id;
  ELSE UPDATE public.partners SET updated_at=now() WHERE id=p.id; END IF;
  PERFORM public.partner_log_action(p.id, _action, p.status, _to, _reason, _uid, _d);
  RETURN _d || jsonb_build_object('status',_to);
END $$;
REVOKE ALL ON FUNCTION public.staff_partner_lifecycle(uuid,text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_partner_lifecycle(uuid,text,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_partner_set_kyc(_partner_id uuid, _pan text, _bank_verified boolean, _deposit numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := public.partner_require_admin(); _b jsonb; _pan2 text := upper(NULLIF(btrim(COALESCE(_pan,'')),''));
BEGIN
  IF _pan2 IS NOT NULL AND _pan2 !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' THEN RAISE EXCEPTION 'PAN must look like ABCDE1234F'; END IF;
  IF _deposit IS NOT NULL AND _deposit < 0 THEN RAISE EXCEPTION 'Deposit cannot be negative'; END IF;
  SELECT jsonb_build_object('pan_number',pan_number,'bank_verified',bank_verified,'deposit_amount',deposit_amount) INTO _b FROM public.partners WHERE id=_partner_id;
  IF _b IS NULL THEN RAISE EXCEPTION 'Partner not found'; END IF;
  UPDATE public.partners SET pan_number=_pan2, bank_verified=COALESCE(_bank_verified,false), deposit_amount=_deposit, updated_at=now() WHERE id=_partner_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid,'partner_kyc_update','partners',_partner_id,_b,jsonb_build_object('pan_number',_pan2,'bank_verified',COALESCE(_bank_verified,false),'deposit_amount',_deposit));
END $$;
REVOKE ALL ON FUNCTION public.staff_partner_set_kyc(uuid,text,boolean,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_partner_set_kyc(uuid,text,boolean,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_partner_add_activity(_partner_id uuid, _date date, _type text, _notes text, _paths text[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := public.partner_require_admin(); _id uuid;
BEGIN
  IF COALESCE(array_length(_paths,1),0) NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Add 1 to 5 photos'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(_paths) x WHERE x NOT LIKE _partner_id::text||'/%') THEN RAISE EXCEPTION 'Invalid photo path'; END IF;
  IF _date IS NULL OR _date > (now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Choose a valid date'; END IF;
  INSERT INTO public.partner_activities(partner_id, activity_date, type, notes, photo_paths, added_by)
  VALUES (_partner_id, _date, _type, NULLIF(btrim(COALESCE(_notes,'')),''), _paths, _uid) RETURNING id INTO _id;
  UPDATE public.partners SET last_activity_at=now() WHERE id=_partner_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, after_state)
  VALUES (_uid,'partner_activity_add','partner_activities',_id,jsonb_build_object('partner_id',_partner_id,'type',_type,'date',_date,'photos',array_length(_paths,1)));
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.staff_partner_add_activity(uuid,date,text,text,text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_partner_add_activity(uuid,date,text,text,text[]) TO authenticated;

-- last_activity_at when an expert is onboarded by the partner
CREATE OR REPLACE FUNCTION public.partner_touch_on_expert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.onboarded_by_partner_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.onboarded_by_partner_id IS DISTINCT FROM OLD.onboarded_by_partner_id) THEN
    UPDATE public.partners SET last_activity_at=now() WHERE id=NEW.onboarded_by_partner_id;
  END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_partner_touch_on_expert ON public.experts;
CREATE TRIGGER trg_partner_touch_on_expert AFTER INSERT OR UPDATE OF onboarded_by_partner_id ON public.experts FOR EACH ROW EXECUTE FUNCTION public.partner_touch_on_expert();

-- daily: exit effective, agreement expiry, due upgrades
CREATE OR REPLACE FUNCTION public.partner_daily_lifecycle() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; _today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  FOR r IN SELECT * FROM public.partners WHERE status NOT IN ('terminated','exited')
     AND ((exit_effective_date IS NOT NULL AND exit_effective_date <= _today) OR agreement_end < _today) LOOP
    UPDATE public.partners SET status='exited', status_reason=CASE WHEN r.exit_effective_date <= _today THEN 'Exit notice period over' ELSE 'Agreement ended without renewal' END,
      status_changed_at=now(), status_changed_by=NULL, freed_zone_id=zone_id WHERE id=r.id;
    PERFORM public.partner_log_action(r.id,'auto_exit',r.status,'exited',
      CASE WHEN r.exit_effective_date <= _today THEN 'Exit notice period over' ELSE 'Agreement ended without renewal' END, NULL, '{}');
  END LOOP;
  FOR r IN SELECT p.*, pl.name pn FROM public.partners p JOIN public.partner_commission_plans pl ON pl.id=p.pending_plan_id
     WHERE p.pending_plan_from <= _today AND p.status NOT IN ('terminated','exited') LOOP
    UPDATE public.partners SET plan_id=r.pending_plan_id, pending_plan_id=NULL, pending_plan_from=NULL WHERE id=r.id;
    PERFORM public.partner_log_action(r.id,'upgrade_applied',r.status,r.status,'Upgrade effective', NULL, jsonb_build_object('plan',r.pn));
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.partner_daily_lifecycle() FROM PUBLIC, anon, authenticated;
SELECT cron.schedule('partner-daily-lifecycle', '30 21 * * *', 'SELECT public.partner_daily_lifecycle()');

-- upsert: keep lifecycle status on edit, new = active, territory occupied by any non-ended status
CREATE OR REPLACE FUNCTION public.staff_partner_upsert(_p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := public.partner_require_admin(); _id uuid := NULLIF(_p->>'id','')::uuid;
  _program text := _p->>'program'; _plan uuid := NULLIF(_p->>'plan_id','')::uuid; _plan_row record;
  _gplan uuid := NULLIF(_p->>'growth_plan_id','')::uuid; _gplan_row record;
  _zone uuid := NULLIF(_p->>'zone_id','')::uuid; _city text := btrim(COALESCE(_p->>'city',''));
  _start date := (_p->>'agreement_start')::date; _end date; _status text; _before jsonb; _after jsonb;
  _live text[] := ARRAY['active','warning','inactive','suspended'];
BEGIN
  IF btrim(COALESCE(_p->>'name',''))='' OR btrim(COALESCE(_p->>'phone',''))='' THEN RAISE EXCEPTION 'Name and phone are required'; END IF;
  IF _program NOT IN ('growth','zone_franchise','city_master') THEN RAISE EXCEPTION 'Invalid program'; END IF;
  IF _plan IS NULL THEN RAISE EXCEPTION 'Choose a commission plan'; END IF;
  SELECT * INTO _plan_row FROM public.partner_commission_plans WHERE id=_plan;
  IF _plan_row.id IS NULL OR _plan_row.partner_type <> _program THEN RAISE EXCEPTION 'Plan does not match the partner type'; END IF;
  IF _id IS NOT NULL THEN SELECT to_jsonb(p) INTO _before FROM public.partners p WHERE id=_id;
    IF _before IS NULL THEN RAISE EXCEPTION 'Partner not found'; END IF; END IF;
  _status := COALESCE(_before->>'status','active');
  _end := COALESCE(NULLIF(_p->>'agreement_end','')::date, (_start + make_interval(months => COALESCE((_plan_row.rules->>'agreement_months')::int,12)) - interval '1 day')::date);
  IF _plan_row.status <> 'active' AND (_before IS NULL OR (_before->>'plan_id')::uuid IS DISTINCT FROM _plan) THEN
    RAISE EXCEPTION 'This plan is inactive'; END IF;
  IF _program='growth' THEN _gplan := NULL; END IF;
  IF _gplan IS NOT NULL THEN
    SELECT * INTO _gplan_row FROM public.partner_commission_plans WHERE id=_gplan;
    IF _gplan_row.id IS NULL OR _gplan_row.partner_type <> 'growth' THEN RAISE EXCEPTION 'Growth plan must be a Growth Partner plan'; END IF;
    IF _gplan_row.status <> 'active' AND (_before IS NULL OR NULLIF(_before->>'growth_plan_id','')::uuid IS DISTINCT FROM _gplan) THEN
      RAISE EXCEPTION 'This Growth plan is inactive'; END IF;
  END IF;
  IF _program='zone_franchise' THEN
    IF _zone IS NULL THEN RAISE EXCEPTION 'Zone is required for Zone Franchise'; END IF;
    SELECT city INTO _city FROM public.zones WHERE id=_zone AND deleted_at IS NULL;
    IF _city IS NULL THEN RAISE EXCEPTION 'Zone not found'; END IF;
  ELSE _zone := NULL; END IF;
  IF _city='' THEN RAISE EXCEPTION 'City is required'; END IF;
  IF _start IS NULL THEN RAISE EXCEPTION 'Agreement start date is required'; END IF;
  IF _status = ANY(_live) AND _program='zone_franchise' AND EXISTS (SELECT 1 FROM public.partners WHERE program='zone_franchise' AND status = ANY(_live) AND zone_id=_zone AND id IS DISTINCT FROM _id) THEN
    RAISE EXCEPTION 'This zone already has a Zone Franchise'; END IF;
  IF _status = ANY(_live) AND _program='city_master' AND EXISTS (SELECT 1 FROM public.partners WHERE program='city_master' AND status = ANY(_live) AND lower(city)=lower(_city) AND id IS DISTINCT FROM _id) THEN
    RAISE EXCEPTION 'This city already has a City Master'; END IF;
  IF _id IS NULL THEN
    INSERT INTO public.partners(name,phone,program,level,plan_id,growth_plan_id,city,zone_id,agreement_start,agreement_end,fee_paid,fee_collected_at,status,notes,deposit_amount,last_activity_at)
    VALUES (btrim(_p->>'name'),btrim(_p->>'phone'),_program,NULL,_plan,_gplan,_city,_zone,_start,_end,
      COALESCE(NULLIF(_p->>'fee_paid','')::numeric,0), NULLIF(_p->>'fee_collected_at','')::date, 'active', NULLIF(_p->>'notes',''),
      COALESCE(NULLIF(_p->>'deposit_amount','')::numeric, _plan_row.suggested_fee), now())
    RETURNING id INTO _id;
  ELSE
    UPDATE public.partners SET name=btrim(_p->>'name'), phone=btrim(_p->>'phone'), program=_program, level=NULL, plan_id=_plan, growth_plan_id=_gplan,
      city=_city, zone_id=_zone, agreement_start=_start, agreement_end=_end, fee_paid=COALESCE(NULLIF(_p->>'fee_paid','')::numeric,0),
      fee_collected_at=NULLIF(_p->>'fee_collected_at','')::date, notes=NULLIF(_p->>'notes',''), updated_at=now()
     WHERE id=_id;
  END IF;
  SELECT to_jsonb(p) INTO _after FROM public.partners p WHERE id=_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, CASE WHEN _before IS NULL THEN 'partner_create' ELSE 'partner_update' END, 'partners', _id, _before, _after);
  RETURN _id;
END $$;