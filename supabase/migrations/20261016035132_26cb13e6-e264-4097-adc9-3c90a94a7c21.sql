CREATE OR REPLACE FUNCTION public.city_accept_timeout(_city_id uuid, _svc text) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT default_accept_timeout_minutes FROM city_service_settings WHERE city_id = COALESCE(_city_id, public.default_city_id()) AND service_key = _svc),
    (SELECT default_accept_timeout_minutes FROM city_service_settings WHERE city_id = public.default_city_id() AND service_key = _svc),
    CASE _svc WHEN 'store' THEN 10 ELSE 5 END) $$;
GRANT EXECUTE ON FUNCTION public.city_accept_timeout(uuid, text) TO authenticated, service_role;

-- Remove the duplicate shared copy
CREATE OR REPLACE FUNCTION public.city_ops_keys() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['slot_capacity_enabled','slot_capacity_mode','default_slot_capacity','wash_default_slot_capacity',
    'clean_band_morning_end','clean_band_day_end','wash_band_morning_end','wash_band_day_end',
    'slot_first_start_hour','slot_last_start_hour','slot_step_minutes',
    'instant_booking_enabled','wash_instant_booking_enabled'] $$;
DELETE FROM public.city_ops_settings WHERE key = 'store_accept_timeout_minutes';
DELETE FROM public.ops_settings WHERE key = 'store_accept_timeout_minutes';

-- Auto-reject job: city value only
CREATE OR REPLACE FUNCTION public.store_sweeper()
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _r record;
begin
  begin perform public.store_expire_unpaid();
  exception when others then raise warning 'store_expire_unpaid failed: %', sqlerrm; end;
  begin
    for _r in select o.id from public.merchant_orders o
                join public.merchants m on m.id = o.merchant_id
                where o.status in ('placed','paid') and o.payment_status = 'paid' and o.accepted_at is null
                 and coalesce(o.placed_at, o.paid_at, o.created_at)
                     < now() - make_interval(mins => public.city_accept_timeout(coalesce(o.city_id, m.city_id),
                         case when m.service_type = 'food' then 'food' else 'store' end))
               for update of o skip locked
    loop
      update public.merchant_orders set reject_reason = 'MERCHANT_TIMEOUT' where id = _r.id;
      perform public.store_set_status(_r.id, 'rejected', 'store_auto_reject_timeout', jsonb_build_object('reason','MERCHANT_TIMEOUT'));
      perform public.store_restock(_r.id);
      perform public.store_mark_refund(_r.id, 'MERCHANT_TIMEOUT');
    end loop;
    perform public.store_dispatch_refund_job();
  exception when others then raise warning 'store_sweeper failed: %', sqlerrm;
  end;
end $function$;

-- Alert validation: compare against the same city's value
CREATE OR REPLACE FUNCTION public.staff_update_dispatch_config(_payload jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _id uuid := (_payload->>'id')::uuid;
  _m jsonb := _payload->'no_accept_minutes';
  _t int; _city uuid;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), NULL) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _id IS NULL THEN RAISE EXCEPTION 'id required'; END IF;
  SELECT city_id INTO _city FROM public.dispatch_config WHERE id = _id;
  IF _m IS NOT NULL THEN
    _t := public.city_accept_timeout(_city, 'store');
    IF (_m->>'store')::int >= _t THEN
      RAISE EXCEPTION 'Store alert limit must be lower than the merchant accept timeout (% min)', _t; END IF;
    _t := public.city_accept_timeout(_city, 'food');
    IF (_m->>'food')::int >= _t THEN
      RAISE EXCEPTION 'Food alert limit must be lower than the restaurant accept timeout (% min)', _t; END IF;
  END IF;
  UPDATE public.dispatch_config SET
    no_accept_minutes = COALESCE(_m, no_accept_minutes),
    aisensy_template_name = COALESCE(_payload->>'aisensy_template_name', aisensy_template_name),
    ops_alert_whatsapp_numbers = COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(_payload->'ops_alert_whatsapp_numbers','[]'::jsonb))), ops_alert_whatsapp_numbers),
    almost_available_window_minutes = COALESCE((_payload->>'almost_available_window_minutes')::integer, almost_available_window_minutes),
    updated_at = now()
  WHERE id = _id;
  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), 'update_dispatch_config', 'dispatch_config', _id, NULL, _payload);
END;
$function$;