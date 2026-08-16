CREATE OR REPLACE FUNCTION public.staff_upsert_task_detail(_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _id uuid := nullif(_payload->>'id','')::uuid;
  _before jsonb;
  _rank int;
  _segment uuid := nullif(_payload->>'segment_id','')::uuid;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF _segment IS NULL THEN RAISE EXCEPTION 'segment_id is required'; END IF;
  IF coalesce(trim(_payload->>'task_name'),'') = '' THEN RAISE EXCEPTION 'task_name is required'; END IF;
  IF coalesce(trim(_payload->>'task_slug'),'') = '' THEN RAISE EXCEPTION 'task_slug is required'; END IF;

  IF _id IS NOT NULL THEN
    SELECT to_jsonb(t) INTO _before FROM public.service_task_details t WHERE t.id = _id;
    IF _before IS NULL THEN RAISE EXCEPTION 'task not found'; END IF;
    UPDATE public.service_task_details SET
      segment_id = _segment,
      task_name = trim(_payload->>'task_name'),
      task_slug = trim(_payload->>'task_slug'),
      icon_url = nullif(_payload->>'icon_url',''),
      included_items = coalesce((SELECT array_agg(x) FROM jsonb_array_elements_text(coalesce(_payload->'included_items','[]'::jsonb)) x), ARRAY[]::text[]),
      excluded_items = coalesce((SELECT array_agg(x) FROM jsonb_array_elements_text(coalesce(_payload->'excluded_items','[]'::jsonb)) x), ARRAY[]::text[]),
      is_active = coalesce((_payload->>'is_active')::boolean, true)
    WHERE id = _id;
  ELSE
    SELECT coalesce(max(rank),0) + 1 INTO _rank FROM public.service_task_details WHERE segment_id = _segment;
    INSERT INTO public.service_task_details (segment_id, task_name, task_slug, icon_url, included_items, excluded_items, rank, is_active)
    VALUES (
      _segment,
      trim(_payload->>'task_name'),
      trim(_payload->>'task_slug'),
      nullif(_payload->>'icon_url',''),
      coalesce((SELECT array_agg(x) FROM jsonb_array_elements_text(coalesce(_payload->'included_items','[]'::jsonb)) x), ARRAY[]::text[]),
      coalesce((SELECT array_agg(x) FROM jsonb_array_elements_text(coalesce(_payload->'excluded_items','[]'::jsonb)) x), ARRAY[]::text[]),
      coalesce((_payload->>'rank')::int, _rank),
      coalesce((_payload->>'is_active')::boolean, true)
    )
    RETURNING id INTO _id;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  SELECT auth.uid(), CASE WHEN _before IS NULL THEN 'task_detail_create' ELSE 'task_detail_update' END,
         'service_task_details', _id, _before, to_jsonb(t)
  FROM public.service_task_details t WHERE t.id = _id;

  RETURN _id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.staff_delete_task_detail(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _before jsonb;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT to_jsonb(t) INTO _before FROM public.service_task_details t WHERE t.id = _id;
  IF _before IS NULL THEN RAISE EXCEPTION 'task not found'; END IF;
  DELETE FROM public.service_task_details WHERE id = _id;
  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), 'task_detail_delete', 'service_task_details', _id, _before, NULL);
END;
$function$;

CREATE OR REPLACE FUNCTION public.staff_reorder_task_details(_orders jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _o jsonb;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  FOR _o IN SELECT * FROM jsonb_array_elements(coalesce(_orders,'[]'::jsonb)) LOOP
    UPDATE public.service_task_details
       SET rank = (_o->>'rank')::int
     WHERE id = (_o->>'id')::uuid;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.staff_upsert_task_detail(jsonb) FROM public, anon;
REVOKE ALL ON FUNCTION public.staff_delete_task_detail(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.staff_reorder_task_details(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_upsert_task_detail(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_delete_task_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_reorder_task_details(jsonb) TO authenticated;

DROP POLICY IF EXISTS "Staff can read task details" ON public.service_task_details;
CREATE POLICY "Staff can read task details" ON public.service_task_details
FOR SELECT TO authenticated
USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) OR is_active = true);