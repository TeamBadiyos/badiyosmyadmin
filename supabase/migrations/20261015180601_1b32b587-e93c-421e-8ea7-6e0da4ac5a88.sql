
CREATE OR REPLACE FUNCTION public.is_active_staff(_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM staff_users WHERE auth_user_id=_uid AND status='active') $$;
INSERT INTO public.ops_settings(key,value,label) VALUES
 ('customer_invoices_visible','false','Show invoices in Customer App'),
 ('customer_wallet_enabled','false','Customer wallet live'),
 ('wallet_topup_min','100','Wallet minimum top-up (₹)'),
 ('wallet_topup_max','5000','Wallet maximum top-up (₹)'),
 ('wallet_max_balance','10000','Wallet maximum balance (₹)')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE public.customer_doc_counters(series text NOT NULL, fy text NOT NULL, last_no int NOT NULL DEFAULT 0, PRIMARY KEY(series,fy));
GRANT ALL ON public.customer_doc_counters TO service_role;
ALTER TABLE public.customer_doc_counters ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.customer_invoices(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 invoice_no text NOT NULL UNIQUE,
 fy text NOT NULL,
 invoice_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
 user_id uuid,
 customer_name text, customer_phone text,
 service text NOT NULL,
 ref_type text NOT NULL, ref_id uuid NOT NULL, ref_code text,
 lines jsonb NOT NULL DEFAULT '[]',
 discount numeric NOT NULL DEFAULT 0,
 taxable_value numeric NOT NULL DEFAULT 0,
 cgst numeric NOT NULL DEFAULT 0, sgst numeric NOT NULL DEFAULT 0, igst numeric NOT NULL DEFAULT 0,
 total numeric NOT NULL DEFAULT 0,
 company jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(ref_type, ref_id)
);
GRANT SELECT ON public.customer_invoices TO authenticated;
GRANT ALL ON public.customer_invoices TO service_role;
ALTER TABLE public.customer_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read invoices" ON public.customer_invoices FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid()));
CREATE INDEX ON public.customer_invoices(user_id); CREATE INDEX ON public.customer_invoices(invoice_date);

CREATE TABLE public.customer_credit_notes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 credit_note_no text NOT NULL UNIQUE,
 fy text NOT NULL,
 note_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
 invoice_id uuid NOT NULL REFERENCES public.customer_invoices(id),
 user_id uuid,
 reason text,
 taxable_value numeric NOT NULL DEFAULT 0,
 cgst numeric NOT NULL DEFAULT 0, sgst numeric NOT NULL DEFAULT 0, igst numeric NOT NULL DEFAULT 0,
 total numeric NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(invoice_id)
);
GRANT SELECT ON public.customer_credit_notes TO authenticated;
GRANT ALL ON public.customer_credit_notes TO service_role;
ALTER TABLE public.customer_credit_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read credit notes" ON public.customer_credit_notes FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid()));

CREATE OR REPLACE FUNCTION public.fin_fy(_d date) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN extract(month FROM _d)>=4 THEN extract(year FROM _d)::int ELSE extract(year FROM _d)::int-1 END || '-' ||
  lpad(((CASE WHEN extract(month FROM _d)>=4 THEN extract(year FROM _d)::int ELSE extract(year FROM _d)::int-1 END + 1) % 100)::text,2,'0') $$;

CREATE OR REPLACE FUNCTION public.fin_next_doc_no(_series text, _d date) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _fy text := public.fin_fy(_d); _n int;
BEGIN
 INSERT INTO customer_doc_counters(series,fy,last_no) VALUES(_series,_fy,1)
 ON CONFLICT(series,fy) DO UPDATE SET last_no=customer_doc_counters.last_no+1 RETURNING last_no INTO _n;
 RETURN _series||'/'||_fy||'/'||lpad(_n::text,6,'0');
END $$;
REVOKE EXECUTE ON FUNCTION public.fin_next_doc_no(text,date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fin_company_snapshot() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_object_agg(replace(key,'company_',''), value),'{}'::jsonb) FROM ops_settings WHERE key LIKE 'company\_%' $$;

