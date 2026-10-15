DROP POLICY IF EXISTS "Merchants view own orders" ON public.merchant_orders;
CREATE POLICY "Merchants view own orders" ON public.merchant_orders FOR SELECT TO authenticated
USING (merchant_id = public.current_merchant_id()
       AND (coalesce(payment_mode,'') <> 'online' OR payment_status = 'paid'));