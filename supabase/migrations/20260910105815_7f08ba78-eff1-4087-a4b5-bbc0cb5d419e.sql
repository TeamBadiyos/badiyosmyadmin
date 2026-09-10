-- 1. Referral credit reworked: fires on first COMPLETED booking of the referred user
CREATE OR REPLACE FUNCTION public.credit_referral_for_booking(_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _booking_user uuid; _booking_status text;
  _completed_count integer; _txn_id uuid; _referrer_id uuid;
  _is_active boolean; _reward numeric;
BEGIN
  SELECT user_id, status INTO _booking_user, _booking_status
    FROM public.bookings WHERE id = _booking_id;
  IF _booking_user IS NULL THEN RETURN; END IF;
  IF _booking_status <> 'completed' THEN RETURN; END IF;

  -- must be the referred user's FIRST completed booking
  SELECT count(*) INTO _completed_count FROM public.bookings
    WHERE user_id = _booking_user AND status = 'completed';
  IF _completed_count <> 1 THEN RETURN; END IF;

  -- no referral already credited for this user, ever
  IF EXISTS (SELECT 1 FROM public.referral_transactions
              WHERE referred_user_id = _booking_user AND status = 'reward_credited') THEN
    RETURN;
  END IF;

  SELECT id, referrer_id INTO _txn_id, _referrer_id FROM public.referral_transactions
    WHERE referred_user_id = _booking_user AND status = 'pending'
    ORDER BY created_at LIMIT 1;
  IF _txn_id IS NULL OR _referrer_id IS NULL THEN RETURN; END IF;

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

  IF _reward > 0 THEN
    INSERT INTO public.wallet_transactions (user_id, amount, type, description)
      VALUES (_referrer_id, _reward, 'credit', 'Referral Reward');
    PERFORM public.notify_push_event('customer', _referrer_id, 'referral_reward',
      'Referral reward credited',
      'Your friend completed their first booking. You earned ' || _reward::text || ' coins.',
      jsonb_build_object('route','refer-earn'));
  END IF;

  PERFORM public.evaluate_reward_triggers('customer', _referrer_id, 'referral_first_booking', _txn_id::text,
    jsonb_build_object('booking_id', _booking_id, 'referred_user_id', _booking_user));
END;
$function$;

CREATE OR REPLACE FUNCTION public.bookings_after_complete_referral()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'completed' AND COALESCE(OLD.status,'') <> 'completed' THEN
    PERFORM public.credit_referral_for_booking(NEW.id);
  END IF;
  RETURN NULL;
END $function$;

DROP TRIGGER IF EXISTS trg_bookings_after_complete_referral ON public.bookings;
CREATE TRIGGER trg_bookings_after_complete_referral
AFTER UPDATE OF status ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.bookings_after_complete_referral();

-- backfill missing referral codes
UPDATE public.users
   SET referral_code = upper(substring(md5(id::text) from 1 for 6))
 WHERE referral_code IS NULL;

-- 2. Reward programs: archive + safe permanent delete
ALTER TABLE public.reward_programs ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.reward_ledger ADD COLUMN IF NOT EXISTS program_name text;
UPDATE public.reward_ledger l
   SET program_name = p.name
  FROM public.reward_programs p
 WHERE p.id = l.program_id AND l.program_name IS NULL;
ALTER TABLE public.reward_ledger ALTER COLUMN program_id DROP NOT NULL;

DO $$
DECLARE _c text;
BEGIN
  SELECT conname INTO _c FROM pg_constraint
   WHERE conrelid = 'public.reward_ledger'::regclass AND contype='f'
     AND confrelid = 'public.reward_programs'::regclass;
  IF _c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.reward_ledger DROP CONSTRAINT %I', _c);
  END IF;
END $$;
ALTER TABLE public.reward_ledger
  ADD CONSTRAINT reward_ledger_program_id_fkey
  FOREIGN KEY (program_id) REFERENCES public.reward_programs(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.reward_apply_credit(_program reward_programs, _actor_type text, _actor_id uuid, _event_ref text, _notes text DEFAULT NULL::text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _inserted uuid; _label text; _body text;
BEGIN
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
    END IF;
  END IF;

  RETURN true;
END;
$function$;

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

CREATE OR REPLACE FUNCTION public.staff_archive_reward_program(_id uuid, _archived boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _before jsonb;
BEGIN
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT to_jsonb(r) INTO _before FROM public.reward_programs r WHERE id = _id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Program not found'; END IF;
  UPDATE public.reward_programs
     SET archived_at = CASE WHEN _archived THEN now() ELSE NULL END,
         is_active = CASE WHEN _archived THEN false ELSE is_active END,
         updated_at = now()
   WHERE id = _id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state)
  VALUES (_uid, CASE WHEN _archived THEN 'archive_reward_program' ELSE 'restore_reward_program' END,
          'reward_programs', _id, _before);
END $function$;

DROP FUNCTION IF EXISTS public.staff_delete_reward_program(uuid);
CREATE OR REPLACE FUNCTION public.staff_delete_reward_program(_id uuid, _force boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _before jsonb; _has_history boolean;
BEGIN
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT to_jsonb(r) INTO _before FROM public.reward_programs r WHERE id = _id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Program not found'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.reward_ledger WHERE program_id = _id) INTO _has_history;
  IF _has_history AND NOT _force THEN
    RAISE EXCEPTION 'Program has reward history; archive it or delete permanently';
  END IF;
  UPDATE public.reward_ledger l
     SET program_name = COALESCE(l.program_name, _before->>'name')
   WHERE l.program_id = _id;
  DELETE FROM public.reward_programs WHERE id = _id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state)
  VALUES (_uid, CASE WHEN _has_history THEN 'force_delete_reward_program' ELSE 'delete_reward_program' END,
          'reward_programs', _id, _before);
END $function$;

CREATE OR REPLACE FUNCTION public.staff_reward_ledger_search(_actor_type text DEFAULT NULL::text, _program_id uuid DEFAULT NULL::uuid, _search text DEFAULT NULL::text, _from timestamp with time zone DEFAULT NULL::timestamp with time zone, _to timestamp with time zone DEFAULT NULL::timestamp with time zone, _limit integer DEFAULT 200)
RETURNS TABLE(id uuid, program_id uuid, program_name text, actor_type text, actor_id uuid, actor_name text, actor_phone text, trigger_event_ref text, reward_type text, reward_value numeric, status text, credited_at timestamp with time zone, reversed_at timestamp with time zone, reversal_reason text, notes text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_active_staff(auth.uid(), NULL) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  RETURN QUERY
  SELECT l.id, l.program_id, COALESCE(p.name, l.program_name, 'Deleted program'), l.actor_type, l.actor_id,
         COALESCE(u.full_name, e.name, m.store_name, m.owner_name) AS actor_name,
         COALESCE(u.phone, e.phone, m.phone) AS actor_phone,
         l.trigger_event_ref, l.reward_type, l.reward_value, l.status,
         l.credited_at, l.reversed_at, l.reversal_reason, l.notes
    FROM public.reward_ledger l
    LEFT JOIN public.reward_programs p ON p.id = l.program_id
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
END $function$;

REVOKE ALL ON FUNCTION public.staff_archive_reward_program(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_archive_reward_program(uuid, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.staff_delete_reward_program(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_delete_reward_program(uuid, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.credit_referral_for_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.credit_referral_for_booking(uuid) TO authenticated;