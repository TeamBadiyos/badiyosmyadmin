SELECT cron.unschedule('reward-period-jobs-weekly');
SELECT cron.schedule('reward-period-jobs-daily', '31 18 * * *', $$SELECT public.run_reward_period_jobs();$$);