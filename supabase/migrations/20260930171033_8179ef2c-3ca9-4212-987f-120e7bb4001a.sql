revoke execute on function public.staff_set_lead_status(text, uuid, text) from public;
revoke execute on function public.staff_set_lead_status(text, uuid, text) from anon;
grant execute on function public.staff_set_lead_status(text, uuid, text) to authenticated;