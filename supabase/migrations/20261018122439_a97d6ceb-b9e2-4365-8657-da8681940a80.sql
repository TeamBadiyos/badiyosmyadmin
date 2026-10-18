ALTER FUNCTION public.zz_spin_lt_call(uuid,uuid,text,text) SECURITY DEFINER;
UPDATE public.spin_events SET is_active=false WHERE name LIKE 'LOADTEST lt%';