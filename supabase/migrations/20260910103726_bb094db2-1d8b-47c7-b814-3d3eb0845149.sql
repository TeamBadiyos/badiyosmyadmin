
-- 1. Fix radius expansion job (blocked by the direct-update guard)
CREATE OR REPLACE FUNCTION public.expand_stale_broadcasts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  cfg record;
  b record;
  _new_radius numeric;
  _expanded integer := 0;
BEGIN
  SELECT * INTO cfg FROM public.dispatch_config LIMIT 1;
  IF cfg.id IS NULL THEN RETURN 0; END IF;

  FOR b IN
    SELECT id, COALESCE(current_search_radius_km, cfg.broadcast_radius_km) AS radius
    FROM public.bookings
    WHERE status = 'accepted'
      AND assigned_expert_id IS NULL
      AND deleted_at IS NULL
      AND broadcast_started_at IS NOT NULL
      AND broadcast_started_at < now() - make_interval(secs => cfg.radius_expand_after_seconds)
      AND COALESCE(current_search_radius_km, cfg.broadcast_radius_km) < cfg.radius_expand_max_km
  LOOP
    _new_radius := LEAST(b.radius + cfg.radius_expand_step_km, cfg.radius_expand_max_km);
    PERFORM set_config('app.booking_bypass','on', true);
    UPDATE public.bookings SET current_search_radius_km = _new_radius WHERE id = b.id;
    PERFORM set_config('app.booking_bypass','off', true);
    PERFORM public.broadcast_booking_to_experts(b.id, _new_radius);
    _expanded := _expanded + 1;
  END LOOP;

  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings
     SET dispatch_exhausted_at = now()
   WHERE status = 'accepted'
     AND assigned_expert_id IS NULL
     AND deleted_at IS NULL
     AND dispatch_exhausted_at IS NULL
     AND broadcast_started_at IS NOT NULL
     AND broadcast_started_at < now() - make_interval(secs => cfg.radius_expand_after_seconds)
     AND COALESCE(current_search_radius_km, cfg.broadcast_radius_km) >= cfg.radius_expand_max_km;
  PERFORM set_config('app.booking_bypass','off', true);

  RETURN _expanded;
END;
$fn$;

