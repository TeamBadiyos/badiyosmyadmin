
REVOKE EXECUTE ON FUNCTION public.default_city_id(), public.city_id_by_name(text), public.fill_city_id(), public.customer_invoices_place_of_supply(),
  public.staff_allowed_city_ids(), public.staff_can_city(uuid), public.staff_my_cities(), public.staff_set_city_access(uuid, uuid[]),
  public.staff_list_cities(), public.staff_city_template(uuid), public.staff_create_city(text,text,text,uuid,jsonb,jsonb,jsonb),
  public.staff_set_city_status(uuid,text), public.staff_delete_city(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fill_city_id(), public.customer_invoices_place_of_supply(), public.city_id_by_name(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.staff_allowed_city_ids(), public.staff_can_city(uuid), public.staff_my_cities(), public.staff_set_city_access(uuid, uuid[]),
  public.staff_list_cities(), public.staff_city_template(uuid), public.staff_create_city(text,text,text,uuid,jsonb,jsonb,jsonb),
  public.staff_set_city_status(uuid,text), public.staff_delete_city(uuid), public.default_city_id() TO authenticated;
