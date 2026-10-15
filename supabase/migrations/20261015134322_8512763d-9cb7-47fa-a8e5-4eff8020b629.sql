-- 1. commission_pct: NULL means "not set"
ALTER TABLE public.merchants ALTER COLUMN commission_pct DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.merchants_default_commission()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _d numeric := least(greatest(public.store_setting('store_default_commission_pct', 10), 0), 50);
begin
  -- commission_pct stays NULL when not set; bill/settlement use COALESCE(commission_pct, default)
  if NEW.status = 'approved' and (TG_OP = 'INSERT' or coalesce(OLD.status,'') <> 'approved')
     and coalesce(NEW.commission_value,0) = 0 then
    NEW.commission_type  := 'PERCENTAGE';
    NEW.commission_value := coalesce(NEW.commission_pct, _d);
  end if;
  return NEW;
end $function$;

CREATE OR REPLACE FUNCTION public.merchant_effective_commission_pct(_merchant_id uuid)
 RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ select least(greatest(coalesce(m.commission_pct, public.store_setting('store_default_commission_pct', 10)),0),50)
      from public.merchants m where m.id = _merchant_id $$;
REVOKE EXECUTE ON FUNCTION public.merchant_effective_commission_pct(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.merchant_effective_commission_pct(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.store_commission_snapshot(_merchant_id uuid, _items_total numeric)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _pct numeric; _gst_pct numeric; _amt numeric; _gst numeric;
begin
  _pct := coalesce(public.merchant_effective_commission_pct(_merchant_id), 0);
  _gst_pct := public.tax_rate('commission_gst');
  _amt := round(coalesce(_items_total,0) * _pct / 100.0, 2);
  _gst := round(_amt * _gst_pct / 100.0, 2);
  return jsonb_build_object('commission_pct', _pct, 'commission_amount', _amt,
    'commission_gst_pct', _gst_pct, 'commission_gst_amount', _gst,
    'merchant_net', greatest(round(coalesce(_items_total,0) - _amt - _gst, 2), 0));
end $function$;

-- order_bill_core: flat mode uses COALESCE(merchant commission_pct, default)
DO $do$
DECLARE _def text;
BEGIN
  SELECT pg_get_functiondef('public.order_bill_core(uuid,jsonb,numeric,numeric)'::regprocedure) INTO _def;
  _def := replace(_def,
    $a$if coalesce(_m.commission_mode,'flat') = 'split' or _m.commission_pct is null then$a$,
    $a$if coalesce(_m.commission_mode,'flat') = 'split' then$a$);
  _def := replace(_def,
    $a$_comm_pct := _m.commission_pct; _comm_amt := round(_it_total * _comm_pct / 100, 2);$a$,
    $a$_comm_pct := public.merchant_effective_commission_pct(_merchant_id); _comm_amt := round(_it_total * _comm_pct / 100, 2);$a$);
  IF position('merchant_effective_commission_pct' in _def) = 0 THEN RAISE EXCEPTION 'order_bill_core patch failed'; END IF;
  EXECUTE _def;
END $do$;

-- 2. Finance: ops_manager can read settlements
DROP POLICY IF EXISTS ms_read ON public.merchant_settlements;
CREATE POLICY ms_read ON public.merchant_settlements FOR SELECT TO authenticated
USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager'])
  OR EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = merchant_settlements.store_id AND m.auth_user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.staff_approve_settlement(_settlement_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  UPDATE public.merchant_settlements SET status='approved', updated_at=now() WHERE id=_settlement_id AND status='draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'not_draft'; END IF;
  INSERT INTO public.audit_logs(actor_id,action,target_table,target_id,after_state)
  VALUES (auth.uid(),'settlement_approved','merchant_settlements',_settlement_id,'{}'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.staff_retry_store_refund(_order_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  UPDATE public.merchant_orders SET refund_status='refund_pending', payment_status='refund_pending',
         refund_attempts=0, refund_next_attempt_at=now(), updated_at=now()
   WHERE id=_order_id AND refund_status='failed';
  IF NOT FOUND THEN RAISE EXCEPTION 'not_failed'; END IF;
  INSERT INTO public.audit_logs(actor_id,action,target_table,target_id,after_state)
  VALUES (auth.uid(),'store_refund_retry','merchant_orders',_order_id,'{}'::jsonb);
  PERFORM public.store_dispatch_refund_job();
END $$;

-- 3. Company profile (ops_settings keys)
INSERT INTO public.ops_settings(key,value,label) VALUES
 ('company_legal_name','', 'Company legal name'),
 ('company_gstin','', 'Company GSTIN'),
 ('company_pan','', 'Company PAN'),
 ('company_address','', 'Company address'),
 ('company_state','Maharashtra', 'Company state')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.staff_save_company_profile(_p jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _before jsonb; _k text;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT jsonb_object_agg(key,value) INTO _before FROM public.ops_settings WHERE key LIKE 'company\_%';
  FOREACH _k IN ARRAY ARRAY['legal_name','gstin','pan','address','state'] LOOP
    IF _p ? _k THEN
      UPDATE public.ops_settings SET value=btrim(coalesce(_p->>_k,'')), updated_at=now() WHERE key='company_'||_k;
    END IF;
  END LOOP;
  INSERT INTO public.audit_logs(actor_id,action,target_table,before_state,after_state)
  VALUES (auth.uid(),'company_profile_updated','ops_settings',_before,_p);
END $$;

CREATE OR REPLACE FUNCTION public.staff_set_merchant_tax_ids(_merchant_id uuid, _gstin text, _pan text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _b jsonb;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT jsonb_build_object('gstin',gstin,'pan',pan) INTO _b FROM public.merchants WHERE id=_merchant_id;
  UPDATE public.merchants SET gstin=nullif(upper(btrim(_gstin)),''), pan=nullif(upper(btrim(_pan)),'') WHERE id=_merchant_id;
  INSERT INTO public.audit_logs(actor_id,action,target_table,target_id,before_state,after_state)
  VALUES (auth.uid(),'merchant_tax_ids_updated','merchants',_merchant_id,_b,jsonb_build_object('gstin',_gstin,'pan',_pan));
END $$;

-- Invoice data: staff or the merchant owner (reusable by Merchant App)
CREATE OR REPLACE FUNCTION public.get_settlement_invoice(_settlement_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _s public.merchant_settlements%rowtype; _m record; _co jsonb; _gst_rate numeric; _intra boolean;
BEGIN
  SELECT * INTO _s FROM public.merchant_settlements WHERE id=_settlement_id;
  IF _s.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT id, store_name, gstin, pan, state, address, auth_user_id, service_type INTO _m FROM public.merchants WHERE id=_s.store_id;
  IF NOT (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) OR _m.auth_user_id = auth.uid()) THEN
    RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT jsonb_object_agg(replace(key,'company_',''),value) INTO _co FROM public.ops_settings WHERE key LIKE 'company\_%';
  _gst_rate := CASE WHEN _s.commission_total > 0 THEN round(_s.commission_gst_total*100/_s.commission_total,2) ELSE public.tax_rate('commission_gst') END;
  _intra := lower(coalesce(_m.state,'')) = lower(coalesce(_co->>'state',''));
  RETURN jsonb_build_object(
    'invoice_no', _s.invoice_no, 'invoice_fy', _s.invoice_fy, 'date', coalesce(_s.run_date, _s.created_at::date),
    'period_from', _s.period_from, 'period_to', _s.period_to, 'type', _s.type, 'status', _s.status,
    'company', _co,
    'merchant', jsonb_build_object('name',_m.store_name,'gstin',_m.gstin,'pan',_m.pan,'state',_m.state,'address',_m.address,'service',_m.service_type),
    'gross', _s.gross_amount, 'commission', _s.commission_total, 'gst_rate', _gst_rate,
    'intra_state', _intra,
    'cgst', CASE WHEN _intra THEN round(_s.commission_gst_total/2,2) ELSE 0 END,
    'sgst', CASE WHEN _intra THEN _s.commission_gst_total - round(_s.commission_gst_total/2,2) ELSE 0 END,
    'igst', CASE WHEN _intra THEN 0 ELSE _s.commission_gst_total END,
    'commission_gst', _s.commission_gst_total,
    'tcs', _s.tcs_total, 'tds', _s.tds_total, 'adjustments', _s.adjustment_total,
    'instant_fee', _s.instant_fee, 'net', _s.net_amount);
END $$;

-- Dashboard overview
CREATE OR REPLACE FUNCTION public.staff_dashboard_overview(_from date, _to date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _f timestamptz := (_from::timestamp AT TIME ZONE 'Asia/Kolkata');
        _t timestamptz := ((_to+1)::timestamp AT TIME ZONE 'Asia/Kolkata');
        _riders jsonb; _svc jsonb := '{}'::jsonb; _g text; _r record; _util numeric; _daily jsonb; _alerts jsonb;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  _riders := public.rider_pool_stats();

  FOREACH _g IN ARRAY ARRAY['clean','wash'] LOOP
    SELECT count(*) FILTER (WHERE status='completed') completed,
           count(*) FILTER (WHERE status NOT IN ('completed','cancelled','rejected','expired')) active,
           count(*) FILTER (WHERE status IN ('cancelled','rejected')) cancelled,
           coalesce(sum(total_amount) FILTER (WHERE status='completed'),0) gmv,
           coalesce(sum(coalesce(total_amount,0)-coalesce(gst_amount,0)-coalesce(snapshot_expert_payout,0)-coalesce(snapshot_partner_payout,0)) FILTER (WHERE status='completed'),0) earn
      INTO _r FROM public.bookings b
     WHERE coalesce(b.is_training,false)=false AND b.scheduled_date BETWEEN _from AND _to
       AND public.booking_capacity_group(b.service_category_id, b.service_label) = _g;
    SELECT round(avg(LEAST(1, x.n::numeric / NULLIF(public.slot_capacity_for(_g, x.d),0)))*100,0) INTO _util
      FROM (SELECT scheduled_date d, scheduled_time_slot s, count(*) n FROM public.bookings b
             WHERE coalesce(b.is_training,false)=false AND b.scheduled_date BETWEEN _from AND _to
               AND b.status NOT IN ('cancelled','rejected','expired')
               AND public.booking_capacity_group(b.service_category_id, b.service_label) = _g
             GROUP BY 1,2) x;
    _svc := _svc || jsonb_build_object(CASE WHEN _g='clean' THEN 'maid' ELSE 'wash' END, jsonb_build_object(
      'completed',_r.completed,'active',_r.active,'cancelled',_r.cancelled,'gmv',_r.gmv,'earning',round(_r.earn,2),'utilisation',_util,
      'notify',(SELECT jsonb_build_object('tried',count(*),'notified',count(notified_at),'converted',count(converted_order_id))
                  FROM public.notify_requests WHERE service_type=_g AND created_at>=_f AND created_at<_t)));
  END LOOP;

  FOREACH _g IN ARRAY ARRAY['store','food'] LOOP
    SELECT count(*) FILTER (WHERE o.status IN ('delivered','completed')) completed,
           count(*) FILTER (WHERE o.status NOT IN ('delivered','completed','cancelled','rejected')) active,
           count(*) FILTER (WHERE o.status IN ('cancelled','rejected')) cancelled,
           coalesce(sum(coalesce(o.total_payable,o.total_amount)) FILTER (WHERE o.status IN ('delivered','completed')),0) gmv,
           coalesce(sum(coalesce(o.commission_amount,0)+greatest(coalesce(o.delivery_fee,0)-coalesce(o.rider_share_amount,0),0)+coalesce(o.platform_fee,0))
             FILTER (WHERE o.status IN ('delivered','completed')),0) earn
      INTO _r FROM public.merchant_orders o JOIN public.merchants m ON m.id=o.merchant_id
     WHERE (CASE WHEN m.service_type='food' THEN 'food' ELSE 'store' END)=_g
       AND o.created_at>=_f AND o.created_at<_t
       AND (coalesce(o.payment_mode,'')<>'online' OR o.payment_status<>'pending');
    _svc := _svc || jsonb_build_object(_g, jsonb_build_object(
      'completed',_r.completed,'active',_r.active,'cancelled',_r.cancelled,'gmv',_r.gmv,'earning',round(_r.earn,2),
      'utilisation', CASE WHEN coalesce((_riders->>'online')::int,0)>0 THEN round((_riders->>'busy')::numeric*100/(_riders->>'online')::numeric,0) END,
      'notify',(SELECT jsonb_build_object('tried',count(*),'notified',count(notified_at),'converted',count(converted_order_id))
                  FROM public.notify_requests WHERE service_type=_g AND created_at>=_f AND created_at<_t)));
  END LOOP;

  SELECT count(*) FILTER (WHERE status IN ('DELIVERED','COMPLETED')) completed,
         count(*) FILTER (WHERE status NOT IN ('DELIVERED','COMPLETED','CANCELLED','FAILED','EXPIRED')) active,
         count(*) FILTER (WHERE status IN ('CANCELLED','FAILED','EXPIRED')) cancelled,
         coalesce(sum(total_amount) FILTER (WHERE status IN ('DELIVERED','COMPLETED')),0) gmv,
         coalesce(sum((coalesce(base_amount,0)+coalesce(extra_fee,0)+coalesce(stops_fee,0))*coalesce(commission_pct,0)/100+coalesce(platform_fee,0))
           FILTER (WHERE status IN ('DELIVERED','COMPLETED')),0) earn
    INTO _r FROM public.courier_orders WHERE merchant_order_id IS NULL AND created_at>=_f AND created_at<_t;
  _svc := _svc || jsonb_build_object('parcel', jsonb_build_object(
    'completed',_r.completed,'active',_r.active,'cancelled',_r.cancelled,'gmv',_r.gmv,'earning',round(_r.earn,2),
    'utilisation', CASE WHEN coalesce((_riders->>'online')::int,0)>0 THEN round((_riders->>'busy')::numeric*100/(_riders->>'online')::numeric,0) END,
    'notify',(SELECT jsonb_build_object('tried',count(*),'notified',count(notified_at),'converted',count(converted_order_id))
                FROM public.notify_requests WHERE service_type='parcel' AND created_at>=_f AND created_at<_t)));

  SELECT coalesce(jsonb_agg(row_to_json(d) ORDER BY d.day),'[]'::jsonb) INTO _daily FROM (
    SELECT g.day::date AS day,
      (SELECT count(*) FROM public.bookings b WHERE coalesce(b.is_training,false)=false AND b.scheduled_date=g.day::date AND public.booking_capacity_group(b.service_category_id,b.service_label)='clean') maid,
      (SELECT count(*) FROM public.bookings b WHERE coalesce(b.is_training,false)=false AND b.scheduled_date=g.day::date AND public.booking_capacity_group(b.service_category_id,b.service_label)='wash') wash,
      (SELECT count(*) FROM public.merchant_orders o JOIN public.merchants m ON m.id=o.merchant_id WHERE m.service_type<>'food' AND (o.created_at AT TIME ZONE 'Asia/Kolkata')::date=g.day::date AND (coalesce(o.payment_mode,'')<>'online' OR o.payment_status<>'pending')) store,
      (SELECT count(*) FROM public.merchant_orders o JOIN public.merchants m ON m.id=o.merchant_id WHERE m.service_type='food' AND (o.created_at AT TIME ZONE 'Asia/Kolkata')::date=g.day::date AND (coalesce(o.payment_mode,'')<>'online' OR o.payment_status<>'pending')) food,
      (SELECT count(*) FROM public.courier_orders c WHERE c.merchant_order_id IS NULL AND (c.created_at AT TIME ZONE 'Asia/Kolkata')::date=g.day::date) parcel
    FROM generate_series(_from::timestamp, _to::timestamp, interval '1 day') g(day)) d;

  _alerts := jsonb_build_object(
    'pending_products_store', (SELECT count(*) FROM public.products p JOIN public.merchants m ON m.id=p.merchant_id WHERE p.approval_status='pending' AND m.service_type<>'food'),
    'pending_products_food', (SELECT count(*) FROM public.products p JOIN public.merchants m ON m.id=p.merchant_id WHERE p.approval_status='pending' AND m.service_type='food'),
    'instant_to_pay', (SELECT count(*) FROM public.merchant_settlements WHERE type='instant' AND status='approved'),
    'refunds_failed', (SELECT count(*) FROM public.merchant_orders WHERE refund_status='failed'),
    'carry_forward_merchants', (SELECT count(DISTINCT store_id) FROM public.merchant_settlements WHERE status='carry_forward'),
    'all_riders_busy', coalesce((_riders->>'online')::int,0) > 0 AND coalesce((_riders->>'free')::int,0) = 0,
    'riders', _riders);
  RETURN jsonb_build_object('services',_svc,'daily',_daily,'alerts',_alerts);
END $$;

-- Tax report (monthly)
CREATE OR REPLACE FUNCTION public.staff_tax_report(_month date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _f timestamptz := (date_trunc('month',_month)::timestamp AT TIME ZONE 'Asia/Kolkata');
        _t timestamptz := ((date_trunc('month',_month)+interval '1 month')::timestamp AT TIME ZONE 'Asia/Kolkata');
        _sum jsonb; _merch jsonb;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  WITH o AS (
    SELECT o.*, m.store_name, m.gstin m_gstin, m.pan m_pan, m.service_type svc,
      coalesce((o.tax_rates_snapshot->>'order_delivery_gst')::numeric,(o.tax_rates_snapshot->>'delivery_gst')::numeric) del_rate
    FROM public.merchant_orders o JOIN public.merchants m ON m.id=o.merchant_id
    WHERE o.status IN ('delivered','completed') AND coalesce(o.delivered_at,o.created_at)>=_f AND coalesce(o.delivered_at,o.created_at)<_t
      AND coalesce(o.refund_status,'none') <> 'done')
  SELECT jsonb_build_object(
    'orders', count(*),
    'food_gst_9_5', coalesce(sum(gst_items) FILTER (WHERE svc='food'),0),
    'store_delivery_gst', coalesce(sum(gst_delivery) FILTER (WHERE svc<>'food'),0),
    'food_delivery_gst', coalesce(sum(gst_delivery) FILTER (WHERE svc='food'),0),
    'commission_gst', coalesce(sum(coalesce(commission_gst,commission_gst_amount,0)),0),
    'platform_fee_gst', coalesce(sum(gst_platform),0),
    'tcs', coalesce(sum(tcs_amount),0), 'tds', coalesce(sum(tds_amount),0),
    'delivery_gst_rates', coalesce(jsonb_agg(DISTINCT del_rate) FILTER (WHERE del_rate IS NOT NULL),'[]'::jsonb)) INTO _sum FROM o;
  _sum := _sum || jsonb_build_object('parcel_delivery_gst',
    (SELECT coalesce(sum(gst_amount),0) FROM public.courier_orders WHERE merchant_order_id IS NULL AND status IN ('DELIVERED','COMPLETED') AND created_at>=_f AND created_at<_t));
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'name'),'[]'::jsonb) INTO _merch FROM (
    SELECT jsonb_build_object('merchant_id',m.id,'name',m.store_name,'service',m.service_type,'gstin',m.gstin,'pan',m.pan,
      'orders',count(*),'taxable_value',sum(coalesce(o.item_total,o.items_total,0)),'tcs',sum(o.tcs_amount),'tds',sum(o.tds_amount),
      'commission',sum(o.commission_amount),'commission_gst',sum(coalesce(o.commission_gst,0))) x
    FROM public.merchant_orders o JOIN public.merchants m ON m.id=o.merchant_id
    WHERE o.status IN ('delivered','completed') AND coalesce(o.delivered_at,o.created_at)>=_f AND coalesce(o.delivered_at,o.created_at)<_t
      AND coalesce(o.refund_status,'none') <> 'done'
    GROUP BY m.id) s;
  RETURN jsonb_build_object('summary',_sum,'merchants',_merch);
END $$;

DO $g$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['staff_approve_settlement(uuid)','staff_retry_store_refund(uuid)','staff_save_company_profile(jsonb)',
    'staff_set_merchant_tax_ids(uuid,text,text)','get_settlement_invoice(uuid)','staff_dashboard_overview(date,date)','staff_tax_report(date)'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM public, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP; END $g$;