UPDATE public.ops_settings SET value = '0' WHERE key = 'reward_punctuality_gate_enabled';
SELECT public.run_reward_period_jobs('2026-10-05'::date);