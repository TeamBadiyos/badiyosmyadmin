-- lovable-cron-fallback-reviewed: 1440 runs/day; no-accept alerts must fire within ~1 minute of the per-city threshold, so per-minute is the required cadence; the statement is a bounded no-op scan when nothing is stale
SELECT cron.schedule(
  'dispatch-no-accept-alerts-every-minute',
  '* * * * *',
  $$SELECT public.system_check_no_accept_alerts();$$
);
