create or replace function public.staff_set_lead_status(
  _kind text,
  _lead_id uuid,
  _status text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
  v_old text;
begin
  select exists (
    select 1 from staff_users s
    where s.auth_user_id = auth.uid()
      and s.status = 'active'
      and s.role in ('super_admin','ops_manager')
  ) into v_ok;
  if not v_ok then
    raise exception 'Forbidden';
  end if;

  if _status not in ('new','contacted','converted','rejected') then
    raise exception 'invalid_status';
  end if;

  if _kind = 'area_partner' then
    select status into v_old from area_partner_leads where id = _lead_id;
    if v_old is null then raise exception 'lead_not_found'; end if;
    update area_partner_leads set status = _status where id = _lead_id;
  elsif _kind = 'expert' then
    select status into v_old from expert_leads where id = _lead_id;
    if v_old is null then raise exception 'lead_not_found'; end if;
    update expert_leads set status = _status where id = _lead_id;
  else
    raise exception 'invalid_kind';
  end if;

  insert into audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (
    auth.uid(),
    'lead_status_change',
    _kind || '_lead',
    _lead_id,
    jsonb_build_object('status', v_old),
    jsonb_build_object('status', _status)
  );

  return true;
end;
$$;

grant execute on function public.staff_set_lead_status(text, uuid, text) to authenticated;