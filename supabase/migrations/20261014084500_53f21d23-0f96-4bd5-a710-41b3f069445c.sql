CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.event_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text, rules_text text,
  button_text text NOT NULL DEFAULT 'Swipe to Redeem',
  success_title text, success_message text, emoji text, image_url text, card_color text,
  price int NOT NULL DEFAULT 0 CHECK (price >= 0),
  mrp int,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  is_active boolean NOT NULL DEFAULT false,
  per_user_limit int NOT NULL DEFAULT 1 CHECK (per_user_limit >= 1),
  per_device_limit int DEFAULT 1,
  total_stock int,
  show_remaining boolean NOT NULL DEFAULT false,
  audience text NOT NULL DEFAULT 'all' CHECK (audience IN ('all','new_users')),
  new_users_since timestamptz,
  city_ids uuid[],
  undo_seconds int NOT NULL DEFAULT 10 CHECK (undo_seconds >= 0),
  require_staff_pin boolean NOT NULL DEFAULT false,
  staff_pin_hash text,
  payment_hold_minutes int NOT NULL DEFAULT 10 CHECK (payment_hold_minutes > 0),
  unredeemed_refund_policy text NOT NULL DEFAULT 'auto_refund' CHECK (unredeemed_refund_policy IN ('auto_refund','no_refund')),
  show_as_home_banner boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.event_offers TO authenticated;
GRANT ALL ON public.event_offers TO service_role;
ALTER TABLE public.event_offers ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.event_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES public.event_offers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  device_key text,
  status text NOT NULL CHECK (status IN ('payment_pending','paid','pending','confirmed','undone','payment_failed','expired','refunded')),
  amount int NOT NULL DEFAULT 0,
  razorpay_order_id text,
  razorpay_payment_id text UNIQUE,
  razorpay_refund_id text,
  redeemed_at timestamptz, undo_deadline timestamptz, undone_at timestamptz,
  paid_at timestamptz, refunded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX event_redemptions_offer_user_idx ON public.event_redemptions(offer_id, user_id);
CREATE INDEX event_redemptions_offer_device_idx ON public.event_redemptions(offer_id, device_key);
CREATE INDEX event_redemptions_rzp_order_idx ON public.event_redemptions(razorpay_order_id);
GRANT SELECT ON public.event_redemptions TO authenticated;
GRANT ALL ON public.event_redemptions TO service_role;
ALTER TABLE public.event_redemptions ENABLE ROW LEVEL SECURITY;

-- Role helper: super_admin or finance
CREATE OR REPLACE FUNCTION public.is_offer_finance_user()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.staff_users WHERE auth_user_id = auth.uid()
    AND status = 'active' AND role IN ('super_admin','finance'));
$$;
REVOKE EXECUTE ON FUNCTION public.is_offer_finance_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_offer_finance_user() TO authenticated, service_role;

-- Hide PIN hash from customers (column-level)
REVOKE SELECT ON public.event_offers FROM authenticated;
GRANT SELECT (id,title,description,rules_text,button_text,success_title,success_message,emoji,image_url,card_color,
  price,mrp,starts_at,ends_at,is_active,per_user_limit,per_device_limit,total_stock,show_remaining,audience,
  new_users_since,city_ids,undo_seconds,require_staff_pin,payment_hold_minutes,unredeemed_refund_policy,
  show_as_home_banner,sort_order,created_by,created_at,updated_at) ON public.event_offers TO authenticated;

CREATE POLICY "Customers read live offers" ON public.event_offers FOR SELECT TO authenticated
  USING ((is_active AND now() BETWEEN starts_at AND ends_at) OR public.is_offer_finance_user());
CREATE POLICY "Read own redemptions" ON public.event_redemptions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_offer_finance_user());

CREATE TRIGGER event_offers_updated_at BEFORE UPDATE ON public.event_offers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Counting rule (single source of truth)
CREATE OR REPLACE FUNCTION public.is_redemption_counted(_status text, _created_at timestamptz, _hold_minutes int)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _status = 'payment_pending' THEN _created_at > now() - make_interval(mins => COALESCE(_hold_minutes,10))
    WHEN _status IN ('paid','pending','confirmed') THEN true
    ELSE false END;
$$;
-- effective status: pending past deadline = confirmed
CREATE OR REPLACE FUNCTION public.event_redemption_effective_status(_status text, _undo_deadline timestamptz)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN _status = 'pending' AND (_undo_deadline IS NULL OR _undo_deadline <= now()) THEN 'confirmed' ELSE _status END;
$$;