-- Core issuer: idempotent per (ref_type, ref_id)
CREATE OR REPLACE FUNCTION public.fin_issue_invoice(_ref_type text, _ref_id uuid, _d date DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _id uuid; _uid uuid; _name text; _phone text; _svc text; _code text; _lines jsonb; _disc numeric:=0; _gst numeric:=0; _total numeric:=0; _taxable numeric:=0; _date date;
 b record; m record; c record;
BEGIN
 SELECT id INTO _id FROM customer_invoices WHERE ref_type=_ref_type AND ref_id=_ref_id; IF _id IS NOT NULL THEN RETURN _id; END IF;
 _date := coalesce(_d, (now() AT TIME ZONE 'Asia/Kolkata')::date);
 IF _ref_type='booking' THEN
  SELECT * INTO b FROM bookings WHERE id=_ref_id; IF NOT FOUND OR coalesce(b.is_training,false) THEN RETURN NULL; END IF;
  _uid:=b.user_id; _code:=left(b.id::text,8);
  _svc := CASE WHEN public.booking_capacity_group(b.service_category_id,b.service_label)='wash' THEN 'clean_auto' ELSE 'clean_home' END;
  _gst:=coalesce(b.gst_amount,0); _total:=coalesce(b.total_amount,b.price,0); _disc:=coalesce(b.discount_amount,0);
  _taxable:=_total-_gst;
  _lines:=jsonb_build_array(jsonb_build_object('desc',coalesce(b.service_label,'Service'),'sac',CASE WHEN _svc='clean_auto' THEN '998714' ELSE '998533' END,
    'taxable',_taxable,'gst_pct',coalesce(b.gst_percent,0),'gst',_gst));
 ELSIF _ref_type='merchant_order' THEN
  SELECT o.*, coalesce(mm.service_type,'store') st INTO m FROM merchant_orders o LEFT JOIN merchants mm ON mm.id=o.merchant_id WHERE o.id=_ref_id;
  IF NOT FOUND OR coalesce(m.is_training,false) THEN RETURN NULL; END IF;
  _uid:=m.user_id; _code:=m.order_number; _svc:=CASE WHEN m.st='food' THEN 'food' ELSE 'store' END;
  _name:=m.customer_name; _phone:=m.customer_phone;
  _lines:='[]'::jsonb;
  IF coalesce(m.item_total,m.items_total,0)>0 THEN _lines:=_lines||jsonb_build_object('desc',CASE WHEN _svc='food' THEN 'Food items' ELSE 'Store items' END,'sac',CASE WHEN _svc='food' THEN '996331' ELSE '' END,
     'taxable',coalesce(m.item_total,m.items_total,0),'gst_pct',coalesce((m.tax_rates_snapshot->>'food_gst_9_5')::numeric, CASE WHEN _svc='food' THEN 5 ELSE 0 END),'gst',coalesce(m.gst_items,0)); END IF;
  IF coalesce(m.delivery_fee,0)>0 THEN _lines:=_lines||jsonb_build_object('desc','Delivery charge','sac','996813','taxable',m.delivery_fee,'gst_pct',coalesce((m.tax_rates_snapshot->>'order_delivery_gst')::numeric,0),'gst',coalesce(m.gst_delivery,0)); END IF;
  IF coalesce(m.platform_fee,0)>0 THEN _lines:=_lines||jsonb_build_object('desc','Platform fee','sac','998599','taxable',m.platform_fee,'gst_pct',coalesce((m.tax_rates_snapshot->>'platform_fee_gst')::numeric,18),'gst',coalesce(m.gst_platform,0)); END IF;
  _gst:=coalesce(m.gst_items,0)+coalesce(m.gst_delivery,0)+coalesce(m.gst_platform,0);
  _total:=coalesce(m.total_payable,m.total_amount,0);
  _taxable:=(SELECT coalesce(sum((l->>'taxable')::numeric),0) FROM jsonb_array_elements(_lines) l);
  _disc:=greatest(0,_taxable+_gst-_total);
 ELSIF _ref_type='courier_order' THEN
  SELECT * INTO c FROM courier_orders WHERE id=_ref_id;
  IF NOT FOUND OR c.business_merchant_id IS NOT NULL OR c.merchant_order_id IS NOT NULL OR c.store_order_id IS NOT NULL THEN RETURN NULL; END IF;
  _uid:=c.customer_id; _code:=c.order_code; _svc:='parcel';
  _gst:=coalesce(c.gst_amount,0); _total:=coalesce(c.total_amount,0); _disc:=coalesce(c.discount_amount,0); _taxable:=_total-_gst;
  _lines:=jsonb_build_array(jsonb_build_object('desc','Parcel delivery','sac','996813','taxable',_taxable,'gst_pct',coalesce(c.gst_percent,0),'gst',_gst));
 ELSE RETURN NULL; END IF;
 IF _total<=0 THEN RETURN NULL; END IF;
 IF _name IS NULL OR _phone IS NULL THEN SELECT coalesce(_name,full_name), coalesce(_phone,phone) INTO _name,_phone FROM users WHERE id=_uid; END IF;
 INSERT INTO customer_invoices(invoice_no,fy,invoice_date,user_id,customer_name,customer_phone,service,ref_type,ref_id,ref_code,lines,discount,taxable_value,cgst,sgst,total,company)
 VALUES(fin_next_doc_no('BDS',_date),fin_fy(_date),_date,_uid,_name,_phone,_svc,_ref_type,_ref_id,_code,_lines,_disc,round(_taxable,2),round(_gst/2,2),_gst-round(_gst/2,2),_total,fin_company_snapshot())
 ON CONFLICT(ref_type,ref_id) DO NOTHING RETURNING id INTO _id;
 RETURN _id;
END $$;
REVOKE EXECUTE ON FUNCTION public.fin_issue_invoice(text,uuid,date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fin_issue_credit_note(_ref_type text, _ref_id uuid, _amount numeric, _reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE i customer_invoices; _id uuid; _r numeric; _gst numeric; _amt numeric; _d date:=(now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
 SELECT * INTO i FROM customer_invoices WHERE ref_type=_ref_type AND ref_id=_ref_id; IF NOT FOUND OR i.total<=0 THEN RETURN NULL; END IF;
 _amt:=least(coalesce(nullif(_amount,0),i.total),i.total); _r:=_amt/i.total; _gst:=round((i.cgst+i.sgst+i.igst)*_r,2);
 INSERT INTO customer_credit_notes(credit_note_no,fy,note_date,invoice_id,user_id,reason,taxable_value,cgst,sgst,total)
 VALUES(fin_next_doc_no('BDCN',_d),fin_fy(_d),_d,i.id,i.user_id,_reason,_amt-_gst,round(_gst/2,2),_gst-round(_gst/2,2),_amt)
 ON CONFLICT(invoice_id) DO NOTHING RETURNING id INTO _id; RETURN _id;
END $$;
REVOKE EXECUTE ON FUNCTION public.fin_issue_credit_note(text,uuid,numeric,text) FROM PUBLIC, anon, authenticated;

-- Triggers: never block the order on failure
CREATE OR REPLACE FUNCTION public.fin_invoice_trg() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _rt text := TG_ARGV[0]; _done boolean; _was boolean;
BEGIN
 BEGIN
  _done := lower(NEW.status) IN ('completed','delivered');
  _was := TG_OP='UPDATE' AND lower(coalesce(OLD.status,'')) IN ('completed','delivered');
  IF _done AND NOT _was THEN PERFORM fin_issue_invoice(_rt, NEW.id); END IF;
  IF NEW.refund_status='done' AND (TG_OP='INSERT' OR coalesce(OLD.refund_status,'')<>'done') THEN
   PERFORM fin_issue_credit_note(_rt, NEW.id, NEW.refund_amount, 'Refund'); END IF;
 EXCEPTION WHEN OTHERS THEN RAISE WARNING 'invoice issue failed %: %', NEW.id, SQLERRM; END;
 RETURN NEW;
END $$;
CREATE TRIGGER fin_invoice_booking AFTER UPDATE OF status, refund_status ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.fin_invoice_trg('booking');
CREATE TRIGGER fin_invoice_merchant AFTER UPDATE OF status, refund_status ON public.merchant_orders FOR EACH ROW EXECUTE FUNCTION public.fin_invoice_trg('merchant_order');
CREATE TRIGGER fin_invoice_courier AFTER UPDATE OF status, refund_status ON public.courier_orders FOR EACH ROW EXECUTE FUNCTION public.fin_invoice_trg('courier_order');

-- Backfill current FY
DO $$ DECLARE r record; _fy date := make_date(CASE WHEN extract(month FROM now())>=4 THEN extract(year FROM now())::int ELSE extract(year FROM now())::int-1 END,4,1);
BEGIN
 FOR r IN SELECT id, coalesce(service_end_at,updated_at)::date d FROM bookings WHERE status='completed' AND deleted_at IS NULL AND coalesce(service_end_at,updated_at)>=_fy ORDER BY 2 LOOP
  BEGIN PERFORM fin_issue_invoice('booking',r.id,r.d); EXCEPTION WHEN OTHERS THEN NULL; END; END LOOP;
 FOR r IN SELECT id, coalesce(delivered_at,updated_at)::date d FROM merchant_orders WHERE lower(status) IN ('delivered','completed') AND coalesce(delivered_at,updated_at)>=_fy ORDER BY 2 LOOP
  BEGIN PERFORM fin_issue_invoice('merchant_order',r.id,r.d); EXCEPTION WHEN OTHERS THEN NULL; END; END LOOP;
 FOR r IN SELECT id, coalesce(completed_at,updated_at)::date d FROM courier_orders WHERE upper(status)='COMPLETED' AND coalesce(completed_at,updated_at)>=_fy ORDER BY 2 LOOP
  BEGIN PERFORM fin_issue_invoice('courier_order',r.id,r.d); EXCEPTION WHEN OTHERS THEN NULL; END; END LOOP;
END $$;

-- Staff + customer reads
CREATE OR REPLACE FUNCTION public.staff_list_customer_invoices(_from date, _to date, _service text DEFAULT NULL, _q text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.is_active_staff(auth.uid()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 RETURN jsonb_build_object(
  'invoices',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.invoice_no DESC),'[]') FROM (SELECT * FROM customer_invoices WHERE invoice_date BETWEEN _from AND _to
     AND (_service IS NULL OR service=_service) AND (_q IS NULL OR invoice_no ILIKE '%'||_q||'%' OR ref_code ILIKE '%'||_q||'%' OR customer_phone ILIKE '%'||_q||'%' OR customer_name ILIKE '%'||_q||'%') ORDER BY invoice_no DESC LIMIT 1000) i),
  'credit_notes',(SELECT coalesce(jsonb_agg(to_jsonb(n)||jsonb_build_object('invoice_no',i.invoice_no,'customer_name',i.customer_name,'service',i.service,'ref_code',i.ref_code) ORDER BY n.credit_note_no DESC),'[]')
     FROM customer_credit_notes n JOIN customer_invoices i ON i.id=n.invoice_id WHERE n.note_date BETWEEN _from AND _to AND (_service IS NULL OR i.service=_service)),
  'visible',(SELECT value='true' FROM ops_settings WHERE key='customer_invoices_visible'));
END $$;

CREATE OR REPLACE FUNCTION public.customer_list_invoices() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
 IF coalesce((SELECT value FROM ops_settings WHERE key='customer_invoices_visible'),'false')<>'true' THEN RETURN jsonb_build_object('enabled',false,'invoices','[]'::jsonb,'credit_notes','[]'::jsonb); END IF;
 RETURN jsonb_build_object('enabled',true,
  'invoices',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.invoice_date DESC),'[]') FROM customer_invoices i WHERE user_id=auth.uid()),
  'credit_notes',(SELECT coalesce(jsonb_agg(to_jsonb(n)||jsonb_build_object('invoice_no',i.invoice_no)),'[]') FROM customer_credit_notes n JOIN customer_invoices i ON i.id=n.invoice_id WHERE n.user_id=auth.uid()));
