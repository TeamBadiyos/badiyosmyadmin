ALTER TABLE public.merchant_orders
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS picked_up_at timestamptz,
  ADD COLUMN IF NOT EXISTS courier_order_id uuid REFERENCES public.courier_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS refund_id text,
  ADD COLUMN IF NOT EXISTS refund_status text,
  ADD COLUMN IF NOT EXISTS refund_amount numeric;

ALTER TABLE public.courier_orders
  ADD COLUMN IF NOT EXISTS merchant_order_id uuid REFERENCES public.merchant_orders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_courier_orders_merchant_order ON public.courier_orders(merchant_order_id);

UPDATE public.merchant_orders SET accepted_at = coalesce(accepted_at, updated_at)
 WHERE status IN ('accepted','preparing','ready','completed') AND accepted_at IS NULL;
UPDATE public.merchant_orders SET ready_at = coalesce(ready_at, updated_at)
 WHERE status IN ('ready','completed') AND ready_at IS NULL;

CREATE OR REPLACE FUNCTION public.merchant_orders_stamp_steps()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('accepted','preparing','ready','completed') AND NEW.accepted_at IS NULL THEN NEW.accepted_at := now(); END IF;
    IF NEW.status IN ('ready','completed') AND NEW.ready_at IS NULL THEN NEW.ready_at := now(); END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_merchant_orders_stamp_steps ON public.merchant_orders;
CREATE TRIGGER trg_merchant_orders_stamp_steps BEFORE UPDATE ON public.merchant_orders
FOR EACH ROW EXECUTE FUNCTION public.merchant_orders_stamp_steps();

CREATE OR REPLACE FUNCTION public.courier_orders_sync_merchant_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.merchant_order_id IS NOT NULL THEN
    UPDATE public.merchant_orders
       SET courier_order_id = NEW.id,
           picked_up_at = coalesce(picked_up_at, NEW.picked_up_at)
     WHERE id = NEW.merchant_order_id
       AND (courier_order_id IS DISTINCT FROM NEW.id OR (picked_up_at IS NULL AND NEW.picked_up_at IS NOT NULL));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_courier_orders_sync_merchant ON public.courier_orders;
CREATE TRIGGER trg_courier_orders_sync_merchant AFTER INSERT OR UPDATE ON public.courier_orders
FOR EACH ROW EXECUTE FUNCTION public.courier_orders_sync_merchant_order();

CREATE OR REPLACE FUNCTION public.staff_commerce_admin_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.staff_users
   WHERE auth_user_id = auth.uid() AND status = 'active' AND role IN ('super_admin','ops_manager')
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.staff_reassign_store_rider(_order_id uuid, _expert_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _mo merchant_orders; _co courier_orders; _after courier_orders;
BEGIN
  IF public.staff_commerce_admin_id() IS NULL THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO _mo FROM merchant_orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF _mo.courier_order_id IS NULL THEN RAISE EXCEPTION 'No delivery linked to this store order yet'; END IF;
  SELECT * INTO _co FROM courier_orders WHERE id = _mo.courier_order_id FOR UPDATE;
  IF _co.status NOT IN ('REQUESTED','SEARCHING','DRIVER_ASSIGNED','ARRIVED_PICKUP') THEN
    RAISE EXCEPTION 'Rider cannot be changed after pickup (status %)', _co.status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM experts WHERE id = _expert_id AND status = 'active') THEN
    RAISE EXCEPTION 'Rider is not active';
  END IF;
  IF _co.status = 'REQUESTED' THEN
    UPDATE courier_orders SET status = 'SEARCHING' WHERE id = _co.id;
  ELSIF _co.status = 'ARRIVED_PICKUP' THEN
    UPDATE courier_orders SET status = 'SEARCHING' WHERE id = _co.id;
  ELSIF _co.status = 'DRIVER_ASSIGNED' THEN
    UPDATE courier_orders SET status = 'SEARCHING' WHERE id = _co.id;
  END IF;
  UPDATE courier_orders SET status = 'DRIVER_ASSIGNED', assigned_expert_id = _expert_id,
         assigned_at = now(), needs_ops_attention = false
   WHERE id = _co.id RETURNING * INTO _after;
  INSERT INTO audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), 'store_order.reassign_rider', 'merchant_orders', _order_id,
          jsonb_build_object('courier_order_id', _co.id, 'assigned_expert_id', _co.assigned_expert_id, 'status', _co.status),
          jsonb_build_object('courier_order_id', _co.id, 'assigned_expert_id', _expert_id, 'status', _after.status));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.staff_cancel_store_order_apply(_order_id uuid, _reason text, _refund_id text, _refund_status text, _refund_amount numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _mo merchant_orders; _after merchant_orders; _co courier_orders;
BEGIN
  IF public.staff_commerce_admin_id() IS NULL THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO _mo FROM merchant_orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF _mo.status IN ('cancelled','completed') THEN RAISE EXCEPTION 'Order is already %', _mo.status; END IF;
  UPDATE merchant_orders SET status = 'cancelled', cancelled_at = now(),
         cancel_reason = coalesce(nullif(trim(_reason),''), 'Cancelled by admin'),
         refund_id = _refund_id, refund_status = _refund_status, refund_amount = _refund_amount,
         payment_status = CASE WHEN _refund_status IS NOT NULL AND _refund_status <> 'failed' THEN 'refunded' ELSE payment_status END
   WHERE id = _order_id RETURNING * INTO _after;
  IF _mo.courier_order_id IS NOT NULL THEN
    SELECT * INTO _co FROM courier_orders WHERE id = _mo.courier_order_id FOR UPDATE;
    IF _co.status IN ('REQUESTED','SEARCHING','DRIVER_ASSIGNED','ARRIVED_PICKUP','FAILED_DELIVERY') THEN
      UPDATE courier_orders SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = 'ops',
             cancel_reason_code = 'STORE_ORDER_CANCELLED' WHERE id = _co.id;
    END IF;
  END IF;
  INSERT INTO audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), 'store_order.cancel_refund', 'merchant_orders', _order_id, to_jsonb(_mo), to_jsonb(_after));
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.staff_reassign_store_rider(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_cancel_store_order_apply(uuid, text, text, text, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_commerce_admin_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_reassign_store_rider(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_cancel_store_order_apply(uuid, text, text, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_commerce_admin_id() TO authenticated;