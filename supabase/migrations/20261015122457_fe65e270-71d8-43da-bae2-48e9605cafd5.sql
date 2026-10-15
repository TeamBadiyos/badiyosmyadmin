CREATE OR REPLACE FUNCTION public.settlement_next_invoice(_d date)
RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_year int := extract(year FROM (_d - interval '3 months'))::int; v_fy text; v_no int;
BEGIN
  v_fy := v_year::text || '-' || right((v_year+1)::text,2);
  INSERT INTO public.merchant_invoice_counters AS mic (fy, last_no) VALUES (v_fy, 1)
  ON CONFLICT ON CONSTRAINT merchant_invoice_counters_pkey DO UPDATE SET last_no = mic.last_no + 1
  RETURNING mic.last_no INTO v_no;
  RETURN ARRAY['BDC/' || v_fy || '/' || lpad(v_no::text,5,'0'), v_fy];
END $$;

CREATE OR REPLACE FUNCTION public.merchant_orders_refund_adjustment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.refund_status = 'done' AND OLD.refund_status IS DISTINCT FROM 'done'
     AND EXISTS (SELECT 1 FROM public.merchant_settlement_items msi WHERE msi.order_id = NEW.id) THEN
    INSERT INTO public.merchant_settlement_adjustments(store_id, order_id, amount)
    VALUES (NEW.merchant_id, NEW.id, -abs(coalesce(NEW.merchant_net,0)))
    ON CONFLICT (order_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;