END $$;

CREATE OR REPLACE FUNCTION public.staff_set_finance_flag(_key text, _value boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _old text;
BEGIN
 IF NOT public.is_super_admin_user() THEN RAISE EXCEPTION 'Super admin only'; END IF;
 IF _key NOT IN ('customer_invoices_visible','customer_wallet_enabled') THEN RAISE EXCEPTION 'Unknown setting'; END IF;
 SELECT value INTO _old FROM ops_settings WHERE key=_key;
 UPDATE ops_settings SET value=_value::text, updated_at=now() WHERE key=_key;
 INSERT INTO audit_logs(actor_id,action,table_name,old_data,new_data) VALUES(auth.uid(),'finance_flag_changed','ops_settings',jsonb_build_object(_key,_old),jsonb_build_object(_key,_value));
END $$;

-- ================= WALLET =================
CREATE TABLE public.customer_wallets(
 user_id uuid PRIMARY KEY, cash_balance numeric NOT NULL DEFAULT 0, bonus_balance numeric NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.customer_wallets TO authenticated; GRANT ALL ON public.customer_wallets TO service_role;
ALTER TABLE public.customer_wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own or staff wallet" ON public.customer_wallets FOR SELECT TO authenticated USING (user_id=auth.uid() OR public.is_active_staff(auth.uid()));

CREATE TABLE public.customer_wallet_ledger(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
 type text NOT NULL CHECK (type IN ('top_up','payment','refund_in','bonus','bonus_expiry','admin_adjustment')),
 bucket text NOT NULL CHECK (bucket IN ('cash','bonus')),
 amount numeric NOT NULL, cash_after numeric NOT NULL, bonus_after numeric NOT NULL,
 ref_type text, ref_id text, reason text, expires_at timestamptz, expired boolean NOT NULL DEFAULT false,
 created_by uuid, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.customer_wallet_ledger TO authenticated; GRANT ALL ON public.customer_wallet_ledger TO service_role;
ALTER TABLE public.customer_wallet_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own or staff ledger" ON public.customer_wallet_ledger FOR SELECT TO authenticated USING (user_id=auth.uid() OR public.is_active_staff(auth.uid()));
CREATE INDEX ON public.customer_wallet_ledger(user_id, created_at DESC);
CREATE UNIQUE INDEX customer_wallet_ledger_ref_uq ON public.customer_wallet_ledger(type, bucket, ref_type, ref_id) WHERE ref_id IS NOT NULL AND type IN ('top_up','bonus','refund_in','payment');

CREATE TABLE public.wallet_bonus_rules(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
 min_topup numeric NOT NULL DEFAULT 100, bonus_type text NOT NULL DEFAULT 'flat' CHECK (bonus_type IN ('flat','percent')),
 bonus_value numeric NOT NULL DEFAULT 0, max_bonus numeric, validity_days int NOT NULL DEFAULT 30,
 starts_at date, ends_at date, is_active boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.wallet_bonus_rules TO authenticated; GRANT ALL ON public.wallet_bonus_rules TO service_role;
ALTER TABLE public.wallet_bonus_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read bonus rules" ON public.wallet_bonus_rules FOR SELECT TO authenticated USING (true);

CREATE TABLE public.wallet_topups(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, amount numeric NOT NULL,
 razorpay_order_id text UNIQUE, razorpay_payment_id text, status text NOT NULL DEFAULT 'created',
 bonus_rule_id uuid, created_at timestamptz NOT NULL DEFAULT now(), paid_at timestamptz);
GRANT SELECT ON public.wallet_topups TO authenticated; GRANT ALL ON public.wallet_topups TO service_role;
ALTER TABLE public.wallet_topups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own or staff topups" ON public.wallet_topups FOR SELECT TO authenticated USING (user_id=auth.uid() OR public.is_active_staff(auth.uid()));

-- internal posting
CREATE OR REPLACE FUNCTION public.wallet_post(_uid uuid, _type text, _bucket text, _amount numeric, _ref_type text, _ref_id text, _reason text, _expires timestamptz, _by uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE w customer_wallets; _max numeric := coalesce((SELECT value::numeric FROM ops_settings WHERE key='wallet_max_balance'),10000);
BEGIN
 INSERT INTO customer_wallets(user_id) VALUES(_uid) ON CONFLICT DO NOTHING;
 SELECT * INTO w FROM customer_wallets WHERE user_id=_uid FOR UPDATE;
 IF _bucket='cash' THEN w.cash_balance:=w.cash_balance+_amount; ELSE w.bonus_balance:=w.bonus_balance+_amount; END IF;
 IF w.cash_balance<0 OR w.bonus_balance<0 THEN RAISE EXCEPTION 'Insufficient wallet balance'; END IF;
 IF _amount>0 AND _type IN ('top_up','admin_adjustment') AND w.cash_balance+w.bonus_balance>_max THEN RAISE EXCEPTION 'Wallet balance cannot exceed ₹%', _max; END IF;
 UPDATE customer_wallets SET cash_balance=w.cash_balance, bonus_balance=w.bonus_balance, updated_at=now() WHERE user_id=_uid;
 INSERT INTO customer_wallet_ledger(user_id,type,bucket,amount,cash_after,bonus_after,ref_type,ref_id,reason,expires_at,created_by)
 VALUES(_uid,_type,_bucket,_amount,w.cash_balance,w.bonus_balance,_ref_type,_ref_id,_reason,_expires,_by);
 RETURN jsonb_build_object('cash',w.cash_balance,'bonus',w.bonus_balance);
END $$;
REVOKE EXECUTE ON FUNCTION public.wallet_post(uuid,text,text,numeric,text,text,text,timestamptz,uuid) FROM PUBLIC, anon, authenticated;

-- customer: balance + history
CREATE OR REPLACE FUNCTION public.customer_wallet_get() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
 RETURN jsonb_build_object(
  'enabled', coalesce((SELECT value FROM ops_settings WHERE key='customer_wallet_enabled'),'false')='true',
  'cash',coalesce((SELECT cash_balance FROM customer_wallets WHERE user_id=auth.uid()),0),
  'bonus',coalesce((SELECT bonus_balance FROM customer_wallets WHERE user_id=auth.uid()),0),
  'limits',(SELECT jsonb_object_agg(key,value::numeric) FROM ops_settings WHERE key IN ('wallet_topup_min','wallet_topup_max','wallet_max_balance')),
  'bonus_rules',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',name,'min_topup',min_topup,'bonus_type',bonus_type,'bonus_value',bonus_value,'max_bonus',max_bonus,'validity_days',validity_days)),'[]') FROM wallet_bonus_rules
     WHERE is_active AND (starts_at IS NULL OR starts_at<=current_date) AND (ends_at IS NULL OR ends_at>=current_date)),
  'history',(SELECT coalesce(jsonb_agg(to_jsonb(l) - 'created_by' ORDER BY l.created_at DESC),'[]') FROM (SELECT * FROM customer_wallet_ledger WHERE user_id=auth.uid() ORDER BY created_at DESC LIMIT 100) l));
END $$;

-- customer: start top-up (called by server route as the customer)
CREATE OR REPLACE FUNCTION public.customer_wallet_start_topup(_amount numeric) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _min numeric; _max numeric; _cap numeric; _bal numeric; _id uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
 IF coalesce((SELECT value FROM ops_settings WHERE key='customer_wallet_enabled'),'false')<>'true' THEN RETURN jsonb_build_object('ok',false,'error','WALLET_DISABLED'); END IF;
 SELECT (SELECT value::numeric FROM ops_settings WHERE key='wallet_topup_min'),(SELECT value::numeric FROM ops_settings WHERE key='wallet_topup_max'),(SELECT value::numeric FROM ops_settings WHERE key='wallet_max_balance') INTO _min,_max,_cap;
 IF _amount IS NULL OR _amount<_min OR _amount>_max OR _amount<>round(_amount) THEN RETURN jsonb_build_object('ok',false,'error','AMOUNT_OUT_OF_RANGE','min',_min,'max',_max); END IF;
 SELECT coalesce(cash_balance+bonus_balance,0) INTO _bal FROM customer_wallets WHERE user_id=auth.uid();
 IF coalesce(_bal,0)+_amount>_cap THEN RETURN jsonb_build_object('ok',false,'error','MAX_BALANCE','max_balance',_cap); END IF;
 INSERT INTO wallet_topups(user_id,amount) VALUES(auth.uid(),_amount) RETURNING id INTO _id;
 RETURN jsonb_build_object('ok',true,'id',_id,'amount',_amount);
END $$;

CREATE OR REPLACE FUNCTION public.system_set_wallet_topup_order(_id uuid, _order_id text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 UPDATE wallet_topups SET razorpay_order_id=_order_id WHERE id=_id AND razorpay_order_id IS NULL $$;
REVOKE EXECUTE ON FUNCTION public.system_set_wallet_topup_order(uuid,text) FROM PUBLIC, anon, authenticated;

-- service role only: credit after Razorpay confirms (idempotent)
CREATE OR REPLACE FUNCTION public.system_confirm_wallet_topup(_razorpay_order_id text, _payment_id text, _amount_paise bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t wallet_topups; r wallet_bonus_rules; _bonus numeric:=0; _res jsonb;
BEGIN
 SELECT * INTO t FROM wallet_topups WHERE razorpay_order_id=_razorpay_order_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','NOT_FOUND'); END IF;
 IF t.status='paid' THEN RETURN jsonb_build_object('ok',true,'already',true); END IF;
 IF round(t.amount*100)<>_amount_paise THEN RETURN jsonb_build_object('ok',false,'error','AMOUNT_MISMATCH'); END IF;
 _res := wallet_post(t.user_id,'top_up','cash',t.amount,'wallet_topup',t.id::text,'Wallet top-up',NULL,NULL);
 SELECT * INTO r FROM wallet_bonus_rules WHERE is_active AND min_topup<=t.amount AND (starts_at IS NULL OR starts_at<=current_date) AND (ends_at IS NULL OR ends_at>=current_date)
  ORDER BY CASE WHEN bonus_type='flat' THEN bonus_value ELSE least(t.amount*bonus_value/100, coalesce(max_bonus,1e9)) END DESC LIMIT 1;
 IF FOUND THEN
  _bonus := round(CASE WHEN r.bonus_type='flat' THEN r.bonus_value ELSE least(t.amount*r.bonus_value/100, coalesce(r.max_bonus,1e9)) END);
  IF _bonus>0 THEN _res := wallet_post(t.user_id,'bonus','bonus',_bonus,'wallet_topup',t.id::text,r.name,now()+make_interval(days=>r.validity_days),NULL); END IF;
 END IF;
 UPDATE wallet_topups SET status='paid', razorpay_payment_id=_payment_id, paid_at=now(), bonus_rule_id=r.id WHERE id=t.id;
 RETURN jsonb_build_object('ok',true,'balance',_res,'bonus',_bonus);
END $$;
REVOKE EXECUTE ON FUNCTION public.system_confirm_wallet_topup(text,text,bigint) FROM PUBLIC, anon, authenticated;

-- customer pays from wallet: bonus first, then cash
CREATE OR REPLACE FUNCTION public.customer_wallet_pay(_ref_type text, _ref_id text, _amount numeric) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE w customer_wallets; _b numeric; _c numeric;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
 IF _ref_type NOT IN ('booking','merchant_order','courier_order') OR _amount IS NULL OR _amount<=0 THEN RAISE EXCEPTION 'Bad request'; END IF;
 SELECT * INTO w FROM customer_wallets WHERE user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND OR w.cash_balance+w.bonus_balance<_amount THEN RETURN jsonb_build_object('ok',false,'error','INSUFFICIENT_BALANCE'); END IF;
 _b:=least(w.bonus_balance,_amount); _c:=_amount-_b;
 IF _b>0 THEN PERFORM wallet_post(auth.uid(),'payment','bonus',-_b,_ref_type,_ref_id,'Payment',NULL,auth.uid()); END IF;
 IF _c>0 THEN PERFORM wallet_post(auth.uid(),'payment','cash',-_c,_ref_type,_ref_id,'Payment',NULL,auth.uid()); END IF;
 RETURN jsonb_build_object('ok',true,'from_bonus',_b,'from_cash',_c);
END $$;

-- staff
CREATE OR REPLACE FUNCTION public.staff_wallet_overview(_q text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.is_active_staff(auth.uid()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 RETURN jsonb_build_object(
  'enabled', coalesce((SELECT value FROM ops_settings WHERE key='customer_wallet_enabled'),'false')='true',
  'totals',(SELECT jsonb_build_object('cash',coalesce(sum(cash_balance),0),'bonus',coalesce(sum(bonus_balance),0),'wallets',count(*) FILTER (WHERE cash_balance+bonus_balance>0)) FROM customer_wallets),
  'wallets',(SELECT coalesce(jsonb_agg(x ORDER BY (x->>'cash')::numeric+(x->>'bonus')::numeric DESC),'[]') FROM (
     SELECT jsonb_build_object('user_id',w.user_id,'name',u.full_name,'phone',u.phone,'cash',w.cash_balance,'bonus',w.bonus_balance,'updated_at',w.updated_at) x
     FROM customer_wallets w LEFT JOIN users u ON u.id=w.user_id
     WHERE _q IS NULL OR u.phone ILIKE '%'||_q||'%' OR u.full_name ILIKE '%'||_q||'%' LIMIT 500) s),
  'rules',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC),'[]') FROM wallet_bonus_rules r));
END $$;

CREATE OR REPLACE FUNCTION public.staff_wallet_ledger(_user_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.is_active_staff(auth.uid()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.created_at DESC),'[]') FROM (SELECT * FROM customer_wallet_ledger WHERE user_id=_user_id ORDER BY created_at DESC LIMIT 500) l);
END $$;

CREATE OR REPLACE FUNCTION public.staff_find_customer(_phone text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.is_active_staff(auth.uid()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',id,'name',full_name,'phone',phone)),'[]') FROM (SELECT * FROM users WHERE deleted_at IS NULL AND phone ILIKE '%'||_phone||'%' LIMIT 10) u);
END $$;

CREATE OR REPLACE FUNCTION public.staff_wallet_adjust(_user_id uuid, _bucket text, _amount numeric, _reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _res jsonb;
BEGIN
 IF NOT public.is_super_admin_user() THEN RAISE EXCEPTION 'Super admin only'; END IF;
 IF coalesce(length(trim(_reason)),0)<3 THEN RAISE EXCEPTION 'Reason required'; END IF;
 IF _bucket NOT IN ('cash','bonus') OR _amount IS NULL OR _amount=0 THEN RAISE EXCEPTION 'Bad amount'; END IF;
 _res := wallet_post(_user_id,'admin_adjustment',_bucket,_amount,NULL,NULL,_reason,NULL,auth.uid());
 INSERT INTO audit_logs(actor_id,action,table_name,record_id,new_data) VALUES(auth.uid(),'wallet_adjusted','customer_wallets',_user_id,jsonb_build_object('bucket',_bucket,'amount',_amount,'reason',_reason,'balance',_res));
 RETURN _res;
END $$;

CREATE OR REPLACE FUNCTION public.staff_wallet_refund_in(_user_id uuid, _ref_type text, _ref_id text, _amount numeric, _reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _res jsonb;
BEGIN
 IF NOT public.is_super_admin_user() THEN RAISE EXCEPTION 'Super admin only'; END IF;
 IF _amount IS NULL OR _amount<=0 THEN RAISE EXCEPTION 'Bad amount'; END IF;
 _res := wallet_post(_user_id,'refund_in','cash',_amount,_ref_type,_ref_id,coalesce(_reason,'Refund'),NULL,auth.uid());
 INSERT INTO audit_logs(actor_id,action,table_name,record_id,new_data) VALUES(auth.uid(),'wallet_refund_in','customer_wallets',_user_id,jsonb_build_object('ref',_ref_id,'amount',_amount));
 RETURN _res;
END $$;

CREATE OR REPLACE FUNCTION public.staff_save_wallet_bonus_rule(_id uuid, _p jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _rid uuid;
BEGIN
 IF NOT public.is_super_admin_user() THEN RAISE EXCEPTION 'Super admin only'; END IF;
 IF coalesce(_p->>'name','')='' THEN RAISE EXCEPTION 'Name required'; END IF;
 IF _id IS NULL THEN
  INSERT INTO wallet_bonus_rules(name,min_topup,bonus_type,bonus_value,max_bonus,validity_days,starts_at,ends_at,is_active)
  VALUES(_p->>'name',(_p->>'min_topup')::numeric,coalesce(_p->>'bonus_type','flat'),(_p->>'bonus_value')::numeric,nullif(_p->>'max_bonus','')::numeric,coalesce((_p->>'validity_days')::int,30),nullif(_p->>'starts_at','')::date,nullif(_p->>'ends_at','')::date,coalesce((_p->>'is_active')::boolean,false))
  RETURNING id INTO _rid;
 ELSE
  UPDATE wallet_bonus_rules SET name=_p->>'name',min_topup=(_p->>'min_topup')::numeric,bonus_type=coalesce(_p->>'bonus_type','flat'),bonus_value=(_p->>'bonus_value')::numeric,max_bonus=nullif(_p->>'max_bonus','')::numeric,
   validity_days=coalesce((_p->>'validity_days')::int,30),starts_at=nullif(_p->>'starts_at','')::date,ends_at=nullif(_p->>'ends_at','')::date,is_active=coalesce((_p->>'is_active')::boolean,false),updated_at=now() WHERE id=_id RETURNING id INTO _rid;
 END IF;
 INSERT INTO audit_logs(actor_id,action,table_name,record_id,new_data) VALUES(auth.uid(),'wallet_bonus_rule_saved','wallet_bonus_rules',_rid,_p);
 RETURN _rid;
END $$;

-- daily bonus expiry
CREATE OR REPLACE FUNCTION public.wallet_expire_bonuses() RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record; _n int:=0; _amt numeric;
BEGIN
 FOR r IN SELECT * FROM customer_wallet_ledger WHERE type='bonus' AND NOT expired AND expires_at<now() ORDER BY created_at LOOP
  SELECT least(r.amount, bonus_balance) INTO _amt FROM customer_wallets WHERE user_id=r.user_id;
  IF coalesce(_amt,0)>0 THEN PERFORM wallet_post(r.user_id,'bonus_expiry','bonus',-_amt,'bonus',r.id::text,'Bonus expired',NULL,NULL); _n:=_n+1; END IF;
  UPDATE customer_wallet_ledger SET expired=true WHERE id=r.id;
 END LOOP; RETURN _n;
END $$;
REVOKE EXECUTE ON FUNCTION public.wallet_expire_bonuses() FROM PUBLIC, anon, authenticated;
SELECT cron.schedule('wallet-expire-bonuses','45 18 * * *','SELECT public.wallet_expire_bonuses()');
