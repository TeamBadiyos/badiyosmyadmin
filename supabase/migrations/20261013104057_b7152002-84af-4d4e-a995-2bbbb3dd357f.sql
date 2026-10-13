DROP TRIGGER IF EXISTS zz_bookings_expert_referral_reward ON public.bookings;

CREATE OR REPLACE FUNCTION public.run_expert_referral_reward_job()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _e record; _p public.reward_programs; _orders int; _n int := 0;
BEGIN
  FOR _p IN
    SELECT * FROM public.reward_programs
     WHERE trigger_type = 'expert_referral_orders' AND actor_type = 'partner'
       AND is_active = true AND archived_at IS NULL
       AND (valid_from IS NULL OR valid_from <= now())
       AND (valid_until IS NULL OR valid_until >= now())
  LOOP
    FOR _e IN
      SELECT x.id, x.referred_by_expert_id AS referrer FROM public.experts x
       WHERE x.referred_by_expert_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.reward_ledger r
                          WHERE r.program_id = _p.id
                            AND r.trigger_event_ref = 'expert_referral:' || x.id::text)
    LOOP
      SELECT COUNT(*) INTO _orders FROM public.bookings
       WHERE assigned_expert_id = _e.id AND status = 'completed';
      IF _orders >= COALESCE(NULLIF(_p.condition->>'orders','')::int, 50) THEN
        IF public.reward_apply_credit(_p, 'partner', _e.referrer, 'expert_referral:' || _e.id::text,
             'Referred expert completed ' || _orders::text || ' orders') THEN
          _n := _n + 1;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  RETURN _n;
END $$;

REVOKE EXECUTE ON FUNCTION public.run_expert_referral_reward_job() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_expert_referral_reward_job() TO service_role;

SELECT cron.schedule('expert-referral-rewards-nightly', '30 16 * * *', $$SELECT public.run_expert_referral_reward_job();$$);

SELECT public.run_expert_referral_reward_job();