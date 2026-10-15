REVOKE EXECUTE ON FUNCTION public.is_finance_staff() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.is_finance_staff() TO authenticated;