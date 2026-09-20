
-- 1. Expert referral link
ALTER TABLE public.experts ADD COLUMN IF NOT EXISTS referred_by_expert_id uuid REFERENCES public.experts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS experts_referred_by_idx ON public.experts(referred_by_expert_id);

-- 2. New trigger type for expert referral
INSERT INTO public.reward_trigger_types(key, label, description, actor_types, condition_schema, is_time_based, display_order, is_active)
VALUES (
  'expert_referral_orders',
  'Expert referral (orders completed)',
  'Pays the referring expert once the referred expert completes the required number of jobs.',
  ARRAY['partner'],
  '[{"field":"orders","label":"Orders the referred expert must complete","type":"number","default":50}]'::jsonb,
  false, 11, true
)
ON CONFLICT (key) DO UPDATE
  SET condition_schema = EXCLUDED.condition_schema,
      actor_types = EXCLUDED.actor_types,
      label = EXCLUDED.label,
      description = EXCLUDED.description,
      is_time_based = false,
      is_active = true;

-- 3. Evaluator: when a referred expert completes a booking, check referral milestone
CREATE OR REPLACE FUNCTION public.reward_check_expert_referral(_expert_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _referrer uuid; _orders integer; _p public.reward_programs;
BEGIN
  IF _expert_id IS NULL THEN RETURN; END IF;
  SELECT referred_by_expert_id INTO _referrer FROM public.experts WHERE id = _expert_id;
  IF _referrer IS NULL THEN RETURN; END IF;

  SELECT COUNT(*) INTO _orders FROM public.bookings
   WHERE assigned_expert_id = _expert_id AND status = 'completed';

  FOR _p IN
    SELECT * FROM public.reward_programs
     WHERE trigger_type = 'expert_referral_orders'
       AND actor_type = 'partner'
       AND is_active = true AND archived_at IS NULL
       AND (valid_from IS NULL OR valid_from <= now())
       AND (valid_until IS NULL OR valid_until >= now())
  LOOP
    IF _orders >= COALESCE(NULLIF(_p.condition->>'orders','')::int, 50) THEN
      PERFORM public.reward_apply_credit(
        _p, 'partner', _referrer, 'expert_referral:' || _expert_id::text,
        'Referred expert completed ' || _orders::text || ' orders');
    END IF;
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION public.reward_check_expert_referral(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reward_check_expert_referral(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bookings_after_complete_expert_referral()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status = 'completed' AND COALESCE(OLD.status,'') <> 'completed'
     AND NEW.assigned_expert_id IS NOT NULL THEN
    BEGIN
      PERFORM public.reward_check_expert_referral(NEW.assigned_expert_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[expert_referral reward] %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS zz_bookings_expert_referral_reward ON public.bookings;
CREATE TRIGGER zz_bookings_expert_referral_reward
AFTER UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.bookings_after_complete_expert_referral();

-- 4. Poster programs (inserted OFF; enable from the Rewards screen)
INSERT INTO public.reward_programs(name, actor_type, trigger_type, condition, reward_type, reward_value, recurrence, is_active)
SELECT v.name, 'partner', v.trigger_type, v.condition::jsonb, 'cash', v.value, v.recurrence, false
FROM (VALUES
  ('Active Bonus (25 days)', 'active_days_threshold',
   '{"days":25,"orders_per_day":3,"period":"monthly","min_avg_rating":4,"no_complaints":true,"require_on_time":true}', 1000, 'monthly'),
  ('Weekly bonus 25 hours', 'hours_threshold',
   '{"hours":25,"period":"weekly","tier_group":"weekly_hours","min_avg_rating":4,"no_complaints":true,"require_on_time":true}', 200, 'weekly'),
  ('Weekly bonus 30 hours', 'hours_threshold',
   '{"hours":30,"period":"weekly","tier_group":"weekly_hours","min_avg_rating":4,"no_complaints":true,"require_on_time":true}', 300, 'weekly'),
  ('Weekly bonus 35 hours', 'hours_threshold',
   '{"hours":35,"period":"weekly","tier_group":"weekly_hours","min_avg_rating":4,"no_complaints":true,"require_on_time":true}', 500, 'weekly'),
  ('Weekly bonus 50 hours', 'hours_threshold',
   '{"hours":50,"period":"weekly","tier_group":"weekly_hours","min_avg_rating":4,"no_complaints":true,"require_on_time":true}', 1000, 'weekly'),
  ('Monthly bonus 100 hours', 'hours_threshold',
   '{"hours":100,"period":"monthly","tier_group":"monthly_hours","min_avg_rating":4,"no_complaints":true,"require_on_time":true}', 500, 'monthly'),
  ('Monthly bonus 125 hours', 'hours_threshold',
   '{"hours":125,"period":"monthly","tier_group":"monthly_hours","min_avg_rating":4,"no_complaints":true,"require_on_time":true}', 1000, 'monthly'),
  ('Monthly bonus 150 hours', 'hours_threshold',
   '{"hours":150,"period":"monthly","tier_group":"monthly_hours","min_avg_rating":4,"no_complaints":true,"require_on_time":true}', 1500, 'monthly'),
  ('Monthly bonus 200 hours', 'hours_threshold',
   '{"hours":200,"period":"monthly","tier_group":"monthly_hours","min_avg_rating":4,"no_complaints":true,"require_on_time":true}', 2000, 'monthly'),
  ('Expert referral bonus (50 orders)', 'expert_referral_orders',
   '{"orders":50}', 1000, 'per_event')
) AS v(name, trigger_type, condition, value, recurrence)
WHERE NOT EXISTS (SELECT 1 FROM public.reward_programs rp WHERE rp.name = v.name);
