CREATE OR REPLACE FUNCTION public.zz_spin_lt_call(_uid uuid, _event uuid, _req text, _dev text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE t0 timestamptz := clock_timestamp(); r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', _uid::text, true);
  r := app_spin(_event,_req,_dev);
  RETURN jsonb_build_object('ms', extract(epoch from clock_timestamp()-t0)*1000, 'r', r);
END $$;
REVOKE EXECUTE ON FUNCTION public.zz_spin_lt_call(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zz_spin_lt_call(uuid,uuid,text,text) TO service_role;