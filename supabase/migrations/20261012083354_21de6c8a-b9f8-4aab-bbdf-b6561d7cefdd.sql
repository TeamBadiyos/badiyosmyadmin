CREATE OR REPLACE FUNCTION public.bookings_coin_debit()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _need integer; _bal integer; _key text;
BEGIN
  IF COALESCE(NEW.is_training,false) OR NEW.user_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.razorpay_payment_id IS NULL OR NEW.razorpay_payment_id NOT LIKE 'free\_%' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.razorpay_payment_id IS NOT DISTINCT FROM NEW.razorpay_payment_id THEN RETURN NEW; END IF;
  -- 1 coin = Rs 1 on service value after discount; GST is never charged in coins
  _need := ceil(GREATEST(COALESCE(NEW.price,0) - COALESCE(NEW.discount_amount,0), 0))::int;
  IF _need <= 0 THEN RETURN NEW; END IF;
  _key := 'booking:' || NEW.id::text;
  IF EXISTS (SELECT 1 FROM coin_redemptions WHERE razorpay_order_id = _key) THEN RETURN NEW; END IF;
  SELECT COALESCE(total_coins_earned,0) INTO _bal FROM users WHERE id = NEW.user_id FOR UPDATE;
  IF COALESCE(_bal,0) < _need THEN
    RAISE EXCEPTION 'INSUFFICIENT_COINS:%:%', COALESCE(_bal,0), _need
      USING errcode = 'check_violation', hint = 'Not enough coins to cover this booking.';
  END IF;
  PERFORM set_config('app.users_bypass','on',true);
  UPDATE users SET total_coins_earned = _bal - _need WHERE id = NEW.user_id;
  PERFORM set_config('app.users_bypass','off',true);
  INSERT INTO coin_redemptions(user_id, razorpay_order_id, coins, status) VALUES (NEW.user_id, _key, _need, 'used');
  INSERT INTO wallet_transactions(user_id, amount, type, description)
  VALUES (NEW.user_id, _need, 'debit', 'Coins used for booking #' || left(NEW.id::text,6));
  RETURN NEW;
END $function$;

-- One-time correction: GST portion should not have been charged in coins
DO $$
DECLARE r record; _diff int;
BEGIN
  PERFORM set_config('app.users_bypass','on',true);
  FOR r IN
    SELECT cr.id cid, cr.coins, b.id bid, b.user_id,
           ceil(GREATEST(COALESCE(b.price,0)-COALESCE(b.discount_amount,0),0))::int need
    FROM coin_redemptions cr JOIN bookings b ON cr.razorpay_order_id = 'booking:'||b.id
    WHERE cr.status='used'
  LOOP
    _diff := r.coins - r.need;
    IF _diff > 0 THEN
      UPDATE coin_redemptions SET coins = r.need WHERE id = r.cid;
      INSERT INTO wallet_transactions(user_id, amount, type, description)
      VALUES (r.user_id, _diff, 'credit', 'GST coins returned for booking #'||left(r.bid::text,6)||' (correction)');
    END IF;
  END LOOP;
  -- Set balance = wallet ledger (may be negative; future coins offset the deficit)
  UPDATE users u SET total_coins_earned = s.bal
  FROM (SELECT user_id, sum(CASE WHEN type='debit' THEN -amount ELSE amount END)::int bal
        FROM wallet_transactions WHERE user_id IN (SELECT DISTINCT user_id FROM coin_redemptions WHERE razorpay_order_id LIKE 'booking:%') GROUP BY user_id) s
  WHERE u.id = s.user_id;
  PERFORM set_config('app.users_bypass','off',true);
END $$;