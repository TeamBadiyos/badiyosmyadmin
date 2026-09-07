GRANT SELECT ON public.legal_pages TO anon;
GRANT SELECT, INSERT, UPDATE ON public.legal_pages TO authenticated;
GRANT ALL ON public.legal_pages TO service_role;