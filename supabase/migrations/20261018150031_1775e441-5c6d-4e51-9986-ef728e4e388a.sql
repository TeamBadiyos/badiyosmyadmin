GRANT EXECUTE ON FUNCTION public.app_spin_status(uuid, text) TO anon;
UPDATE public.spin_events SET eligibility='all' WHERE id='6d0af02e-529d-4e6e-bd23-f52e32e46988';