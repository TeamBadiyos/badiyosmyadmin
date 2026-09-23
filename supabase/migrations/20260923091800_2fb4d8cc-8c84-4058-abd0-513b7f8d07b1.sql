CREATE OR REPLACE FUNCTION public.staff_set_service_status(
  _service_key text,
  _status text,
  _message_en text DEFAULT NULL::text,
  _message_mr text DEFAULT NULL::text,
  _resume_at timestamp with time zone DEFAULT NULL::timestamp with time zone
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
declare _old record; _was_live boolean;
begin
  perform public.staff_require_super_admin();
  if _status not in ('live','coming_soon','temporarily_stopped','hidden') then
    raise exception 'Invalid status';
  end if;
  select * into _old from public.service_flags where service_key = _service_key order by created_at limit 1;
  if not found then raise exception 'Unknown service %', _service_key; end if;
  _was_live := (_old.status = 'live');

  update public.service_flags set
    status = _status,
    status_message_en = nullif(btrim(coalesce(_message_en, '')), ''),
    status_message_mr = nullif(btrim(coalesce(_message_mr, '')), ''),
    resume_at = case when _status = 'temporarily_stopped' then _resume_at else null end,
    status_updated_at = now(), status_updated_by = auth.uid()
  where id = _old.id;

  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), 'service_status_change', 'service_flags', _old.id,
    jsonb_build_object('status', _old.status, 'status_message_en', _old.status_message_en, 'status_message_mr', _old.status_message_mr),
    jsonb_build_object('status', _status, 'status_message_en', nullif(btrim(coalesce(_message_en,'')),''), 'status_message_mr', nullif(btrim(coalesce(_message_mr,'')),''), 'resume_at', _resume_at));

  if _status = 'live' and not _was_live then
    perform public.notify_service_waiters(_service_key);
  end if;

  return jsonb_build_object('ok', true, 'service_key', _service_key, 'status', _status);
end
$function$;

GRANT EXECUTE ON FUNCTION public.staff_set_service_status(text, text, text, text, timestamp with time zone) TO authenticated;

UPDATE public.service_flags
SET status_message_en = NULL,
    status_message_mr = NULL,
    status_updated_at = now()
WHERE service_key = 'clean';