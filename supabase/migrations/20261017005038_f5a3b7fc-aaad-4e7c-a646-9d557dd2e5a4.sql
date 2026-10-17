CREATE OR REPLACE FUNCTION public.merchants_require_pin() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.deleted_at IS NULL AND NEW.status='approved' AND coalesce(NEW.store_enabled,true)
     AND (NEW.latitude IS NULL OR NEW.longitude IS NULL)
     AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'approved' OR NOT coalesce(OLD.store_enabled,true)
          OR OLD.latitude IS NOT NULL OR OLD.longitude IS NOT NULL) THEN
    RAISE EXCEPTION 'Set the map pin first';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS merchants_require_pin ON public.merchants;
CREATE TRIGGER merchants_require_pin BEFORE INSERT OR UPDATE ON public.merchants FOR EACH ROW EXECUTE FUNCTION public.merchants_require_pin();

CREATE OR REPLACE FUNCTION public.app_store_live(_m uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM merchants WHERE id=_m AND deleted_at IS NULL AND status='approved' AND coalesce(store_enabled,true)
    AND latitude IS NOT NULL AND longitude IS NOT NULL) $$;

DO $do$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.app_commerce_home(text,uuid,double precision,double precision,uuid)'::regprocedure);
  d := replace(d, $r$AND coalesce(m.store_enabled,true) AND coalesce(m.service_type,'store')=_svc$r$,
                  $r$AND coalesce(m.store_enabled,true) AND m.latitude IS NOT NULL AND m.longitude IS NOT NULL AND coalesce(m.service_type,'store')=_svc$r$);
  IF d NOT LIKE '%m.latitude IS NOT NULL%' THEN RAISE EXCEPTION 'patch failed'; END IF;
  EXECUTE d;
END $do$;

CREATE OR REPLACE FUNCTION public.admin_decide_location_change(_request_id uuid, _approve boolean, _reason text DEFAULT NULL::text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r public.merchant_location_change_requests; m public.merchants;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO r FROM public.merchant_location_change_requests WHERE id=_request_id FOR UPDATE;
  IF r.id IS NULL OR r.status<>'pending' THEN RAISE EXCEPTION 'Request is not pending'; END IF;
  IF NOT _approve AND btrim(coalesce(_reason,''))='' THEN RAISE EXCEPTION 'Reason required'; END IF;
  SELECT * INTO m FROM public.merchants WHERE id=r.merchant_id;
  UPDATE public.merchant_location_change_requests SET status=CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
    rejection_reason=CASE WHEN _approve THEN NULL ELSE btrim(_reason) END, decided_by=auth.uid(), decided_at=now(), updated_at=now() WHERE id=r.id;
  IF _approve THEN
    UPDATE public.merchants SET latitude=r.latitude, longitude=r.longitude, address=r.address, updated_at=now() WHERE id=r.merchant_id;
  END IF;
  INSERT INTO public.audit_logs(actor_id,action,target_table,target_id,before_state,after_state)
  VALUES(auth.uid(),CASE WHEN _approve THEN 'merchant_location_change_approved' ELSE 'merchant_location_change_rejected' END,'merchant_location_change_requests',r.id,
    jsonb_build_object('merchant_id',r.merchant_id,'latitude',m.latitude,'longitude',m.longitude,'address',m.address),
    jsonb_build_object('merchant_id',r.merchant_id,'latitude',r.latitude,'longitude',r.longitude,'address',r.address,'reason',_reason));
  PERFORM public.party_notify('merchant',r.merchant_id,'location_change_decided',
    CASE WHEN _approve THEN 'Shop location approved' ELSE 'Shop location change rejected' END,
    CASE WHEN _approve THEN 'Customers now see your new shop location.' ELSE 'Reason: '||btrim(_reason) END,
    jsonb_build_object('request_id',r.id));
END $function$;