CREATE OR REPLACE FUNCTION public.event_offer_audit(_action text, _id uuid, _before jsonb, _after jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), _action, CASE WHEN _action LIKE 'event_offer_%' THEN 'event_offers' ELSE 'event_redemptions' END, _id, _before, _after);
$$;
REVOKE EXECUTE ON FUNCTION public.event_offer_audit(text,uuid,jsonb,jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.event_offers_audit_trg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN PERFORM public.event_offer_audit('event_offer_create', NEW.id, NULL, to_jsonb(NEW) - 'staff_pin_hash');
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.staff_pin_hash IS DISTINCT FROM OLD.staff_pin_hash THEN
      PERFORM public.event_offer_audit('event_offer_pin_change', NEW.id, NULL, jsonb_build_object('pin_set', NEW.staff_pin_hash IS NOT NULL));
    END IF;
    IF (to_jsonb(NEW) - 'staff_pin_hash' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'staff_pin_hash' - 'updated_at') THEN
      PERFORM public.event_offer_audit('event_offer_edit', NEW.id, to_jsonb(OLD) - 'staff_pin_hash', to_jsonb(NEW) - 'staff_pin_hash');
    END IF;
  ELSE PERFORM public.event_offer_audit('event_offer_delete', OLD.id, to_jsonb(OLD) - 'staff_pin_hash', NULL);
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER event_offers_audit AFTER INSERT OR UPDATE OR DELETE ON public.event_offers
  FOR EACH ROW EXECUTE FUNCTION public.event_offers_audit_trg();

CREATE OR REPLACE FUNCTION public.event_redemptions_audit_trg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN PERFORM public.event_offer_audit('event_redemption_' || NEW.status, NEW.id, NULL, to_jsonb(NEW));
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.event_offer_audit('event_redemption_' || NEW.status, NEW.id, to_jsonb(OLD), to_jsonb(NEW));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER event_redemptions_audit AFTER INSERT OR UPDATE ON public.event_redemptions
  FOR EACH ROW EXECUTE FUNCTION public.event_redemptions_audit_trg();

-- e) expiry
CREATE OR REPLACE FUNCTION public.expire_event_payments(_offer_id uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  UPDATE public.event_redemptions r SET status = 'expired'
  FROM public.event_offers o
  WHERE o.id = r.offer_id AND r.status = 'payment_pending'
    AND (_offer_id IS NULL OR r.offer_id = _offer_id)
    AND r.created_at <= now() - make_interval(mins => o.payment_hold_minutes);
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.expire_event_payments(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_event_payments(uuid) TO service_role;

-- shared checks; returns error code or NULL. _exclude = redemption id not to count (paid row being redeemed)
CREATE OR REPLACE FUNCTION public.event_offer_check(_o public.event_offers, _uid uuid, _device text, _exclude uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE ucreated timestamptz; n int;
BEGIN
  IF NOT _o.is_active OR now() < _o.starts_at OR now() > _o.ends_at THEN RETURN 'NOT_ACTIVE'; END IF;
  SELECT created_at INTO ucreated FROM public.users WHERE id = _uid AND deleted_at IS NULL;
  IF ucreated IS NULL THEN RETURN 'NOT_ELIGIBLE'; END IF;
  IF _o.audience = 'new_users' AND ucreated < COALESCE(_o.new_users_since, _o.starts_at) THEN RETURN 'NOT_ELIGIBLE'; END IF;
  IF _o.city_ids IS NOT NULL AND cardinality(_o.city_ids) > 0 AND NOT EXISTS (
     SELECT 1 FROM public.addresses a JOIN public.zones z ON lower(trim(z.city)) = lower(trim(a.city))
     WHERE a.user_id = _uid AND z.id = ANY(_o.city_ids)) THEN RETURN 'NOT_ELIGIBLE'; END IF;
  SELECT count(*) INTO n FROM public.event_redemptions WHERE offer_id = _o.id AND user_id = _uid
    AND id IS DISTINCT FROM _exclude AND public.is_redemption_counted(status, created_at, _o.payment_hold_minutes);
  IF n >= _o.per_user_limit THEN RETURN 'LIMIT_REACHED'; END IF;
  IF _o.per_device_limit IS NOT NULL AND _device IS NOT NULL THEN
    SELECT count(*) INTO n FROM public.event_redemptions WHERE offer_id = _o.id AND device_key = _device
      AND id IS DISTINCT FROM _exclude AND public.is_redemption_counted(status, created_at, _o.payment_hold_minutes);
    IF n >= _o.per_device_limit THEN RETURN 'DEVICE_LIMIT_REACHED'; END IF;
  END IF;
  IF _o.total_stock IS NOT NULL THEN
    SELECT count(*) INTO n FROM public.event_redemptions WHERE offer_id = _o.id
      AND id IS DISTINCT FROM _exclude AND public.is_redemption_counted(status, created_at, _o.payment_hold_minutes);
    IF n >= _o.total_stock THEN RETURN 'OUT_OF_STOCK'; END IF;
  END IF;
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.event_offer_check(public.event_offers,uuid,text,uuid) FROM PUBLIC, anon, authenticated;

-- a) redeem
CREATE OR REPLACE FUNCTION public.redeem_event_offer(p_offer_id uuid, p_device_key text, p_staff_pin text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE uid uuid := auth.uid(); o public.event_offers; err text; r public.event_redemptions; paid_id uuid;
BEGIN
  IF uid IS NULL THEN RETURN jsonb_build_object('ok',false,'error','NOT_AUTHENTICATED'); END IF;
  PERFORM public.expire_event_payments(p_offer_id);
  SELECT * INTO o FROM public.event_offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','NOT_ACTIVE'); END IF;
  IF o.price > 0 THEN
    SELECT id INTO paid_id FROM public.event_redemptions WHERE offer_id = o.id AND user_id = uid AND status = 'paid'
      ORDER BY paid_at LIMIT 1 FOR UPDATE;
  END IF;
  err := public.event_offer_check(o, uid, p_device_key, paid_id);
  IF err IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'error',err); END IF;
  IF o.require_staff_pin AND (p_staff_pin IS NULL OR o.staff_pin_hash IS NULL OR crypt(p_staff_pin, o.staff_pin_hash) <> o.staff_pin_hash) THEN
    RETURN jsonb_build_object('ok',false,'error','WRONG_PIN');
  END IF;
  IF o.price > 0 THEN
    IF paid_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','PAYMENT_REQUIRED'); END IF;
    UPDATE public.event_redemptions SET
      status = CASE WHEN o.undo_seconds = 0 THEN 'confirmed' ELSE 'pending' END,
      redeemed_at = now(),
      undo_deadline = CASE WHEN o.undo_seconds = 0 THEN NULL ELSE now() + make_interval(secs => o.undo_seconds) END,
      device_key = COALESCE(device_key, p_device_key)
    WHERE id = paid_id RETURNING * INTO r;
  ELSE
    INSERT INTO public.event_redemptions(offer_id, user_id, device_key, status, amount, redeemed_at, undo_deadline)
    VALUES (o.id, uid, p_device_key, CASE WHEN o.undo_seconds = 0 THEN 'confirmed' ELSE 'pending' END, 0, now(),
      CASE WHEN o.undo_seconds = 0 THEN NULL ELSE now() + make_interval(secs => o.undo_seconds) END)
    RETURNING * INTO r;
  END IF;
  RETURN jsonb_build_object('ok',true,'id',r.id,'status',r.status,'redeemed_at',r.redeemed_at,'undo_deadline',r.undo_deadline);
END $$;

-- b) undo
CREATE OR REPLACE FUNCTION public.undo_event_redemption(p_redemption_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.event_redemptions; o public.event_offers;
BEGIN
  SELECT * INTO r FROM public.event_redemptions WHERE id = p_redemption_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR r.status <> 'pending' OR r.undo_deadline IS NULL OR now() >= r.undo_deadline THEN
    RETURN jsonb_build_object('ok',false,'error','UNDO_EXPIRED');
  END IF;
  SELECT * INTO o FROM public.event_offers WHERE id = r.offer_id;
  IF o.price > 0 AND r.razorpay_payment_id IS NOT NULL THEN
    UPDATE public.event_redemptions SET status='paid', redeemed_at=NULL, undo_deadline=NULL, undone_at=now() WHERE id=r.id RETURNING * INTO r;
  ELSE
    UPDATE public.event_redemptions SET status='undone', undone_at=now() WHERE id=r.id RETURNING * INTO r;
  END IF;
  RETURN jsonb_build_object('ok',true,'id',r.id,'status',r.status);
END $$;

-- c) start payment (called by server with user JWT)
CREATE OR REPLACE FUNCTION public.start_offer_payment(p_offer_id uuid, p_device_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); o public.event_offers; err text; r public.event_redemptions;
BEGIN
  IF uid IS NULL THEN RETURN jsonb_build_object('ok',false,'error','NOT_AUTHENTICATED'); END IF;
  PERFORM public.expire_event_payments(p_offer_id);
  SELECT * INTO o FROM public.event_offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','NOT_ACTIVE'); END IF;
  IF o.price <= 0 THEN RETURN jsonb_build_object('ok',false,'error','FREE_OFFER'); END IF;
  SELECT * INTO r FROM public.event_redemptions WHERE offer_id=o.id AND user_id=uid AND status='paid' LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('ok',true,'already_paid',true,'id',r.id,'amount',r.amount); END IF;
  SELECT * INTO r FROM public.event_redemptions WHERE offer_id=o.id AND user_id=uid AND status='payment_pending'
    AND public.is_redemption_counted(status, created_at, o.payment_hold_minutes) ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('ok',true,'id',r.id,'amount',r.amount,'razorpay_order_id',r.razorpay_order_id); END IF;
  err := public.event_offer_check(o, uid, p_device_key, NULL);
  IF err IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'error',err); END IF;
  INSERT INTO public.event_redemptions(offer_id,user_id,device_key,status,amount)
  VALUES (o.id, uid, p_device_key, 'payment_pending', o.price) RETURNING * INTO r;
  RETURN jsonb_build_object('ok',true,'id',r.id,'amount',r.amount,'razorpay_order_id',NULL);
