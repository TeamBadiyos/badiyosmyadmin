CREATE OR REPLACE FUNCTION public.staff_partner_batch_delete(_batch_id uuid, _reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := public.partner_require_admin(); _st text;
BEGIN
  IF btrim(COALESCE(_reason,''))='' THEN RAISE EXCEPTION 'Reason required'; END IF;
  SELECT status INTO _st FROM public.partner_payout_batches WHERE id=_batch_id;
  IF _st IS NULL THEN RAISE EXCEPTION 'Batch not found'; END IF;
  IF _st NOT IN ('draft','approved') THEN RAISE EXCEPTION 'Only draft or approved (unpaid) batches can be deleted'; END IF;
  UPDATE public.partner_payout_lines SET is_deleted=true, delete_reason=COALESCE(delete_reason, 'Batch deleted: '||btrim(_reason)) WHERE batch_id=_batch_id AND NOT is_deleted;
  UPDATE public.partner_payout_batches SET status='deleted', deleted_at=now(), delete_reason=btrim(_reason) WHERE id=_batch_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid,'partner_payout_batch_delete','partner_payout_batches',_batch_id, jsonb_build_object('status',_st),
          jsonb_build_object('status','deleted','reason',btrim(_reason)));
END $$;