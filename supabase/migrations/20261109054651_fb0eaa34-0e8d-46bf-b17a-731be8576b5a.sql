REVOKE EXECUTE ON FUNCTION public.courier_is_gifting_order(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.courier_rider_complete_gifting_stop(uuid) FROM authenticated;
COMMENT ON FUNCTION public.courier_is_gifting_order(uuid) IS 'Internal server-derived gifting discriminator. Not directly callable by browser roles.';
COMMENT ON FUNCTION public.courier_rider_complete_gifting_stop(uuid) IS 'Internal helper reached through existing courier_verify_stop_otp or courier_complete_drop_with_proof RPC; verifies authenticated assigned rider and stop sequence.';