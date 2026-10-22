-- Transactional accounting tests: all changes roll back, no credit insert/push.
BEGIN;
DO $test$
DECLARE
  admin_uid uuid; expert_id uuid; entry_id uuid; automatic_id uuid;
  batch_id uuid; original_balance numeric; original_time timestamptz;
  expected jsonb; current_balance numeric;
BEGIN
  SELECT auth_user_id INTO admin_uid FROM public.staff_users WHERE status='active' AND role='super_admin' LIMIT 1;
  SELECT id,coalesce(wallet_balance,0) INTO expert_id,original_balance FROM public.experts LIMIT 1;
  IF admin_uid IS NULL OR expert_id IS NULL THEN RAISE EXCEPTION 'Missing test prerequisites'; END IF;
  PERFORM set_config('request.jwt.claim.sub',admin_uid::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  entry_id:=public.staff_wallet_adjust('expert',expert_id,100,'debit','Adjustment test','2026-10-16');
  SELECT created_at INTO original_time FROM public.wallet_ledger WHERE id=entry_id;
  expected:=jsonb_build_object('amount',100,'type','debit','reason','Adjustment test','adjustment_date','2026-10-16');
  PERFORM public.staff_edit_wallet_adjustment(entry_id,150,'credit','Edited adjustment','2026-10-17',expected);
  SELECT wallet_balance INTO current_balance FROM public.experts WHERE id=expert_id;
  IF current_balance<>original_balance+150 THEN RAISE EXCEPTION 'Edit must replace -100 with +150, not duplicate credit'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.wallet_ledger WHERE id=entry_id AND amount=150 AND type='credit' AND adjustment_date='2026-10-17' AND created_at=original_time) THEN RAISE EXCEPTION 'Edit must preserve entry time and change accounting date'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE target_id=entry_id AND action='wallet_adjust_edit' AND before_state->>'amount'='100' AND after_state->>'amount'='150') THEN RAISE EXCEPTION 'Edit audit must preserve before and after'; END IF;
  BEGIN
    PERFORM public.staff_edit_wallet_adjustment(entry_id,200,'debit','Stale edit','2026-10-18',expected);
    RAISE EXCEPTION 'Stale edit unexpectedly allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM<>'Adjustment changed. Refresh and try again' THEN RAISE; END IF;
  END;
  expected:=jsonb_build_object('amount',150,'type','credit','reason','Edited adjustment','adjustment_date','2026-10-17');
  INSERT INTO public.payout_batches(week_start,week_end,status) VALUES('2026-10-12','2026-10-18','pending') RETURNING id INTO batch_id;
  INSERT INTO public.payout_batch_items(batch_id,owner_type,owner_id,amount,ledger_ids) VALUES(batch_id,'expert',expert_id,150,ARRAY[entry_id]);
  BEGIN
    PERFORM public.staff_delete_wallet_adjustment(entry_id,'Test delete',expected);
    RAISE EXCEPTION 'Payout-linked delete unexpectedly allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM<>'Adjustment is included in a payout batch and cannot be deleted' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.staff_edit_wallet_adjustment(entry_id,200,'credit','Payout edit','2026-10-18',expected);
    RAISE EXCEPTION 'Payout-linked edit unexpectedly allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM<>'Adjustment is included in a payout batch and cannot be changed' THEN RAISE; END IF;
  END;
  UPDATE public.payout_batches SET status='discarded' WHERE id=batch_id;
  PERFORM public.staff_delete_wallet_adjustment(entry_id,'Remove test adjustment',expected);
  SELECT wallet_balance INTO current_balance FROM public.experts WHERE id=expert_id;
  IF current_balance<>original_balance OR EXISTS(SELECT 1 FROM public.wallet_ledger WHERE id=entry_id) THEN RAISE EXCEPTION 'Delete must reverse balance and remove entry'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE target_id=entry_id AND action='wallet_adjust_delete' AND before_state->>'amount'='150' AND after_state->>'deleted'='true') THEN RAISE EXCEPTION 'Delete must retain audit'; END IF;
  BEGIN
    PERFORM public.staff_delete_wallet_adjustment(entry_id,'Repeated delete',expected);
    RAISE EXCEPTION 'Repeated delete unexpectedly allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM<>'Adjustment not found' THEN RAISE; END IF;
  END;
  entry_id:=public.staff_wallet_adjust('expert',expert_id,80,'debit','Debit delete test','2026-10-16');
  expected:=jsonb_build_object('amount',80,'type','debit','reason','Debit delete test','adjustment_date','2026-10-16');
  PERFORM public.staff_delete_wallet_adjustment(entry_id,'Remove debit',expected);
  SELECT wallet_balance INTO current_balance FROM public.experts WHERE id=expert_id;
  IF current_balance<>original_balance THEN RAISE EXCEPTION 'Deleting debit must restore balance'; END IF;
  INSERT INTO public.wallet_ledger(owner_type,owner_id,amount,type,reason) VALUES('expert',expert_id,1,'debit','Automatic test') RETURNING id INTO automatic_id;
  expected:=jsonb_build_object('amount',1,'type','debit','reason','Automatic test','adjustment_date',NULL);
  BEGIN
    PERFORM public.staff_edit_wallet_adjustment(automatic_id,2,'debit','Invalid automatic edit','2026-10-16',expected);
    RAISE EXCEPTION 'Automatic edit unexpectedly allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM<>'Only manual adjustments can be edited' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.staff_delete_wallet_adjustment(automatic_id,'Invalid automatic delete',expected);
    RAISE EXCEPTION 'Automatic delete unexpectedly allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM<>'Only manual adjustments can be deleted' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  BEGIN
    PERFORM public.staff_edit_wallet_adjustment(automatic_id,2,'debit','Forbidden','2026-10-16',expected);
    RAISE EXCEPTION 'Non-admin edit unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.staff_delete_wallet_adjustment(automatic_id,'Forbidden',expected);
    RAISE EXCEPTION 'Non-admin delete unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF has_function_privilege('anon','public.staff_edit_wallet_adjustment(uuid,numeric,text,text,date,jsonb)','EXECUTE') OR has_function_privilege('anon','public.staff_delete_wallet_adjustment(uuid,text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Anonymous execution must be revoked'; END IF;
END $test$;
ROLLBACK;