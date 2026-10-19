CREATE OR REPLACE FUNCTION public.staff_set_service_hours(_service_key text, _weekday integer, _open_time time without time zone, _close_time time without time zone, _is_closed boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _fid uuid; _city uuid;
begin
  perform public.staff_require_super_admin();
  select city_id into _city from public.staff_view_city where auth_user_id = auth.uid() limit 1;
  select id into _fid from public.service_flags
   where service_key = _service_key
   order by (city_id is not distinct from _city) desc, created_at limit 1;
  if _fid is null then raise exception 'Unknown service %', _service_key; end if;
  insert into public.service_hours (service_flag_id, weekday, open_time, close_time, is_closed, updated_at)
  values (_fid, _weekday, _open_time, _close_time, _is_closed, now())
  on conflict (service_flag_id, weekday)
  do update set open_time = excluded.open_time, close_time = excluded.close_time,
                is_closed = excluded.is_closed, updated_at = now();
  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), 'service_hours_change', 'service_flags', _fid, null,
    jsonb_build_object('weekday', _weekday, 'open', _open_time, 'close', _close_time, 'is_closed', _is_closed));
  return jsonb_build_object('ok', true);
end $function$;