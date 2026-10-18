ALTER FUNCTION public.mask_phone(text) SET search_path=public;
REVOKE ALL ON FUNCTION public.staff_role(), public.staff_my_zone_ids(), public.staff_touch_login(),
  public.staff_update_booking_location(uuid,numeric,numeric,text,text), public.staff_connect_via_badiyos(uuid,text),
  public.staff_set_expert_leave_today(uuid,boolean), public.staff_recommend_application(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_role(), public.staff_my_zone_ids(), public.staff_touch_login(),
  public.staff_update_booking_location(uuid,numeric,numeric,text,text), public.staff_connect_via_badiyos(uuid,text),
  public.staff_set_expert_leave_today(uuid,boolean), public.staff_recommend_application(uuid,text) TO authenticated;