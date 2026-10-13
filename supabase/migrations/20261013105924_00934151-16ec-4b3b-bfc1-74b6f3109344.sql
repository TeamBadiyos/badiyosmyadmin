CREATE OR REPLACE FUNCTION public.run_expert_referral_reward_job()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _e record; _p public.reward_programs; _orders int; _n int := 0; _id uuid;
BEGIN
  FOR _p IN SELECT * FROM public.reward_programs
     WHERE trigger_type = 'expert_referral_orders' AND actor_type = 'partner'
       AND is_active AND archived_at IS NULL
       AND (valid_from IS NULL OR valid_from <= now()) AND (valid_until IS NULL OR valid_until >= now())
  LOOP
    FOR _e IN SELECT x.id, x.name, x.referred_by_expert_id AS referrer FROM public.experts x
       WHERE x.referred_by_expert_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.reward_ledger r WHERE r.program_id = _p.id
                          AND r.trigger_event_ref = 'expert_referral:' || x.id::text)
    LOOP
      SELECT COUNT(*) INTO _orders FROM public.bookings
       WHERE assigned_expert_id = _e.id AND status = 'completed' AND is_training = false AND deleted_at IS NULL;
      IF _orders >= COALESCE(NULLIF(_p.condition->>'orders','')::int, 50) THEN
        _id := NULL;
        INSERT INTO public.reward_ledger(program_id, program_name, actor_type, actor_id, trigger_event_ref,
                                         reward_type, reward_value, status, notes)
        VALUES (_p.id, _p.name, 'partner', _e.referrer, 'expert_referral:' || _e.id::text,
                _p.reward_type, COALESCE(_p.reward_value,0), 'pending_approval',
                'Referred expert ' || COALESCE(_e.name,'') || ' completed ' || _orders || ' orders')
        ON CONFLICT (program_id, actor_id, trigger_event_ref) DO NOTHING RETURNING id INTO _id;
        IF _id IS NOT NULL THEN _n := _n + 1; END IF;
      END IF;
    END LOOP;
  END LOOP;
  RETURN _n;
END $$;
REVOKE EXECUTE ON FUNCTION public.run_expert_referral_reward_job() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_expert_referral_reward_job() TO service_role;

CREATE OR REPLACE FUNCTION public.staff_decide_pending_reward(_ledger_id uuid, _approve boolean, _reason text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _r public.reward_ledger; _p public.reward_programs; _ok boolean;
BEGIN
  IF NOT public.is_super_admin_user() THEN RAISE EXCEPTION 'Forbidden: super admin only'; END IF;
  SELECT * INTO _r FROM public.reward_ledger WHERE id = _ledger_id FOR UPDATE;
  IF _r.id IS NULL OR _r.status <> 'pending_approval' THEN RAISE EXCEPTION 'Not pending'; END IF;
  IF NOT _approve THEN
    UPDATE public.reward_ledger SET status = 'rejected', reversal_reason = _reason, reversed_at = now() WHERE id = _ledger_id;
    _ok := true;
  ELSE
    SELECT * INTO _p FROM public.reward_programs WHERE id = _r.program_id;
    DELETE FROM public.reward_ledger WHERE id = _ledger_id;
    _ok := public.reward_apply_credit(_p, _r.actor_type, _r.actor_id, _r.trigger_event_ref, _r.notes);
    IF NOT _ok THEN RAISE EXCEPTION 'Credit failed'; END IF;
  END IF;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), CASE WHEN _approve THEN 'reward_approved' ELSE 'reward_rejected' END,
          'reward_ledger', _ledger_id, to_jsonb(_r), jsonb_build_object('reason', _reason));
  RETURN _ok;
END $$;
REVOKE EXECUTE ON FUNCTION public.staff_decide_pending_reward(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_decide_pending_reward(uuid, boolean, text) TO authenticated, service_role;

SELECT public.run_expert_referral_reward_job();