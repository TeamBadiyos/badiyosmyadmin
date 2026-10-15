ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE public.customer_invoices ADD COLUMN IF NOT EXISTS merchant_goods jsonb;

CREATE OR REPLACE FUNCTION public.bookings_stamp_paid_at() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF coalesce(NEW.razorpay_payment_id,'')<>'' AND NEW.paid_at IS NULL
    AND (TG_OP='INSERT' OR coalesce(OLD.razorpay_payment_id,'')='') THEN NEW.paid_at := now(); END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bookings_stamp_paid_at ON public.bookings;
CREATE TRIGGER bookings_stamp_paid_at BEFORE INSERT OR UPDATE OF razorpay_payment_id ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.bookings_stamp_paid_at();

CREATE OR REPLACE FUNCTION public.fin_paid_date(_ref_type text, _ref_id uuid) RETURNS date LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE _t timestamptz;
BEGIN
 IF _ref_type='booking' THEN
  SELECT CASE WHEN razorpay_payment_id IS NOT NULL THEN coalesce(paid_at,created_at) WHEN status='completed' THEN coalesce(service_end_at,updated_at) END INTO _t FROM bookings WHERE id=_ref_id;
 ELSIF _ref_type='merchant_order' THEN
  SELECT coalesce(paid_at, delivered_at, CASE WHEN lower(status) IN ('delivered','completed') THEN updated_at END) INTO _t FROM merchant_orders WHERE id=_ref_id;
 ELSE
  SELECT CASE WHEN payment_status='paid' THEN created_at WHEN upper(status)='COMPLETED' THEN coalesce(completed_at,updated_at) END INTO _t FROM courier_orders WHERE id=_ref_id;
 END IF;
 IF _t IS NULL THEN RETURN NULL; END IF;
 RETURN (_t AT TIME ZONE 'Asia/Kolkata')::date;
END $$;
REVOKE EXECUTE ON FUNCTION public.fin_paid_date(text,uuid) FROM PUBLIC, anon, authenticated;

