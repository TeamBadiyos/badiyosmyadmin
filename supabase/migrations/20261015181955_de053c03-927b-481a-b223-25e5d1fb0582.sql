
-- SAC codes (editable)
INSERT INTO ops_settings(key,value,label) VALUES
 ('sac_maid','998533','SAC — Clean Home'),('sac_wash','998714','SAC — Clean Auto'),('sac_store_items','','HSN — Store items'),('sac_food_9_5','996331','SAC — Food 9(5)'),
 ('sac_store_delivery','996813','SAC — Store delivery'),('sac_food_delivery','996813','SAC — Food delivery'),('sac_parcel','996813','SAC — Parcel'),
 ('sac_platform_fee','998599','SAC — Platform fee'),('sac_commission','998599','SAC — Commission'),('sac_instant_fee','','SAC — Instant fee')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fin_sac(_k text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce((SELECT value FROM ops_settings WHERE key='sac_'||_k),'') $$;
REVOKE EXECUTE ON FUNCTION public.fin_sac(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_sac(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_set_sac_codes(_codes jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE k text; v text; _old jsonb;
BEGIN
 IF NOT public.is_super_admin_user() THEN RAISE EXCEPTION 'Super admin only'; END IF;
 SELECT jsonb_object_agg(key,value) INTO _old FROM ops_settings WHERE key LIKE 'sac\_%';
 FOR k,v IN SELECT * FROM jsonb_each_text(_codes) LOOP
  IF k NOT IN ('maid','wash','store_items','food_9_5','store_delivery','food_delivery','parcel','platform_fee','commission','instant_fee') THEN RAISE EXCEPTION 'Unknown code %',k; END IF;
  IF v !~ '^[0-9]{0,8}$' THEN RAISE EXCEPTION 'SAC/HSN must be digits only (max 8)'; END IF;
  UPDATE ops_settings SET value=v, updated_at=now() WHERE key='sac_'||k;
 END LOOP;
 INSERT INTO audit_logs(actor_id,action,table_name,old_data,new_data) VALUES(auth.uid(),'sac_codes_changed','ops_settings',_old,_codes);
END $$;
REVOKE EXECUTE ON FUNCTION public.staff_set_sac_codes(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_set_sac_codes(jsonb) TO authenticated;

-- Draft / Issued
ALTER TABLE public.customer_invoices ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft';

CREATE OR REPLACE FUNCTION public.fin_company_complete() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce((SELECT bool_and(coalesce(btrim(value),'')<>'') FROM ops_settings WHERE key IN ('company_gstin','company_pan','company_address')),false)
   AND (SELECT count(*) FROM ops_settings WHERE key IN ('company_gstin','company_pan','company_address'))=3 $$;
REVOKE EXECUTE ON FUNCTION public.fin_company_complete() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_company_complete() TO authenticated;

-- Payment date per order
CREATE OR REPLACE FUNCTION public.fin_paid_date(_ref_type text, _ref_id uuid) RETURNS date LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE _t timestamptz;
BEGIN
 IF _ref_type='booking' THEN
  SELECT CASE WHEN razorpay_payment_id IS NOT NULL THEN created_at WHEN status='completed' THEN coalesce(service_end_at,updated_at) END INTO _t FROM bookings WHERE id=_ref_id;
 ELSIF _ref_type='merchant_order' THEN
  SELECT coalesce(paid_at, CASE WHEN lower(status) IN ('delivered','completed') THEN coalesce(delivered_at,updated_at) END) INTO _t FROM merchant_orders WHERE id=_ref_id;
 ELSIF _ref_type='courier_order' THEN
  SELECT CASE WHEN payment_status='paid' THEN created_at WHEN upper(status)='COMPLETED' THEN coalesce(completed_at,updated_at) END INTO _t FROM courier_orders WHERE id=_ref_id;
 END IF;
 RETURN (_t AT TIME ZONE 'Asia/Kolkata')::date;
END $$;
REVOKE EXECUTE ON FUNCTION public.fin_paid_date(text,uuid) FROM PUBLIC, anon, authenticated;

-- Issuer: paid date, editable SAC, draft/issued
CREATE OR REPLACE FUNCTION public.fin_issue_invoice(_ref_type text, _ref_id uuid, _d date DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _id uuid; _uid uuid; _name text; _phone text; _svc text; _code text; _lines jsonb; _disc numeric:=0; _gst numeric:=0; _total numeric:=0; _taxable numeric:=0; _date date;
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
  SELECT o.*, coalesce(mm.service_type,'store') st INTO m FROM merchant_orders o LEFT JOIN merchants mm ON mm.id=o.merchant_id WHERE o.id=_ref_id;
  IF NOT FOUND OR coalesce(m.is_training,false) THEN RETURN NULL; END IF;
  _uid:=m.user_id; _code:=m.order_number; _svc:=CASE WHEN m.st='food' THEN 'food' ELSE 'store' END;
  _name:=m.customer_name; _phone:=m.customer_phone;
  _lines:='[]'::jsonb;
  IF coalesce(m.item_total,m.items_total,0)>0 THEN _lines:=_lines||jsonb_build_object('desc',CASE WHEN _svc='food' THEN 'Food items' ELSE 'Store items' END,'sac',fin_sac(CASE WHEN _svc='food' THEN 'food_9_5' ELSE 'store_items' END),
     'taxable',coalesce(m.item_total,m.items_total,0),'gst_pct',coalesce((m.tax_rates_snapshot->>'food_gst_9_5')::numeric, CASE WHEN _svc='food' THEN 5 ELSE 0 END),'gst',coalesce(m.gst_items,0)); END IF;
  IF coalesce(m.delivery_fee,0)>0 THEN _lines:=_lines||jsonb_build_object('desc','Delivery charge','sac',fin_sac(CASE WHEN _svc='food' THEN 'food_delivery' ELSE 'store_delivery' END),'taxable',m.delivery_fee,'gst_pct',coalesce((m.tax_rates_snapshot->>'order_delivery_gst')::numeric,0),'gst',coalesce(m.gst_delivery,0)); END IF;
  IF coalesce(m.platform_fee,0)>0 THEN _lines:=_lines||jsonb_build_object('desc','Platform fee','sac',fin_sac('platform_fee'),'taxable',m.platform_fee,'gst_pct',coalesce((m.tax_rates_snapshot->>'platform_fee_gst')::numeric,18),'gst',coalesce(m.gst_platform,0)); END IF;
  _gst:=coalesce(m.gst_items,0)+coalesce(m.gst_delivery,0)+coalesce(m.gst_platform,0);
  _total:=coalesce(m.total_payable,m.total_amount,0);
  _taxable:=(SELECT coalesce(sum((l->>'taxable')::numeric),0) FROM jsonb_array_elements(_lines) l);
  _disc:=greatest(0,_taxable+_gst-_total);
 ELSIF _ref_type='courier_order' THEN
  SELECT * INTO c FROM courier_orders WHERE id=_ref_id;
  IF NOT FOUND OR c.business_merchant_id IS NOT NULL OR c.merchant_order_id IS NOT NULL OR c.store_order_id IS NOT NULL THEN RETURN NULL; END IF;
  _uid:=c.customer_id; _code:=c.order_code; _svc:='parcel';
  _gst:=coalesce(c.gst_amount,0); _total:=coalesce(c.total_amount,0); _disc:=coalesce(c.discount_amount,0); _taxable:=_total-_gst;
  _lines:=jsonb_build_array(jsonb_build_object('desc','Parcel delivery','sac',fin_sac('parcel'),'taxable',_taxable,'gst_pct',coalesce(c.gst_percent,0),'gst',_gst));
 ELSE RETURN NULL; END IF;
 IF _total<=0 THEN RETURN NULL; END IF;
 IF _name IS NULL OR _phone IS NULL THEN SELECT coalesce(_name,full_name), coalesce(_phone,phone) INTO _name,_phone FROM users WHERE id=_uid; END IF;
 INSERT INTO customer_invoices(invoice_no,fy,invoice_date,user_id,customer_name,customer_phone,service,ref_type,ref_id,ref_code,lines,discount,taxable_value,cgst,sgst,total,company,status)
 VALUES(fin_next_doc_no('BDS',_date),fin_fy(_date),_date,_uid,_name,_phone,_svc,_ref_type,_ref_id,_code,_lines,_disc,round(_taxable,2),round(_gst/2,2),_gst-round(_gst/2,2),_total,fin_company_snapshot(),
        CASE WHEN fin_company_complete() THEN 'issued' ELSE 'draft' END)
 ON CONFLICT(ref_type,ref_id) DO NOTHING RETURNING id INTO _id;
 RETURN _id;
END $$;
REVOKE EXECUTE ON FUNCTION public.fin_issue_invoice(text,uuid,date) FROM PUBLIC, anon, authenticated;

-- Trigger: issue at payment (online) or at completion (cash / pay-later)
CREATE OR REPLACE FUNCTION public.fin_invoice_trg() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _rt text := TG_ARGV[0]; _now boolean; _before boolean;
BEGIN
 BEGIN
  IF _rt='booking' THEN
   _now := NEW.razorpay_payment_id IS NOT NULL OR lower(NEW.status)='completed';
   _before := TG_OP='UPDATE' AND (OLD.razorpay_payment_id IS NOT NULL OR lower(coalesce(OLD.status,''))='completed');
  ELSIF _rt='merchant_order' THEN
   _now := NEW.paid_at IS NOT NULL OR lower(NEW.status) IN ('delivered','completed');
   _before := TG_OP='UPDATE' AND (OLD.paid_at IS NOT NULL OR lower(coalesce(OLD.status,'')) IN ('delivered','completed'));
  ELSE
   _now := NEW.payment_status='paid' OR upper(NEW.status)='COMPLETED';
   _before := TG_OP='UPDATE' AND (OLD.payment_status='paid' OR upper(coalesce(OLD.status,''))='COMPLETED');
  END IF;
  IF _now AND NOT _before THEN PERFORM fin_issue_invoice(_rt, NEW.id); END IF;
  IF TG_OP='UPDATE' AND NEW.refund_status='done' AND coalesce(OLD.refund_status,'')<>'done' THEN
   PERFORM fin_issue_credit_note(_rt, NEW.id, NEW.refund_amount, 'Refund'); END IF;
 EXCEPTION WHEN OTHERS THEN RAISE WARNING 'invoice issue failed %: %', NEW.id, SQLERRM; END;
 RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.fin_invoice_trg() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS fin_invoice_booking ON public.bookings;
DROP TRIGGER IF EXISTS fin_invoice_merchant ON public.merchant_orders;
DROP TRIGGER IF EXISTS fin_invoice_courier ON public.courier_orders;
CREATE TRIGGER fin_invoice_booking AFTER INSERT OR UPDATE OF status, refund_status, razorpay_payment_id ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.fin_invoice_trg('booking');
CREATE TRIGGER fin_invoice_merchant AFTER INSERT OR UPDATE OF status, refund_status, paid_at ON public.merchant_orders FOR EACH ROW EXECUTE FUNCTION public.fin_invoice_trg('merchant_order');
CREATE TRIGGER fin_invoice_courier AFTER INSERT OR UPDATE OF status, refund_status, payment_status ON public.courier_orders FOR EACH ROW EXECUTE FUNCTION public.fin_invoice_trg('courier_order');

-- Re-date existing invoices to payment date, renumber in date order, mark draft, refresh SAC codes
DO $$ DECLARE r record; _n int; _fy text; _prev text := NULL; _sac jsonb;
BEGIN
 UPDATE customer_invoices i SET invoice_date = coalesce(fin_paid_date(i.ref_type,i.ref_id), i.invoice_date);
 UPDATE customer_invoices SET fy = fin_fy(invoice_date), invoice_no = 'TMP-'||id::text, status='draft';
 UPDATE customer_invoices SET lines = (SELECT jsonb_agg(l || jsonb_build_object('sac', fin_sac(CASE
     WHEN service='clean_home' THEN 'maid' WHEN service='clean_auto' THEN 'wash' WHEN service='parcel' THEN 'parcel'
     WHEN l->>'desc'='Platform fee' THEN 'platform_fee'
     WHEN l->>'desc'='Delivery charge' THEN CASE WHEN service='food' THEN 'food_delivery' ELSE 'store_delivery' END
     WHEN service='food' THEN 'food_9_5' ELSE 'store_items' END))) FROM jsonb_array_elements(lines) l)
   WHERE jsonb_array_length(lines)>0;
 DELETE FROM customer_doc_counters WHERE series='BDS';
 FOR r IN SELECT id, invoice_date, fy FROM customer_invoices ORDER BY invoice_date, created_at, id LOOP
  UPDATE customer_invoices SET invoice_no = fin_next_doc_no('BDS', r.invoice_date) WHERE id=r.id;
 END LOOP;
 IF fin_company_complete() THEN UPDATE customer_invoices SET status='issued', company=fin_company_snapshot(); END IF;
END $$;

-- Re-issue drafts when the company profile becomes complete
CREATE OR REPLACE FUNCTION public.fin_company_profile_trg() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.key LIKE 'company\_%' AND fin_company_complete() THEN
  UPDATE customer_invoices SET company=fin_company_snapshot(), status='issued' WHERE status='draft';
 END IF;
 RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.fin_company_profile_trg() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS fin_company_profile ON public.ops_settings;
CREATE TRIGGER fin_company_profile AFTER INSERT OR UPDATE OF value ON public.ops_settings FOR EACH ROW EXECUTE FUNCTION public.fin_company_profile_trg();

-- Customer App sees issued invoices only
CREATE OR REPLACE FUNCTION public.customer_list_invoices() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
 IF coalesce((SELECT value FROM ops_settings WHERE key='customer_invoices_visible'),'false')<>'true' THEN RETURN jsonb_build_object('enabled',false,'invoices','[]'::jsonb,'credit_notes','[]'::jsonb); END IF;
 RETURN jsonb_build_object('enabled',true,
  'invoices',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.invoice_date DESC),'[]') FROM customer_invoices i WHERE user_id=auth.uid() AND status='issued'),
  'credit_notes',(SELECT coalesce(jsonb_agg(to_jsonb(n)||jsonb_build_object('invoice_no',i.invoice_no)),'[]') FROM customer_credit_notes n JOIN customer_invoices i ON i.id=n.invoice_id WHERE n.user_id=auth.uid() AND i.status='issued'));
END $$;
