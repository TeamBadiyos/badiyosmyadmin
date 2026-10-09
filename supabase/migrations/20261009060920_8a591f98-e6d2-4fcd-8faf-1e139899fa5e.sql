REVOKE EXECUTE ON FUNCTION public.bookings_check_slot_capacity() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_set_slot_full(date,int,boolean,text,text) FROM PUBLIC, anon;