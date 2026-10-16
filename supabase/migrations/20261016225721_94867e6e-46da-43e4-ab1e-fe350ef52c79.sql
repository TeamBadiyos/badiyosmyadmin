INSERT INTO public.ops_settings(key, value, label) VALUES ('wallet_bonus_expiry_days','30','Wallet bonus expires after (days)') ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.wallet_bonus_days() RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS
$$ SELECT greatest(1, least(365, coalesce((SELECT nullif(value,'')::int FROM ops_settings WHERE key='wallet_bonus_expiry_days'), 30))) $$;

DO $$ DECLARE f text; d text; BEGIN
  FOREACH f IN ARRAY ARRAY['public.wallet_transactions_redirect()','public.wallet_return(uuid,text,text,text)','public.bookings_coin_refund_on_cancel()'] LOOP
    d := pg_get_functiondef(f::regprocedure);
    d := replace(d, 'now()+interval ''30 days''', 'now()+make_interval(days=>public.wallet_bonus_days())');
    d := replace(d, 'now() + interval ''30 days''', 'now()+make_interval(days=>public.wallet_bonus_days())');
    EXECUTE d;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.staff_set_wallet_bonus_days(_days integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _old text;
BEGIN
  IF NOT public.is_super_admin_user() THEN RAISE EXCEPTION 'Super admin only'; END IF;
  IF _days IS NULL OR _days < 1 OR _days > 365 THEN RAISE EXCEPTION 'Days must be 1–365'; END IF;
  SELECT value INTO _old FROM ops_settings WHERE key='wallet_bonus_expiry_days';
  UPDATE ops_settings SET value=_days::text, updated_at=now() WHERE key='wallet_bonus_expiry_days';
  INSERT INTO audit_logs(actor_id,action,target_table,target_id,before_state,after_state)
  VALUES (auth.uid(),'wallet_bonus_days_changed','ops_settings',NULL,jsonb_build_object('days',_old),jsonb_build_object('days',_days));
END $$;

-- remaining bonus per credit: balance belongs to the latest-expiring credits (spending is oldest-expiry first)
CREATE OR REPLACE FUNCTION public.wallet_bonus_lots(_uid uuid)
RETURNS TABLE(ledger_id uuid, remaining numeric, expires_at timestamptz, credited_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE _left numeric; r record; _take numeric;
BEGIN
  SELECT coalesce(bonus_balance,0) INTO _left FROM customer_wallets WHERE user_id=_uid;
  _left := coalesce(_left,0);
  FOR r IN SELECT l.id, l.amount, l.expires_at, l.created_at FROM customer_wallet_ledger l
           WHERE l.user_id=_uid AND l.type='bonus' AND l.bucket='bonus' AND l.amount>0 AND NOT l.expired
           ORDER BY l.expires_at DESC NULLS FIRST, l.created_at DESC LOOP
    EXIT WHEN _left <= 0;
    _take := least(r.amount, _left); _left := _left - _take;
    ledger_id := r.id; remaining := _take; expires_at := r.expires_at; credited_at := r.created_at; RETURN NEXT;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.wallet_expire_bonuses() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE u uuid; l record; _n int := 0;
BEGIN
  FOR u IN SELECT DISTINCT user_id FROM customer_wallet_ledger WHERE type='bonus' AND NOT expired AND expires_at < now() LOOP
    FOR l IN SELECT * FROM wallet_bonus_lots(u) WHERE expires_at < now() LOOP
      IF l.remaining > 0 THEN
        PERFORM wallet_post(u,'bonus_expiry','bonus',-l.remaining,'bonus',l.ledger_id::text,
          'Bonus expired (credited ' || to_char(l.credited_at AT TIME ZONE 'Asia/Kolkata','DD Mon YYYY') || ')',NULL,NULL);
        _n := _n + 1;
      END IF;
    END LOOP;
    UPDATE customer_wallet_ledger SET expired=true WHERE user_id=u AND type='bonus' AND NOT expired AND expires_at < now();
  END LOOP;
  RETURN _n;
END $$;

-- offer-notification opt-out
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS offer_notifications boolean NOT NULL DEFAULT true;
CREATE OR REPLACE FUNCTION public.app_set_offer_notifications(_on boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  PERFORM set_config('app.users_bypass','on',true);
  UPDATE users SET offer_notifications=coalesce(_on,true) WHERE id=auth.uid();
  PERFORM set_config('app.users_bypass','off',true);
  RETURN jsonb_build_object('offer_notifications', coalesce(_on,true));
END $$;

-- reminders
CREATE TABLE public.wallet_expiry_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  expires_on date NOT NULL,
  days_before integer NOT NULL,
  amount numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, expires_on, days_before)
);
GRANT ALL ON public.wallet_expiry_reminders TO service_role;
GRANT SELECT ON public.wallet_expiry_reminders TO authenticated;
ALTER TABLE public.wallet_expiry_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can view reminders" ON public.wallet_expiry_reminders FOR SELECT TO authenticated USING (public.is_super_admin_user());
CREATE POLICY cc_reader_all ON public.wallet_expiry_reminders FOR SELECT TO cc_reader USING (true);
GRANT SELECT ON public.wallet_expiry_reminders TO cc_reader;

CREATE OR REPLACE FUNCTION public.wallet_send_expiry_reminders() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _today date := (now() AT TIME ZONE 'Asia/Kolkata')::date; d int; u record; _amt numeric; _day date; _ds text; _en text; _mr text; _n int := 0; _id uuid;
BEGIN
  FOREACH d IN ARRAY ARRAY[15,10,5] LOOP
    _day := _today + d;
    FOR u IN SELECT DISTINCT l.user_id FROM customer_wallet_ledger l JOIN users us ON us.id=l.user_id
             WHERE l.type='bonus' AND NOT l.expired AND (l.expires_at AT TIME ZONE 'Asia/Kolkata')::date = _day
               AND coalesce(us.offer_notifications,true) LOOP
      SELECT coalesce(sum(remaining),0) INTO _amt FROM wallet_bonus_lots(u.user_id) x WHERE (x.expires_at AT TIME ZONE 'Asia/Kolkata')::date = _day;
      _amt := floor(_amt);
      CONTINUE WHEN _amt <= 0;
      INSERT INTO wallet_expiry_reminders(user_id, expires_on, days_before, amount) VALUES (u.user_id, _day, d, _amt)
        ON CONFLICT DO NOTHING RETURNING id INTO _id;
      CONTINUE WHEN _id IS NULL;
      _ds := to_char(_day,'DD Mon');
      _en := '₹' || _amt::text || ' badiyos Wallet bonus expires on ' || _ds || '. Use it on your next booking 🎉';
      _mr := 'तुमचा ₹' || _amt::text || ' badiyos Wallet बोनस ' || _ds || ' ला संपेल. पुढच्या बुकिंगला वापरा 🎉';
      PERFORM notify_push_event('customer', u.user_id, 'wallet_bonus_expiry', 'Wallet bonus expiring', _en,
        jsonb_build_object('route','clean','tab','clean','amount',_amt,'expires_on',_day,'body_mr',_mr,'title_mr','वॉलेट बोनस संपत आहे'));
      INSERT INTO party_notifications(party_type, party_id, auth_user_id, kind, title, body, data)
      VALUES ('customer', u.user_id, u.user_id, 'wallet_bonus_expiry', 'Wallet bonus expiring', _en,
        jsonb_build_object('route','clean','amount',_amt,'expires_on',_day,'body_mr',_mr,'title_mr','वॉलेट बोनस संपत आहे'));
      _n := _n + 1; _id := NULL;
    END LOOP;
  END LOOP;
  RETURN _n;
END $$;

SELECT cron.schedule('wallet-bonus-expiry-reminders', '30 4 * * *', $$SELECT public.wallet_send_expiry_reminders()$$);

-- app summary uses the real remaining lots
CREATE OR REPLACE FUNCTION public.app_wallet_summary() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _c numeric; _b numeric; _days int := wallet_bonus_days();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT coalesce(cash_balance,0), coalesce(bonus_balance,0) INTO _c, _b FROM customer_wallets WHERE user_id = auth.uid();
  _c := coalesce(_c,0); _b := coalesce(_b,0);
  RETURN jsonb_build_object('balance', _c+_b, 'cash', _c, 'bonus', _b,
    'bonus_validity_days', _days,
    'bonus_note', 'Bonus money expires ' || _days || ' days after it is added.',
    'bonus_note_mr', 'बोनस रक्कम जमा झाल्यापासून ' || _days || ' दिवसांनी संपते.',
    'offer_notifications', (SELECT offer_notifications FROM users WHERE id=auth.uid()),
    'bonus_expiring', coalesce((SELECT jsonb_agg(jsonb_build_object('amount', amt, 'expires_at', ex) ORDER BY ex)
       FROM (SELECT sum(remaining) amt, (expires_at AT TIME ZONE 'Asia/Kolkata')::date ex FROM wallet_bonus_lots(auth.uid()) WHERE expires_at IS NOT NULL GROUP BY 2) x), '[]'::jsonb));
END $$;

-- Clothing & Footwear
DO $$ DECLARE _o uuid := (SELECT id FROM store_categories WHERE is_other AND city_id IS NULL LIMIT 1); _c uuid := (SELECT id FROM store_categories WHERE slug='clothing-footwear'); BEGIN
  IF _c IS NOT NULL THEN
    UPDATE merchants SET store_category_id=_o WHERE store_category_id=_c;
    DELETE FROM store_categories WHERE id=_c;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.wallet_bonus_lots(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.wallet_send_expiry_reminders() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.wallet_expire_bonuses() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.staff_set_wallet_bonus_days(integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.app_set_offer_notifications(boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.app_set_offer_notifications(boolean) TO authenticated;