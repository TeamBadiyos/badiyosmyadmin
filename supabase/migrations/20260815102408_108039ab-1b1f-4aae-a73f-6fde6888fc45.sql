GRANT EXECUTE ON FUNCTION public.get_expert_id_for_auth(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_expert_id_for_auth(uuid) FROM PUBLIC, anon;