-- 2. Tip received -> notify expert
CREATE OR REPLACE FUNCTION public.record_booking_tip(_booking_id uuid, _amount numeric, _razorpay_payment_id text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_expert uuid;
  v_tip_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _amount IS NULL OR _amount NOT IN (25, 50, 100) THEN RAISE EXCEPTION 'Invalid tip amount'; END IF;
  IF _razorpay_payment_id IS NULL OR length(trim(_razorpay_payment_id)) = 0 THEN
    RAISE EXCEPTION 'Missing payment reference';
  END IF;

  SELECT assigned_expert_id INTO v_expert
  FROM public.bookings WHERE id = _booking_id AND user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF v_expert IS NULL THEN RAISE EXCEPTION 'No expert assigned'; END IF;

  SELECT id INTO v_tip_id FROM public.booking_tips WHERE razorpay_payment_id = _razorpay_payment_id;
  IF v_tip_id IS NOT NULL THEN RETURN v_tip_id; END IF;

  INSERT INTO public.booking_tips (booking_id, expert_id, user_id, amount, razorpay_payment_id, status)
  VALUES (_booking_id, v_expert, v_uid, _amount, _razorpay_payment_id, 'paid')
  RETURNING id INTO v_tip_id;

  UPDATE public.experts
  SET wallet_balance = COALESCE(wallet_balance, 0) + _amount
  WHERE id = v_expert;

  INSERT INTO public.wallet_ledger (owner_type, owner_id, amount, type, reason, created_by)
  VALUES ('expert', v_expert, _amount, 'credit', 'Customer tip', v_uid);

  PERFORM public.notify_expert_alert(
    v_expert, 'tip_received', 'You received a tip!',
    'A customer tipped you ' || to_char(_amount, 'FM999999') || ' for your service.',
    jsonb_build_object('booking_id', _booking_id, 'amount', _amount, 'route', 'earnings')
  );

  RETURN v_tip_id;
END;
$fn$;

-- 3. Reward credited -> notify the earner
CREATE OR REPLACE FUNCTION public.reward_apply_credit(_program record, _actor_type text, _actor_id uuid, _event_ref text, _notes text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _inserted uuid; _label text; _body text;
BEGIN
  INSERT INTO public.reward_ledger(program_id, actor_type, actor_id, trigger_event_ref,
                                   reward_type, reward_value, status, notes)
  VALUES (_program.id, _actor_type, _actor_id, _event_ref,
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

    _label := CASE WHEN _program.reward_type = 'coins' THEN
                COALESCE(_program.reward_value,0)::text || ' coins'
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
$fn$;

-- 4. Referral bonus -> notify the referrer
CREATE OR REPLACE FUNCTION public.credit_referral_for_booking(_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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

  PERFORM public.notify_push_event('customer', _referrer_id, 'referral_reward',
    'Referral reward credited',
    'Your friend completed their first booking. You earned ' || _reward::text || ' coins.',
    jsonb_build_object('route','refer-earn'));

  PERFORM public.evaluate_reward_triggers('customer', _referrer_id, 'referral_first_booking', _txn_id::text,
    jsonb_build_object('booking_id', _booking_id, 'referred_user_id', _uid));
END;
$fn$;

-- 5. Payout paid -> notify expert
CREATE OR REPLACE FUNCTION public.staff_mark_payout_item_paid(_item_id uuid, _paid boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _uid uuid := auth.uid(); _batch uuid; _before jsonb; _after jsonb;
        _owner_type text; _owner_id uuid; _amount numeric;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT to_jsonb(i), batch_id, i.owner_type, i.owner_id, i.amount
    INTO _before, _batch, _owner_type, _owner_id, _amount
    FROM public.payout_batch_items i WHERE id=_item_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Item not found'; END IF;
  UPDATE public.payout_batch_items
     SET paid = _paid,
         paid_at = CASE WHEN _paid THEN now() ELSE NULL END
   WHERE id = _item_id;
  SELECT to_jsonb(i) INTO _after FROM public.payout_batch_items i WHERE id=_item_id;

  IF _paid AND NOT EXISTS (SELECT 1 FROM public.payout_batch_items WHERE batch_id=_batch AND paid=false) THEN
    UPDATE public.payout_batches SET status='paid', paid_at=now() WHERE id=_batch;
  ELSIF NOT _paid THEN
    UPDATE public.payout_batches SET status='pending', paid_at=NULL WHERE id=_batch;
  END IF;

  IF _paid AND _owner_type = 'expert' THEN
    PERFORM public.notify_expert_alert(_owner_id, 'payout_paid', 'Payout sent',
      'Your payout of ₹' || COALESCE(_amount,0)::text || ' has been paid out.',
      jsonb_build_object('route','earnings'));
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
    VALUES(_uid,'mark_payout_item_paid','payout_batch_items',_item_id,_before,_after);
END
$fn$;

CREATE OR REPLACE FUNCTION public.staff_mark_payout_batch_paid(_batch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _uid uuid := auth.uid(); _before jsonb; _after jsonb; r record;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT to_jsonb(b) INTO _before FROM public.payout_batches b WHERE id=_batch_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Batch not found'; END IF;

  FOR r IN SELECT owner_type, owner_id, amount FROM public.payout_batch_items
            WHERE batch_id=_batch_id AND paid=false AND owner_type='expert'
  LOOP
    PERFORM public.notify_expert_alert(r.owner_id, 'payout_paid', 'Payout sent',
      'Your payout of ₹' || COALESCE(r.amount,0)::text || ' has been paid out.',
      jsonb_build_object('route','earnings'));
  END LOOP;

  UPDATE public.payout_batch_items SET paid=true, paid_at=now() WHERE batch_id=_batch_id AND paid=false;
  UPDATE public.payout_batches SET status='paid', paid_at=now() WHERE id=_batch_id;
  SELECT to_jsonb(b) INTO _after FROM public.payout_batches b WHERE id=_batch_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
    VALUES(_uid,'mark_payout_batch_paid','payout_batches',_batch_id,_before,_after);
END
$fn$;

-- 6. Merchant order status -> notify customer
CREATE OR REPLACE FUNCTION public.notify_customer_order_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _title text; _body text; _store text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;

  SELECT store_name INTO _store FROM public.merchants WHERE id = NEW.merchant_id;
  _store := COALESCE(_store, 'the store');

  IF NEW.status = 'accepted' THEN
    _title := 'Order accepted'; _body := _store || ' accepted your order.';
  ELSIF NEW.status = 'preparing' THEN
    _title := 'Order being prepared'; _body := _store || ' is preparing your order.';
  ELSIF NEW.status = 'ready' THEN
    _title := 'Order ready'; _body := 'Your order from ' || _store || ' is ready.';
  ELSIF NEW.status = 'completed' THEN
    _title := 'Order completed'; _body := 'Your order from ' || _store || ' is complete.';
  ELSIF NEW.status = 'rejected' THEN
    _title := 'Order declined'; _body := _store || ' could not accept your order. Any payment will be refunded.';
  ELSE
    RETURN NEW;
  END IF;

  PERFORM public.notify_push_event('customer', NEW.user_id, 'order_' || NEW.status,
    _title, _body,
    jsonb_build_object('order_id', NEW.id, 'route', 'my-orders', 'status', NEW.status));
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_notify_customer_order_status ON public.merchant_orders;
CREATE TRIGGER trg_notify_customer_order_status
AFTER UPDATE ON public.merchant_orders
FOR EACH ROW EXECUTE FUNCTION public.notify_customer_order_status();

-- 7. Expert declines an assigned job -> tell the customer we are re-searching
CREATE OR REPLACE FUNCTION public.expert_reject_booking(_booking_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _expert_id uuid; _b record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  _expert_id := public.get_expert_id_for_auth(auth.uid());
  IF _expert_id IS NULL THEN RAISE EXCEPTION 'Not an expert'; END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION 'Reason required'; END IF;

  SELECT id, assigned_expert_id, status
    INTO _b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF _b.id IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _b.assigned_expert_id <> _expert_id THEN RAISE EXCEPTION 'Not your booking'; END IF;
  IF _b.status <> 'expert_assigned' THEN RAISE EXCEPTION 'Booking cannot be rejected now'; END IF;

  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings
     SET assigned_expert_id = NULL,
         status = 'accepted',
         cancellation_reason = btrim(_reason)
   WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);

  UPDATE public.experts SET is_busy = false WHERE id = _expert_id;

  PERFORM public.notify_customer_alert(_booking_id, 'booking_researching',
    'Finding you another expert',
    'Your expert became unavailable. We are assigning someone else right away.',
    jsonb_build_object('route','my-bookings'));

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), 'expert_rejected_booking', 'bookings', _booking_id,
    jsonb_build_object('assigned_expert_id', _expert_id, 'status', 'expert_assigned'),
    jsonb_build_object('status', 'accepted', 'reason', btrim(_reason)));
END
$fn$;

-- 8. Expert KYC decision and forced offline -> notify expert
CREATE OR REPLACE FUNCTION public.staff_expert_kyc_decision(_expert_id uuid, _decision text, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _before jsonb;
  _after jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT role INTO _role FROM public.staff_users WHERE auth_user_id=_uid AND status='active';
  IF _role IS NULL OR _role NOT IN ('super_admin','ops_manager') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _decision NOT IN ('approved','rejected','pending') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
  IF _decision = 'rejected' AND coalesce(btrim(_reason),'') = '' THEN RAISE EXCEPTION 'Rejection reason required'; END IF;
  IF _decision = 'pending' AND _role <> 'super_admin' THEN RAISE EXCEPTION 'Only super_admin can reset KYC'; END IF;

  SELECT to_jsonb(e) INTO _before FROM public.experts e WHERE id=_expert_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Expert not found'; END IF;

  UPDATE public.experts
     SET kyc_status = _decision,
         kyc_rejection_reason = CASE WHEN _decision='rejected' THEN btrim(_reason) ELSE NULL END
   WHERE id = _expert_id;

  IF _decision = 'approved' THEN
    PERFORM public.notify_expert_alert(_expert_id, 'kyc_approved', 'You are verified',
      'Your documents were approved. You can go online and start accepting jobs.',
      jsonb_build_object('route','profile'));
  ELSIF _decision = 'rejected' THEN
    PERFORM public.notify_expert_alert(_expert_id, 'kyc_rejected', 'Verification needs attention',
      btrim(_reason), jsonb_build_object('route','profile'));
  END IF;

  SELECT to_jsonb(e) INTO _after FROM public.experts e WHERE id=_expert_id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'kyc_' || _decision, 'experts', _expert_id, _before, _after);
END
$fn$;

CREATE OR REPLACE FUNCTION public.staff_force_expert_offline(_expert_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  UPDATE public.experts SET is_online = false WHERE id = _expert_id;

  PERFORM public.notify_expert_alert(_expert_id, 'forced_offline', 'You were set offline',
    'Support set your status to offline. Open the app and go online again to receive jobs.',
    jsonb_build_object('route','home'));

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES(_uid, 'force_expert_offline', 'experts', _expert_id, NULL,
         jsonb_build_object('is_online', false));
END
$fn$;
