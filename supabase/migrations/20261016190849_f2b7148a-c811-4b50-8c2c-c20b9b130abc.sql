CREATE OR REPLACE FUNCTION public.staff_save_clean_media(_city uuid, _payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare p jsonb; t jsonb; before jsonb; u text; begin
  perform clean_media_require(_city);
  if jsonb_typeof(_payload->'tiles')<>'array' or jsonb_array_length(_payload->'tiles')<>6 then raise exception 'Exactly 6 tiles are required'; end if;
  -- accept both current (heading/title) and older (heading_en/title_en) field names
  _payload := jsonb_build_object(
    'maid_url', nullif(_payload->>'maid_url',''),
    'heading', coalesce(nullif(_payload->>'heading',''), _payload->>'heading_en', ''),
    'heading_mr', coalesce(_payload->>'heading_mr',''),
    'tiles', (select jsonb_agg(jsonb_build_object(
        'title', coalesce(nullif(e->>'title',''), e->>'title_en', ''),
        'title_mr', coalesce(e->>'title_mr',''),
        'url', nullif(e->>'url',''),
        'enabled', case when jsonb_typeof(e->'enabled')='boolean' then e->'enabled' else 'true'::jsonb end) order by o)
      from jsonb_array_elements(_payload->'tiles') with ordinality x(e,o)));
  if length(_payload->>'heading') not between 1 and 80 or length(_payload->>'heading_mr') > 80 then raise exception 'Heading is required (max 80 characters)'; end if;
  for t in select * from jsonb_array_elements(_payload->'tiles') loop
    if length(t->>'title') not between 1 and 40 or length(t->>'title_mr') > 40 then raise exception 'Each tile needs an English title (max 40 characters)'; end if;
  end loop;
  for u in select _payload->>'maid_url' union all select e->>'url' from jsonb_array_elements(_payload->'tiles') e loop
    if u is not null and u !~ '^https://api\.badiyos\.com/storage/v1/object/public/catalog-images/clean-media/' then raise exception 'Images must be uploaded here'; end if;
  end loop;
  p := clean_media_normalize(_payload);
  select payload into before from homepage_sections where section_type='clean_media' and city_id is not distinct from _city;
  if before is null then
    insert into homepage_sections(section_type, display_order, is_active, payload, city_id, updated_by, updated_at)
    values ('clean_media', 0, true, p, _city, auth.uid(), now());
  else
    update homepage_sections set payload=p, updated_by=auth.uid(), updated_at=now() where section_type='clean_media' and city_id is not distinct from _city;
  end if;
  insert into audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(),'save_clean_media','homepage_sections',_city, before, p);
  return staff_get_clean_media(_city);
end $function$;