CREATE OR REPLACE FUNCTION public.admin_decide_bank_change(_request_id uuid, _approve boolean, _reason text DEFAULT NULL::text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r public.merchant_bank_change_requests; m public.merchants;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','finance']) THEN RAISE EXCEPTION 'Only Super Admin or Finance can decide bank changes'; END IF;
  SELECT * INTO r FROM public.merchant_bank_change_requests WHERE id=_request_id FOR UPDATE;
  IF r.id IS NULL OR r.status<>'pending' THEN RAISE EXCEPTION 'Request is not pending'; END IF;
  IF NOT _approve AND btrim(coalesce(_reason,''))='' THEN RAISE EXCEPTION 'Reason required'; END IF;
  SELECT * INTO m FROM public.merchants WHERE id=r.merchant_id;
  UPDATE public.merchant_bank_change_requests SET status=CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
    rejection_reason=CASE WHEN _approve THEN NULL ELSE btrim(_reason) END, decided_by=auth.uid(), decided_at=now(), updated_at=now() WHERE id=r.id;
  IF _approve THEN
    UPDATE public.merchants SET bank_account_holder_name=r.account_holder_name, bank_account_number=r.account_number, bank_ifsc=r.ifsc WHERE id=r.merchant_id;
  END IF;
  INSERT INTO public.audit_logs(actor_id,action,target_table,target_id,before_state,after_state)
  VALUES(auth.uid(),CASE WHEN _approve THEN 'merchant_bank_change_approved' ELSE 'merchant_bank_change_rejected' END,'merchant_bank_change_requests',r.id,
    jsonb_build_object('merchant_id',r.merchant_id,'holder',m.bank_account_holder_name,'last4',right(coalesce(m.bank_account_number,''),4),'ifsc',m.bank_ifsc),
    jsonb_build_object('merchant_id',r.merchant_id,'holder',r.account_holder_name,'last4',right(r.account_number,4),'ifsc',r.ifsc,'reason',_reason));
  PERFORM public.party_notify('merchant',r.merchant_id,'bank_change_decided',
    CASE WHEN _approve THEN 'Bank change approved' ELSE 'Bank change rejected' END,
    CASE WHEN _approve THEN 'Payouts will now go to ••••'||right(r.account_number,4)||'.' ELSE 'Reason: '||btrim(_reason) END,
    jsonb_build_object('request_id',r.id));
END $function$;