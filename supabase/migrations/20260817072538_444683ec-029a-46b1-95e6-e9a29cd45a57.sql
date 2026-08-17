-- =========================================================
-- 1. LOOKUP: extensible trigger types
-- =========================================================
CREATE TABLE IF NOT EXISTS public.reward_trigger_types (
  key text PRIMARY KEY,
  label text NOT NULL,
  description text,
  actor_types text[] NOT NULL DEFAULT ARRAY['customer','partner','merchant'],
  condition_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_time_based boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0
);

GRANT SELECT ON public.reward_trigger_types TO authenticated;
GRANT ALL ON public.reward_trigger_types TO service_role;
ALTER TABLE public.reward_trigger_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reward_trigger_types_staff_read" ON public.reward_trigger_types
  FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid(), NULL));

INSERT INTO public.reward_trigger_types (key, label, description, actor_types, condition_schema, is_time_based, display_order) VALUES
 ('referral_signup','Referral signup','When a referred user signs up using the actor''s referral code',ARRAY['customer'],
   '[{"field":"referral_count","label":"Referrals required","type":"number","default":1}]'::jsonb,false,10),
 ('referral_first_booking','Referral first booking','When a referred user completes their first booking',ARRAY['customer'],
   '[{"field":"referral_count","label":"Successful referrals required","type":"number","default":1}]'::jsonb,false,20),
 ('booking_completed','Booking completed','Each time a booking is completed',ARRAY['customer','partner'],
   '[{"field":"min_amount","label":"Minimum booking value (optional)","type":"number","optional":true}]'::jsonb,false,30),
 ('rating_given','Rating given','When a customer submits a rating',ARRAY['customer','partner'],
   '[{"field":"min_rating","label":"Minimum rating","type":"number","default":4}]'::jsonb,false,40),
 ('count_threshold','Count threshold (periodic)','Completed bookings/orders in a period reach a threshold',ARRAY['customer','partner','merchant'],
   '[{"field":"count","label":"Count required","type":"number","default":5},{"field":"period","label":"Period","type":"select","options":["weekly","monthly"],"default":"weekly"}]'::jsonb,true,50),
 ('hours_threshold','Hours threshold (periodic)','Service hours delivered in a period reach a threshold',ARRAY['partner'],
   '[{"field":"hours","label":"Hours required","type":"number","default":40},{"field":"period","label":"Period","type":"select","options":["weekly","monthly"],"default":"weekly"}]'::jsonb,true,60)
ON CONFLICT (key) DO NOTHING;

-- =========================================================
-- 2. reward_programs
-- =========================================================
CREATE TABLE IF NOT EXISTS public.reward_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  actor_type text NOT NULL,
  trigger_type text NOT NULL REFERENCES public.reward_trigger_types(key),
  condition jsonb NOT NULL DEFAULT '{}'::jsonb,
  reward_type text NOT NULL,
  reward_value numeric NOT NULL DEFAULT 0,
  recurrence text NOT NULL DEFAULT 'per_event',
  valid_from timestamptz,
  valid_until timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reward_programs_lookup_idx
  ON public.reward_programs (actor_type, trigger_type, is_active);

GRANT SELECT ON public.reward_programs TO authenticated;
GRANT ALL ON public.reward_programs TO service_role;
ALTER TABLE public.reward_programs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reward_programs_staff_read" ON public.reward_programs
  FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid(), NULL));

-- =========================================================
-- 3. reward_ledger
-- =========================================================
CREATE TABLE IF NOT EXISTS public.reward_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.reward_programs(id) ON DELETE CASCADE,
  actor_type text NOT NULL,
  actor_id uuid NOT NULL,
  trigger_event_ref text NOT NULL,
  reward_type text NOT NULL,
  reward_value numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'credited',
  notes text,
  credited_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz,
  reversed_by uuid REFERENCES public.staff_users(id),
  reversal_reason text
);

CREATE UNIQUE INDEX IF NOT EXISTS reward_ledger_event_unique
  ON public.reward_ledger (program_id, actor_id, trigger_event_ref);
CREATE INDEX IF NOT EXISTS reward_ledger_actor_idx
  ON public.reward_ledger (actor_type, actor_id, credited_at DESC);

