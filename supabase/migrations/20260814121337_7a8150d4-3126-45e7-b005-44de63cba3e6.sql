CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dispatch-radius-expand') THEN
    PERFORM cron.unschedule('dispatch-radius-expand');
  END IF;
END $$;

SELECT cron.schedule(
  'dispatch-radius-expand',
  '30 seconds',
  $$ select public.expand_stale_broadcasts(); $$
);