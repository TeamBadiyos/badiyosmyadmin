-- 1. reward_apply_credit: coins for partner/merchant, merchant push, weekly/monthly recurrence
CREATE OR REPLACE FUNCTION public.reward_apply_credit(_program reward_programs, _actor_type text, _actor_id uuid, _event_ref text, _notes text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _inserted uuid; _label text; _body text; _period_start timestamptz;
BEGIN
  -- Periodic recurrence caps: one credit per actor per calendar week/month per program
  IF _program.recurrence IN ('weekly','monthly') THEN
    _period_start := CASE WHEN _program.recurrence = 'monthly'
                          THEN date_trunc('month', now())
                          ELSE date_trunc('week', now()) END;
    IF EXISTS (
      SELECT 1 FROM public.reward_ledger
       WHERE program_id = _program.id AND actor_id = _actor_id
         AND status = 'credited' AND credited_at >= _period_start
    ) THEN
      RETURN false;
    END IF;
  END IF;

  INSERT INTO public.reward_ledger(program_id, program_name, actor_type, actor_id, trigger_event_ref,
                                   reward_type, reward_value, status, notes)
  VALUES (_program.id, _program.name, _actor_type, _actor_id, _event_ref,
          _program.reward_type, COALESCE(_program.reward_value,0), 'credited', _notes)
  ON CONFLICT (program_id, actor_id, trigger_event_ref) DO NOTHING
  RETURNING id INTO _inserted;

  IF _inserted IS NULL THEN RETURN false; END IF;

  IF COALESCE(_program.reward_value,0) > 0 THEN
    IF _actor_type = 'customer' AND _program.reward_type IN ('coins','cash') THEN
      PERFORM set_config('app.users_bypass','on', true);
      UPDATE public.users
         SET total_coins_earned = COALESCE(total_coins_earned,0) + _program.reward_value::int
       WHERE id = _actor_id;
      PERFORM set_config('app.users_bypass','off', true);
      INSERT INTO public.wallet_transactions(user_id, amount, type, description)
      VALUES (_actor_id, _program.reward_value, 'credit', 'Reward: ' || _program.name);
    ELSIF _actor_type = 'partner' AND _program.reward_type IN ('cash','coins') THEN
      INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
      VALUES ('expert', _actor_id, _program.reward_value, 'credit', 'Reward: ' || _program.name, NULL);
      UPDATE public.experts
         SET wallet_balance = COALESCE(wallet_balance,0) + _program.reward_value
       WHERE id = _actor_id;
    ELSIF _actor_type = 'merchant' AND _program.reward_type IN ('cash','coins') THEN
      INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
      VALUES ('merchant', _actor_id, _program.reward_value, 'credit', 'Reward: ' || _program.name, NULL);
    END IF;

    _label := CASE WHEN _program.reward_type = 'coins'
                THEN COALESCE(_program.reward_value,0)::text || ' coins'
                ELSE '₹' || COALESCE(_program.reward_value,0)::text END;
    _body := 'You earned ' || _label || ' — ' || _program.name || '.';

    IF _actor_type = 'customer' THEN
      PERFORM public.notify_push_event('customer', _actor_id, 'reward_credited',
        'Reward credited', _body, jsonb_build_object('route','rewards'));
    ELSIF _actor_type = 'partner' THEN
      PERFORM public.notify_push_event('expert', _actor_id, 'reward_credited',
        'Reward credited', _body, jsonb_build_object('route','earnings'));
    ELSIF _actor_type = 'merchant' THEN
      PERFORM public.notify_push_event('merchant', _actor_id, 'reward_credited',
        'Reward credited', _body, jsonb_build_object('route','earnings'));
    END IF;
  END IF;

  RETURN true;
END;
$function$;

-- 2. Nightly periodic job must skip archived programs
CREATE OR REPLACE FUNCTION public.run_reward_period_jobs(_force_period_start date DEFAULT NULL::date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _p public.reward_programs;
  _period text;
  _start timestamptz;
  _end timestamptz;
  _ref text;
  _granted integer := 0;
  _actor record;
  _threshold numeric;
BEGIN
  FOR _p IN
    SELECT rp.* FROM public.reward_programs rp
     JOIN public.reward_trigger_types tt ON tt.key = rp.trigger_type
     WHERE rp.is_active = true AND rp.archived_at IS NULL AND tt.is_time_based = true
       AND (rp.valid_from IS NULL OR rp.valid_from <= now())
       AND (rp.valid_until IS NULL OR rp.valid_until >= now())
  LOOP
    _period := COALESCE(_p.condition->>'period', 'weekly');

    IF _force_period_start IS NOT NULL THEN
      _start := _force_period_start::timestamptz;
      _end := CASE WHEN _period = 'monthly' THEN _start + interval '1 month' ELSE _start + interval '7 days' END;
    ELSIF _period = 'monthly' THEN
      _start := date_trunc('month', now()) - interval '1 month';
      _end := date_trunc('month', now());
    ELSE
      _start := date_trunc('week', now()) - interval '7 days';
      _end := date_trunc('week', now());
    END IF;

    _ref := _p.trigger_type || ':' || _period || ':' || to_char(_start, 'YYYY-MM-DD');

    IF _p.trigger_type = 'hours_threshold' THEN
      _threshold := COALESCE((_p.condition->>'hours')::numeric, 0);
      IF _p.actor_type = 'partner' THEN
        FOR _actor IN
          SELECT b.assigned_expert_id AS id,
                 SUM(COALESCE(b.service_duration_minutes,0))::numeric / 60.0 AS metric
            FROM public.bookings b
           WHERE b.status = 'completed' AND b.assigned_expert_id IS NOT NULL
             AND b.service_end_at >= _start AND b.service_end_at < _end
           GROUP BY b.assigned_expert_id
        LOOP
          IF _actor.metric >= _threshold AND public.reward_apply_credit(
               _p, _p.actor_type, _actor.id, _ref,
               'Hours in period: ' || round(_actor.metric, 2)::text) THEN
            _granted := _granted + 1;
          END IF;
        END LOOP;
      END IF;

    ELSIF _p.trigger_type = 'count_threshold' THEN
      _threshold := COALESCE((_p.condition->>'count')::numeric, 0);

      IF _p.actor_type = 'partner' THEN
        FOR _actor IN
          SELECT b.assigned_expert_id AS id, count(*)::numeric AS metric
            FROM public.bookings b
           WHERE b.status = 'completed' AND b.assigned_expert_id IS NOT NULL
             AND b.service_end_at >= _start AND b.service_end_at < _end
           GROUP BY b.assigned_expert_id
        LOOP
          IF _actor.metric >= _threshold AND public.reward_apply_credit(
               _p, _p.actor_type, _actor.id, _ref, 'Count in period: ' || _actor.metric::text) THEN
            _granted := _granted + 1;
          END IF;
        END LOOP;

      ELSIF _p.actor_type = 'customer' THEN
        FOR _actor IN
          SELECT b.user_id AS id, count(*)::numeric AS metric
            FROM public.bookings b
           WHERE b.status = 'completed' AND b.user_id IS NOT NULL
             AND b.updated_at >= _start AND b.updated_at < _end
           GROUP BY b.user_id
        LOOP
          IF _actor.metric >= _threshold AND public.reward_apply_credit(
               _p, _p.actor_type, _actor.id, _ref, 'Count in period: ' || _actor.metric::text) THEN
            _granted := _granted + 1;
          END IF;
        END LOOP;

      ELSIF _p.actor_type = 'merchant' THEN
        FOR _actor IN
          SELECT o.merchant_id AS id, count(*)::numeric AS metric
            FROM public.merchant_orders o
           WHERE o.status = 'completed'
             AND o.updated_at >= _start AND o.updated_at < _end
           GROUP BY o.merchant_id
        LOOP
          IF _actor.metric >= _threshold AND public.reward_apply_credit(
               _p, _p.actor_type, _actor.id, _ref, 'Count in period: ' || _actor.metric::text) THEN
            _granted := _granted + 1;
          END IF;
        END LOOP;
      END IF;
    END IF;
  END LOOP;

  RETURN _granted;
END $function$;

-- 3. Merchant "order completed" trigger type + event hook
INSERT INTO public.reward_trigger_types (key, label, description, actor_types, condition_schema, is_time_based, display_order, is_active)
VALUES ('order_completed', 'Order completed', 'Fires when a merchant order is completed',
        ARRAY['merchant']::text[],
        '[{"field":"min_amount","label":"Minimum order amount","type":"number","optional":true}]'::jsonb,
        false, 25, true)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      actor_types = EXCLUDED.actor_types,
      condition_schema = EXCLUDED.condition_schema,
      is_active = true;

CREATE OR REPLACE FUNCTION public.merchant_orders_ledger_on_complete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _net numeric;
BEGIN
  IF NEW.status = 'completed' AND COALESCE(OLD.status, '') <> 'completed' THEN
    _net := COALESCE(NEW.total_amount, 0) - COALESCE(NEW.commission_amount, 0);
    INSERT INTO public.wallet_ledger (owner_type, owner_id, amount, type, reason)
    VALUES ('merchant', NEW.merchant_id, ABS(_net), CASE WHEN _net < 0 THEN 'debit' ELSE 'credit' END,
            'order:' || NEW.id::text)
    ON CONFLICT DO NOTHING;

    BEGIN
      PERFORM public.evaluate_reward_triggers('merchant', NEW.merchant_id, 'order_completed', NEW.id::text,
        jsonb_build_object('order_id', NEW.id, 'amount', COALESCE(NEW.total_amount,0)));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[merchant order reward] %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$function$;

-- condition check for the new trigger type
CREATE OR REPLACE FUNCTION public.evaluate_reward_triggers(_actor_type text, _actor_id uuid, _trigger_type text, _event_ref text, _event_context jsonb DEFAULT '{}'::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _p public.reward_programs;
  _granted integer := 0;
  _ok boolean;
  _n numeric;
BEGIN
  IF _actor_id IS NULL OR _trigger_type IS NULL OR _event_ref IS NULL THEN RETURN 0; END IF;
  _event_context := COALESCE(_event_context, '{}'::jsonb);

  FOR _p IN
    SELECT * FROM public.reward_programs
     WHERE is_active = true
       AND archived_at IS NULL
       AND actor_type = _actor_type
       AND trigger_type = _trigger_type
       AND (valid_from IS NULL OR valid_from <= now())
       AND (valid_until IS NULL OR valid_until >= now())
  LOOP
    _ok := true;

    IF _p.recurrence = 'once' AND EXISTS (
         SELECT 1 FROM public.reward_ledger
          WHERE program_id = _p.id AND actor_id = _actor_id AND status = 'credited'
       ) THEN
      _ok := false;
    END IF;

    IF _ok THEN
      CASE _trigger_type
        WHEN 'rating_given' THEN
          _n := COALESCE((_p.condition->>'min_rating')::numeric, 0);
          IF COALESCE((_event_context->>'rating')::numeric, 0) < _n THEN _ok := false; END IF;

        WHEN 'booking_completed' THEN
          IF (_p.condition ? 'min_amount') AND NULLIF(_p.condition->>'min_amount','') IS NOT NULL THEN
            IF COALESCE((_event_context->>'amount')::numeric, 0) < (_p.condition->>'min_amount')::numeric THEN
              _ok := false;
            END IF;
          END IF;

        WHEN 'order_completed' THEN
          IF (_p.condition ? 'min_amount') AND NULLIF(_p.condition->>'min_amount','') IS NOT NULL THEN
            IF COALESCE((_event_context->>'amount')::numeric, 0) < (_p.condition->>'min_amount')::numeric THEN
              _ok := false;
            END IF;
          END IF;

        WHEN 'referral_signup' THEN
          _n := COALESCE((_p.condition->>'referral_count')::numeric, 1);
          IF (SELECT count(*) FROM public.referral_transactions
               WHERE referrer_id = _actor_id) < _n THEN _ok := false; END IF;

        WHEN 'referral_first_booking' THEN
          _n := COALESCE((_p.condition->>'referral_count')::numeric, 1);
          IF (SELECT count(*) FROM public.referral_transactions
               WHERE referrer_id = _actor_id AND status = 'reward_credited') < _n THEN _ok := false; END IF;

        ELSE
          NULL;
      END CASE;
    END IF;

    IF _ok THEN
      IF public.reward_apply_credit(_p, _actor_type, _actor_id, _event_ref, NULL) THEN
        _granted := _granted + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN _granted;
END $function$;

-- 4. Partner in-app reward alert used the wrong actor label
CREATE OR REPLACE FUNCTION public.notify_expert_reward_credited()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _name text; _body text;
BEGIN
  IF NEW.actor_type IN ('partner','expert') AND COALESCE(NEW.status,'') = 'credited' THEN
    _name := COALESCE(NEW.program_name, (SELECT name FROM public.reward_programs WHERE id = NEW.program_id));
    IF NEW.reward_type IN ('cash','coins') AND COALESCE(NEW.reward_value,0) > 0 THEN
      _body := '₹' || trim(to_char(NEW.reward_value, 'FM999999990.00')) || ' bonus credited'
               || COALESCE(' for ' || _name, '') || '.';
    ELSE
      _body := COALESCE(_name, 'A reward') || ' has been credited to your account.';
    END IF;
    BEGIN
      PERFORM public.notify_expert_alert(
        NEW.actor_id, 'reward_credited', 'Reward earned', _body,
        jsonb_build_object('route', 'rewards')
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[notify_expert_reward_credited] %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $function$;

-- 5. Referral: credit on first booking completed AFTER the code was applied + milestone bonus
CREATE OR REPLACE FUNCTION public.credit_referral_for_booking(_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _booking_user uuid; _booking_status text;
  _txn_id uuid; _referrer_id uuid; _txn_created timestamptz;
  _is_active boolean; _reward numeric;
  _milestone_n integer; _milestone_reward numeric; _new_count integer;
BEGIN
  SELECT user_id, status INTO _booking_user, _booking_status
    FROM public.bookings WHERE id = _booking_id;
  IF _booking_user IS NULL THEN RETURN; END IF;
  IF _booking_status <> 'completed' THEN RETURN; END IF;

  -- no referral already credited for this user, ever
  IF EXISTS (SELECT 1 FROM public.referral_transactions
              WHERE referred_user_id = _booking_user AND status = 'reward_credited') THEN
    RETURN;
  END IF;

  SELECT id, referrer_id, created_at INTO _txn_id, _referrer_id, _txn_created
    FROM public.referral_transactions
   WHERE referred_user_id = _booking_user AND status = 'pending'
   ORDER BY created_at LIMIT 1
   FOR UPDATE;
  IF _txn_id IS NULL OR _referrer_id IS NULL THEN RETURN; END IF;

  SELECT is_active, reward_coins, milestone_referrals, milestone_reward_coins
    INTO _is_active, _reward, _milestone_n, _milestone_reward
    FROM public.referral_config ORDER BY updated_at DESC NULLS LAST LIMIT 1;
  IF _is_active IS NOT TRUE THEN RETURN; END IF;
  _reward := COALESCE(_reward, 0);

  UPDATE public.referral_transactions
    SET status='reward_credited', reward_amount=_reward, reward_date=now(), booking_id=_booking_id
    WHERE id = _txn_id AND status = 'pending';
  IF NOT FOUND THEN RETURN; END IF;

  PERFORM set_config('app.users_bypass', 'on', true);
  UPDATE public.users
    SET total_coins_earned = COALESCE(total_coins_earned,0) + _reward::int,
        successful_referrals = COALESCE(successful_referrals,0) + 1
    WHERE id = _referrer_id
    RETURNING successful_referrals INTO _new_count;
  PERFORM set_config('app.users_bypass', 'off', true);

  IF _reward > 0 THEN
    INSERT INTO public.wallet_transactions (user_id, amount, type, description)
      VALUES (_referrer_id, _reward, 'credit', 'Referral Reward');
    PERFORM public.notify_push_event('customer', _referrer_id, 'referral_reward',
      'Referral reward credited',
      'Your friend completed their first booking. You earned ' || _reward::text || ' coins.',
      jsonb_build_object('route','refer-earn'));
  END IF;

  -- Milestone bonus every N successful referrals
  IF COALESCE(_milestone_n,0) > 0 AND COALESCE(_milestone_reward,0) > 0
     AND COALESCE(_new_count,0) > 0 AND _new_count % _milestone_n = 0 THEN
    PERFORM set_config('app.users_bypass', 'on', true);
    UPDATE public.users
       SET total_coins_earned = COALESCE(total_coins_earned,0) + _milestone_reward::int
     WHERE id = _referrer_id;
    PERFORM set_config('app.users_bypass', 'off', true);
    INSERT INTO public.wallet_transactions (user_id, amount, type, description)
      VALUES (_referrer_id, _milestone_reward, 'credit',
              'Referral milestone bonus (' || _new_count::text || ' referrals)');
    PERFORM public.notify_push_event('customer', _referrer_id, 'referral_reward',
      'Referral milestone reached',
      'You have ' || _new_count::text || ' successful referrals. Bonus of '
        || _milestone_reward::text || ' coins credited.',
      jsonb_build_object('route','refer-earn'));
  END IF;

  PERFORM public.evaluate_reward_triggers('customer', _referrer_id, 'referral_first_booking', _txn_id::text,
    jsonb_build_object('booking_id', _booking_id, 'referred_user_id', _booking_user));
END;
$function$;

-- legacy entry point delegates to the single implementation
CREATE OR REPLACE FUNCTION public.system_credit_referral_for_booking(_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.credit_referral_for_booking(_booking_id);
END;
$function$;