CREATE OR REPLACE FUNCTION public.staff_update_dispatch_config(_payload jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _id uuid := (_payload->>'id')::uuid;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), NULL) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _id IS NULL THEN RAISE EXCEPTION 'id required'; END IF;
  UPDATE public.dispatch_config SET
    no_accept_minutes = COALESCE(_payload->'no_accept_minutes', no_accept_minutes),
    aisensy_template_name = COALESCE(_payload->>'aisensy_template_name', aisensy_template_name),
    ops_alert_whatsapp_numbers = COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(_payload->'ops_alert_whatsapp_numbers','[]'::jsonb))), ops_alert_whatsapp_numbers),
    almost_available_window_minutes = COALESCE((_payload->>'almost_available_window_minutes')::integer, almost_available_window_minutes),
    updated_at = now()
  WHERE id = _id;
  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), 'update_dispatch_config', 'dispatch_config', _id, NULL, _payload);
END;
$function$;