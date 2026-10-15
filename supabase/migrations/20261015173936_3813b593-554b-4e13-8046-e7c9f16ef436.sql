CREATE OR REPLACE FUNCTION public.system_check_commerce_alerts() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
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

  -- No rider accepted: always uses the Parcel (rider) limit
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
    AND coalesce(c.search_started_at,c.created_at) <= now() - make_interval(mins => public.dispatch_limit_minutes(coalesce(m.city, c.city), 'parcel'))
  ON CONFLICT (notif_key) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.system_check_commerce_alerts() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.system_check_commerce_alerts() TO service_role;