DO $migration$
DECLARE d text; old_text text; new_text text;
BEGIN
  d := pg_get_functiondef('public.app_service_content(text,uuid)'::regprocedure);
  old_text := 'declare r record; h jsonb; x jsonb; cp jsonb; begin';
  IF position(old_text in d)=0 THEN RAISE EXCEPTION 'Unexpected public content function'; END IF;
  d := replace(d, old_text, 'declare r record; h jsonb; x jsonb; cp jsonb; result jsonb; begin');
  d := replace(d, 'return jsonb_build_object(', 'result := jsonb_build_object(');
  d := replace(d, 'end $function$', E'  return case when _service_key = ''wash'' then result - ''banner'' - ''campaign'' else result end;\nend $function$');
  EXECUTE d;

  d := pg_get_functiondef('public.staff_save_service_content(text,uuid,jsonb)'::regprocedure);
  old_text := E'  _payload := jsonb_build_object(''hero'', h, ''cards'', _payload->''cards'', ''options'', coalesce(_payload->''options'',''{}''))';
  new_text := E'  select payload into before from homepage_sections where section_type=_service_key||''_content'' and city_id is not distinct from _city;\n  if _service_key = ''wash'' then\n    -- Unused Auto banners must not block ordinary content saves.\n    _payload := _payload - ''banner'' - ''banners'' - ''campaign'';\n  end if;\n  _payload := jsonb_build_object(''hero'', h, ''cards'', _payload->''cards'', ''options'', coalesce(_payload->''options'',''{}''))';
  IF position(old_text in d)=0 THEN RAISE EXCEPTION 'Unexpected staff content function'; END IF;
  d := replace(d, old_text, new_text);
  old_text := E'  perform service_content_check_extras(_payload);';
  new_text := E'  perform service_content_check_extras(_payload);\n  if _service_key = ''wash'' then\n    -- Preserve raw existing banner keys exactly; do not copy fallback data.\n    _payload := (_payload - ''banner'' - ''banners'' - ''campaign'')\n      || coalesce((select jsonb_object_agg(key, value) from jsonb_each(coalesce(before, ''{}''::jsonb)) where key in (''banner'', ''banners'', ''campaign'')), ''{}''::jsonb);\n  end if;';
  IF position(old_text in d)=0 THEN RAISE EXCEPTION 'Unexpected extras validation'; END IF;
  d := replace(d, old_text, new_text);
  EXECUTE d;
END $migration$;