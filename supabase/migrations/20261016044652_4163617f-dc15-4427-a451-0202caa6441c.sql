CREATE OR REPLACE FUNCTION public.rider_is_busy(_expert_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce((SELECT is_busy FROM public.experts WHERE id=_expert_id),false)
      OR EXISTS (SELECT 1 FROM public.courier_orders c WHERE c.assigned_expert_id=_expert_id
                 AND c.status IN ('DRIVER_ASSIGNED','ARRIVED_PICKUP','PICKED_UP','IN_TRANSIT'))
$$;
REVOKE EXECUTE ON FUNCTION public.rider_is_busy(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rider_is_busy(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rider_pool_stats() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH r AS (SELECT e.id, public.rider_is_busy(e.id) AS busy
               FROM public.experts e WHERE e.status='active' AND e.is_online AND public.is_delivery_rider(e.id))
  SELECT CASE WHEN public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager','area_partner'])
    THEN jsonb_build_object('online',(SELECT count(*) FROM r),'busy',(SELECT count(*) FILTER (WHERE busy) FROM r),
                            'free',(SELECT count(*) FILTER (WHERE NOT busy) FROM r)) END
$$;

DROP FUNCTION IF EXISTS public.staff_courier_assignable_riders(uuid);
CREATE FUNCTION public.staff_courier_assignable_riders(_order_id uuid)
RETURNS TABLE(id uuid, name text, phone text, is_online boolean, distance_km numeric, rider_status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
declare _o public.courier_orders%rowtype; _skill uuid;
begin
  if not public.courier_is_ops_staff() then raise exception 'Not authorized' using errcode='42501'; end if;
  select * into _o from public.courier_orders where courier_orders.id=_order_id;
  select required_skill into _skill from public.courier_vehicle_types where courier_vehicle_types.id=_o.vehicle_type_id;
  return query
  select x.id, x.name, x.phone, x.is_online, x.dist,
         case when x.busy then 'busy' when x.is_online then 'free' else 'offline' end
  from (
    select e.id, e.name::text name, e.phone::text phone, coalesce(e.is_online,false) is_online,
           case when e.current_lat is not null and _o.pickup_lat is not null
                then round(public.haversine_km(e.current_lat,e.current_lng,_o.pickup_lat,_o.pickup_lng)::numeric,1) end dist,
           (e.id is distinct from _o.assigned_expert_id and (public.rider_is_busy(e.id) or exists (
              select 1 from public.bookings b where b.assigned_expert_id=e.id and b.deleted_at is null
                and b.status in ('expert_assigned','in_progress')))) busy
    from public.experts e
    where e.status='active'
      and (_skill is null or exists (select 1 from public.partner_skills ps where ps.expert_id=e.id and ps.status='approved' and ps.service_category_id=_skill))
      and (_o.required_skill_id is null or exists (select 1 from public.partner_skills ps where ps.expert_id=e.id and ps.status='approved' and ps.service_category_id=_o.required_skill_id))
  ) x
  order by case when x.busy then 1 when x.is_online then 0 else 2 end, x.dist asc nulls last, x.name
  limit 200;
end $$;
REVOKE EXECUTE ON FUNCTION public.staff_courier_assignable_riders(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_courier_assignable_riders(uuid) TO authenticated, service_role;

ALTER TABLE public.courier_orders ADD COLUMN IF NOT EXISTS customer_phone text;
UPDATE public.courier_orders c SET customer_phone = u.phone FROM public.users u
 WHERE u.id = c.customer_id AND c.customer_phone IS NULL AND u.phone IS NOT NULL;
UPDATE public.merchant_orders m SET customer_phone = u.phone FROM public.users u
 WHERE u.id = m.user_id AND (m.customer_phone IS NULL OR m.customer_phone = '') AND u.phone IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fill_order_customer_phone() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if TG_TABLE_NAME = 'courier_orders' then
    if NEW.customer_phone is null and NEW.customer_id is not null then
      select phone into NEW.customer_phone from public.users where id = NEW.customer_id;
    end if;
  else
    if coalesce(NEW.customer_phone,'') = '' and NEW.user_id is not null then
      select phone into NEW.customer_phone from public.users where id = NEW.user_id;
    end if;
  end if;
  return NEW;
end $$;
REVOKE EXECUTE ON FUNCTION public.fill_order_customer_phone() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS trg_fill_customer_phone ON public.courier_orders;
CREATE TRIGGER trg_fill_customer_phone BEFORE INSERT ON public.courier_orders FOR EACH ROW EXECUTE FUNCTION public.fill_order_customer_phone();
DROP TRIGGER IF EXISTS trg_fill_customer_phone ON public.merchant_orders;
CREATE TRIGGER trg_fill_customer_phone BEFORE INSERT ON public.merchant_orders FOR EACH ROW EXECUTE FUNCTION public.fill_order_customer_phone();