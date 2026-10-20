-- lovable-cron-fallback-reviewed: expert presence depends on absence of app pings (no row change to trigger on); one tiny UPDATE every 5 min keeps unreachable experts out of job offers.
UPDATE public.ops_settings SET value = '15' WHERE key = 'expert_stale_online_minutes';
DO $$ BEGIN PERFORM cron.unschedule('expire-stale-online-experts'); EXCEPTION WHEN others THEN NULL; END $$;
SELECT cron.schedule('expire-stale-online-experts', '*/5 * * * *', $$SELECT public.expire_stale_online_experts();$$);
SELECT public.expire_stale_online_experts();