END $$;

-- save order id (service role)
CREATE OR REPLACE FUNCTION public.system_set_offer_order(_redemption_id uuid, _order_id text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.event_redemptions SET razorpay_order_id = _order_id WHERE id = _redemption_id AND status = 'payment_pending';
$$;

-- d) mark paid (service role only, idempotent)
CREATE OR REPLACE FUNCTION public.system_mark_offer_paid(_razorpay_order_id text, _payment_id text, _amount int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.event_redemptions;
BEGIN
  SELECT * INTO r FROM public.event_redemptions WHERE razorpay_payment_id = _payment_id;
  IF FOUND THEN RETURN jsonb_build_object('ok',true,'id',r.id,'status',r.status,'duplicate',true); END IF;
  SELECT * INTO r FROM public.event_redemptions WHERE razorpay_order_id = _razorpay_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','NOT_FOUND'); END IF;
  IF _amount IS NOT NULL AND _amount < r.amount THEN RETURN jsonb_build_object('ok',false,'error','AMOUNT_MISMATCH'); END IF;
  -- paid even if hold expired: money taken, keep the seat
  UPDATE public.event_redemptions SET status='paid', paid_at=now(), razorpay_payment_id=_payment_id
   WHERE id = r.id AND status IN ('payment_pending','expired','payment_failed') RETURNING * INTO r;
  RETURN jsonb_build_object('ok',true,'id',r.id,'status',COALESCE(r.status,'paid'));
END $$;

CREATE OR REPLACE FUNCTION public.system_mark_offer_payment_failed(_razorpay_order_id text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.event_redemptions SET status='payment_failed' WHERE razorpay_order_id=_razorpay_order_id AND status='payment_pending';
$$;

-- g) refund bookkeeping (called by server after Razorpay refund)
CREATE OR REPLACE FUNCTION public.system_mark_offer_refunded(_redemption_id uuid, _refund_id text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.event_redemptions SET status='refunded', refunded_at=now(), razorpay_refund_id=_refund_id
  WHERE id=_redemption_id AND status IN ('paid','pending','confirmed');
$$;

-- f) PIN
CREATE OR REPLACE FUNCTION public.set_offer_staff_pin(p_offer_id uuid, p_pin text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT public.is_super_admin_user() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  UPDATE public.event_offers SET staff_pin_hash = CASE WHEN p_pin IS NULL OR p_pin = '' THEN NULL ELSE crypt(p_pin, gen_salt('bf')) END
  WHERE id = p_offer_id;
END $$;

-- staff upsert offer
CREATE OR REPLACE FUNCTION public.staff_upsert_event_offer(_p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid := NULLIF(_p->>'id','')::uuid; rec public.event_offers;
BEGIN
  IF NOT public.is_super_admin_user() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  _p := _p - 'id' - 'staff_pin_hash' - 'created_by' - 'created_at' - 'updated_at';
  IF _id IS NULL THEN
    rec := jsonb_populate_record(NULL::public.event_offers, _p);
    INSERT INTO public.event_offers SELECT (jsonb_populate_record(rec, jsonb_build_object(
      'id', gen_random_uuid(), 'created_by', auth.uid(), 'created_at', now(), 'updated_at', now(),
      'button_text', COALESCE(rec.button_text,'Swipe to Redeem'), 'price', COALESCE(rec.price,0),
      'starts_at', COALESCE(rec.starts_at, now()), 'ends_at', COALESCE(rec.ends_at, now()+interval '7 days'),
      'is_active', COALESCE(rec.is_active,false), 'per_user_limit', COALESCE(rec.per_user_limit,1),
      'show_remaining', COALESCE(rec.show_remaining,false), 'audience', COALESCE(rec.audience,'all'),
      'undo_seconds', COALESCE(rec.undo_seconds,10), 'require_staff_pin', COALESCE(rec.require_staff_pin,false),
      'payment_hold_minutes', COALESCE(rec.payment_hold_minutes,10),
      'unredeemed_refund_policy', COALESCE(rec.unredeemed_refund_policy,'auto_refund'),
      'show_as_home_banner', COALESCE(rec.show_as_home_banner,false), 'sort_order', COALESCE(rec.sort_order,0)))).*
    RETURNING id INTO _id;
  ELSE
    SELECT * INTO rec FROM public.event_offers WHERE id = _id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    rec := jsonb_populate_record(rec, _p);
    UPDATE public.event_offers SET title=rec.title, description=rec.description, rules_text=rec.rules_text,
      button_text=rec.button_text, success_title=rec.success_title, success_message=rec.success_message, emoji=rec.emoji,
      image_url=rec.image_url, card_color=rec.card_color, price=rec.price, mrp=rec.mrp, starts_at=rec.starts_at,
      ends_at=rec.ends_at, is_active=rec.is_active, per_user_limit=rec.per_user_limit, per_device_limit=rec.per_device_limit,
      total_stock=rec.total_stock, show_remaining=rec.show_remaining, audience=rec.audience, new_users_since=rec.new_users_since,
      city_ids=rec.city_ids, undo_seconds=rec.undo_seconds, require_staff_pin=rec.require_staff_pin,
      payment_hold_minutes=rec.payment_hold_minutes, unredeemed_refund_policy=rec.unredeemed_refund_policy,
      show_as_home_banner=rec.show_as_home_banner, sort_order=rec.sort_order
    WHERE id=_id;
  END IF;
  RETURN _id;
END $$;

-- helper for refund processing: list paid unredeemed rows of an ended offer
CREATE OR REPLACE FUNCTION public.staff_offer_refundable(_offer_id uuid)
RETURNS TABLE(id uuid, razorpay_payment_id text, amount int) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_offer_finance_user() AND auth.role() <> 'service_role' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN QUERY SELECT r.id, r.razorpay_payment_id, r.amount FROM public.event_redemptions r
    JOIN public.event_offers o ON o.id = r.offer_id
    WHERE r.offer_id = _offer_id AND r.status = 'paid' AND o.ends_at < now() AND o.unredeemed_refund_policy = 'auto_refund';
END $$;

REVOKE EXECUTE ON FUNCTION public.redeem_event_offer(uuid,text,text), public.undo_event_redemption(uuid),
  public.start_offer_payment(uuid,text), public.set_offer_staff_pin(uuid,text), public.staff_upsert_event_offer(jsonb),
  public.staff_offer_refundable(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_event_offer(uuid,text,text), public.undo_event_redemption(uuid),
  public.start_offer_payment(uuid,text), public.set_offer_staff_pin(uuid,text), public.staff_upsert_event_offer(jsonb),
  public.staff_offer_refundable(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.system_set_offer_order(uuid,text), public.system_mark_offer_paid(text,text,int),
  public.system_mark_offer_payment_failed(text), public.system_mark_offer_refunded(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.system_set_offer_order(uuid,text), public.system_mark_offer_paid(text,text,int),
  public.system_mark_offer_payment_failed(text), public.system_mark_offer_refunded(uuid,text) TO service_role;