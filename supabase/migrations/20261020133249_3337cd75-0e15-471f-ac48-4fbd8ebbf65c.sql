REVOKE EXECUTE ON FUNCTION public.admin_alert_clean(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_alert_dispatch() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_alert_enabled(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_alert_enqueue(text,uuid,text,text,numeric,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_alert_verify_job_secret(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_alert_claim_batch(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_alert_mark(uuid,boolean,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_alert_clean(text), public.admin_alert_dispatch(), public.admin_alert_enabled(text),
  public.admin_alert_enqueue(text,uuid,text,text,numeric,text), public.admin_alert_verify_job_secret(text),
  public.admin_alert_claim_batch(integer), public.admin_alert_mark(uuid,boolean,text) TO service_role;

CREATE OR REPLACE FUNCTION public.staff_category_usage(_kind text, _id uuid)
 RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN PERFORM public.require_staff();
  RETURN (SELECT CASE WHEN _kind='store_type' THEN (SELECT count(*) FROM merchants WHERE store_category_id=_id AND deleted_at IS NULL)
              ELSE (SELECT count(*) FROM products WHERE category_id=_id) END::int);
END $function$;

CREATE OR REPLACE FUNCTION public.staff_zone_ids(_auth_user_id uuid)
 RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN PERFORM public.require_staff();
  RETURN COALESCE(
    (SELECT array_agg(DISTINCT z.zone_id)
       FROM public.staff_user_zones z
       JOIN public.staff_users s ON s.id = z.staff_user_id
      WHERE s.auth_user_id = _auth_user_id),
    (SELECT CASE WHEN s.zone_id IS NULL THEN ARRAY[]::uuid[] ELSE ARRAY[s.zone_id] END
       FROM public.staff_users s WHERE s.auth_user_id = _auth_user_id LIMIT 1),
    ARRAY[]::uuid[]
  );
END $function$;

CREATE OR REPLACE FUNCTION public.staff_get_service_content(_service_key text, _city uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare r record; begin PERFORM public.require_staff();
  perform clean_media_require(_city);
  select * into r from service_content_resolve(_service_key, _city);
  return jsonb_build_object('content', (r.content - 'banners') || jsonb_build_object('hero', coalesce(r.content->'hero','{}') - 'morning_switch_time') || service_content_merge_extras(_service_key, r.content), 'is_default', r.is_default, 'options', service_content_options(_service_key, _city));
end $function$;

CREATE OR REPLACE FUNCTION public.staff_courier_rider_ok(_order_id uuid, _expert_id uuid)
 RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _o public.courier_orders%rowtype; _skill uuid; _st text;
begin PERFORM public.require_staff();
  select * into _o from public.courier_orders where id=_order_id;
  select status into _st from public.experts where id=_expert_id;
  if _st is null then return 'Rider not found'; end if;
  if _st <> 'active' then return 'Rider is not active'; end if;
  select required_skill into _skill from public.courier_vehicle_types where id=_o.vehicle_type_id;
  if _skill is not null and not exists (select 1 from public.partner_skills where expert_id=_expert_id and status='approved' and service_category_id=_skill) then
    return 'Rider is not approved for this vehicle type'; end if;
  if _o.required_skill_id is not null and not exists (select 1 from public.partner_skills where expert_id=_expert_id and status='approved' and service_category_id=_o.required_skill_id) then
    return 'Rider does not have the courier skill'; end if;
  if exists (select 1 from public.courier_orders c where c.assigned_expert_id=_expert_id and c.id<>_order_id
             and c.status in ('DRIVER_ASSIGNED','ARRIVED_PICKUP','PICKED_UP','IN_TRANSIT')) then
    return 'Rider is already on another courier job'; end if;
  if exists (select 1 from public.bookings b where b.assigned_expert_id=_expert_id and b.deleted_at is null
             and b.status in ('expert_assigned','in_progress')) then
    return 'Rider is on an active booking'; end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.staff_set_plan_active(_kind text, _id uuid, _active boolean, _reason text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _used int;
begin PERFORM public.require_staff();
  perform public.business_require_super_admin();
  if _kind not in ('pricing','dispatch') then raise exception 'Kind must be pricing or dispatch'; end if;
  select count(*) into _used from public.business_profiles b join public.merchants m on m.id=b.merchant_id
   where m.delivery_status='active' and case when _kind='pricing' then b.pricing_plan_id=_id else b.dispatch_plan_id=_id end;
  if not _active and _used > 0 then
    return jsonb_build_object('ok',false,'reason','in_use','used_by',_used);
  end if;
  if _kind='pricing' then
    update public.bulk_pricing_plans set is_active=_active where id=_id;
  else
    update public.bulk_dispatch_plans set is_active=_active where id=_id;
  end if;
  if not found then raise exception 'Plan not found'; end if;
  perform public.business_audit('staff_set_plan_active', case when _kind='pricing' then 'bulk_pricing_plans' else 'bulk_dispatch_plans' end, _id,
    null, jsonb_build_object('is_active',_active,'reason',_reason), null);
  return jsonb_build_object('ok',true,'used_by',_used);
end $function$;