-- Remove store items SAC
DELETE FROM public.ops_settings WHERE key='sac_store_items';
CREATE OR REPLACE FUNCTION public.staff_set_sac_codes(_codes jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE k text; v text; _old jsonb;
BEGIN
 IF NOT public.is_super_admin_user() THEN RAISE EXCEPTION 'Super admin only'; END IF;
 SELECT jsonb_object_agg(key,value) INTO _old FROM ops_settings WHERE key LIKE 'sac\_%';
 FOR k,v IN SELECT * FROM jsonb_each_text(_codes) LOOP
  IF k NOT IN ('maid','wash','food_9_5','store_delivery','food_delivery','parcel','platform_fee','commission','instant_fee') THEN RAISE EXCEPTION 'Unknown code %',k; END IF;
  IF v !~ '^[0-9]{0,8}$' THEN RAISE EXCEPTION 'SAC/HSN must be digits only (max 8)'; END IF;
  UPDATE ops_settings SET value=v, updated_at=now() WHERE key='sac_'||k;
 END LOOP;
 INSERT INTO audit_logs(actor_id,action,table_name,old_data,new_data) VALUES(auth.uid(),'sac_codes_changed','ops_settings',_old,_codes);
END $$;

-- Tax keys in ops_settings: super admin only, even through direct table writes
CREATE OR REPLACE FUNCTION public.ops_settings_tax_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NOT NULL AND (NEW.key LIKE 'sac\_%' OR NEW.key LIKE '%gst%' OR NEW.key LIKE '%tcs%' OR NEW.key LIKE '%tds%')
    AND NOT public.is_super_admin_user() THEN RAISE EXCEPTION 'Only super admin can change tax settings'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ops_settings_tax_guard ON public.ops_settings;
CREATE TRIGGER ops_settings_tax_guard BEFORE INSERT OR UPDATE ON public.ops_settings FOR EACH ROW EXECUTE FUNCTION public.ops_settings_tax_guard();

CREATE OR REPLACE FUNCTION public.fin_issue_invoice(_ref_type text, _ref_id uuid, _d date DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _id uuid; _uid uuid; _name text; _phone text; _svc text; _code text; _lines jsonb; _disc numeric:=0; _gst numeric:=0; _total numeric:=0; _taxable numeric:=0; _date date; _goods jsonb;
 b record; m record; c record;
BEGIN
 SELECT id INTO _id FROM customer_invoices WHERE ref_type=_ref_type AND ref_id=_ref_id; IF _id IS NOT NULL THEN RETURN _id; END IF;
 _date := coalesce(_d, fin_paid_date(_ref_type,_ref_id), (now() AT TIME ZONE 'Asia/Kolkata')::date);
 IF _ref_type='booking' THEN
  SELECT * INTO b FROM bookings WHERE id=_ref_id; IF NOT FOUND OR coalesce(b.is_training,false) THEN RETURN NULL; END IF;
  _uid:=b.user_id; _code:=left(b.id::text,8);
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
  IF _svc='food' THEN
   _gst:=coalesce(m.gst_items,0)+coalesce(m.gst_delivery,0)+coalesce(m.gst_platform,0);
   _total:=coalesce(m.total_payable,m.total_amount,0);
   _disc:=greatest(0,_taxable+_gst-_total);
  ELSE
   -- Store: goods are supplied by the merchant; badiyos invoices only its own supplies
   _gst:=coalesce(m.gst_delivery,0)+coalesce(m.gst_platform,0);
   _total:=_taxable+_gst; _disc:=0;
   _goods:=jsonb_build_object('merchant_name',m.m_name,'merchant_gstin',m.m_gstin,
     'items',coalesce((SELECT jsonb_agg(jsonb_build_object('desc',i.product_name_snapshot||coalesce(' · '||i.variant_name,''),'qty',i.quantity,'amount',coalesce(i.line_total,i.price_snapshot*i.quantity)))
                       FROM merchant_order_items i WHERE i.order_id=m.id),'[]'::jsonb),
     'total',coalesce(m.item_total,m.items_total,0));
  END IF;
 ELSIF _ref_type='courier_order' THEN
  SELECT * INTO c FROM courier_orders WHERE id=_ref_id;
  IF NOT FOUND OR c.business_merchant_id IS NOT NULL OR c.merchant_order_id IS NOT NULL OR c.store_order_id IS NOT NULL THEN RETURN NULL; END IF;
  _uid:=c.customer_id; _code:=c.order_code; _svc:='parcel';
  _gst:=coalesce(c.gst_amount,0); _total:=coalesce(c.total_amount,0); _disc:=coalesce(c.discount_amount,0); _taxable:=_total-_gst;
  _lines:=jsonb_build_array(jsonb_build_object('desc','Parcel delivery','sac',fin_sac('parcel'),'taxable',_taxable,'gst_pct',coalesce(c.gst_percent,0),'gst',_gst));
 ELSE RETURN NULL; END IF;
 IF _total<=0 THEN RETURN NULL; END IF;
 IF _name IS NULL OR _phone IS NULL THEN SELECT coalesce(_name,full_name), coalesce(_phone,phone) INTO _name,_phone FROM users WHERE id=_uid; END IF;
 INSERT INTO customer_invoices(invoice_no,fy,invoice_date,user_id,customer_name,customer_phone,service,ref_type,ref_id,ref_code,lines,discount,taxable_value,cgst,sgst,total,company,status,merchant_goods)
 VALUES(fin_next_doc_no('BDS',_date),fin_fy(_date),_date,_uid,_name,_phone,_svc,_ref_type,_ref_id,_code,_lines,_disc,round(_taxable,2),round(_gst/2,2),_gst-round(_gst/2,2),_total,fin_company_snapshot(),
        CASE WHEN fin_company_complete() THEN 'issued' ELSE 'draft' END,_goods)
 ON CONFLICT(ref_type,ref_id) DO NOTHING RETURNING id INTO _id;
 RETURN _id;
END $$;
REVOKE EXECUTE ON FUNCTION public.fin_issue_invoice(text,uuid,date) FROM PUBLIC, anon, authenticated;

-- Fix existing Draft store invoices: rebuild lines keeping number and date
DO $$ DECLARE r record; _no text; _dt date; _fy text; BEGIN
 FOR r IN SELECT id, ref_id, invoice_no, invoice_date, fy FROM customer_invoices WHERE service='store' AND status='draft' LOOP
  DELETE FROM customer_invoices WHERE id=r.id;
  PERFORM fin_issue_invoice('merchant_order', r.ref_id, r.invoice_date);
  UPDATE customer_invoices SET invoice_no=r.invoice_no, fy=r.fy WHERE ref_type='merchant_order' AND ref_id=r.ref_id;
 END LOOP; END $$;