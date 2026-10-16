-- 0. snapshot
CREATE TABLE public.wallet_migration_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  user_id uuid,
  data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.wallet_migration_log TO service_role;
ALTER TABLE public.wallet_migration_log ENABLE ROW LEVEL SECURITY;
INSERT INTO public.wallet_migration_log (kind, user_id, data)
SELECT 'legacy_snapshot', u.id, jsonb_build_object('coins', u.total_coins_earned,
     'ledger', (SELECT coalesce(sum(case when type='credit' then amount else -amount end),0) FROM wallet_transactions t WHERE t.user_id=u.id),
     'wallet', (SELECT coalesce(cash_balance+bonus_balance,0) FROM customer_wallets w WHERE w.user_id=u.id))
FROM users u WHERE coalesce(u.total_coins_earned,0)<>0 OR EXISTS (SELECT 1 FROM wallet_transactions t WHERE t.user_id=u.id);

-- 1. spend helper
CREATE OR REPLACE FUNCTION public.wallet_spend(_uid uuid, _amount numeric, _type text, _ref_type text, _ref_id text, _reason text, _bonus_first boolean DEFAULT false, _partial boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w customer_wallets; _c numeric := 0; _b numeric := 0; _left numeric := round(coalesce(_amount,0),2);
BEGIN
  IF _left <= 0 THEN RETURN jsonb_build_object('cash',0,'bonus',0,'short',0); END IF;
  INSERT INTO customer_wallets(user_id) VALUES(_uid) ON CONFLICT DO NOTHING;
  SELECT * INTO w FROM customer_wallets WHERE user_id=_uid FOR UPDATE;
  IF NOT _partial AND w.cash_balance + w.bonus_balance < _left THEN
    RAISE EXCEPTION 'INSUFFICIENT_WALLET:%:%', w.cash_balance + w.bonus_balance, _left USING errcode='check_violation';
  END IF;
  IF _bonus_first THEN _b := least(_left, w.bonus_balance); _c := least(_left - _b, w.cash_balance);
  ELSE _c := least(_left, w.cash_balance); _b := least(_left - _c, w.bonus_balance); END IF;
  IF _c > 0 THEN PERFORM wallet_post(_uid,_type,'cash',-_c,_ref_type,_ref_id,_reason,NULL,NULL); END IF;
  IF _b > 0 THEN PERFORM wallet_post(_uid,_type,'bonus',-_b,_ref_type,_ref_id,_reason,NULL,NULL); END IF;
  RETURN jsonb_build_object('cash',_c,'bonus',_b,'short',_left-_c-_b);
END $$;

-- give back what a spend took, bucket by bucket (bonus returns with a fresh 30-day expiry)
CREATE OR REPLACE FUNCTION public.wallet_return(_uid uuid, _ref_type text, _ref_id text, _reason text)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _c numeric; _b numeric;
BEGIN
  SELECT coalesce(-sum(amount) filter (where bucket='cash'),0), coalesce(-sum(amount) filter (where bucket='bonus'),0)
    INTO _c, _b FROM customer_wallet_ledger WHERE user_id=_uid AND ref_type=_ref_type AND ref_id=_ref_id;
  IF _c > 0 THEN PERFORM wallet_post(_uid,'refund_in','cash',_c,_ref_type,_ref_id,_reason,NULL,NULL); END IF;
  IF _b > 0 THEN PERFORM wallet_post(_uid,'bonus','bonus',_b,_ref_type,_ref_id,_reason,now()+interval '30 days',NULL); END IF;
  RETURN _c + _b;
END $$;

-- 2. mirror wallet total into users.total_coins_earned (read-only copy)
CREATE OR REPLACE FUNCTION public.customer_wallets_mirror() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.wallet_mirror','on',true);
  PERFORM set_config('app.users_bypass','on',true);
  UPDATE users SET total_coins_earned = floor(NEW.cash_balance + NEW.bonus_balance)::int WHERE id = NEW.user_id
    AND total_coins_earned IS DISTINCT FROM floor(NEW.cash_balance + NEW.bonus_balance)::int;
  PERFORM set_config('app.users_bypass','off',true);
  PERFORM set_config('app.wallet_mirror','off',true);
  RETURN NEW;
END $$;
CREATE TRIGGER customer_wallets_mirror AFTER INSERT OR UPDATE ON public.customer_wallets FOR EACH ROW EXECUTE FUNCTION public.customer_wallets_mirror();

-- 3. one-time move of old coins (idempotent)
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT id, total_coins_earned c FROM users WHERE coalesce(total_coins_earned,0) > 0
           AND NOT EXISTS (SELECT 1 FROM customer_wallet_ledger l WHERE l.user_id=users.id AND l.ref_type='legacy_coins') LOOP
    PERFORM wallet_post(r.id,'bonus','bonus',r.c,'legacy_coins',r.id::text,'Opening balance (old coins)',now()+interval '30 days',NULL);
    INSERT INTO wallet_transactions(user_id, amount, type, description) VALUES (r.id, r.c, 'debit', 'Moved to wallet (opening balance)');
  END LOOP;
  -- negative legacy history: close at zero
  INSERT INTO wallet_transactions(user_id, amount, type, description)
  SELECT user_id, -sum(case when type='credit' then amount else -amount end), 'credit', 'Closed at zero (moved to wallet)'
  FROM wallet_transactions GROUP BY user_id HAVING sum(case when type='credit' then amount else -amount end) < 0;
  PERFORM set_config('app.users_bypass','on',true);
  UPDATE users u SET total_coins_earned = 0 WHERE coalesce(total_coins_earned,0) <> 0
    AND NOT EXISTS (SELECT 1 FROM customer_wallets w WHERE w.user_id=u.id);
  PERFORM set_config('app.users_bypass','off',true);
END $$;

-- 4. users.total_coins_earned can only change through the mirror
CREATE OR REPLACE FUNCTION public.users_coins_readonly() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.total_coins_earned IS DISTINCT FROM OLD.total_coins_earned AND coalesce(current_setting('app.wallet_mirror',true),'') <> 'on' THEN
    NEW.total_coins_earned := OLD.total_coins_earned;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER zz_users_coins_readonly BEFORE UPDATE OF total_coins_earned ON public.users FOR EACH ROW EXECUTE FUNCTION public.users_coins_readonly();

-- 5. old history is read-only; any new old-style entry is posted to the new wallet instead
CREATE OR REPLACE FUNCTION public.wallet_transactions_redirect() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r jsonb;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Old wallet history is read-only'; END IF;
  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN RETURN NULL; END IF;
  IF NEW.type = 'credit' THEN
    PERFORM wallet_post(NEW.user_id,'bonus','bonus',NEW.amount,
      CASE WHEN NEW.description ILIKE 'Referral%' THEN 'referral' ELSE 'reward' END, NULL,
      NEW.description, now()+interval '30 days', NULL);
  ELSE
    _r := wallet_spend(NEW.user_id, NEW.amount, 'admin_adjustment', 'reversal', NULL, NEW.description, true, true);
    IF (_r->>'short')::numeric > 0 THEN
      INSERT INTO wallet_migration_log(kind, user_id, data)
      VALUES ('reversal_shortfall', NEW.user_id, jsonb_build_object('reason',NEW.description,'wanted',NEW.amount,'taken',_r));
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER wallet_transactions_redirect BEFORE INSERT OR UPDATE OR DELETE ON public.wallet_transactions FOR EACH ROW EXECUTE FUNCTION public.wallet_transactions_redirect();

-- 6. coin payment paths now use the wallet directly
CREATE OR REPLACE FUNCTION public.bookings_coin_debit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _need numeric; _key text;
BEGIN
  IF COALESCE(NEW.is_training,false) OR NEW.user_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.razorpay_payment_id IS NULL OR NEW.razorpay_payment_id NOT LIKE 'free\_%' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.razorpay_payment_id IS NOT DISTINCT FROM NEW.razorpay_payment_id THEN RETURN NEW; END IF;
  -- wallet pays the full amount incl. GST, cash first then bonus
  _need := round(GREATEST(COALESCE(NEW.total_amount, COALESCE(NEW.price,0) - COALESCE(NEW.discount_amount,0)), 0), 2);
  IF _need <= 0 THEN RETURN NEW; END IF;
  _key := 'booking:' || NEW.id::text;
  IF EXISTS (SELECT 1 FROM coin_redemptions WHERE razorpay_order_id = _key) THEN RETURN NEW; END IF;
  PERFORM wallet_spend(NEW.user_id, _need, 'payment', 'booking_coins', NEW.id::text, 'Paid for booking ' || coalesce(NEW.booking_number, '#' || left(NEW.id::text,6)));
  INSERT INTO coin_redemptions(user_id, razorpay_order_id, coins, status) VALUES (NEW.user_id, _key, ceil(_need)::int, 'used');
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.bookings_coin_refund_on_cancel() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _r record; _back numeric;
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    SELECT * INTO _r FROM coin_redemptions WHERE razorpay_order_id = 'booking:' || NEW.id::text AND status = 'used' FOR UPDATE;
    IF _r.id IS NOT NULL THEN
      UPDATE coin_redemptions SET status = 'refunded' WHERE id = _r.id;
      _back := wallet_return(_r.user_id, 'booking_coins', NEW.id::text, 'Returned — booking ' || coalesce(NEW.booking_number,'#' || left(NEW.id::text,6)) || ' cancelled');
      IF _back = 0 THEN -- paid before the move: coins were part of the opening balance
        PERFORM wallet_post(_r.user_id,'bonus','bonus',_r.coins,'booking_coins',NEW.id::text,'Returned — booking cancelled',now()+interval '30 days',NULL);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.system_coins_reserve(_user_id uuid, _order_id text, _coins integer) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _existing integer; _bal numeric; _take integer;
BEGIN
  IF _user_id IS NULL OR _order_id IS NULL OR COALESCE(_coins,0) <= 0 THEN RETURN 0; END IF;
  SELECT coins INTO _existing FROM coin_redemptions WHERE razorpay_order_id = _order_id AND status = 'reserved';
  IF _existing IS NOT NULL THEN RETURN _existing; END IF;
  SELECT coalesce(cash_balance+bonus_balance,0) INTO _bal FROM customer_wallets WHERE user_id=_user_id FOR UPDATE;
  _take := floor(LEAST(_coins, GREATEST(coalesce(_bal,0),0)))::int;
  IF _take <= 0 THEN RETURN 0; END IF;
  PERFORM wallet_spend(_user_id, _take, 'payment', 'coin_reserve', _order_id, 'Used on a booking payment');
  INSERT INTO coin_redemptions(user_id, razorpay_order_id, coins, status) VALUES (_user_id, _order_id, _take, 'reserved');
  RETURN _take;
END $function$;

CREATE OR REPLACE FUNCTION public.system_coins_release(_order_id text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _r record;
BEGIN
  SELECT * INTO _r FROM coin_redemptions WHERE razorpay_order_id = _order_id AND status = 'reserved' FOR UPDATE;
  IF _r IS NULL THEN RETURN 0; END IF;
  UPDATE coin_redemptions SET status = 'released' WHERE id = _r.id;
  PERFORM wallet_return(_r.user_id, 'coin_reserve', _order_id, 'Returned — booking payment not completed');
  RETURN _r.coins;
END $function$;

CREATE OR REPLACE FUNCTION public.my_coin_balance() RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((SELECT floor(cash_balance+bonus_balance)::int FROM customer_wallets WHERE user_id = auth.uid()), 0);
$$;

-- 7. app functions
CREATE OR REPLACE FUNCTION public.app_wallet_summary() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _c numeric; _b numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT coalesce(cash_balance,0), coalesce(bonus_balance,0) INTO _c, _b FROM customer_wallets WHERE user_id = auth.uid();
  _c := coalesce(_c,0); _b := coalesce(_b,0);
  RETURN jsonb_build_object('balance', _c+_b, 'cash', _c, 'bonus', _b,
    'bonus_validity_days', 30,
    'bonus_note', 'Bonus money expires 30 days after it is added.',
    'bonus_expiring', coalesce((SELECT jsonb_agg(jsonb_build_object('amount', amt, 'expires_at', expires_at) ORDER BY expires_at)
       FROM (SELECT least(amount, _b) amt, expires_at FROM customer_wallet_ledger
             WHERE user_id = auth.uid() AND type='bonus' AND NOT expired AND expires_at > now() AND amount > 0) x WHERE _b > 0), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.app_wallet_history(_limit integer DEFAULT 30, _before timestamptz DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _l int := greatest(1, least(coalesce(_limit,30), 100)); _rows jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb) INTO _rows FROM (
    SELECT * FROM (
      SELECT l.id, l.created_at, l.amount, l.bucket,
        CASE WHEN l.ref_type='legacy_coins' THEN 'opening_balance'
             WHEN l.ref_type='referral' THEN 'referral'
             WHEN l.type='top_up' THEN 'top_up'
             WHEN l.type='payment' THEN 'payment'
             WHEN l.type='refund_in' OR (l.type='bonus' AND l.ref_type IN ('booking_coins','coin_reserve')) THEN 'refund'
             WHEN l.type='bonus_expiry' THEN 'bonus_expired'
             WHEN l.type='bonus' THEN 'bonus'
             ELSE 'adjustment' END AS kind,
        coalesce(l.reason, initcap(replace(l.type,'_',' '))) AS label,
        l.expires_at, false AS legacy
      FROM customer_wallet_ledger l WHERE l.user_id = auth.uid()
      UNION ALL
      SELECT t.id, t.created_at, CASE WHEN t.type='credit' THEN t.amount ELSE -t.amount END, 'old_coins',
        'old_coins', t.description, NULL::timestamptz, true
      FROM wallet_transactions t WHERE t.user_id = auth.uid()
    ) a WHERE _before IS NULL OR a.created_at < _before
    ORDER BY created_at DESC LIMIT _l) x;
  RETURN jsonb_build_object('items', _rows,
    'next_before', CASE WHEN jsonb_array_length(_rows) = _l THEN _rows->(_l-1)->>'created_at' END);
END $$;

REVOKE ALL ON FUNCTION public.app_wallet_summary() FROM public, anon;
REVOKE ALL ON FUNCTION public.app_wallet_history(integer, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.app_wallet_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_wallet_history(integer, timestamptz) TO authenticated;
REVOKE ALL ON FUNCTION public.wallet_spend(uuid,numeric,text,text,text,text,boolean,boolean) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.wallet_return(uuid,text,text,text) FROM public, anon, authenticated;