ALTER FUNCTION public.suggestion_remarks_no_change() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.suggestions_before_insert() FROM PUBLIC, anon, authenticated;
CREATE POLICY "No direct access to remarks" ON public.suggestion_remarks FOR SELECT TO authenticated USING (false);