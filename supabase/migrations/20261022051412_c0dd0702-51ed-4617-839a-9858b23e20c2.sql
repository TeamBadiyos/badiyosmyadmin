CREATE OR REPLACE FUNCTION public.staff_manual_adjustment_ids(_owner_id uuid)
RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_active_staff(auth.uid(),ARRAY['super_admin']) THEN RAISE EXCEPTION 'Super Admin only' USING ERRCODE='42501'; END IF;
 RETURN ARRAY(SELECT l.id FROM public.wallet_ledger l WHERE l.owner_type='expert' AND l.owner_id=_owner_id AND EXISTS (SELECT 1 FROM public.audit_logs a WHERE a.action='wallet_adjust' AND a.target_table='wallet_ledger' AND a.target_id=l.id));
END $$;
REVOKE ALL ON FUNCTION public.staff_manual_adjustment_ids(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_manual_adjustment_ids(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.staff_edit_wallet_adjustment(_ledger_id uuid,_amount numeric,_type text,_reason text,_adjustment_date date,_expected jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE _old public.wallet_ledger; _new public.wallet_ledger; _delta numeric; _balance numeric;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_active_staff(auth.uid(),ARRAY['super_admin']) THEN RAISE EXCEPTION 'Super Admin only' USING ERRCODE='42501'; END IF;
 IF _amount IS NULL OR _amount<=0 OR _amount::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
 IF _type IS NULL OR _type NOT IN ('credit','debit') THEN RAISE EXCEPTION 'Invalid type'; END IF;
 IF nullif(btrim(_reason),'') IS NULL THEN RAISE EXCEPTION 'Reason required'; END IF;
 IF _adjustment_date IS NULL OR NOT isfinite(_adjustment_date) THEN RAISE EXCEPTION 'Adjustment date required'; END IF;
 SELECT * INTO _old FROM public.wallet_ledger WHERE id=_ledger_id FOR UPDATE;
 IF _old.id IS NULL THEN RAISE EXCEPTION 'Adjustment not found'; END IF;
 IF _old.owner_type<>'expert' OR NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE action='wallet_adjust' AND target_table='wallet_ledger' AND target_id=_ledger_id) THEN RAISE EXCEPTION 'Only manual adjustments can be edited'; END IF;
 IF _expected IS NULL OR jsonb_build_object('amount',_old.amount,'type',_old.type,'reason',_old.reason,'adjustment_date',_old.adjustment_date) IS DISTINCT FROM _expected THEN RAISE EXCEPTION 'Adjustment changed. Refresh and try again'; END IF;
 SELECT wallet_balance INTO _balance FROM public.experts WHERE id=_old.owner_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Expert not found'; END IF;
 IF EXISTS(SELECT 1 FROM public.payout_batch_items i JOIN public.payout_batches b ON b.id=i.batch_id WHERE _ledger_id=ANY(i.ledger_ids) AND b.status<>'discarded' AND NOT coalesce(i.removed,false)) THEN RAISE EXCEPTION 'Adjustment is included in a payout batch and cannot be changed'; END IF;
 _delta := (CASE WHEN _type='credit' THEN _amount ELSE -_amount END) - (CASE WHEN _old.type='credit' THEN _old.amount ELSE -_old.amount END);
 UPDATE public.wallet_ledger SET amount=_amount,type=_type,reason=btrim(_reason),adjustment_date=_adjustment_date WHERE id=_ledger_id RETURNING * INTO _new;
 UPDATE public.experts SET wallet_balance=coalesce(wallet_balance,0)+_delta WHERE id=_old.owner_id;
 INSERT INTO public.audit_logs(actor_id,action,target_table,target_id,before_state,after_state) VALUES(auth.uid(),'wallet_adjust_edit','wallet_ledger',_ledger_id,to_jsonb(_old)||jsonb_build_object('wallet_balance',_balance),to_jsonb(_new)||jsonb_build_object('wallet_balance',coalesce(_balance,0)+_delta));
END $$;
REVOKE ALL ON FUNCTION public.staff_edit_wallet_adjustment(uuid,numeric,text,text,date,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_edit_wallet_adjustment(uuid,numeric,text,text,date,jsonb) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.staff_delete_wallet_adjustment(_ledger_id uuid,_reason text,_expected jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE _old public.wallet_ledger; _balance numeric; _delta numeric;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_active_staff(auth.uid(),ARRAY['super_admin']) THEN RAISE EXCEPTION 'Super Admin only' USING ERRCODE='42501'; END IF;
 IF nullif(btrim(_reason),'') IS NULL THEN RAISE EXCEPTION 'Deletion reason required'; END IF;
 SELECT * INTO _old FROM public.wallet_ledger WHERE id=_ledger_id FOR UPDATE;
 IF _old.id IS NULL THEN RAISE EXCEPTION 'Adjustment not found'; END IF;
 IF _old.owner_type<>'expert' OR NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE action='wallet_adjust' AND target_table='wallet_ledger' AND target_id=_ledger_id) THEN RAISE EXCEPTION 'Only manual adjustments can be deleted'; END IF;
 IF _expected IS NULL OR jsonb_build_object('amount',_old.amount,'type',_old.type,'reason',_old.reason,'adjustment_date',_old.adjustment_date) IS DISTINCT FROM _expected THEN RAISE EXCEPTION 'Adjustment changed. Refresh and try again'; END IF;
 SELECT wallet_balance INTO _balance FROM public.experts WHERE id=_old.owner_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Expert not found'; END IF;
 IF EXISTS(SELECT 1 FROM public.payout_batch_items i JOIN public.payout_batches b ON b.id=i.batch_id WHERE _ledger_id=ANY(i.ledger_ids) AND b.status<>'discarded' AND NOT coalesce(i.removed,false)) THEN RAISE EXCEPTION 'Adjustment is included in a payout batch and cannot be deleted'; END IF;
 _delta:=CASE WHEN _old.type='credit' THEN -_old.amount ELSE _old.amount END;
 DELETE FROM public.wallet_ledger WHERE id=_ledger_id;
 UPDATE public.experts SET wallet_balance=coalesce(wallet_balance,0)+_delta WHERE id=_old.owner_id;
 INSERT INTO public.audit_logs(actor_id,action,target_table,target_id,before_state,after_state) VALUES(auth.uid(),'wallet_adjust_delete','wallet_ledger',_ledger_id,to_jsonb(_old)||jsonb_build_object('wallet_balance',_balance),jsonb_build_object('deleted',true,'reason',btrim(_reason),'owner_id',_old.owner_id,'wallet_balance',coalesce(_balance,0)+_delta));
END $$;
REVOKE ALL ON FUNCTION public.staff_delete_wallet_adjustment(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_delete_wallet_adjustment(uuid,text,jsonb) TO authenticated,service_role;