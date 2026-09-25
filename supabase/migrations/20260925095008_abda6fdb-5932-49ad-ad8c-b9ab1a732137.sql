CREATE OR REPLACE FUNCTION public.business_require_super_admin()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_active_staff(auth.uid(), array['super_admin']) THEN
    RAISE EXCEPTION 'Only a super admin can do this';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.business_require_super_admin() TO authenticated;

DO $$
DECLARE r record; def text;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('staff_business_wallet_adjust','staff_upsert_pricing_plan','staff_upsert_dispatch_plan','staff_set_plan_active','staff_assign_business_plans','staff_set_merchant_modules','staff_set_delivery_status')
  LOOP
    def := pg_get_functiondef(r.oid);
    def := replace(def, 'public.business_require_ops()', 'public.business_require_super_admin()');
    EXECUTE def;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('staff_business_wallet_adjust','staff_upsert_pricing_plan','staff_upsert_dispatch_plan','staff_set_plan_active','staff_assign_business_plans','staff_set_merchant_modules','staff_set_delivery_status')
    AND pg_get_functiondef(p.oid) LIKE '%business_require_ops%') THEN
    RAISE EXCEPTION 'guard swap incomplete';
  END IF;
END $$;