-- Grants
REVOKE ALL ON public.payment_modes, public.merchant_fee_tiers, public.offline_sales, public.offline_sale_items, public.merchant_store_hours, public.merchant_schedule_overrides, public.merchant_subscription_invoices FROM anon;
GRANT SELECT ON public.payment_modes TO authenticated;
GRANT SELECT ON public.merchant_fee_tiers TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.offline_sales TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.offline_sale_items TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.merchant_store_hours TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.merchant_schedule_overrides TO authenticated;
GRANT SELECT ON public.merchant_subscription_invoices TO authenticated;
GRANT ALL ON public.payment_modes, public.merchant_fee_tiers, public.offline_sales, public.offline_sale_items, public.merchant_store_hours, public.merchant_schedule_overrides, public.merchant_subscription_invoices TO service_role;

-- payment_modes
CREATE POLICY "Authenticated can view active payment modes" ON public.payment_modes
  FOR SELECT TO authenticated USING (is_active OR is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));
CREATE POLICY "Staff manage payment modes" ON public.payment_modes
  FOR ALL TO authenticated USING (is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']))
  WITH CHECK (is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

-- merchant_fee_tiers
CREATE POLICY "Authenticated can view active fee tiers" ON public.merchant_fee_tiers
  FOR SELECT TO authenticated USING (is_active OR is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));
CREATE POLICY "Staff manage fee tiers" ON public.merchant_fee_tiers
  FOR ALL TO authenticated USING (is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']))
  WITH CHECK (is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

-- offline_sales
CREATE POLICY "Merchants view own offline sales" ON public.offline_sales
  FOR SELECT TO authenticated USING (merchant_id = current_merchant_id());
CREATE POLICY "Merchants create own offline sales" ON public.offline_sales
  FOR INSERT TO authenticated WITH CHECK (merchant_id = current_merchant_id());
CREATE POLICY "Merchants update own offline sales" ON public.offline_sales
  FOR UPDATE TO authenticated USING (merchant_id = current_merchant_id()) WITH CHECK (merchant_id = current_merchant_id());
CREATE POLICY "Staff view all offline sales" ON public.offline_sales
  FOR SELECT TO authenticated USING (is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

-- offline_sale_items (scoped through parent sale)
CREATE POLICY "Merchants view own offline sale items" ON public.offline_sale_items
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.offline_sales s WHERE s.id = sale_id AND s.merchant_id = current_merchant_id()));
CREATE POLICY "Merchants create own offline sale items" ON public.offline_sale_items
  FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.offline_sales s WHERE s.id = sale_id AND s.merchant_id = current_merchant_id()));
CREATE POLICY "Merchants update own offline sale items" ON public.offline_sale_items
  FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.offline_sales s WHERE s.id = sale_id AND s.merchant_id = current_merchant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.offline_sales s WHERE s.id = sale_id AND s.merchant_id = current_merchant_id()));
CREATE POLICY "Staff view all offline sale items" ON public.offline_sale_items
  FOR SELECT TO authenticated USING (is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

-- merchant_store_hours
CREATE POLICY "Merchants view own store hours" ON public.merchant_store_hours
  FOR SELECT TO authenticated USING (merchant_id = current_merchant_id());
CREATE POLICY "Merchants create own store hours" ON public.merchant_store_hours
  FOR INSERT TO authenticated WITH CHECK (merchant_id = current_merchant_id());
CREATE POLICY "Merchants update own store hours" ON public.merchant_store_hours
  FOR UPDATE TO authenticated USING (merchant_id = current_merchant_id()) WITH CHECK (merchant_id = current_merchant_id());
CREATE POLICY "Staff view all store hours" ON public.merchant_store_hours
  FOR SELECT TO authenticated USING (is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

-- merchant_schedule_overrides
CREATE POLICY "Merchants view own schedule overrides" ON public.merchant_schedule_overrides
  FOR SELECT TO authenticated USING (merchant_id = current_merchant_id());
CREATE POLICY "Merchants create own schedule overrides" ON public.merchant_schedule_overrides
  FOR INSERT TO authenticated WITH CHECK (merchant_id = current_merchant_id());
CREATE POLICY "Merchants update own schedule overrides" ON public.merchant_schedule_overrides
  FOR UPDATE TO authenticated USING (merchant_id = current_merchant_id()) WITH CHECK (merchant_id = current_merchant_id());
CREATE POLICY "Staff view all schedule overrides" ON public.merchant_schedule_overrides
  FOR SELECT TO authenticated USING (is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

-- merchant_subscription_invoices
CREATE POLICY "Merchants view own subscription invoices" ON public.merchant_subscription_invoices
  FOR SELECT TO authenticated USING (merchant_id = current_merchant_id());
CREATE POLICY "Staff view all subscription invoices" ON public.merchant_subscription_invoices
  FOR SELECT TO authenticated USING (is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));
CREATE POLICY "Staff create subscription invoices" ON public.merchant_subscription_invoices
  FOR INSERT TO authenticated WITH CHECK (is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));
CREATE POLICY "Staff update subscription invoices" ON public.merchant_subscription_invoices
  FOR UPDATE TO authenticated USING (is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']))
  WITH CHECK (is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

-- Invoice number generator (Indian FY: April-March)
CREATE OR REPLACE FUNCTION public.generate_offline_invoice_number(_merchant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _now date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  _fy_start date;
  _fy_end date;
  _label text;
  _n integer;
BEGIN
  IF EXTRACT(MONTH FROM _now) >= 4 THEN
    _fy_start := make_date(EXTRACT(YEAR FROM _now)::int, 4, 1);
  ELSE
    _fy_start := make_date(EXTRACT(YEAR FROM _now)::int - 1, 4, 1);
  END IF;
  _fy_end := _fy_start + interval '1 year';
  _label := to_char(_fy_start, 'YYYY') || '-' || to_char(_fy_start + interval '1 year', 'YY');

  SELECT count(*) + 1 INTO _n
  FROM public.offline_sales
  WHERE merchant_id = _merchant_id
    AND (created_at AT TIME ZONE 'Asia/Kolkata')::date >= _fy_start
    AND (created_at AT TIME ZONE 'Asia/Kolkata')::date < _fy_end;

  RETURN 'INV-' || _label || '-' || lpad(_n::text, 4, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.generate_offline_invoice_number(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_offline_invoice_number(uuid) TO authenticated, service_role;

-- Seed default fee tiers
INSERT INTO public.merchant_fee_tiers (name, monthly_fee, is_active)
SELECT 'Basic', 499, true WHERE NOT EXISTS (SELECT 1 FROM public.merchant_fee_tiers WHERE name = 'Basic');
INSERT INTO public.merchant_fee_tiers (name, monthly_fee, is_active)
SELECT 'Standard', 999, true WHERE NOT EXISTS (SELECT 1 FROM public.merchant_fee_tiers WHERE name = 'Standard');
