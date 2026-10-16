ALTER TABLE public.customer_invoices ADD COLUMN IF NOT EXISTS payments jsonb;

CREATE OR REPLACE FUNCTION public.fin_issue_invoice(_ref_type text, _ref_id uuid, _d date DEFAULT NULL::date)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _id uuid; _uid uuid; _name text; _phone text; _svc text; _code text; _lines jsonb; _disc numeric:=0; _gst numeric:=0; _total numeric:=0; _taxable numeric:=0; _date date; _goods jsonb; _pay jsonb;
 _bill numeric; _cpn numeric; _wal numeric;
 b record; m record; c record;
BEGIN
 SELECT id INTO _id FROM customer_invoices WHERE ref_type=_ref_type AND ref_id=_ref_id; IF _id IS NOT NULL THEN RETURN _id; END IF;
 _date := coalesce(_d, fin_paid_date(_ref_type,_ref_id), (now() AT TIME ZONE 'Asia/Kolkata')::date);
 IF _ref_type='booking' THEN
  SELECT * INTO b FROM bookings WHERE id=_ref_id; IF NOT FOUND OR coalesce(b.is_training,false) THEN RETURN NULL; END IF;
  _uid:=b.user_id; _code:=coalesce(b.booking_number,left(b.id::text,8));
  _svc := CASE WHEN public.booking_capacity_group(b.service_category_id,b.service_label)='wash' THEN 'clean_auto' ELSE 'clean_home' END;
  _gst:=coalesce(b.gst_amount,0); _total:=coalesce(b.total_amount,b.price,0); _disc:=coalesce(b.discount_amount,0);
  _taxable:=_total-_gst;
  _lines:=jsonb_build_array(jsonb_build_object('desc',coalesce(b.service_label,'Service'),'sac',fin_sac(CASE WHEN _svc='clean_auto' THEN 'wash' ELSE 'maid' END),
     'taxable',_taxable,'gst_pct',coalesce(b.gst_percent,0),'gst',_gst));
 ELSIF _ref_type='merchant_order' THEN
  SELECT o.*, coalesce(mm.service_type,'store') st, mm.store_name m_name, mm.gstin m_gstin INTO m FROM merchant_orders o LEFT JOIN merchants mm ON mm.id=o.merchant_id WHERE o.id=_ref_id;
  IF NOT FOUND OR coalesce(m.is_training,false) THEN RETURN NULL; END IF;
  _uid:=m.user_id; _code:=m.order_number; _svc:=CASE WHEN m.st='food' THEN 'food' ELSE 'store' END;
  _name:=m.customer_name; _phone:=m.customer_phone;
  _lines:='[]'::jsonb;
  IF _svc='food' AND coalesce(m.item_total,m.items_total,0)>0 THEN _lines:=_lines||jsonb_build_object('desc','Food items','sac',fin_sac('food_9_5'),
     'taxable',coalesce(m.item_total,m.items_total,0),'gst_pct',coalesce((m.tax_rates_snapshot->>'food_gst_9_5')::numeric,5),'gst',coalesce(m.gst_items,0)); END IF;
  IF coalesce(m.delivery_fee,0)>0 THEN _lines:=_lines||jsonb_build_object('desc','Delivery charge','sac',fin_sac(CASE WHEN _svc='food' THEN 'food_delivery' ELSE 'store_delivery' END),'taxable',m.delivery_fee,'gst_pct',coalesce((m.tax_rates_snapshot->>'order_delivery_gst')::numeric,0),'gst',coalesce(m.gst_delivery,0)); END IF;
  IF coalesce(m.platform_fee,0)>0 THEN _lines:=_lines||jsonb_build_object('desc','Platform fee','sac',fin_sac('platform_fee'),'taxable',m.platform_fee,'gst_pct',coalesce((m.tax_rates_snapshot->>'platform_fee_gst')::numeric,18),'gst',coalesce(m.gst_platform,0)); END IF;
  _taxable:=(SELECT coalesce(sum((l->>'taxable')::numeric),0) FROM jsonb_array_elements(_lines) l);
  _cpn:=coalesce(m.coupon_discount,0); _wal:=coalesce(m.wallet_used,0);
  _bill:=coalesce(m.total_payable, coalesce(m.total_amount,0)+_cpn+_wal);
  IF _svc='food' THEN
   _gst:=coalesce(m.gst_items,0)+coalesce(m.gst_delivery,0)+coalesce(m.gst_platform,0);
   _disc:=least(_cpn,_taxable+_gst);
   _total:=_taxable+_gst-_disc;
  ELSE
   -- Store: goods are supplied by the merchant; badiyos invoices only its own supplies
   _gst:=coalesce(m.gst_delivery,0)+coalesce(m.gst_platform,0);
   _total:=_taxable+_gst; _disc:=0;
   _goods:=jsonb_build_object('merchant_name',m.m_name,'merchant_gstin',m.m_gstin,
     'items',coalesce((SELECT jsonb_agg(jsonb_build_object('desc',i.product_name_snapshot||coalesce(' · '||i.variant_name,''),'qty',i.quantity,'amount',coalesce(i.line_total,i.price_snapshot*i.quantity)))
                       FROM merchant_order_items i WHERE i.order_id=m.id),'[]'::jsonb),
     'total',coalesce(m.item_total,m.items_total,0));
  END IF;
  _pay:=jsonb_build_object('bill_total',round(_bill,2),'coupon',round(_cpn,2),'amount_due',round(_bill-_cpn,2),
     'wallet',round(_wal,2),'online',round(coalesce(m.total_amount,0),2));
 ELSIF _ref_type='courier_order' THEN
  SELECT * INTO c FROM courier_orders WHERE id=_ref_id;
  IF NOT FOUND OR c.business_merchant_id IS NOT NULL OR c.merchant_order_id IS NOT NULL OR c.store_order_id IS NOT NULL THEN RETURN NULL; END IF;
  _uid:=c.customer_id; _code:=c.order_code; _svc:='parcel';
  _gst:=coalesce(c.gst_amount,0); _total:=coalesce(c.total_amount,0); _disc:=coalesce(c.discount_amount,0); _taxable:=_total-_gst;
  _lines:=jsonb_build_array(jsonb_build_object('desc','Parcel delivery','sac',fin_sac('parcel'),'taxable',_taxable,'gst_pct',coalesce(c.gst_percent,0),'gst',_gst));
 ELSE RETURN NULL; END IF;
 IF _total<=0 THEN RETURN NULL; END IF;
 IF _name IS NULL OR _phone IS NULL THEN SELECT coalesce(_name,full_name), coalesce(_phone,phone) INTO _name,_phone FROM users WHERE id=_uid; END IF;
 INSERT INTO customer_invoices(invoice_no,fy,invoice_date,user_id,customer_name,customer_phone,service,ref_type,ref_id,ref_code,lines,discount,taxable_value,cgst,sgst,total,company,status,merchant_goods,payments)
 VALUES(fin_next_doc_no('BDS',_date),fin_fy(_date),_date,_uid,_name,_phone,_svc,_ref_type,_ref_id,_code,_lines,_disc,round(_taxable,2),round(_gst/2,2),_gst-round(_gst/2,2),round(_total,2),fin_company_snapshot(),
        CASE WHEN fin_company_complete() THEN 'issued' ELSE 'draft' END,_goods,_pay)
 ON CONFLICT(ref_type,ref_id) DO NOTHING RETURNING id INTO _id;
 RETURN _id;
END $function$;

DO $$
DECLARE f text; d text; n text; fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['staff_dashboard_money','staff_dashboard_drill'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname=fn;
    n := replace(d, '+coalesce(o.gst_platform,0)-coalesce(o.total_amount,0),0)', '+coalesce(o.gst_platform,0)-coalesce(o.total_amount,0)-coalesce(o.wallet_used,0),0)');
    IF n = d THEN RAISE EXCEPTION 'pattern not found in %', fn; END IF;
    EXECUTE n;
  END LOOP;
  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname='staff_tax_report';
  n := replace(d, 'LEAST(1, coalesce(o.refund_amount, coalesce(o.total_payable,o.total_amount))/coalesce(o.total_payable,o.total_amount))',
     'LEAST(1, CASE WHEN o.refund_amount IS NULL THEN 1 ELSE (o.refund_amount+coalesce(o.wallet_used,0))/nullif(coalesce(o.total_payable,o.total_amount)-coalesce(o.coupon_discount,0),0) END)');
  IF n = d THEN RAISE EXCEPTION 'pattern not found in tax report'; END IF;
  EXECUTE n;
END $$;