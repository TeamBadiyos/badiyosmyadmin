UPDATE public.dispatch_config SET no_accept_minutes = '{"maid":10,"wash":10,"store":3,"food":3,"parcel":5}'::jsonb;
ALTER TABLE public.dispatch_config ALTER COLUMN no_accept_minutes SET DEFAULT '{"maid":10,"wash":10,"store":3,"food":3,"parcel":5}'::jsonb;

CREATE OR REPLACE FUNCTION public.dispatch_limit_minutes(_city text, _svc text) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT (no_accept_minutes->>_svc)::int FROM public.dispatch_config WHERE city = _city LIMIT 1),
    (SELECT (no_accept_minutes->>_svc)::int FROM public.dispatch_config ORDER BY city LIMIT 1),
    CASE _svc WHEN 'store' THEN 3 WHEN 'food' THEN 3 WHEN 'parcel' THEN 5 ELSE 10 END);
$$;
REVOKE ALL ON FUNCTION public.dispatch_limit_minutes(text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.dispatch_limit_minutes(text,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.staff_update_dispatch_config(_payload jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _id uuid := (_payload->>'id')::uuid;
  _m jsonb := _payload->'no_accept_minutes';
  _t int;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), NULL) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _id IS NULL THEN RAISE EXCEPTION 'id required'; END IF;
  IF _m IS NOT NULL THEN
    SELECT default_accept_timeout_minutes INTO _t FROM public.service_settings WHERE service_key='store';
    IF _t IS NOT NULL AND (_m->>'store')::int >= _t THEN
      RAISE EXCEPTION 'Store alert limit must be lower than the merchant accept timeout (% min)', _t; END IF;
    SELECT default_accept_timeout_minutes INTO _t FROM public.service_settings WHERE service_key='food';
    IF _t IS NOT NULL AND (_m->>'food')::int >= _t THEN
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

-- Store / Food / Parcel bell alerts
CREATE OR REPLACE FUNCTION public.system_check_commerce_alerts() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Merchant hasn't accepted
  INSERT INTO public.staff_notifications (notif_key, kind, title, detail, target, target_id, event_at)
  SELECT 'merchant_slow:'||o.id, 'dispatch', 'Merchant hasn''t accepted',
         coalesce(m.store_name,'Store')||' · #'||coalesce(o.order_number,'')||' · waiting '||
           floor(extract(epoch from now()-o.created_at)/60)::int||' min',
         CASE WHEN m.service_type='food' THEN 'food-orders' ELSE 'store-orders' END, o.id, now()
  FROM public.merchant_orders o JOIN public.merchants m ON m.id = o.merchant_id
  WHERE o.status = 'pending' AND COALESCE(o.is_training,false) = false
    AND o.created_at > now() - interval '1 day'
    AND (o.payment_mode IS DISTINCT FROM 'online' OR o.payment_status = 'paid')
    AND o.created_at <= now() - make_interval(mins => public.dispatch_limit_minutes(m.city, CASE WHEN m.service_type='food' THEN 'food' ELSE 'store' END))
  ON CONFLICT (notif_key) DO NOTHING;

  -- No rider accepted (store/food delivery, parcel, business trips)
  INSERT INTO public.staff_notifications (notif_key, kind, title, detail, target, target_id, event_at)
  SELECT 'no_rider:'||c.id, 'dispatch', 'No rider accepted',
         CASE WHEN mo.id IS NOT NULL THEN (CASE WHEN m.service_type='food' THEN 'Food' ELSE 'Store' END)||' · '||coalesce(m.store_name,'')
              WHEN c.source='business' THEN 'Business trip'||coalesce(' · '||c.order_code,'')
              ELSE 'Parcel'||coalesce(' · '||c.order_code,'') END
           ||' · waiting '||floor(extract(epoch from now()-coalesce(c.search_started_at,c.created_at))/60)::int||' min',
         CASE WHEN mo.id IS NOT NULL THEN (CASE WHEN m.service_type='food' THEN 'food-orders' ELSE 'store-orders' END) ELSE 'courier-orders' END,
         COALESCE(mo.id, c.id), now()
  FROM public.courier_orders c
  LEFT JOIN public.merchant_orders mo ON mo.courier_order_id = c.id
  LEFT JOIN public.merchants m ON m.id = mo.merchant_id
  WHERE c.status IN ('REQUESTED','SEARCHING') AND c.assigned_expert_id IS NULL
    AND coalesce(c.search_started_at,c.created_at) > now() - interval '1 day'
    AND coalesce(c.search_started_at,c.created_at) <= now() - make_interval(mins => public.dispatch_limit_minutes(
          coalesce(m.city, c.city), CASE WHEN mo.id IS NULL THEN 'parcel' WHEN m.service_type='food' THEN 'food' ELSE 'store' END))
  ON CONFLICT (notif_key) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.system_check_commerce_alerts() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.system_check_commerce_alerts() TO service_role;

-- Booking no-accept check: per-service (Clean Home / Clean Auto) limit
CREATE OR REPLACE FUNCTION public.system_check_no_accept_alerts()
 RETURNS SETOF uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE b record;
BEGIN
  BEGIN PERFORM public.system_check_commerce_alerts();
  EXCEPTION WHEN others THEN RAISE WARNING 'commerce alerts: %', sqlerrm; END;

  FOR b IN
    SELECT bk.id, bk.broadcast_started_at,
           public.dispatch_limit_minutes(z.city,
             CASE WHEN public.booking_capacity_group(bk.service_category_id, bk.service_label) = 'wash' THEN 'wash' ELSE 'maid' END) AS lim
      FROM public.bookings bk
      LEFT JOIN public.zones z ON z.id = bk.zone_id
     WHERE bk.status IN ('confirmed','accepted') AND bk.assigned_expert_id IS NULL
       AND bk.deleted_at IS NULL AND bk.broadcast_started_at IS NOT NULL
       AND COALESCE(bk.dispatch_alert_sent, false) = false
  LOOP
    IF b.broadcast_started_at <= now() - make_interval(mins => b.lim) THEN
      IF public.raise_dispatch_alert(b.id, 'no_accept') THEN RETURN NEXT b.id; END IF;
    END IF;
  END LOOP;
END;
$function$;