CREATE OR REPLACE FUNCTION public.staff_reverse_reward(_ledger_id uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _staff uuid; _row public.reward_ledger; _before jsonb; _after jsonb;
BEGIN
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION 'Reason required'; END IF;
  SELECT * INTO _row FROM public.reward_ledger WHERE id = _ledger_id;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'Reward not found'; END IF;
  IF _row.status <> 'credited' THEN RAISE EXCEPTION 'Only credited rewards can be reversed'; END IF;
  _before := to_jsonb(_row);
  SELECT id INTO _staff FROM public.staff_users WHERE auth_user_id = _uid;

  UPDATE public.reward_ledger
     SET status = 'reversed', reversed_at = now(), reversed_by = _staff, reversal_reason = btrim(_reason)
   WHERE id = _ledger_id;

  IF COALESCE(_row.reward_value,0) > 0 THEN
    IF _row.actor_type = 'customer' AND _row.reward_type IN ('coins','cash') THEN
      PERFORM set_config('app.users_bypass','on', true);
      UPDATE public.users SET total_coins_earned = GREATEST(COALESCE(total_coins_earned,0) - _row.reward_value::int, 0)
       WHERE id = _row.actor_id;
      PERFORM set_config('app.users_bypass','off', true);
      INSERT INTO public.wallet_transactions(user_id, amount, type, description)
      VALUES (_row.actor_id, _row.reward_value, 'debit', 'Reward reversed: ' || btrim(_reason));
    ELSIF _row.actor_type = 'partner' AND _row.reward_type IN ('cash','coins') THEN
      INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
      VALUES ('expert', _row.actor_id, -_row.reward_value, 'debit', 'Reward reversed: ' || btrim(_reason), _staff);
      UPDATE public.experts SET wallet_balance = COALESCE(wallet_balance,0) - _row.reward_value WHERE id = _row.actor_id;
    ELSIF _row.actor_type = 'merchant' AND _row.reward_type IN ('cash','coins') THEN
      INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
      VALUES ('merchant', _row.actor_id, -_row.reward_value, 'debit', 'Reward reversed: ' || btrim(_reason), _staff);
    END IF;
  END IF;

  SELECT to_jsonb(r) INTO _after FROM public.reward_ledger r WHERE id = _ledger_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'reverse_reward', 'reward_ledger', _ledger_id, _before, _after);
END $function$;