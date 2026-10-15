
-- A1: Store delivery keeps old customer total (old courier fare = pre-GST + get_gst_percent on top). Split the same total into base + delivery GST.
DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.order_bill_core'::regproc);
  d := replace(d,
    $x$_fee := round((_fare->>'base_amount')::numeric + coalesce((_fare->>'extra_fee')::numeric,0) + coalesce((_fare->>'platform_fee')::numeric,0), 2);$x$,
    $x$_fee := round((_fare->>'delivery_fee')::numeric / (1 + public.tax_rate('delivery_gst')/100.0), 2);$x$);
  IF position('delivery_fee'')::numeric / (1 + public.tax_rate' in d) = 0 THEN RAISE EXCEPTION 'order_bill_core patch failed'; END IF;
  EXECUTE d;
END $mig$;

-- A2: food flag
INSERT INTO public.service_flags (service_key, city, is_active, label, sort_order, status)
SELECT 'food','Latur',true,'badiyos Food',4,'coming_soon'
WHERE NOT EXISTS (SELECT 1 FROM public.service_flags WHERE service_key='food');

-- Schema additions
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS pending_changes jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS pending_submitted_at timestamptz;
ALTER TABLE public.merchant_settlements ADD COLUMN IF NOT EXISTS invoice_no text;
ALTER TABLE public.merchant_settlements ADD COLUMN IF NOT EXISTS invoice_fy text;
ALTER TABLE public.merchant_settlements ADD COLUMN IF NOT EXISTS adjustment_total numeric NOT NULL DEFAULT 0;
ALTER TABLE public.merchant_settlements ADD COLUMN IF NOT EXISTS run_date date;
CREATE UNIQUE INDEX IF NOT EXISTS merchant_settlements_invoice_no_uq ON public.merchant_settlements(invoice_no) WHERE invoice_no IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.merchant_invoice_counters (fy text PRIMARY KEY, last_no int NOT NULL DEFAULT 0);
GRANT ALL ON public.merchant_invoice_counters TO service_role;
ALTER TABLE public.merchant_invoice_counters ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.merchant_settlement_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.merchants(id),
  order_id uuid NOT NULL UNIQUE REFERENCES public.merchant_orders(id),
  amount numeric NOT NULL,
  reason text NOT NULL DEFAULT 'refund_after_settlement',
  settlement_id uuid REFERENCES public.merchant_settlements(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.merchant_settlement_adjustments TO authenticated;
GRANT ALL ON public.merchant_settlement_adjustments TO service_role;
ALTER TABLE public.merchant_settlement_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "msa_read" ON public.merchant_settlement_adjustments FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager'])
         OR EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = store_id AND m.auth_user_id = auth.uid()));

