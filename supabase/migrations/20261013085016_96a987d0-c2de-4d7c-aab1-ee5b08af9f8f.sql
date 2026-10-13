CREATE OR REPLACE FUNCTION public.reward_effective_ts() RETURNS timestamptz
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT COALESCE(NULLIF(current_setting('app.reward_period_end', true),'')::timestamptz - interval '1 second', now())
$$;

DO $do$
DECLARE _src text;
BEGIN
  _src := pg_get_functiondef('public.reward_apply_credit(reward_programs,text,uuid,text,text)'::regprocedure);
  _src := replace(_src, 'INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by, wallet_type)',
                        'INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by, wallet_type, created_at)');
  _src := replace(_src, '''Reward: '' || _program.name, NULL, ''earnings'')', '''Reward: '' || _program.name, NULL, ''earnings'', public.reward_effective_ts())');
  IF position('reward_effective_ts' in _src) = 0 THEN RAISE EXCEPTION 'apply_credit patch failed'; END IF;
  EXECUTE _src;

  _src := pg_get_functiondef('public.run_reward_period_jobs(date)'::regprocedure);
  _src := replace(_src, '_start := _force_period_start::timestamptz;', '_start := (_force_period_start::timestamp AT TIME ZONE ''Asia/Kolkata'');');
  _src := replace(_src, '_start + interval ''1 month''', '(((_start AT TIME ZONE ''Asia/Kolkata'') + interval ''1 month'') AT TIME ZONE ''Asia/Kolkata'')');
  _src := replace(_src, 'date_trunc(''month'', now())', '(date_trunc(''month'', now() AT TIME ZONE ''Asia/Kolkata'') AT TIME ZONE ''Asia/Kolkata'')');
  _src := replace(_src, 'date_trunc(''week'', now())', '(date_trunc(''week'', now() AT TIME ZONE ''Asia/Kolkata'') AT TIME ZONE ''Asia/Kolkata'')');
  _src := replace(_src, 'to_char(_start, ''YYYY-MM-DD'')', 'to_char(_start AT TIME ZONE ''Asia/Kolkata'', ''YYYY-MM-DD'')');
  _src := replace(_src, 'IF public.reward_apply_credit(_p, _p.actor_type, _actor.id, _ref,',
                        'PERFORM set_config(''app.reward_period_end'', _end::text, true);
          IF public.reward_apply_credit(_p, _p.actor_type, _actor.id, _ref,');
  IF position('app.reward_period_end' in _src) = 0 OR position('to_char(_start AT TIME ZONE' in _src) = 0
     OR position('_force_period_start::timestamp AT TIME ZONE' in _src) = 0 THEN
    RAISE EXCEPTION 'run_reward patch failed';
  END IF;
  EXECUTE _src;
END $do$;

-- Weekly job right after Sunday ends (Mon 00:01 IST)
SELECT cron.unschedule('reward-period-jobs-weekly');
SELECT cron.schedule('reward-period-jobs-weekly', '31 18 * * 0', $$SELECT public.run_reward_period_jobs();$$);

-- Move last week's bonuses into the week they were earned
UPDATE public.wallet_ledger l SET created_at = '2026-10-11 23:59:59+05:30'
  FROM public.reward_ledger r
 WHERE r.trigger_event_ref = 'hours_threshold:weekly:2026-10-05' AND r.status='credited'
   AND l.owner_id = r.actor_id AND l.type='credit' AND l.reason = 'Reward: ' || r.program_name
   AND l.amount = r.reward_value AND l.created_at >= '2026-10-12 00:00:00+05:30';

-- Add them to the pending 05–11 Oct batch
DO $do$
DECLARE r record; _t record;
BEGIN
  FOR r IN SELECT i.id, i.owner_type, i.owner_id, SUM(x.reward_value) AS bonus
             FROM public.payout_batch_items i
             JOIN public.reward_ledger x ON x.actor_id=i.owner_id AND x.trigger_event_ref='hours_threshold:weekly:2026-10-05' AND x.status='credited'
            WHERE i.batch_id='e369fdd9-cf55-4c0f-80b4-d435058cf9e2' AND NOT i.paid AND COALESCE(i.bonus_amount,0)=0
            GROUP BY i.id, i.owner_type, i.owner_id LOOP
    UPDATE public.payout_batch_items SET amount=amount+r.bonus, gross_amount=gross_amount+r.bonus, bonus_amount=r.bonus WHERE id=r.id;
    SELECT * INTO _t FROM public.compute_tds(r.owner_type, r.owner_id, (SELECT gross_amount FROM public.payout_batch_items WHERE id=r.id));
    UPDATE public.payout_batch_items SET tds_amount=COALESCE(_t.amount,0), net_amount=round(gross_amount)-COALESCE(_t.amount,0) WHERE id=r.id;
  END LOOP;
  PERFORM public.payout_batch_recalc_total('e369fdd9-cf55-4c0f-80b4-d435058cf9e2');
END $do$;