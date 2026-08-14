-- Trigger functions: not callable by any client
REVOKE ALL ON FUNCTION public.notify_expert_assigned() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.on_booking_broadcast_start() FROM PUBLIC, anon, authenticated;

-- Privileged RPCs: authenticated + service_role only
REVOKE ALL ON FUNCTION public.customer_cancel_booking_apply(uuid, numeric, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_cancel_booking_apply(uuid, numeric, numeric, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_broadcast_booking_address(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_broadcast_booking_address(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.staff_area_partner_kyc_decision(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_area_partner_kyc_decision(uuid, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.staff_create_service_catalogue_row(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_create_service_catalogue_row(jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.staff_decide_partner_skill(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_decide_partner_skill(uuid, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.staff_delete_service_catalogue_row(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_delete_service_catalogue_row(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.staff_redraw_zone_boundary(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_redraw_zone_boundary(uuid, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.staff_soft_delete_area_partner(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_soft_delete_area_partner(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.staff_soft_delete_zone(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_soft_delete_zone(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.staff_update_zone(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_update_zone(uuid, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.zone_delete_impact(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.zone_delete_impact(uuid) TO authenticated, service_role;
