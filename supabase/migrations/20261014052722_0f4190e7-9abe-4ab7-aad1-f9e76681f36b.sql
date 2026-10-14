UPDATE public.reward_programs SET condition = jsonb_build_object('hours',50) WHERE id='6e951fa7-383c-4d6b-a5d2-81cdc3dfb0fd';

CREATE OR REPLACE FUNCTION public.run_expert_referral_reward_job()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _e record; _p public.reward_programs; _mins numeric; _need numeric; _n int := 0; _id uuid;
BEGIN
  FOR _p IN SELECT * FROM public.reward_programs
     WHERE trigger_type = 'expert_referral_orders' AND actor_type = 'partner'
       AND is_active AND archived_at IS NULL
       AND (valid_from IS NULL OR valid_from <= now()) AND (valid_until IS NULL OR valid_until >= now())
  LOOP
    _need := COALESCE(NULLIF(_p.condition->>'hours','')::numeric, 50) * 60;
    FOR _e IN SELECT x.id, x.name, x.referred_by_expert_id AS referrer FROM public.experts x
       WHERE x.referred_by_expert_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.reward_ledger r WHERE r.program_id = _p.id
                          AND r.trigger_event_ref = 'expert_referral:' || x.id::text)
    LOOP
      SELECT COALESCE(SUM(b.service_duration_minutes),0)
           + COALESCE((SELECT SUM(be.extra_minutes) FROM public.booking_extensions be
                        JOIN public.bookings b2 ON b2.id = be.booking_id
                       WHERE b2.assigned_expert_id = _e.id AND b2.status='completed' AND b2.is_training=false
                         AND b2.deleted_at IS NULL AND be.approval_status IN ('accepted','approved')),0)
        INTO _mins FROM public.bookings b
       WHERE b.assigned_expert_id = _e.id AND b.status = 'completed' AND b.is_training = false AND b.deleted_at IS NULL;
      IF _mins >= _need THEN
        _id := NULL;
        INSERT INTO public.reward_ledger(program_id, program_name, actor_type, actor_id, trigger_event_ref,
                                         reward_type, reward_value, status, notes)
        VALUES (_p.id, _p.name, 'partner', _e.referrer, 'expert_referral:' || _e.id::text,
                _p.reward_type, COALESCE(_p.reward_value,0), 'pending_approval',
                'Referred expert ' || COALESCE(_e.name,'') || ' completed ' || round(_mins/60.0,1) || ' hours')
        ON CONFLICT (program_id, actor_id, trigger_event_ref) DO NOTHING RETURNING id INTO _id;
        IF _id IS NOT NULL THEN _n := _n + 1; END IF;
      END IF;
    END LOOP;
  END LOOP;
  RETURN _n;
END $$;
REVOKE EXECUTE ON FUNCTION public.run_expert_referral_reward_job() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_expert_referral_reward_job() TO service_role;

SELECT public.run_expert_referral_reward_job();