-- Access helper: returns 'cc' | 'owner' | 'staff' | null
CREATE OR REPLACE FUNCTION public.merchant_access(_store_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN NULL
    WHEN EXISTS (SELECT 1 FROM public.merchants WHERE id=_store_id AND auth_user_id=auth.uid()) THEN 'owner'
    WHEN EXISTS (SELECT 1 FROM public.merchant_staff WHERE merchant_id=_store_id AND auth_user_id=auth.uid() AND status='active') THEN 'staff'
    WHEN public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN 'cc'
    ELSE NULL END
$$;

CREATE OR REPLACE FUNCTION public.merchant_require(_store_id uuid, _allow text[])
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE a text := public.merchant_access(_store_id);
BEGIN
  IF a IS NULL OR NOT a = ANY(_allow) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN a;
END $$;

-- B: product write (core)
CREATE OR REPLACE FUNCTION public.product_upsert_core(_store_id uuid, _product_id uuid, _payload jsonb, _who text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _svc text; _cat uuid; _pid uuid; _p record; _v jsonb; _a jsonb; _i int;
BEGIN
  SELECT coalesce(service_type,'store') INTO _svc FROM public.merchants WHERE id=_store_id;
  IF _svc IS NULL THEN RAISE EXCEPTION 'store_not_found'; END IF;
  IF coalesce(trim(_payload->>'name'),'') = '' THEN RAISE EXCEPTION 'name_required'; END IF;
  IF (_payload->>'price') IS NULL OR (_payload->>'price')::numeric < 0 THEN RAISE EXCEPTION 'invalid_price'; END IF;
  _cat := nullif(_payload->>'category_id','')::uuid;
  IF _cat IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.catalog_categories WHERE id=_cat AND service_type=_svc AND is_active) THEN
    RAISE EXCEPTION 'invalid_category'; END IF;

  IF _product_id IS NOT NULL THEN
    SELECT * INTO _p FROM public.products WHERE id=_product_id AND merchant_id=_store_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'product_not_found'; END IF;
  END IF;

  -- Merchant edit of an existing live product: park changes, keep live version
  IF _who IN ('owner','staff') AND _product_id IS NOT NULL AND _p.approval_status='approved' THEN
    UPDATE public.products SET pending_changes=_payload, pending_submitted_at=now() WHERE id=_product_id;
    RETURN jsonb_build_object('ok',true,'product_id',_product_id,'status','pending_review');
  END IF;

  IF _product_id IS NULL THEN
    INSERT INTO public.products (merchant_id, name, price, is_active, approval_status)
    VALUES (_store_id, _payload->>'name', (_payload->>'price')::numeric, true,
            CASE WHEN _who='cc' THEN 'approved' ELSE 'pending' END)
    RETURNING id INTO _pid;
  ELSE _pid := _product_id; END IF;

  UPDATE public.products SET
    name=_payload->>'name', description=_payload->>'description', image_path=_payload->>'image_path',
    category_id=_cat, price=(_payload->>'price')::numeric,
    approval_status=CASE WHEN _who='cc' THEN 'approved' ELSE 'pending' END,
    approval_reviewed_at=CASE WHEN _who='cc' THEN now() ELSE approval_reviewed_at END,
    approval_reviewed_by=CASE WHEN _who='cc' THEN auth.uid() ELSE approval_reviewed_by END,
    pending_changes=NULL, pending_submitted_at=NULL
  WHERE id=_pid;

  IF _payload ? 'variants' THEN
    DELETE FROM public.product_variants WHERE product_id=_pid;
    _i := 0;
    FOR _v IN SELECT * FROM jsonb_array_elements(coalesce(_payload->'variants','[]')) LOOP
      INSERT INTO public.product_variants(product_id,name,price,sort_order,is_default)
      VALUES (_pid, _v->>'name', (_v->>'price')::numeric, _i, coalesce((_v->>'is_default')::boolean,false));
      _i := _i+1;
    END LOOP;
  END IF;
  IF _payload ? 'addons' THEN
    DELETE FROM public.product_addons WHERE product_id=_pid;
    _i := 0;
    FOR _a IN SELECT * FROM jsonb_array_elements(coalesce(_payload->'addons','[]')) LOOP
      INSERT INTO public.product_addons(product_id,name,price,sort_order,is_active)
      VALUES (_pid, _a->>'name', (_a->>'price')::numeric, _i, coalesce((_a->>'is_active')::boolean,true));
      _i := _i+1;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('ok',true,'product_id',_pid,'status',CASE WHEN _who='cc' THEN 'approved' ELSE 'pending' END);
END $$;

CREATE OR REPLACE FUNCTION public.upsert_product(_store_id uuid, _payload jsonb, _product_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w text := public.merchant_require(_store_id, ARRAY['owner','staff']);
BEGIN RETURN public.product_upsert_core(_store_id, _product_id, _payload, w); END $$;

CREATE OR REPLACE FUNCTION public.staff_upsert_product(_store_id uuid, _payload jsonb, _product_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN public.product_upsert_core(_store_id, _product_id, _payload, 'cc');
END $$;

CREATE OR REPLACE FUNCTION public.staff_review_product_changes(_product_id uuid, _approve boolean, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _p record;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO _p FROM public.products WHERE id=_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'product_not_found'; END IF;
  IF _p.pending_changes IS NOT NULL THEN
    IF _approve THEN PERFORM public.product_upsert_core(_p.merchant_id, _p.id, _p.pending_changes, 'cc');
    ELSE UPDATE public.products SET pending_changes=NULL, pending_submitted_at=NULL, approval_note=_note WHERE id=_p.id; END IF;
  ELSE
    UPDATE public.products SET approval_status=CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
      approval_note=_note, approval_reviewed_at=now(), approval_reviewed_by=auth.uid() WHERE id=_p.id;
  END IF;
  INSERT INTO public.audit_logs(actor_id,action,target_table,target_id,after_state)
  VALUES (auth.uid(), CASE WHEN _approve THEN 'product_approved' ELSE 'product_rejected' END,'products',_p.id, jsonb_build_object('note',_note));
  RETURN jsonb_build_object('ok',true);
END $$;

-- availability / recommended / ordering / open / offer text (core takes store id + already-verified caller)
CREATE OR REPLACE FUNCTION public.set_product_availability(_product_id uuid, _is_available boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sid uuid;
BEGIN
  SELECT merchant_id INTO _sid FROM public.products WHERE id=_product_id;
  PERFORM public.merchant_require(_sid, ARRAY['owner','staff','cc']);
  UPDATE public.products SET is_available=_is_available WHERE id=_product_id;
END $$;

CREATE OR REPLACE FUNCTION public.set_recommended_products(_store_id uuid, _product_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i int;
BEGIN
  PERFORM public.merchant_require(_store_id, ARRAY['owner','staff','cc']);
  IF coalesce(array_length(_product_ids,1),0) > 6 THEN RAISE EXCEPTION 'MAX_6_RECOMMENDED'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(_product_ids) x WHERE NOT EXISTS (SELECT 1 FROM public.products WHERE id=x AND merchant_id=_store_id)) THEN
    RAISE EXCEPTION 'product_not_found'; END IF;
  UPDATE public.products SET is_recommended=false, recommended_order=NULL WHERE merchant_id=_store_id AND is_recommended;
  FOR i IN 1..coalesce(array_length(_product_ids,1),0) LOOP
    UPDATE public.products SET is_recommended=true, recommended_order=i WHERE id=_product_ids[i];
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.reorder_store_categories(_store_id uuid, _category_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i int;
BEGIN
  PERFORM public.merchant_require(_store_id, ARRAY['owner','staff','cc']);
  DELETE FROM public.store_category_order WHERE store_id=_store_id;
  FOR i IN 1..coalesce(array_length(_category_ids,1),0) LOOP
    INSERT INTO public.store_category_order(store_id,category_id,sort_order) VALUES (_store_id,_category_ids[i],i);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.reorder_products(_store_id uuid, _category_id uuid, _product_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i int;
BEGIN
  PERFORM public.merchant_require(_store_id, ARRAY['owner','staff','cc']);
  FOR i IN 1..coalesce(array_length(_product_ids,1),0) LOOP
    UPDATE public.products SET sort_order=i WHERE id=_product_ids[i] AND merchant_id=_store_id
      AND category_id IS NOT DISTINCT FROM _category_id;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.set_store_open(_store_id uuid, _is_open boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.merchant_require(_store_id, ARRAY['owner','staff','cc']);
  UPDATE public.merchants SET is_open=_is_open WHERE id=_store_id;
END $$;

CREATE OR REPLACE FUNCTION public.set_offer_text(_store_id uuid, _text text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.merchant_require(_store_id, ARRAY['owner','staff','cc']);
  IF _text IS NOT NULL AND length(_text) > 60 THEN RAISE EXCEPTION 'offer_text_too_long'; END IF;
  UPDATE public.merchants SET offer_text=nullif(trim(_text),'') WHERE id=_store_id;
END $$;

-- C: Settlements
CREATE OR REPLACE FUNCTION public.settlement_next_invoice(_d date)
RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE y int := extract(year FROM (_d - interval '3 months'))::int; fy text; n int;
BEGIN
  fy := y::text || '-' || right((y+1)::text,2);
  INSERT INTO public.merchant_invoice_counters(fy,last_no) VALUES (fy,1)
  ON CONFLICT (fy) DO UPDATE SET last_no = merchant_invoice_counters.last_no + 1
  RETURNING last_no INTO n;
  RETURN ARRAY['BDC/' || fy || '/' || lpad(n::text,5,'0'), fy];
END $$;

CREATE OR REPLACE FUNCTION public.settlement_build(_store_id uuid, _cutoff timestamptz, _type text, _run_date date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sid uuid; _t record; _adj numeric; _fee numeric := 0; _pct numeric; _inv text[]; _net numeric;
BEGIN
  SELECT count(*) c, min(o.delivered_at)::date f, max(o.delivered_at)::date t,
         coalesce(sum(coalesce(o.item_total,o.items_total)),0) g, coalesce(sum(o.commission_amount),0) cm,
         coalesce(sum(o.commission_gst),0) cg, coalesce(sum(o.tcs_amount),0) tc, coalesce(sum(o.tds_amount),0) td,
         coalesce(sum(o.merchant_net),0) n
    INTO _t
    FROM public.merchant_orders o
   WHERE o.merchant_id=_store_id AND o.status='delivered' AND o.delivered_at < _cutoff
     AND o.payment_status='paid' AND coalesce(o.refund_status,'') NOT IN ('refunded','pending','processing','initiated')
     AND NOT EXISTS (SELECT 1 FROM public.merchant_settlement_items i WHERE i.order_id=o.id);
  SELECT coalesce(sum(amount),0) INTO _adj FROM public.merchant_settlement_adjustments WHERE store_id=_store_id AND settlement_id IS NULL;
  IF _t.c = 0 AND _adj = 0 THEN RETURN NULL; END IF;
  _net := round(_t.n + _adj, 2);
  IF _type='instant' THEN
    SELECT coalesce(instant_settlement_fee_pct,0) INTO _pct FROM public.merchants WHERE id=_store_id;
    _fee := round(greatest(_net,0) * _pct / 100, 2);
  END IF;
  _inv := public.settlement_next_invoice(coalesce(_run_date, (now() AT TIME ZONE 'Asia/Kolkata')::date));
  INSERT INTO public.merchant_settlements(store_id,type,period_from,period_to,gross_amount,commission_total,commission_gst_total,
     tcs_total,tds_total,instant_fee,net_amount,status,adjustment_total,invoice_no,invoice_fy,run_date)
  VALUES (_store_id,_type,_t.f,_t.t,_t.g,_t.cm,_t.cg,_t.tc,_t.td,_fee,round(_net-_fee,2),
     CASE WHEN _type='instant' THEN 'approved' ELSE 'draft' END,_adj,_inv[1],_inv[2],_run_date)
  RETURNING id INTO _sid;
  INSERT INTO public.merchant_settlement_items(settlement_id,order_id)
  SELECT _sid, o.id FROM public.merchant_orders o
   WHERE o.merchant_id=_store_id AND o.status='delivered' AND o.delivered_at < _cutoff
     AND o.payment_status='paid' AND coalesce(o.refund_status,'') NOT IN ('refunded','pending','processing','initiated')
     AND NOT EXISTS (SELECT 1 FROM public.merchant_settlement_items i WHERE i.order_id=o.id);
  UPDATE public.merchant_settlement_adjustments SET settlement_id=_sid WHERE store_id=_store_id AND settlement_id IS NULL;
  RETURN _sid;
END $$;

CREATE OR REPLACE FUNCTION public.generate_settlement_batch(_run_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _cut timestamptz := (_run_date::timestamp AT TIME ZONE 'Asia/Kolkata'); _m record; _s uuid; _n int := 0;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  FOR _m IN SELECT DISTINCT id FROM public.merchants WHERE deleted_at IS NULL LOOP
    PERFORM pg_advisory_xact_lock(hashtext('settle:'||_m.id));
    _s := public.settlement_build(_m.id, _cut, 'normal', _run_date);
    IF _s IS NOT NULL THEN _n := _n+1; END IF;
  END LOOP;
  INSERT INTO public.audit_logs(actor_id,action,target_table,after_state)
  VALUES (auth.uid(),'settlement_batch_generated','merchant_settlements',jsonb_build_object('run_date',_run_date,'created',_n));
  RETURN jsonb_build_object('ok',true,'created',_n);
END $$;

CREATE OR REPLACE FUNCTION public.request_instant_settlement(_store_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _d date := (now() AT TIME ZONE 'Asia/Kolkata')::date; _s uuid;
BEGIN
  PERFORM public.merchant_require(_store_id, ARRAY['owner']);
  PERFORM pg_advisory_xact_lock(hashtext('settle:'||_store_id));
  _s := public.settlement_build(_store_id, (_d::timestamp AT TIME ZONE 'Asia/Kolkata'), 'instant', _d);
  IF _s IS NULL THEN RETURN jsonb_build_object('ok',false,'error','NOTHING_TO_SETTLE'); END IF;
  RETURN (SELECT jsonb_build_object('ok',true,'settlement_id',id,'net_amount',net_amount,'instant_fee',instant_fee)
          FROM public.merchant_settlements WHERE id=_s);
END $$;

CREATE OR REPLACE FUNCTION public.staff_mark_settlement_paid(_settlement_id uuid, _reference text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF coalesce(trim(_reference),'') = '' THEN RAISE EXCEPTION 'reference_required'; END IF;
  UPDATE public.merchant_settlements SET status='paid', paid_at=now(), reference=_reference, updated_at=now()
   WHERE id=_settlement_id AND status IN ('draft','approved');
  IF NOT FOUND THEN RAISE EXCEPTION 'not_payable'; END IF;
  INSERT INTO public.audit_logs(actor_id,action,target_table,target_id,after_state)
  VALUES (auth.uid(),'settlement_paid','merchant_settlements',_settlement_id,jsonb_build_object('reference',_reference));
END $$;

CREATE OR REPLACE FUNCTION public.merchant_orders_refund_adjustment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.refund_status='refunded' AND OLD.refund_status IS DISTINCT FROM 'refunded'
     AND EXISTS (SELECT 1 FROM public.merchant_settlement_items WHERE order_id=NEW.id) THEN
    INSERT INTO public.merchant_settlement_adjustments(store_id,order_id,amount)
    VALUES (NEW.merchant_id, NEW.id, -abs(coalesce(NEW.merchant_net,0))) ON CONFLICT (order_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_merchant_orders_refund_adjustment ON public.merchant_orders;
CREATE TRIGGER trg_merchant_orders_refund_adjustment AFTER UPDATE OF refund_status ON public.merchant_orders
  FOR EACH ROW EXECUTE FUNCTION public.merchant_orders_refund_adjustment();

-- D: Notify-me
CREATE OR REPLACE FUNCTION public.notify_capacity_available(_service text)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _u uuid; _n int := 0;
BEGIN
  UPDATE public.notify_requests SET status='expired' WHERE status='waiting' AND created_at < now() - interval '24 hours';
  FOR _u IN SELECT DISTINCT customer_id FROM public.notify_requests WHERE service_type=_service AND status='waiting' LOOP
    BEGIN
      PERFORM public.notify_push_event('customer', _u, 'general', 'Ab available hai', 'Ab available hai — pehle aao, pehle pao',
        jsonb_build_object('route', CASE WHEN _service='clean' THEN 'home' ELSE _service END, 'service', _service));
    EXCEPTION WHEN others THEN NULL; END;
    _n := _n+1;
  END LOOP;
  UPDATE public.notify_requests SET status='notified', notified_at=now() WHERE service_type=_service AND status='waiting';
  RETURN _n;
END $$;

CREATE OR REPLACE FUNCTION public.experts_capacity_freed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF coalesce(NEW.is_online,false) AND NOT coalesce(NEW.is_busy,false)
     AND (coalesce(OLD.is_busy,false) OR NOT coalesce(OLD.is_online,false))
     AND EXISTS (SELECT 1 FROM public.notify_requests WHERE status='waiting' AND service_type IN ('store','food','parcel')) THEN
    PERFORM public.notify_capacity_available('store');
    PERFORM public.notify_capacity_available('food');
    PERFORM public.notify_capacity_available('parcel');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_experts_capacity_freed ON public.experts;
CREATE TRIGGER trg_experts_capacity_freed AFTER UPDATE OF is_busy, is_online ON public.experts
  FOR EACH ROW EXECUTE FUNCTION public.experts_capacity_freed();

CREATE OR REPLACE FUNCTION public.bookings_slot_freed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('cancelled','canceled') AND OLD.status IS DISTINCT FROM NEW.status
     AND EXISTS (SELECT 1 FROM public.notify_requests WHERE status='waiting' AND service_type='clean') THEN
    PERFORM public.notify_capacity_available('clean');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_bookings_slot_freed ON public.bookings;
CREATE TRIGGER trg_bookings_slot_freed AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_slot_freed();

CREATE OR REPLACE FUNCTION public.notify_mark_converted(_customer uuid, _service text, _order_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.notify_requests SET status='converted', converted_order_id=_order_id
   WHERE customer_id=_customer AND service_type=_service AND status='notified' AND notified_at > now() - interval '2 hours';
$$;

CREATE OR REPLACE FUNCTION public.notify_convert_merchant_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.payment_status='paid' AND (TG_OP='INSERT' OR OLD.payment_status IS DISTINCT FROM 'paid') THEN
    PERFORM public.notify_mark_converted(NEW.user_id,
      (SELECT CASE WHEN service_type='food' THEN 'food' ELSE 'store' END FROM public.merchants WHERE id=NEW.merchant_id), NEW.id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notify_convert_merchant_order ON public.merchant_orders;
CREATE TRIGGER trg_notify_convert_merchant_order AFTER INSERT OR UPDATE OF payment_status ON public.merchant_orders
  FOR EACH ROW EXECUTE FUNCTION public.notify_convert_merchant_order();

CREATE OR REPLACE FUNCTION public.notify_convert_booking()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN PERFORM public.notify_mark_converted(NEW.user_id, 'clean', NEW.id); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_notify_convert_booking ON public.bookings;
CREATE TRIGGER trg_notify_convert_booking AFTER INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.notify_convert_booking();

CREATE OR REPLACE FUNCTION public.notify_convert_courier()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.merchant_order_id IS NULL THEN PERFORM public.notify_mark_converted(NEW.customer_id, 'parcel', NEW.id); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notify_convert_courier ON public.courier_orders;
CREATE TRIGGER trg_notify_convert_courier AFTER INSERT ON public.courier_orders
  FOR EACH ROW EXECUTE FUNCTION public.notify_convert_courier();

CREATE OR REPLACE FUNCTION public.notify_requests_expire()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  UPDATE public.notify_requests SET status='expired' WHERE status='waiting' AND created_at < now() - interval '24 hours';
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='notify-requests-expire';
SELECT cron.schedule('notify-requests-expire','0 * * * *', 'select public.notify_requests_expire()');

CREATE OR REPLACE FUNCTION public.staff_notify_summary(_from date, _to date)
RETURNS TABLE(day date, service_type text, tried bigint, notified bigint, converted bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN QUERY
  SELECT (r.created_at AT TIME ZONE 'Asia/Kolkata')::date, r.service_type, count(*),
         count(*) FILTER (WHERE r.notified_at IS NOT NULL), count(*) FILTER (WHERE r.status='converted')
    FROM public.notify_requests r
   WHERE (r.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN _from AND _to
   GROUP BY 1,2 ORDER BY 1 DESC, 2;
END $$;

-- Grants
DO $g$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'merchant_access(uuid)','merchant_require(uuid,text[])','product_upsert_core(uuid,uuid,jsonb,text)',
    'settlement_next_invoice(date)','settlement_build(uuid,timestamptz,text,date)','merchant_orders_refund_adjustment()',
    'notify_capacity_available(text)','experts_capacity_freed()','bookings_slot_freed()','notify_mark_converted(uuid,text,uuid)',
    'notify_convert_merchant_order()','notify_convert_booking()','notify_convert_courier()','notify_requests_expire()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM public, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'upsert_product(uuid,jsonb,uuid)','staff_upsert_product(uuid,jsonb,uuid)','staff_review_product_changes(uuid,boolean,text)',
    'set_product_availability(uuid,boolean)','set_recommended_products(uuid,uuid[])','reorder_store_categories(uuid,uuid[])',
    'reorder_products(uuid,uuid,uuid[])','set_store_open(uuid,boolean)','set_offer_text(uuid,text)',
    'generate_settlement_batch(date)','request_instant_settlement(uuid)','staff_mark_settlement_paid(uuid,text)',
    'staff_notify_summary(date,date)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM public, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $g$;
