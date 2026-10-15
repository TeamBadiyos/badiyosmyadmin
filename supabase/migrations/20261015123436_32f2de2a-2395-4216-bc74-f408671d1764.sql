ALTER TABLE public.merchant_settlements DROP CONSTRAINT merchant_settlements_status_check;
ALTER TABLE public.merchant_settlements ADD CONSTRAINT merchant_settlements_status_check
  CHECK (status = ANY (ARRAY['draft','approved','paid','failed','cancelled','carry_forward']));

CREATE OR REPLACE FUNCTION public.settlement_build(_store_id uuid, _cutoff timestamp with time zone, _type text, _run_date date)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _sid uuid; _t record; _adj numeric; _fee numeric := 0; _pct numeric; _inv text[]; _net numeric;
BEGIN
  SELECT count(*) c, min(o.delivered_at)::date f, max(o.delivered_at)::date t,
         coalesce(sum(coalesce(o.item_total,o.items_total)),0) g, coalesce(sum(o.commission_amount),0) cm,
         coalesce(sum(o.commission_gst),0) cg, coalesce(sum(o.tcs_amount),0) tc, coalesce(sum(o.tds_amount),0) td,
         coalesce(sum(o.merchant_net),0) n
    INTO _t
    FROM public.merchant_orders o
   WHERE o.merchant_id=_store_id AND o.status='delivered' AND o.delivered_at < _cutoff
     AND o.payment_status='paid' AND coalesce(o.refund_status,'none') NOT IN ('refund_pending','processing','done','failed')
     AND NOT EXISTS (SELECT 1 FROM public.merchant_settlement_items i WHERE i.order_id=o.id);
  SELECT coalesce(sum(a.amount),0) INTO _adj FROM public.merchant_settlement_adjustments a WHERE a.store_id=_store_id AND a.settlement_id IS NULL;
  IF _t.c = 0 AND _adj = 0 THEN RETURN NULL; END IF;
  _net := round(_t.n + _adj, 2);
  IF _type='instant' AND _net > 0 THEN
    SELECT coalesce(m.instant_settlement_fee_pct,0) INTO _pct FROM public.merchants m WHERE m.id=_store_id;
    _fee := round(_net * _pct / 100, 2);
  END IF;
  _inv := public.settlement_next_invoice(coalesce(_run_date, (now() AT TIME ZONE 'Asia/Kolkata')::date));
  INSERT INTO public.merchant_settlements(store_id,type,period_from,period_to,gross_amount,commission_total,commission_gst_total,
     tcs_total,tds_total,instant_fee,net_amount,status,adjustment_total,invoice_no,invoice_fy,run_date)
  VALUES (_store_id,_type,_t.f,_t.t,_t.g,_t.cm,_t.cg,_t.tc,_t.td,_fee,
     CASE WHEN _net < 0 THEN 0 ELSE round(_net-_fee,2) END,
     CASE WHEN _net < 0 THEN 'carry_forward' WHEN _type='instant' THEN 'approved' ELSE 'draft' END,
     _adj,_inv[1],_inv[2],_run_date)
  RETURNING id INTO _sid;
  INSERT INTO public.merchant_settlement_items(settlement_id,order_id)
  SELECT _sid, o.id FROM public.merchant_orders o
   WHERE o.merchant_id=_store_id AND o.status='delivered' AND o.delivered_at < _cutoff
     AND o.payment_status='paid' AND coalesce(o.refund_status,'none') NOT IN ('refund_pending','processing','done','failed')
     AND NOT EXISTS (SELECT 1 FROM public.merchant_settlement_items i WHERE i.order_id=o.id);
  UPDATE public.merchant_settlement_adjustments a SET settlement_id=_sid WHERE a.store_id=_store_id AND a.settlement_id IS NULL;
  IF _net < 0 THEN
    -- carry the unrecovered negative balance into the merchant's next batch
    INSERT INTO public.merchant_settlement_adjustments(store_id, order_id, amount, reason, settlement_id)
    VALUES (_store_id, NULL, _net, 'carry_forward from ' || _inv[1], NULL);
  END IF;
  RETURN _sid;
END $function$;

CREATE OR REPLACE FUNCTION public.staff_update_tax_setting(_key text, _rate numeric, _active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
  IF NOT public.is_super_admin_user() THEN RAISE EXCEPTION 'Only super admin'; END IF;
  SELECT to_jsonb(t) INTO v_before FROM public.tax_settings t WHERE t.key=_key;
  IF v_before IS NULL THEN RAISE EXCEPTION 'Unknown tax key'; END IF;
  UPDATE public.tax_settings t SET rate_pct=_rate, is_active=_active, updated_at=now(), updated_by=auth.uid()
   WHERE t.key=_key RETURNING to_jsonb(t) INTO v_after;
  INSERT INTO public.audit_logs(actor_id, action, target_table, before_state, after_state)
  VALUES (auth.uid(), 'tax_setting_update', 'tax_settings', v_before, v_after);
END $$;
REVOKE ALL ON FUNCTION public.staff_update_tax_setting(text,numeric,boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_update_tax_setting(text,numeric,boolean) TO authenticated;