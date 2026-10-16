create or replace function public.clean_media_normalize(_p jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare d_en text[] := array['House Cleaning','Dusting & Wiping','Bathroom Cleaning','Wash Fold & Arrange','Cleaning Dishes','And many more'];
  d_mr text[] := array['घराची स्वच्छता','धूळ पुसणे','बाथरूम स्वच्छता','कपडे धुणे व घडी','भांडी घासणे','आणि बरेच काही'];
  t jsonb := '[]'; i int; u text; begin
  _p := coalesce(_p,'{}');
  if jsonb_typeof(_p->'tiles')='array' and jsonb_array_length(_p->'tiles')>0 then t := _p->'tiles';
  else for i in 1..6 loop
    u := case when jsonb_typeof(_p->'tile_urls')='array' then _p->'tile_urls'->>(i-1) end;
    t := t || jsonb_build_array(jsonb_build_object('url',u,'title_en',d_en[i],'title_mr',d_mr[i],'enabled',true));
  end loop; end if;
  return jsonb_build_object('maid_url', _p->>'maid_url',
    'heading_en', coalesce(nullif(_p->>'heading_en',''),'One Expert who can do it all'),
    'heading_mr', coalesce(nullif(_p->>'heading_mr',''),'एक एक्सपर्ट, सगळी कामे'),
    'tiles', t, 'tile_urls', (select coalesce(jsonb_agg(e->'url'),'[]') from jsonb_array_elements(t) e));
end $$;

create or replace function public.app_clean_media(_city uuid default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select public.clean_media_normalize(coalesce(
    (select payload from homepage_sections where section_type='clean_media' and city_id=_city and _city is not null order by updated_at desc limit 1),
    (select payload from homepage_sections where section_type='clean_media' and city_id is null order by updated_at desc limit 1))) $$;

create or replace function public.clean_media_require(_city uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r text; begin
  select role into r from staff_users where auth_user_id=auth.uid() and status='active';
  if r is null or r not in ('super_admin','ops_manager') then raise exception 'Forbidden'; end if;
  if _city is null and r<>'super_admin' and not exists (select 1 from staff_users where auth_user_id=auth.uid()) then raise exception 'Forbidden'; end if;
  if _city is not null and not (_city = any(staff_allowed_city_ids())) then raise exception 'Forbidden for this city'; end if;
end $$;

create or replace function public.staff_get_clean_media(_city uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare own boolean; begin
  perform clean_media_require(_city);
  own := exists (select 1 from homepage_sections where section_type='clean_media' and city_id is not distinct from _city);
  return app_clean_media(_city) || jsonb_build_object('is_default', not own);
end $$;

create or replace function public.staff_save_clean_media(_city uuid, _payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p jsonb; t jsonb; before jsonb; u text; begin
  perform clean_media_require(_city);
  if jsonb_typeof(_payload->'tiles')<>'array' or jsonb_array_length(_payload->'tiles')<>6 then raise exception 'Exactly 6 tiles are required'; end if;
  if length(coalesce(_payload->>'heading_en','')) not between 1 and 80 or length(coalesce(_payload->>'heading_mr','')) > 80 then raise exception 'Heading is required (max 80 characters)'; end if;
  for t in select * from jsonb_array_elements(_payload->'tiles') loop
    if length(coalesce(t->>'title_en','')) not between 1 and 40 or length(coalesce(t->>'title_mr','')) > 40 then raise exception 'Each tile needs an English title (max 40 characters)'; end if;
    if jsonb_typeof(t->'enabled')<>'boolean' then raise exception 'Invalid on/off value'; end if;
  end loop;
  for u in select _payload->>'maid_url' union all select e->>'url' from jsonb_array_elements(_payload->'tiles') e loop
    if u is not null and u !~ '^https://api\.badiyos\.com/storage/v1/object/public/catalog-images/clean-media/' then raise exception 'Images must be uploaded here'; end if;
  end loop;
  p := clean_media_normalize(jsonb_build_object('maid_url',_payload->>'maid_url','heading_en',_payload->>'heading_en','heading_mr',_payload->>'heading_mr',
    'tiles',(select jsonb_agg(jsonb_build_object('url',e->>'url','title_en',e->>'title_en','title_mr',coalesce(e->>'title_mr',''),'enabled',(e->>'enabled')::boolean)) from jsonb_array_elements(_payload->'tiles') e)));
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
end $$;

create or replace function public.staff_reset_clean_media(_city uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare before jsonb; begin
  perform clean_media_require(_city);
  if _city is null then raise exception 'The default cannot be reset'; end if;
  delete from homepage_sections where section_type='clean_media' and city_id=_city returning payload into before;
  insert into audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(),'reset_clean_media','homepage_sections',_city, before, null);
  return staff_get_clean_media(_city);
end $$;

revoke all on function public.clean_media_require(uuid) from public, anon, authenticated;
revoke all on function public.staff_get_clean_media(uuid), public.staff_save_clean_media(uuid,jsonb), public.staff_reset_clean_media(uuid) from public, anon;
grant execute on function public.staff_get_clean_media(uuid), public.staff_save_clean_media(uuid,jsonb), public.staff_reset_clean_media(uuid) to authenticated;
grant execute on function public.app_clean_media(uuid) to anon, authenticated;