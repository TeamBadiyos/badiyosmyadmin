DO $patch$ DECLARE _d text; BEGIN
 _d:=pg_get_functiondef('public.staff_courier_override(uuid,text,text,text,uuid,uuid,text,text,jsonb)'::regprocedure);
 _d:=replace(_d,'_return_distances jsonb DEFAULT NULL::jsonb)', '_return_distances jsonb DEFAULT NULL::jsonb, _staff_id uuid DEFAULT NULL::uuid)');
 IF _d=pg_get_functiondef('public.staff_courier_override(uuid,text,text,text,uuid,uuid,text,text,jsonb)'::regprocedure) THEN RAISE EXCEPTION 'Signature patch failed'; END IF;
 _d:=replace(_d, E'BEGIN\n IF NOT public.courier_is_ops_staff()', E'BEGIN\n IF _staff_id IS NULL THEN RAISE EXCEPTION ''Staff identity required''; END IF;\n PERFORM set_config(''request.jwt.claim.sub'',_staff_id::text,true);\n IF NOT public.courier_is_ops_staff()');
 EXECUTE _d;
END $patch$;
REVOKE ALL ON FUNCTION public.staff_courier_override(uuid,text,text,text,uuid,uuid,text,text,jsonb) FROM authenticated,service_role;
REVOKE ALL ON FUNCTION public.staff_courier_override(uuid,text,text,text,uuid,uuid,text,text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.staff_courier_override(uuid,text,text,text,uuid,uuid,text,text,jsonb,uuid) TO service_role;