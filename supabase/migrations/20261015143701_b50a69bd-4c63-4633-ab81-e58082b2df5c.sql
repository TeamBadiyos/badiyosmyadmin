CREATE OR REPLACE FUNCTION public.staff_dashboard_team()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _res jsonb;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  WITH e AS (
    SELECT x.id, x.name, x.phone, x.location_updated_at, z.name zone,
      public.is_delivery_rider(x.id) rider,
      EXISTS (SELECT 1 FROM public.partner_skills ps JOIN public.service_categories c ON c.id=ps.service_category_id
               WHERE ps.expert_id=x.id AND ps.status='approved' AND c.slug='car-bike-wash') washer,
      (SELECT string_agg(DISTINCT vt.name, ', ') FROM public.partner_skills ps JOIN public.courier_vehicle_types vt ON vt.required_skill=ps.service_category_id
        WHERE ps.expert_id=x.id AND ps.status='approved' AND vt.is_active) vehicle,
      (SELECT jsonb_build_object('kind','booking','label',coalesce(b.service_label,'Booking'),'status',b.status,'area',a.city)
         FROM public.bookings b LEFT JOIN public.addresses a ON a.id=b.address_id
        WHERE b.assigned_expert_id=x.id AND b.deleted_at IS NULL AND b.status IN ('expert_assigned','in_progress')
        ORDER BY b.updated_at DESC LIMIT 1) bjob,
      (SELECT jsonb_build_object('kind','parcel','label',c.order_code,'status',c.status,'area',c.drop_address)
         FROM public.courier_orders c
        WHERE c.assigned_expert_id=x.id AND c.status IN ('DRIVER_ASSIGNED','ARRIVED_PICKUP','PICKED_UP','IN_TRANSIT')
        ORDER BY c.updated_at DESC LIMIT 1) cjob,
      greatest(
        (SELECT max(b.updated_at) FROM public.bookings b WHERE b.assigned_expert_id=x.id AND b.status='completed'),
        (SELECT max(c.updated_at) FROM public.courier_orders c WHERE c.assigned_expert_id=x.id AND c.status IN ('DELIVERED','COMPLETED'))) last_done,
      coalesce(x.is_busy,false) is_busy
    FROM public.experts x LEFT JOIN public.zones z ON z.id=x.zone_id
    WHERE x.status='active' AND coalesce(x.is_online,false))
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'name',name,'phone',phone,'zone',zone,
    'group', CASE WHEN rider THEN 'rider' WHEN washer THEN 'washer' ELSE 'maid' END,
    'busy', is_busy OR bjob IS NOT NULL OR cjob IS NOT NULL,
    'job', coalesce(cjob,bjob), 'vehicle', vehicle,
    'free_since', last_done, 'last_seen', location_updated_at) ORDER BY name),'[]'::jsonb) INTO _res FROM e;
  RETURN _res;
END $$;
REVOKE ALL ON FUNCTION public.staff_dashboard_team() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_dashboard_team() TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_dashboard_money(_from date, _to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _f timestamptz := (_from::timestamp AT TIME ZONE 'Asia/Kolkata');
        _t timestamptz := ((_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata');
        _res jsonb := '{}'::jsonb; _g text; _r record;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  FOREACH _g IN ARRAY ARRAY['clean','wash'] LOOP
    SELECT coalesce(sum(coalesce(price,0)),0) gross, coalesce(sum(coalesce(discount_amount,0)),0) disc
      INTO _r FROM public.bookings b
     WHERE b.status='completed' AND coalesce(b.is_training,false)=false AND b.deleted_at IS NULL
       AND b.scheduled_date BETWEEN _from AND _to
       AND public.booking_capacity_group(b.service_category_id, b.service_label)=_g;
    _res := _res || jsonb_build_object(CASE WHEN _g='clean' THEN 'maid' ELSE 'wash' END,
      jsonb_build_object('gross',round(_r.gross,2),'discount',round(_r.disc,2),'net',round(_r.gross-_r.disc,2)));
  END LOOP;
  FOREACH _g IN ARRAY ARRAY['store','food'] LOOP
    SELECT coalesce(sum(coalesce(o.items_total,o.item_total,0)+coalesce(o.delivery_fee,0)+coalesce(o.platform_fee,0)),0) gross,
           coalesce(sum(greatest(coalesce(o.items_total,o.item_total,0)+coalesce(o.delivery_fee,0)+coalesce(o.platform_fee,0)
              +coalesce(o.gst_items,0)+coalesce(o.gst_delivery,0)+coalesce(o.gst_platform,0)-coalesce(o.total_amount,0),0)),0) disc
      INTO _r FROM public.merchant_orders o JOIN public.merchants m ON m.id=o.merchant_id
     WHERE (CASE WHEN m.service_type='food' THEN 'food' ELSE 'store' END)=_g
       AND o.status IN ('delivered','completed') AND o.created_at>=_f AND o.created_at<_t AND coalesce(o.is_training,false)=false;
    _res := _res || jsonb_build_object(_g, jsonb_build_object('gross',round(_r.gross,2),'discount',round(_r.disc,2),'net',round(_r.gross-_r.disc,2)));
  END LOOP;
  SELECT coalesce(sum(coalesce(base_amount,0)+coalesce(extra_fee,0)+coalesce(stops_fee,0)+coalesce(platform_fee,0)),0) gross,
         coalesce(sum(coalesce(discount_amount,0)),0) disc
    INTO _r FROM public.courier_orders
   WHERE merchant_order_id IS NULL AND status IN ('DELIVERED','COMPLETED') AND created_at>=_f AND created_at<_t;
  _res := _res || jsonb_build_object('parcel', jsonb_build_object('gross',round(_r.gross,2),'discount',round(_r.disc,2),'net',round(_r.gross-_r.disc,2)));
  RETURN _res;
END $$;
REVOKE ALL ON FUNCTION public.staff_dashboard_money(date,date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_dashboard_money(date,date) TO authenticated;