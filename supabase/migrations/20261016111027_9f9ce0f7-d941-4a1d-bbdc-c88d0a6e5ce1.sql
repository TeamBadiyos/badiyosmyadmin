CREATE OR REPLACE FUNCTION public.fin_invoice_trg() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _rt text := TG_ARGV[0]; _now boolean; _before boolean;
BEGIN
 IF coalesce((to_jsonb(NEW)->>'is_training')::boolean, false) THEN RETURN NEW; END IF;
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