CREATE OR REPLACE FUNCTION public.staff_set_service_visible(_flag_id uuid, _active boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _old record;
begin
  if not exists (select 1 from public.staff_users s where s.user_id = auth.uid() and s.is_active and s.role in ('super_admin','ops_manager')) then
    raise exception 'Not allowed';
  end if;
  select * into _old from public.service_flags where id = _flag_id;
  if not found then raise exception 'Unknown service'; end if;
  update public.service_flags set is_active = _active, updated_at = now() where id = _flag_id;
  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), 'service_visibility_change', 'service_flags', _flag_id,
    jsonb_build_object('is_active', _old.is_active), jsonb_build_object('is_active', _active));
  return jsonb_build_object('ok', true);
end $$;
REVOKE ALL ON FUNCTION public.staff_set_service_visible(uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_set_service_visible(uuid, boolean) TO authenticated;