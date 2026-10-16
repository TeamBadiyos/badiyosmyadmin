create or replace function public.app_clean_media(_city uuid default null) returns jsonb
language sql stable security definer set search_path = public as $$
  with n as (select public.clean_media_normalize(coalesce(
    (select payload from homepage_sections where section_type='clean_media' and city_id=_city and _city is not null order by updated_at desc limit 1),
    (select payload from homepage_sections where section_type='clean_media' and city_id is null order by updated_at desc limit 1))) j)
  select j || jsonb_build_object('heading_en', j->>'heading',
    'tiles', (select jsonb_agg(e || jsonb_build_object('title_en', e->>'title') order by o) from jsonb_array_elements(j->'tiles') with ordinality x(e,o)))
  from n $$;