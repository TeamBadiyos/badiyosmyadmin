CREATE OR REPLACE FUNCTION public.bookings_coin_debit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _need integer; _bal integer; _key text;
BEGIN
  IF COALESCE(NEW.is_training,false) OR NEW.user_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.razorpay_payment_id IS NULL OR NEW.razorpay_payment_id NOT LIKE 'free\_%' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.razorpay_payment_id IS NOT DISTINCT FROM NEW.razorpay_payment_id THEN RETURN NEW; END IF;
  _need := ceil(COALESCE(NEW.total_amount,0))::int;
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
END $$;

CREATE OR REPLACE FUNCTION public.bookings_coin_refund_on_cancel()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _r record;
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    SELECT * INTO _r FROM coin_redemptions WHERE razorpay_order_id = 'booking:' || NEW.id::text AND status = 'used' FOR UPDATE;
    IF _r.id IS NOT NULL THEN
      UPDATE coin_redemptions SET status = 'refunded' WHERE id = _r.id;
      PERFORM set_config('app.users_bypass','on',true);
      UPDATE users SET total_coins_earned = COALESCE(total_coins_earned,0) + _r.coins WHERE id = _r.user_id;
      PERFORM set_config('app.users_bypass','off',true);
      INSERT INTO wallet_transactions(user_id, amount, type, description)
      VALUES (_r.user_id, _r.coins, 'credit', 'Coins returned — booking #' || left(NEW.id::text,6) || ' cancelled');
    END IF;
  END IF;
  RETURN NEW;
END $$;