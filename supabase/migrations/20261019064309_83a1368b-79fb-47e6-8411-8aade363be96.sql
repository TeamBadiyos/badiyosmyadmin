
CREATE TABLE public.partner_kpi_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  month date NOT NULL,
  plan_id uuid,
  active_experts int, new_experts int, new_customers int, promo_activities int,
  review_meeting_done boolean NOT NULL DEFAULT false,
  targets jsonb NOT NULL DEFAULT '{}',
  kpi_met boolean, skipped_reason text,
  status_before text, status_after text,
  counters_before jsonb,
  evaluated_at timestamptz, evaluated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partner_id, month)
);
GRANT SELECT ON public.partner_kpi_results TO authenticated;
GRANT ALL ON public.partner_kpi_results TO service_role;
ALTER TABLE public.partner_kpi_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read kpi results" ON public.partner_kpi_results FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));
CREATE POLICY cc_reader_all ON public.partner_kpi_results FOR SELECT TO cc_reader USING (true);
GRANT SELECT ON public.partner_kpi_results TO cc_reader;

CREATE TABLE public.partner_payout_skips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.partner_payout_batches(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  order_type text NOT NULL, order_id uuid NOT NULL, order_completed_at timestamptz,
  amount numeric NOT NULL DEFAULT 0, reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.partner_payout_skips TO authenticated;
GRANT ALL ON public.partner_payout_skips TO service_role;
ALTER TABLE public.partner_payout_skips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read payout skips" ON public.partner_payout_skips FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));
CREATE POLICY cc_reader_all ON public.partner_payout_skips FOR SELECT TO cc_reader USING (true);
GRANT SELECT ON public.partner_payout_skips TO cc_reader;

ALTER TABLE public.partner_payout_lines DROP CONSTRAINT IF EXISTS partner_payout_lines_order_type_check;
ALTER TABLE public.partner_payout_lines ADD CONSTRAINT partner_payout_lines_order_type_check
  CHECK (order_type = ANY (ARRAY['booking','courier','store','booking_adj','courier_adj','store_adj']));

-- status at a moment, from history (no history before = active)
CREATE OR REPLACE FUNCTION public.partner_status_at(_pid uuid, _at timestamptz) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((SELECT to_status FROM public.partner_status_history WHERE partner_id=_pid AND created_at <= _at
     AND to_status IS NOT NULL ORDER BY created_at DESC LIMIT 1), 'active')
$$;
REVOKE ALL ON FUNCTION public.partner_status_at(uuid,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_status_at(uuid,timestamptz) TO authenticated;

-- KPI actuals for a partner and month
CREATE OR REPLACE FUNCTION public.partner_kpi_actuals(_pid uuid, _month date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE p record; r jsonb; _s timestamptz; _e timestamptz; _hrs numeric; _jobs int; _ae int; _ne int; _nc int; _pa int;
BEGIN
  SELECT pa.*, pl.rules FROM public.partners pa LEFT JOIN public.partner_commission_plans pl ON pl.id=pa.plan_id WHERE pa.id=_pid INTO p;
  r := COALESCE(p.rules,'{}');
  _hrs := COALESCE((r->>'active_expert_min_hours')::numeric, 20);
  _jobs := COALESCE((r->>'active_expert_min_jobs')::int, 10);
  _s := (_month::timestamp AT TIME ZONE 'Asia/Kolkata');
  _e := ((_month + interval '1 month')::timestamp AT TIME ZONE 'Asia/Kolkata');

  CREATE TEMP TABLE IF NOT EXISTS _kx(expert_id uuid PRIMARY KEY) ON COMMIT DROP; DELETE FROM _kx;
  INSERT INTO _kx SELECT DISTINCT e.id FROM public.experts e
   WHERE (p.program='growth' AND e.onboarded_by_partner_id=p.id)
      OR (p.program='zone_franchise' AND (e.zone_id=p.zone_id OR EXISTS (SELECT 1 FROM public.expert_zones z WHERE z.expert_id=e.id AND z.zone_id=p.zone_id)))
      OR (p.program='city_master' AND e.city_id=p.city_id)
  ON CONFLICT DO NOTHING;

  WITH jobs AS (
    SELECT b.assigned_expert_id x, COALESCE(b.service_duration_minutes,0)/60.0 h FROM public.bookings b
     WHERE b.status='completed' AND b.deleted_at IS NULL AND NOT COALESCE(b.is_training,false)
       AND COALESCE(b.service_end_at,b.updated_at) >= _s AND COALESCE(b.service_end_at,b.updated_at) < _e
       AND b.assigned_expert_id IN (SELECT expert_id FROM _kx)
    UNION ALL
    SELECT c.assigned_expert_id, 0 FROM public.courier_orders c
     WHERE upper(c.status)='COMPLETED' AND c.completed_at >= _s AND c.completed_at < _e AND c.assigned_expert_id IN (SELECT expert_id FROM _kx)
  ), agg AS (SELECT x, sum(h) h, count(*) n FROM jobs GROUP BY x)
  SELECT count(*) FILTER (WHERE h >= _hrs OR n >= _jobs),
         count(*) FILTER (WHERE x IN (SELECT id FROM public.experts WHERE created_at >= _s AND created_at < _e))
    INTO _ae, _ne FROM agg;

  SELECT count(*) INTO _nc FROM (
    SELECT DISTINCT ON (b.user_id) b.user_id, b.assigned_expert_id, b.zone_id, b.city_id, COALESCE(b.service_end_at,b.updated_at) t
      FROM public.bookings b WHERE b.status='completed' AND b.deleted_at IS NULL AND NOT COALESCE(b.is_training,false) AND b.user_id IS NOT NULL
     ORDER BY b.user_id, COALESCE(b.service_end_at,b.updated_at)) f
   WHERE f.t >= _s AND f.t < _e AND (
     (p.program='growth' AND f.assigned_expert_id IN (SELECT expert_id FROM _kx))
     OR (p.program='zone_franchise' AND f.zone_id=p.zone_id)
     OR (p.program='city_master' AND f.city_id=p.city_id));

  SELECT count(*) INTO _pa FROM public.partner_activities WHERE partner_id=_pid AND activity_date >= _month AND activity_date < (_month + interval '1 month')::date;
  RETURN jsonb_build_object('active_experts',COALESCE(_ae,0),'new_experts',COALESCE(_ne,0),'new_customers',COALESCE(_nc,0),'promo_activities',COALESCE(_pa,0));
END $$;
REVOKE ALL ON FUNCTION public.partner_kpi_actuals(uuid,date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.partner_kpi_targets(_pid uuid, _month date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE p record; k jsonb; t jsonb := '{}'; _ramp boolean; f text;
BEGIN
  SELECT pa.agreement_start, pl.kpi, pl.rules INTO p FROM public.partners pa LEFT JOIN public.partner_commission_plans pl ON pl.id=pa.plan_id WHERE pa.id=_pid;
  k := COALESCE(p.kpi,'{}');
  _ramp := ((_month + interval '1 month' - interval '1 day')::date - p.agreement_start) < COALESCE((p.rules->>'rampup_days')::int,60);
  FOREACH f IN ARRAY ARRAY['min_active_experts','min_new_experts','min_new_customers','min_promo_activities'] LOOP
    IF k ? f AND k->>f IS NOT NULL AND k->>f <> '' THEN
      t := t || jsonb_build_object(f, CASE WHEN _ramp THEN ceil((k->>f)::numeric/2)::int ELSE (k->>f)::int END);
    END IF;
  END LOOP;
  IF COALESCE((k->>'review_meeting_required')::boolean,false) THEN t := t || '{"review_meeting_required":true}'; END IF;
  RETURN t || jsonb_build_object('rampup', _ramp);
END $$;
REVOKE ALL ON FUNCTION public.partner_kpi_targets(uuid,date) FROM PUBLIC, anon, authenticated;

-- evaluate one partner for a month (idempotent; re-run restores counters first)
CREATE OR REPLACE FUNCTION public.partner_evaluate_kpi(_pid uuid, _month date, _by text, _uid uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE p record; prev record; a jsonb; t jsonb; r jsonb; _met boolean; _rev boolean; _new text;
  _miss int; _inact int; _am int; _rec boolean; _cb jsonb;
BEGIN
  _month := date_trunc('month',_month)::date;
  SELECT * INTO prev FROM public.partner_kpi_results WHERE partner_id=_pid AND month=_month;
  IF prev.id IS NOT NULL AND prev.counters_before IS NOT NULL AND prev.evaluated_at IS NOT NULL THEN
    UPDATE public.partners SET status=prev.status_before,
      consecutive_kpi_misses=(prev.counters_before->>'misses')::int, consecutive_inactive_months=(prev.counters_before->>'inactive')::int,
      active_months_count=(prev.counters_before->>'active_months')::int, termination_recommended=(prev.counters_before->>'term')::boolean
     WHERE id=_pid;
  END IF;
  SELECT pa.*, pl.rules FROM public.partners pa LEFT JOIN public.partner_commission_plans pl ON pl.id=pa.plan_id WHERE pa.id=_pid INTO p;
  _cb := jsonb_build_object('misses',p.consecutive_kpi_misses,'inactive',p.consecutive_inactive_months,'active_months',p.active_months_count,'term',p.termination_recommended);
  _rev := COALESCE(prev.review_meeting_done,false);
  IF p.status NOT IN ('active','warning','inactive') THEN
    INSERT INTO public.partner_kpi_results(partner_id,month,plan_id,kpi_met,skipped_reason,status_before,status_after,evaluated_at,evaluated_by,review_meeting_done,counters_before)
    VALUES (_pid,_month,p.plan_id,NULL,'Partner is '||p.status,p.status,p.status,now(),_by,_rev,NULL)
    ON CONFLICT (partner_id,month) DO UPDATE SET kpi_met=NULL, skipped_reason=EXCLUDED.skipped_reason, status_before=EXCLUDED.status_before,
      status_after=EXCLUDED.status_after, evaluated_at=now(), evaluated_by=_by, counters_before=NULL;
    RETURN jsonb_build_object('skipped',true);
  END IF;
  a := public.partner_kpi_actuals(_pid,_month); t := public.partner_kpi_targets(_pid,_month); r := COALESCE(p.rules,'{}');
  _met := COALESCE((a->>'active_experts')::int >= COALESCE((t->>'min_active_experts')::int,0),true)
      AND (a->>'new_experts')::int >= COALESCE((t->>'min_new_experts')::int,0)
      AND (a->>'new_customers')::int >= COALESCE((t->>'min_new_customers')::int,0)
      AND (a->>'promo_activities')::int >= COALESCE((t->>'min_promo_activities')::int,0)
      AND (NOT COALESCE((t->>'review_meeting_required')::boolean,false) OR _rev);
  _miss := p.consecutive_kpi_misses; _inact := p.consecutive_inactive_months; _am := p.active_months_count; _rec := p.termination_recommended; _new := p.status;
  IF _met THEN _miss := 0; _inact := 0; _am := _am + 1; _new := 'active';
  ELSE
    _miss := _miss + 1;
    IF _miss >= COALESCE((r->>'inactive_after_consecutive_misses')::int,2) THEN _new := 'inactive'; _inact := _inact + 1;
    ELSIF _miss >= COALESCE((r->>'warning_after_misses')::int,1) THEN _new := 'warning'; END IF;
    IF _inact >= COALESCE((r->>'termination_after_consecutive_inactive')::int,4) THEN _rec := true; END IF;
  END IF;
  UPDATE public.partners SET status=_new, consecutive_kpi_misses=_miss, consecutive_inactive_months=_inact, active_months_count=_am,
    termination_recommended=_rec,
    status_reason=CASE WHEN _new<>p.status THEN CASE WHEN _met THEN 'KPI met' ELSE 'KPI missed' END ELSE status_reason END,
    status_changed_at=CASE WHEN _new<>p.status THEN now() ELSE status_changed_at END,
    status_changed_by=CASE WHEN _new<>p.status THEN _uid ELSE status_changed_by END
   WHERE id=_pid;
  IF _new <> p.status THEN
    PERFORM public.partner_log_action(_pid,'kpi_evaluation',p.status,_new, CASE WHEN _met THEN 'KPI met ' ELSE 'KPI missed ' END||to_char(_month,'Mon YYYY'), _uid, jsonb_build_object('month',_month));
  END IF;
  IF _rec AND NOT p.termination_recommended THEN
    INSERT INTO public.staff_notifications(notif_key,kind,title,detail,target,target_id,event_at)
    VALUES ('partner_term_rec:'||_pid||':'||_month,'partner','Termination recommended', p.name||' has been inactive '||_inact||' months in a row','partners',_pid,now())
    ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO public.partner_kpi_results(partner_id,month,plan_id,active_experts,new_experts,new_customers,promo_activities,review_meeting_done,targets,kpi_met,skipped_reason,status_before,status_after,counters_before,evaluated_at,evaluated_by)
  VALUES (_pid,_month,p.plan_id,(a->>'active_experts')::int,(a->>'new_experts')::int,(a->>'new_customers')::int,(a->>'promo_activities')::int,_rev,t,_met,NULL,p.status,_new,_cb,now(),_by)
  ON CONFLICT (partner_id,month) DO UPDATE SET plan_id=EXCLUDED.plan_id, active_experts=EXCLUDED.active_experts, new_experts=EXCLUDED.new_experts,
    new_customers=EXCLUDED.new_customers, promo_activities=EXCLUDED.promo_activities, targets=EXCLUDED.targets, kpi_met=EXCLUDED.kpi_met,
    skipped_reason=NULL, status_before=EXCLUDED.status_before, status_after=EXCLUDED.status_after, counters_before=EXCLUDED.counters_before,
    evaluated_at=now(), evaluated_by=_by;
  RETURN jsonb_build_object('kpi_met',_met,'status',_new,'actuals',a,'targets',t);
END $$;
REVOKE ALL ON FUNCTION public.partner_evaluate_kpi(uuid,date,text,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.partner_monthly_kpi() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; _today date := (now() AT TIME ZONE 'Asia/Kolkata')::date; _m date;
BEGIN
  IF extract(day FROM _today) <> 1 THEN RETURN; END IF;
  _m := (_today - interval '1 month')::date;
  FOR r IN SELECT id FROM public.partners WHERE agreement_start <= (_today - 1) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.partner_kpi_results WHERE partner_id=r.id AND month=_m AND evaluated_at IS NOT NULL) THEN
      PERFORM public.partner_evaluate_kpi(r.id,_m,'system',NULL);
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.partner_monthly_kpi() FROM PUBLIC, anon, authenticated;
SELECT cron.unschedule('partner-monthly-kpi') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='partner-monthly-kpi');
SELECT cron.schedule('partner-monthly-kpi', '30 20 28-31 * *', 'SELECT public.partner_monthly_kpi()');

-- staff: live progress, re-run, review tick
CREATE OR REPLACE FUNCTION public.staff_partner_kpi_live(_partner_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _m date := date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN jsonb_build_object('month',_m,'actuals',public.partner_kpi_actuals(_partner_id,_m),'targets',public.partner_kpi_targets(_partner_id,_m),
    'review_meeting_done',COALESCE((SELECT review_meeting_done FROM public.partner_kpi_results WHERE partner_id=_partner_id AND month=_m),false));
END $$;
REVOKE ALL ON FUNCTION public.staff_partner_kpi_live(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_partner_kpi_live(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_partner_kpi_rerun(_partner_id uuid, _reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := public.partner_require_admin(); _m date := (date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') - interval '1 month')::date; _res jsonb;
BEGIN
  IF length(btrim(COALESCE(_reason,''))) < 3 THEN RAISE EXCEPTION 'Reason is required'; END IF;
  _res := public.partner_evaluate_kpi(_partner_id,_m,_uid::text,_uid);
  INSERT INTO public.audit_logs(actor_id,action,target_table,target_id,before_state,after_state)
  VALUES (_uid,'partner_kpi_rerun','partners',_partner_id,NULL,jsonb_build_object('month',_m,'reason',_reason,'result',_res));
  RETURN _res;
END $$;
REVOKE ALL ON FUNCTION public.staff_partner_kpi_rerun(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_partner_kpi_rerun(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_partner_review_meeting(_partner_id uuid, _month date, _done boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := public.partner_require_admin();
BEGIN
  _month := date_trunc('month',_month)::date;
  INSERT INTO public.partner_kpi_results(partner_id,month,review_meeting_done) VALUES (_partner_id,_month,_done)
  ON CONFLICT (partner_id,month) DO UPDATE SET review_meeting_done=_done;
  INSERT INTO public.audit_logs(actor_id,action,target_table,target_id,before_state,after_state)
  VALUES (_uid,'partner_review_meeting','partners',_partner_id,NULL,jsonb_build_object('month',_month,'done',_done));
END $$;
REVOKE ALL ON FUNCTION public.staff_partner_review_meeting(uuid,date,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_partner_review_meeting(uuid,date,boolean) TO authenticated;

-- last_activity_at on a growth partner expert's completed job
CREATE OR REPLACE FUNCTION public.partner_touch_on_job() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.partners p SET last_activity_at=now() FROM public.experts e
   WHERE e.id=NEW.assigned_expert_id AND p.id=e.onboarded_by_partner_id AND p.program='growth';
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_partner_touch_on_booking ON public.bookings;
CREATE TRIGGER trg_partner_touch_on_booking AFTER UPDATE OF status ON public.bookings FOR EACH ROW
  WHEN (NEW.status='completed' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.assigned_expert_id IS NOT NULL) EXECUTE FUNCTION public.partner_touch_on_job();
DROP TRIGGER IF EXISTS trg_partner_touch_on_courier ON public.courier_orders;
CREATE TRIGGER trg_partner_touch_on_courier AFTER UPDATE OF status ON public.courier_orders FOR EACH ROW
  WHEN (upper(NEW.status)='COMPLETED' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.assigned_expert_id IS NOT NULL) EXECUTE FUNCTION public.partner_touch_on_job();

-- daily job: add no-activity and suspension-end checks
CREATE OR REPLACE FUNCTION public.partner_daily_lifecycle() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; _today date := (now() AT TIME ZONE 'Asia/Kolkata')::date; _d int;
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
  FOR r IN SELECT p.*, pl.rules FROM public.partners p LEFT JOIN public.partner_commission_plans pl ON pl.id=p.plan_id
     WHERE p.status='suspended' AND p.suspension_end IS NOT NULL AND p.suspension_end < _today LOOP
    UPDATE public.partners SET status='inactive', status_reason='Suspension period over', status_changed_at=now(), status_changed_by=NULL WHERE id=r.id;
    PERFORM public.partner_log_action(r.id,'suspension_over','suspended','inactive','Suspension period over', NULL, '{}');
  END LOOP;
  FOR r IN SELECT p.*, pl.rules FROM public.partners p LEFT JOIN public.partner_commission_plans pl ON pl.id=p.plan_id
     WHERE p.status IN ('active','warning') LOOP
    _d := COALESCE((r.rules->>'no_activity_days_to_inactive')::int,30);
    IF COALESCE(r.last_activity_at, r.agreement_start::timestamp AT TIME ZONE 'Asia/Kolkata') < now() - make_interval(days=>_d) THEN
      UPDATE public.partners SET status='inactive', status_reason='No activity '||_d||' days', status_changed_at=now(), status_changed_by=NULL WHERE id=r.id;
      PERFORM public.partner_log_action(r.id,'no_activity',r.status,'inactive','No activity '||_d||' days', NULL, '{}');
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.partner_daily_lifecycle() FROM PUBLIC, anon, authenticated;

-- status-aware payout
CREATE OR REPLACE FUNCTION public.staff_partner_generate_payout(_from date, _to date, _notes text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := public.partner_require_admin(); _batch uuid; _n int; _sk int; _adj int;
  _today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF _from IS NULL OR _to IS NULL OR _from > _to THEN RAISE EXCEPTION 'Choose a valid start and end date'; END IF;
  IF _to > _today THEN RAISE EXCEPTION 'End date cannot be in the future'; END IF;

  CREATE TEMP TABLE _pp_all ON COMMIT DROP AS
  WITH ord AS (
    SELECT 'booking'::text otype, b.id oid, COALESCE(b.service_end_at,b.updated_at) done_at, b.service_label svc,
           CASE WHEN sc.name='Auto Care' THEN 'auto_care' ELSE 'home_cleaning' END line,
           GREATEST(COALESCE(b.price,0)-COALESCE(b.discount_amount,0),0) base, b.assigned_expert_id expert_id, b.zone_id, z.city
      FROM public.bookings b
      JOIN public.service_categories sc ON sc.id=b.service_category_id
      JOIN public.segments sg ON sg.id=sc.segment_id
      LEFT JOIN public.zones z ON z.id=b.zone_id
     WHERE b.status='completed' AND NOT COALESCE(b.is_training,false) AND b.deleted_at IS NULL
       AND COALESCE(b.razorpay_payment_id,'') <> ''
       AND COALESCE(b.refund_status,'') <> 'refunded' AND COALESCE(b.refund_amount,0)=0
       AND (sc.name='Auto Care' OR sg.slug='clean')
       AND (COALESCE(b.service_end_at,b.updated_at) AT TIME ZONE 'Asia/Kolkata')::date BETWEEN _from AND _to
    UNION ALL
    SELECT 'courier', c.id, c.completed_at,
           CASE WHEN c.business_merchant_id IS NOT NULL THEN 'Bulk delivery'
                WHEN c.merchant_order_id IS NOT NULL THEN 'Store delivery' ELSE 'Courier delivery' END,
           CASE WHEN c.business_merchant_id IS NOT NULL THEN 'bulk_delivery' ELSE 'courier' END,
           GREATEST(COALESCE(c.base_amount,0)+COALESCE(c.stops_fee,0)-COALESCE(c.discount_amount,0),0),
           c.assigned_expert_id, c.zone_id, COALESCE(zc.city, c.city)
      FROM public.courier_orders c LEFT JOIN public.zones zc ON zc.id=c.zone_id
     WHERE upper(c.status)='COMPLETED' AND c.payment_status='paid' AND c.completed_at IS NOT NULL
       AND COALESCE(c.refund_status,'') <> 'refunded' AND COALESCE(c.refund_amount,0)=0
       AND (c.completed_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN _from AND _to
    UNION ALL
    SELECT 'store', mo.id, COALESCE(mo.delivered_at, mo.paid_at), 'Store order', 'store_orders',
           GREATEST(COALESCE(mo.items_total,0),0), NULL::uuid, m.zone_id, m.city
      FROM public.merchant_orders mo JOIN public.merchants m ON m.id=mo.merchant_id
     WHERE lower(mo.status) IN ('delivered','completed') AND lower(COALESCE(mo.payment_status,''))='paid'
       AND NOT COALESCE(mo.is_training,false)
       AND COALESCE(mo.refund_status,'') <> 'refunded' AND COALESCE(mo.refund_amount,0)=0
       AND COALESCE(mo.delivered_at, mo.paid_at) IS NOT NULL
       AND (COALESCE(mo.delivered_at, mo.paid_at) AT TIME ZONE 'Asia/Kolkata')::date BETWEEN _from AND _to
  ), m AS (
    SELECT o.*, p.id partner_id, 'growth'::text program,
           CASE WHEN p.program='growth' THEN p.plan_id ELSE p.growth_plan_id END mplan
      FROM ord o JOIN public.experts e ON e.id=o.expert_id
      JOIN public.partners p ON p.id=e.onboarded_by_partner_id
        AND (p.program='growth' OR (p.program IN ('zone_franchise','city_master') AND p.growth_plan_id IS NOT NULL))
      CROSS JOIN LATERAL public.partner_growth_window(o.expert_id) w
     WHERE o.done_at >= w.win_start AND o.done_at < w.win_end
    UNION ALL
    SELECT o.*, p.id, 'zone_franchise', p.plan_id FROM ord o JOIN public.partners p ON p.program='zone_franchise' AND o.zone_id IS NOT NULL AND p.zone_id=o.zone_id
    UNION ALL
    SELECT o.*, p.id, 'city_master', p.plan_id FROM ord o JOIN public.partners p ON p.program='city_master' AND lower(p.city)=lower(o.city)
  )
  SELECT m.*, pl.id plan_id, pl.name plan_name, ln.pct,
         public.partner_status_at(m.partner_id, m.done_at) st,
         p.commission_hold, p.pan_number, p.bank_verified
    FROM m JOIN public.partners p ON p.id=m.partner_id
    JOIN public.partner_commission_plans pl ON pl.id=m.mplan
    JOIN public.partner_plan_lines ln ON ln.plan_id=pl.id AND ln.line_key=m.line AND ln.enabled
   WHERE (m.done_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p.agreement_start AND p.agreement_end
     AND m.base > 0 AND ln.pct > 0
     AND public.partner_program_on_at(m.program, m.done_at)
     AND NOT EXISTS (SELECT 1 FROM public.partner_payout_lines l WHERE NOT l.is_deleted
                     AND l.partner_id=m.partner_id AND l.program=m.program AND l.order_type=m.otype AND l.order_id=m.oid);

  -- payable = active/warning at completion, KYC ok, not on hold
  CREATE TEMP TABLE _pp_lines ON COMMIT DROP AS
    SELECT * FROM _pp_all WHERE st IN ('active','warning') AND COALESCE(commission_hold,'') <> 'on_hold'
      AND COALESCE(btrim(pan_number),'') <> '' AND COALESCE(bank_verified,false);

  -- refunded/cancelled after being paid -> negative adjustment
  CREATE TEMP TABLE _pp_adj ON COMMIT DROP AS
    SELECT l.* FROM public.partner_payout_lines l JOIN public.partner_payout_batches b ON b.id=l.batch_id
     WHERE NOT l.is_deleted AND b.deleted_at IS NULL AND b.status='paid' AND l.amount > 0 AND l.order_type IN ('booking','courier','store')
       AND ((l.order_type='booking' AND EXISTS (SELECT 1 FROM public.bookings x WHERE x.id=l.order_id AND (x.status<>'completed' OR COALESCE(x.refund_amount,0)>0 OR x.refund_status='refunded')))
         OR (l.order_type='courier' AND EXISTS (SELECT 1 FROM public.courier_orders x WHERE x.id=l.order_id AND (upper(x.status)<>'COMPLETED' OR COALESCE(x.refund_amount,0)>0 OR x.refund_status='refunded')))
         OR (l.order_type='store' AND EXISTS (SELECT 1 FROM public.merchant_orders x WHERE x.id=l.order_id AND (lower(x.status) NOT IN ('delivered','completed') OR COALESCE(x.refund_amount,0)>0 OR x.refund_status='refunded'))))
       AND NOT EXISTS (SELECT 1 FROM public.partner_payout_lines a WHERE NOT a.is_deleted AND a.partner_id=l.partner_id AND a.program=l.program
                       AND a.order_type=l.order_type||'_adj' AND a.order_id=l.order_id);

  SELECT count(*) INTO _n FROM _pp_lines; SELECT count(*) INTO _adj FROM _pp_adj; SELECT count(*) INTO _sk FROM _pp_all WHERE NOT (oid IN (SELECT oid FROM _pp_lines));
  IF _n = 0 AND _adj = 0 AND _sk = 0 THEN RAISE EXCEPTION 'No eligible partner commission in these dates'; END IF;

  INSERT INTO public.partner_payout_batches(period_start, period_end, notes, created_by)
  VALUES (_from, _to, NULLIF(btrim(COALESCE(_notes,'')),''), _uid) RETURNING id INTO _batch;
  INSERT INTO public.partner_payout_items(batch_id, partner_id)
    SELECT DISTINCT _batch, partner_id FROM (SELECT partner_id FROM _pp_lines UNION SELECT partner_id FROM _pp_adj) s;
  INSERT INTO public.partner_payout_lines(batch_id, item_id, partner_id, program, order_type, order_id, order_completed_at,
      service_name, expert_id, base_amount, commission_pct, calculated_amount, amount, plan_id, plan_name, business_line)
  SELECT _batch, i.id, l.partner_id, l.program, l.otype, l.oid, l.done_at, l.svc, l.expert_id, l.base, l.pct,
         round(l.base*l.pct/100.0,2), round(l.base*l.pct/100.0,2), l.plan_id, l.plan_name, l.line
    FROM _pp_lines l JOIN public.partner_payout_items i ON i.batch_id=_batch AND i.partner_id=l.partner_id;
  INSERT INTO public.partner_payout_lines(batch_id, item_id, partner_id, program, order_type, order_id, order_completed_at,
      service_name, expert_id, base_amount, commission_pct, calculated_amount, amount, plan_id, plan_name, business_line, edit_reason)
  SELECT _batch, i.id, a.partner_id, a.program, a.order_type||'_adj', a.order_id, a.order_completed_at,
         'Adjustment: '||COALESCE(a.service_name,''), a.expert_id, -a.base_amount, a.commission_pct, -a.amount, -a.amount, a.plan_id, a.plan_name, a.business_line,
         'Order cancelled/refunded after payout'
    FROM _pp_adj a JOIN public.partner_payout_items i ON i.batch_id=_batch AND i.partner_id=a.partner_id;
  INSERT INTO public.partner_payout_skips(batch_id, partner_id, order_type, order_id, order_completed_at, amount, reason)
  SELECT _batch, s.partner_id, s.otype, s.oid, s.done_at, round(s.base*s.pct/100.0,2),
         CASE WHEN s.st NOT IN ('active','warning') THEN initcap(s.st)
              WHEN COALESCE(s.commission_hold,'')='on_hold' THEN 'On hold'
              ELSE 'Blocked: KYC' END
    FROM _pp_all s WHERE NOT EXISTS (SELECT 1 FROM _pp_lines l WHERE l.oid=s.oid AND l.partner_id=s.partner_id AND l.program=s.program);
  PERFORM public.partner_recalc_batch(_batch);
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid,'partner_payout_generate','partner_payout_batches',_batch,NULL, jsonb_build_object('from',_from,'to',_to,'lines',_n,'adjustments',_adj,'skipped',_sk));
  RETURN _batch;
END $$;
