CREATE OR REPLACE FUNCTION public.admin_alert_enqueue(_order_type text, _order_id uuid, _order text, _customer text, _amount numeric, _time text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- No-expert slot warning duplicated the order-placed WhatsApp; skip it.
  IF _order_type = 'booking_no_expert_warning' THEN RETURN; END IF;
  INSERT INTO public.admin_alert_queue (order_type, order_id, v_order, v_customer, v_amount, v_time)
  VALUES (
    _order_type, _order_id,
    coalesce(public.admin_alert_clean(_order), 'Order'),
    coalesce(public.admin_alert_clean(_customer), 'Customer'),
    left(trim(to_char(coalesce(_amount, 0), 'FM999999990.00')), 60),
    coalesce(public.admin_alert_clean(_time), 'Now')
  )
  ON CONFLICT (order_type, order_id) DO NOTHING;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'admin_alert_enqueue failed: %', sqlerrm;
END;
$$;