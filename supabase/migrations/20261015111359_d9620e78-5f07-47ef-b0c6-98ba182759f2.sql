GRANT EXECUTE ON FUNCTION public.order_bill_compute(text, numeric, numeric, numeric, numeric, numeric, boolean, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.order_bill_core(uuid, jsonb, numeric, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.merchant_fy_gross(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.tax_rate(text) TO service_role;