GRANT SELECT ON public.reward_ledger TO authenticated;
GRANT ALL ON public.reward_ledger TO service_role;
ALTER TABLE public.reward_ledger ENABLE ROW LEVEL SECURITY;

-- Staff read all; actors read only their own rows. No client writes at all.
CREATE POLICY "reward_ledger_staff_read" ON public.reward_ledger
  FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid(), NULL));

CREATE POLICY "reward_ledger_own_read" ON public.reward_ledger
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.resolve_caller_identity(auth.uid()) rci
       WHERE rci.user_id = reward_ledger.actor_id
         AND rci.user_type = CASE reward_ledger.actor_type
                               WHEN 'partner' THEN 'expert'
                               ELSE reward_ledger.actor_type
                             END
    )
  );

-- =========================================================
-- 4. Engine helpers
-- =========================================================
CREATE OR REPLACE FUNCTION public.reward_apply_credit(
  _program public.reward_programs,
  _actor_type text,
  _actor_id uuid,
  _event_ref text,
  _notes text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _inserted uuid;
BEGIN
  INSERT INTO public.reward_ledger(program_id, actor_type, actor_id, trigger_event_ref,
                                   reward_type, reward_value, status, notes)
  VALUES (_program.id, _actor_type, _actor_id, _event_ref,
          _program.reward_type, COALESCE(_program.reward_value,0), 'credited', _notes)
  ON CONFLICT (program_id, actor_id, trigger_event_ref) DO NOTHING
  RETURNING id INTO _inserted;

  IF _inserted IS NULL THEN
    RETURN false; -- already credited for this event
  END IF;

  -- Side effects for value-bearing reward types
  IF COALESCE(_program.reward_value,0) > 0 THEN
    IF _actor_type = 'customer' AND _program.reward_type IN ('coins','cash') THEN
      PERFORM set_config('app.users_bypass','on', true);
      UPDATE public.users
         SET total_coins_earned = COALESCE(total_coins_earned,0) + _program.reward_value::int
       WHERE id = _actor_id;
      PERFORM set_config('app.users_bypass','off', true);
      INSERT INTO public.wallet_transactions(user_id, amount, type, description)
      VALUES (_actor_id, _program.reward_value, 'credit', 'Reward: ' || _program.name);
    ELSIF _actor_type = 'partner' AND _program.reward_type = 'cash' THEN
      INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
      VALUES ('expert', _actor_id, _program.reward_value, 'credit', 'Reward: ' || _program.name, NULL);
      UPDATE public.experts
         SET wallet_balance = COALESCE(wallet_balance,0) + _program.reward_value
       WHERE id = _actor_id;
    ELSIF _actor_type = 'merchant' AND _program.reward_type = 'cash' THEN
      INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
      VALUES ('merchant', _actor_id, _program.reward_value, 'credit', 'Reward: ' || _program.name, NULL);
    END IF;
  END IF;

  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.reward_apply_credit(public.reward_programs, text, uuid, text, text) FROM PUBLIC, anon, authenticated;

-- Main event-driven evaluator
CREATE OR REPLACE FUNCTION public.evaluate_reward_triggers(
  _actor_type text,
  _actor_id uuid,
  _trigger_type text,
  _event_ref text,
  _event_context jsonb DEFAULT '{}'::jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
       AND actor_type = _actor_type
       AND trigger_type = _trigger_type
       AND (valid_from IS NULL OR valid_from <= now())
       AND (valid_until IS NULL OR valid_until >= now())
  LOOP
    _ok := true;

    -- recurrence 'once' => only ever one credit per actor per program
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

        WHEN 'referral_signup' THEN
          _n := COALESCE((_p.condition->>'referral_count')::numeric, 1);
          IF (SELECT count(*) FROM public.referral_transactions
               WHERE referrer_id = _actor_id) < _n THEN _ok := false; END IF;

        WHEN 'referral_first_booking' THEN
          _n := COALESCE((_p.condition->>'referral_count')::numeric, 1);
          IF (SELECT count(*) FROM public.referral_transactions
               WHERE referrer_id = _actor_id AND status = 'reward_credited') < _n THEN _ok := false; END IF;

        ELSE
          NULL; -- unknown/extensible trigger: no extra condition enforced
      END CASE;
    END IF;

    IF _ok THEN
      IF public.reward_apply_credit(_p, _actor_type, _actor_id, _event_ref, NULL) THEN
        _granted := _granted + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN _granted;
END $$;

REVOKE ALL ON FUNCTION public.evaluate_reward_triggers(text, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- =========================================================
-- 5. Periodic (cron) evaluator
-- =========================================================
CREATE OR REPLACE FUNCTION public.run_reward_period_jobs(_force_period_start date DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
     WHERE rp.is_active = true AND tt.is_time_based = true
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
END $$;

REVOKE ALL ON FUNCTION public.run_reward_period_jobs(date) FROM PUBLIC, anon, authenticated;

-- Staff-callable manual trigger (for testing / catch-up)
CREATE OR REPLACE FUNCTION public.staff_run_reward_period_jobs(_period_start date DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _n integer;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  _n := public.run_reward_period_jobs(_period_start);
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, after_state)
  VALUES (auth.uid(), 'run_reward_period_jobs', 'reward_ledger', NULL,
          jsonb_build_object('granted', _n, 'period_start', _period_start));
  RETURN _n;
END $$;

REVOKE ALL ON FUNCTION public.staff_run_reward_period_jobs(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_run_reward_period_jobs(date) TO authenticated;

-- =========================================================
-- 6. Staff management RPCs
-- =========================================================
CREATE OR REPLACE FUNCTION public.staff_upsert_reward_program(
  _id uuid,
  _name text,
  _actor_type text,
  _trigger_type text,
  _condition jsonb,
  _reward_type text,
  _reward_value numeric,
  _recurrence text,
  _valid_from timestamptz,
  _valid_until timestamptz,
  _is_active boolean
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid(); _staff uuid; _before jsonb; _after jsonb; _rid uuid;
BEGIN
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _name IS NULL OR btrim(_name) = '' THEN RAISE EXCEPTION 'Name required'; END IF;
  IF _actor_type NOT IN ('customer','partner','merchant') THEN RAISE EXCEPTION 'Invalid actor type'; END IF;
  IF _reward_type NOT IN ('coins','cash','free_booking','percentage_off') THEN RAISE EXCEPTION 'Invalid reward type'; END IF;
  IF _recurrence NOT IN ('once','weekly','monthly','per_event') THEN RAISE EXCEPTION 'Invalid recurrence'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.reward_trigger_types WHERE key = _trigger_type AND is_active) THEN
    RAISE EXCEPTION 'Invalid trigger type';
  END IF;

  SELECT id INTO _staff FROM public.staff_users WHERE auth_user_id = _uid;

  IF _id IS NULL THEN
    INSERT INTO public.reward_programs(name, actor_type, trigger_type, condition, reward_type,
                                       reward_value, recurrence, valid_from, valid_until, is_active, created_by)
    VALUES (btrim(_name), _actor_type, _trigger_type, COALESCE(_condition,'{}'::jsonb), _reward_type,
            COALESCE(_reward_value,0), _recurrence, _valid_from, _valid_until, COALESCE(_is_active,true), _staff)
    RETURNING id INTO _rid;
  ELSE
    SELECT to_jsonb(r) INTO _before FROM public.reward_programs r WHERE id = _id;
    IF _before IS NULL THEN RAISE EXCEPTION 'Program not found'; END IF;
    UPDATE public.reward_programs
       SET name = btrim(_name), actor_type = _actor_type, trigger_type = _trigger_type,
           condition = COALESCE(_condition,'{}'::jsonb), reward_type = _reward_type,
           reward_value = COALESCE(_reward_value,0), recurrence = _recurrence,
           valid_from = _valid_from, valid_until = _valid_until,
           is_active = COALESCE(_is_active,true), updated_at = now()
     WHERE id = _id
    RETURNING id INTO _rid;
  END IF;

  SELECT to_jsonb(r) INTO _after FROM public.reward_programs r WHERE id = _rid;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, CASE WHEN _id IS NULL THEN 'create_reward_program' ELSE 'update_reward_program' END,
          'reward_programs', _rid, _before, _after);
  RETURN _rid;
END $$;

REVOKE ALL ON FUNCTION public.staff_upsert_reward_program(uuid,text,text,text,jsonb,text,numeric,text,timestamptz,timestamptz,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_upsert_reward_program(uuid,text,text,text,jsonb,text,numeric,text,timestamptz,timestamptz,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_set_reward_program_active(_id uuid, _is_active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid(); _before jsonb; _after jsonb;
BEGIN
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT to_jsonb(r) INTO _before FROM public.reward_programs r WHERE id = _id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Program not found'; END IF;
  UPDATE public.reward_programs SET is_active = _is_active, updated_at = now() WHERE id = _id;
  SELECT to_jsonb(r) INTO _after FROM public.reward_programs r WHERE id = _id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'toggle_reward_program', 'reward_programs', _id, _before, _after);
END $$;

REVOKE ALL ON FUNCTION public.staff_set_reward_program_active(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_set_reward_program_active(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_delete_reward_program(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid(); _before jsonb;
BEGIN
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT to_jsonb(r) INTO _before FROM public.reward_programs r WHERE id = _id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Program not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.reward_ledger WHERE program_id = _id) THEN
    RAISE EXCEPTION 'Program has reward history; pause it instead of deleting';
  END IF;
  DELETE FROM public.reward_programs WHERE id = _id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state)
  VALUES (_uid, 'delete_reward_program', 'reward_programs', _id, _before);
END $$;

REVOKE ALL ON FUNCTION public.staff_delete_reward_program(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_delete_reward_program(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_reverse_reward(_ledger_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid(); _staff uuid; _row public.reward_ledger; _before jsonb; _after jsonb;
BEGIN
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION 'Reason required'; END IF;
  SELECT * INTO _row FROM public.reward_ledger WHERE id = _ledger_id;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'Reward not found'; END IF;
  IF _row.status <> 'credited' THEN RAISE EXCEPTION 'Only credited rewards can be reversed'; END IF;
  _before := to_jsonb(_row);
  SELECT id INTO _staff FROM public.staff_users WHERE auth_user_id = _uid;

  UPDATE public.reward_ledger
     SET status = 'reversed', reversed_at = now(), reversed_by = _staff, reversal_reason = btrim(_reason)
   WHERE id = _ledger_id;

  IF COALESCE(_row.reward_value,0) > 0 THEN
    IF _row.actor_type = 'customer' AND _row.reward_type IN ('coins','cash') THEN
      PERFORM set_config('app.users_bypass','on', true);
      UPDATE public.users SET total_coins_earned = GREATEST(COALESCE(total_coins_earned,0) - _row.reward_value::int, 0)
       WHERE id = _row.actor_id;
      PERFORM set_config('app.users_bypass','off', true);
      INSERT INTO public.wallet_transactions(user_id, amount, type, description)
      VALUES (_row.actor_id, _row.reward_value, 'debit', 'Reward reversed: ' || btrim(_reason));
    ELSIF _row.actor_type = 'partner' AND _row.reward_type = 'cash' THEN
      INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
      VALUES ('expert', _row.actor_id, -_row.reward_value, 'debit', 'Reward reversed: ' || btrim(_reason), _staff);
      UPDATE public.experts SET wallet_balance = COALESCE(wallet_balance,0) - _row.reward_value WHERE id = _row.actor_id;
    ELSIF _row.actor_type = 'merchant' AND _row.reward_type = 'cash' THEN
      INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
      VALUES ('merchant', _row.actor_id, -_row.reward_value, 'debit', 'Reward reversed: ' || btrim(_reason), _staff);
    END IF;
  END IF;

  SELECT to_jsonb(r) INTO _after FROM public.reward_ledger r WHERE id = _ledger_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'reverse_reward', 'reward_ledger', _ledger_id, _before, _after);
END $$;

REVOKE ALL ON FUNCTION public.staff_reverse_reward(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_reverse_reward(uuid, text) TO authenticated;

-- Reporting: per-program aggregates
CREATE OR REPLACE FUNCTION public.staff_reward_program_stats(_from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL)
RETURNS TABLE(program_id uuid, times_triggered bigint, total_value numeric, reversed_count bigint, last_credited_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_active_staff(auth.uid(), NULL) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  RETURN QUERY
  SELECT l.program_id,
         count(*) FILTER (WHERE l.status = 'credited'),
         COALESCE(sum(l.reward_value) FILTER (WHERE l.status = 'credited'), 0),
         count(*) FILTER (WHERE l.status = 'reversed'),
         max(l.credited_at)
    FROM public.reward_ledger l
   WHERE (_from IS NULL OR l.credited_at >= _from)
     AND (_to IS NULL OR l.credited_at <= _to)
   GROUP BY l.program_id;
END $$;

REVOKE ALL ON FUNCTION public.staff_reward_program_stats(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_reward_program_stats(timestamptz, timestamptz) TO authenticated;

-- Reporting: actor drilldown (search by name/phone across customers/experts/merchants)
CREATE OR REPLACE FUNCTION public.staff_reward_ledger_search(
  _actor_type text DEFAULT NULL,
  _program_id uuid DEFAULT NULL,
  _search text DEFAULT NULL,
  _from timestamptz DEFAULT NULL,
  _to timestamptz DEFAULT NULL,
  _limit integer DEFAULT 200
) RETURNS TABLE(
  id uuid, program_id uuid, program_name text, actor_type text, actor_id uuid,
  actor_name text, actor_phone text, trigger_event_ref text, reward_type text,
  reward_value numeric, status text, credited_at timestamptz, reversed_at timestamptz,
  reversal_reason text, notes text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_active_staff(auth.uid(), NULL) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  RETURN QUERY
  SELECT l.id, l.program_id, p.name, l.actor_type, l.actor_id,
         COALESCE(u.full_name, e.name, m.store_name, m.owner_name) AS actor_name,
         COALESCE(u.phone, e.phone, m.phone) AS actor_phone,
         l.trigger_event_ref, l.reward_type, l.reward_value, l.status,
         l.credited_at, l.reversed_at, l.reversal_reason, l.notes
    FROM public.reward_ledger l
    JOIN public.reward_programs p ON p.id = l.program_id
    LEFT JOIN public.users u ON l.actor_type = 'customer' AND u.id = l.actor_id
    LEFT JOIN public.experts e ON l.actor_type = 'partner' AND e.id = l.actor_id
    LEFT JOIN public.merchants m ON l.actor_type = 'merchant' AND m.id = l.actor_id
   WHERE (_actor_type IS NULL OR l.actor_type = _actor_type)
     AND (_program_id IS NULL OR l.program_id = _program_id)
     AND (_from IS NULL OR l.credited_at >= _from)
     AND (_to IS NULL OR l.credited_at <= _to)
     AND (
       _search IS NULL OR btrim(_search) = '' OR
       COALESCE(u.full_name, e.name, m.store_name, m.owner_name, '') ILIKE '%' || btrim(_search) || '%' OR
       COALESCE(u.phone, e.phone, m.phone, '') ILIKE '%' || btrim(_search) || '%'
     )
   ORDER BY l.credited_at DESC
   LIMIT GREATEST(COALESCE(_limit, 200), 1);
END $$;

REVOKE ALL ON FUNCTION public.staff_reward_ledger_search(text, uuid, text, timestamptz, timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_reward_ledger_search(text, uuid, text, timestamptz, timestamptz, integer) TO authenticated;

-- =========================================================
-- 7. Hook into existing flows
-- =========================================================

-- Booking completion via expert end-OTP
CREATE OR REPLACE FUNCTION public.expert_verify_end_otp(_booking_id uuid, _otp text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _expert_id uuid; _b record; _payout numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  _expert_id := public.get_expert_id_for_auth(auth.uid());
  IF _expert_id IS NULL THEN RAISE EXCEPTION 'Not an expert'; END IF;
  IF _otp IS NULL OR btrim(_otp) = '' THEN RAISE EXCEPTION 'OTP required'; END IF;

  SELECT id, assigned_expert_id, status, end_otp, service_duration_minutes, user_id, price
    INTO _b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF _b.id IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _b.assigned_expert_id <> _expert_id THEN RAISE EXCEPTION 'Not your booking'; END IF;
  IF _b.status = 'completed' THEN
    SELECT COALESCE(expert_payout,0) INTO _payout FROM public.service_catalogue_config
      WHERE duration_minutes = _b.service_duration_minutes AND is_active = true
      ORDER BY created_at DESC LIMIT 1;
    RETURN COALESCE(_payout, 0);
  END IF;
  IF _b.status <> 'in_progress' THEN RAISE EXCEPTION 'Booking not in progress'; END IF;
  IF _b.end_otp IS NULL OR btrim(_otp) <> _b.end_otp THEN RAISE EXCEPTION 'Invalid end OTP'; END IF;

  SELECT COALESCE(expert_payout,0) INTO _payout FROM public.service_catalogue_config
    WHERE duration_minutes = _b.service_duration_minutes AND is_active = true
    ORDER BY created_at DESC LIMIT 1;
  _payout := COALESCE(_payout, 0);

  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings
     SET status = 'completed', service_end_at = COALESCE(service_end_at, now()), updated_at = now()
   WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);

  UPDATE public.experts SET is_busy = false WHERE id = _expert_id;

  IF _payout > 0 THEN
    INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
    VALUES('expert', _expert_id, _payout, 'credit', 'Booking payout: ' || _booking_id::text, NULL);
    UPDATE public.experts SET wallet_balance = COALESCE(wallet_balance,0) + _payout WHERE id = _expert_id;
  END IF;

  -- Rewards engine hooks (idempotent per booking)
  PERFORM public.evaluate_reward_triggers('partner', _expert_id, 'booking_completed', _booking_id::text,
    jsonb_build_object('booking_id', _booking_id, 'amount', COALESCE(_b.price,0),
                       'minutes', COALESCE(_b.service_duration_minutes,0)));
  IF _b.user_id IS NOT NULL THEN
    PERFORM public.evaluate_reward_triggers('customer', _b.user_id, 'booking_completed', _booking_id::text,
      jsonb_build_object('booking_id', _booking_id, 'amount', COALESCE(_b.price,0)));
  END IF;

  PERFORM public.notify_customer_alert(
    _booking_id, 'order_completed', 'Service completed',
    'Your booking is complete! Please rate your experience.',
    jsonb_build_object('route', 'booking/' || _booking_id::text)
  );
  PERFORM public.notify_expert_alert(
    _expert_id, 'order_completed', 'Job completed',
    'You completed the job. ₹' || _payout::text || ' has been credited to your wallet.',
    jsonb_build_object('booking_id', _booking_id, 'route', 'booking/' || _booking_id::text)
  );

  RETURN _payout;
END $function$;

-- Rating submission (also completes the booking)
CREATE OR REPLACE FUNCTION public.submit_booking_review(_booking_id uuid, _rating integer, _review text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _current text; _owner uuid; _r int; _expert uuid; _price numeric;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT status, user_id, assigned_expert_id, price
    INTO _current, _owner, _expert, _price FROM public.bookings WHERE id = _booking_id;
  IF _owner IS NULL OR _owner <> _uid THEN RAISE EXCEPTION 'Not found'; END IF;
  IF _current <> 'in_progress' THEN RAISE EXCEPTION 'Invalid status transition'; END IF;
  _r := NULLIF(_rating, 0);
  IF _r IS NOT NULL AND (_r < 1 OR _r > 5) THEN RAISE EXCEPTION 'Invalid rating'; END IF;
  PERFORM set_config('app.booking_bypass', 'on', true);
  UPDATE public.bookings
     SET status='completed', rating=_r, review_text=NULLIF(btrim(coalesce(_review,'')),'')
   WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass', 'off', true);

  -- Rewards: booking completion + rating
  PERFORM public.evaluate_reward_triggers('customer', _owner, 'booking_completed', _booking_id::text,
    jsonb_build_object('booking_id', _booking_id, 'amount', COALESCE(_price,0)));
  IF _expert IS NOT NULL THEN
    PERFORM public.evaluate_reward_triggers('partner', _expert, 'booking_completed', _booking_id::text,
      jsonb_build_object('booking_id', _booking_id, 'amount', COALESCE(_price,0)));
  END IF;
  IF _r IS NOT NULL THEN
    PERFORM public.evaluate_reward_triggers('customer', _owner, 'rating_given', _booking_id::text,
      jsonb_build_object('booking_id', _booking_id, 'rating', _r));
    IF _expert IS NOT NULL THEN
      PERFORM public.evaluate_reward_triggers('partner', _expert, 'rating_given', _booking_id::text,
        jsonb_build_object('booking_id', _booking_id, 'rating', _r));
    END IF;
  END IF;
END;$function$;

-- Referral link (signup)
CREATE OR REPLACE FUNCTION public.link_referral(_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _referrer_id uuid;
  _current_ref text;
BEGIN
  IF _uid IS NULL OR _code IS NULL OR length(trim(_code)) = 0 THEN RETURN; END IF;
  SELECT referred_by INTO _current_ref FROM public.users WHERE id = _uid;
  IF _current_ref IS NOT NULL AND length(_current_ref) > 0 THEN RETURN; END IF;
  SELECT id INTO _referrer_id FROM public.users WHERE upper(referral_code) = upper(trim(_code)) LIMIT 1;
  IF _referrer_id IS NULL OR _referrer_id = _uid THEN RETURN; END IF;
  PERFORM set_config('app.users_bypass', 'on', true);
  UPDATE public.users SET referred_by = upper(trim(_code)) WHERE id = _uid;
  PERFORM set_config('app.users_bypass', 'off', true);
  IF NOT EXISTS (SELECT 1 FROM public.referral_transactions WHERE referred_user_id = _uid) THEN
    INSERT INTO public.referral_transactions (referrer_id, referred_user_id, status)
    VALUES (_referrer_id, _uid, 'pending');
  END IF;

  PERFORM public.evaluate_reward_triggers('customer', _referrer_id, 'referral_signup', _uid::text,
    jsonb_build_object('referred_user_id', _uid));
END;
$function$;

-- Referral first booking credit
CREATE OR REPLACE FUNCTION public.credit_referral_for_booking(_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _booking_user uuid; _booking_status text;
  _confirmed_count integer; _txn_id uuid; _referrer_id uuid;
  _is_active boolean; _reward numeric;
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;
  SELECT user_id, status INTO _booking_user, _booking_status FROM public.bookings WHERE id = _booking_id;
  IF _booking_user IS NULL OR _booking_user <> _uid THEN RETURN; END IF;
  IF _booking_status <> 'confirmed' THEN RETURN; END IF;
  SELECT count(*) INTO _confirmed_count FROM public.bookings
    WHERE user_id = _uid AND status IN ('confirmed','expert_assigned','in_progress','completed');
  IF _confirmed_count <> 1 THEN RETURN; END IF;
  SELECT id, referrer_id INTO _txn_id, _referrer_id FROM public.referral_transactions
    WHERE referred_user_id = _uid AND status = 'pending' LIMIT 1;
  IF _txn_id IS NULL THEN RETURN; END IF;
  SELECT is_active, reward_coins INTO _is_active, _reward
    FROM public.referral_config ORDER BY updated_at DESC NULLS LAST LIMIT 1;
  IF _is_active IS NOT TRUE THEN RETURN; END IF;
  _reward := COALESCE(_reward, 0);
  UPDATE public.referral_transactions
    SET status='reward_credited', reward_amount=_reward, reward_date=now(), booking_id=_booking_id
    WHERE id = _txn_id;
  PERFORM set_config('app.users_bypass', 'on', true);
  UPDATE public.users
    SET total_coins_earned = COALESCE(total_coins_earned,0) + _reward::int,
        successful_referrals = COALESCE(successful_referrals,0) + 1
    WHERE id = _referrer_id;
  PERFORM set_config('app.users_bypass', 'off', true);
  INSERT INTO public.wallet_transactions (user_id, amount, type, description)
    VALUES (_referrer_id, _reward, 'credit', 'Referral Reward');

  PERFORM public.evaluate_reward_triggers('customer', _referrer_id, 'referral_first_booking', _txn_id::text,
    jsonb_build_object('booking_id', _booking_id, 'referred_user_id', _uid));
END;
$function$;

-- =========================================================
-- 8. Daily cron for periodic programs
-- =========================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('run-reward-period-jobs')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'run-reward-period-jobs');

SELECT cron.schedule(
  'run-reward-period-jobs',
  '15 1 * * *',
  $$SELECT public.run_reward_period_jobs();$$
);
