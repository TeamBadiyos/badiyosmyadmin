ALTER TABLE public.wallet_ledger ADD COLUMN IF NOT EXISTS pnl_tag text, ADD COLUMN IF NOT EXISTS pnl_expense_category text;

CREATE OR REPLACE FUNCTION public.staff_tag_wallet_adjustment(_ledger_id uuid, _tag text, _expense_category text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE _old public.wallet_ledger; _cat text := nullif(btrim(coalesce(_expense_category,'')),'');
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_active_staff(auth.uid(),ARRAY['super_admin']) THEN RAISE EXCEPTION 'Super Admin only' USING ERRCODE='42501'; END IF;
 IF _tag IS NOT NULL AND _tag NOT IN ('bonus','expense_recovery','payout_adjustment','advance') THEN RAISE EXCEPTION 'Invalid report category'; END IF;
 IF _tag='expense_recovery' AND _cat IS NULL THEN RAISE EXCEPTION 'Expense category required'; END IF;
 IF _tag IS DISTINCT FROM 'expense_recovery' THEN _cat := NULL; END IF;
 SELECT * INTO _old FROM public.wallet_ledger WHERE id=_ledger_id FOR UPDATE;
 IF _old.id IS NULL THEN RAISE EXCEPTION 'Adjustment not found'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE action='wallet_adjust' AND target_table='wallet_ledger' AND target_id=_ledger_id) THEN RAISE EXCEPTION 'Only manual adjustments can be categorised'; END IF;
 IF _old.pnl_tag IS NOT DISTINCT FROM _tag AND _old.pnl_expense_category IS NOT DISTINCT FROM _cat THEN RETURN; END IF;
 UPDATE public.wallet_ledger SET pnl_tag=_tag, pnl_expense_category=_cat WHERE id=_ledger_id;
 INSERT INTO public.audit_logs(actor_id,action,target_table,target_id,before_state,after_state)
 VALUES(auth.uid(),'wallet_adjust_tag','wallet_ledger',_ledger_id,
  jsonb_build_object('pnl_tag',_old.pnl_tag,'pnl_expense_category',_old.pnl_expense_category),
  jsonb_build_object('pnl_tag',_tag,'pnl_expense_category',_cat));
END $$;
REVOKE ALL ON FUNCTION public.staff_tag_wallet_adjustment(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_tag_wallet_adjustment(uuid,text,text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.staff_latest_my_adjustment(_owner_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_active_staff(auth.uid(),ARRAY['super_admin']) THEN RAISE EXCEPTION 'Super Admin only' USING ERRCODE='42501'; END IF;
 RETURN (SELECT a.target_id FROM public.audit_logs a JOIN public.wallet_ledger l ON l.id=a.target_id
   WHERE a.action='wallet_adjust' AND a.target_table='wallet_ledger' AND a.actor_id=auth.uid() AND l.owner_id=_owner_id
     AND a.created_at > now()-interval '2 minutes'
   ORDER BY a.created_at DESC LIMIT 1);
END $$;
REVOKE ALL ON FUNCTION public.staff_latest_my_adjustment(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_latest_my_adjustment(uuid) TO authenticated,service_role;