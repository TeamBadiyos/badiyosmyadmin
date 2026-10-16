create or replace function public.app_service_content(_service_key text, _city_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r record; h jsonb; x jsonb; cp jsonb; begin
  select * into r from service_content_resolve(_service_key, _city_id);
  h := r.content->'hero';
  x := service_content_merge_extras(_service_key, r.content);
  cp := x->'campaign';
  return jsonb_build_object(
    'service_key', _service_key, 'city_id', _city_id, 'is_default', r.is_default,
    'hero', jsonb_build_object(
      'heading', nullif(btrim(coalesce(h->>'heading','')),''), 'heading_mr', nullif(btrim(coalesce(h->>'heading_mr','')),''),
      'subline', h->>'subline', 'subline_mr', coalesce(h->>'subline_mr',''),
      'button', h->>'button', 'button_mr', coalesce(h->>'button_mr',''),
      'image_url', nullif(h->>'image_url',''), 'bg_color', h->>'bg_color',
      'card_title', left(coalesce(nullif(btrim(coalesce(h->>'card_title','')),''), case when _service_key='wash' then 'Car Wash' else 'Maid' end),30),
      'card_title_mr', left(coalesce(nullif(btrim(coalesce(h->>'card_title_mr','')),''), case when _service_key='wash' then 'कार वॉश' else 'मेड' end),30)),
    'morning_switch_time', case when coalesce(h->>'morning_switch_time','') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then h->>'morning_switch_time' else '05:00' end,
    'cards', coalesce((select jsonb_agg(jsonb_build_object(
        'title', c->>'title', 'title_mr', coalesce(c->>'title_mr',''), 'image_url', nullif(c->>'image_url',''),
        'included', coalesce(c->'included','[]'), 'not_included', coalesce(c->'not_included','[]'),
        'price_option_id', nullif(c->>'price_option_id','')) order by n)
      from jsonb_array_elements(r.content->'cards') with ordinality x(c,n) where coalesce((c->>'enabled')::boolean, true)), '[]'::jsonb),
    'options', coalesce((select jsonb_agg(jsonb_build_object(
        'price_option_id', e->>'price_option_id',
        'name', coalesce(nullif(r.content->'options'->(e->>'price_option_id')->>'name',''), e->>'label'),
        'name_mr', coalesce(r.content->'options'->(e->>'price_option_id')->>'name_mr',''),
        'image_url', nullif(r.content->'options'->(e->>'price_option_id')->>'image_url',''),
        'original_price', coalesce(nullif(r.content->'options'->(e->>'price_option_id')->>'original_price','')::numeric, (e->>'strikethrough_price')::numeric),
        'price', (e->>'price')::numeric, 'gst_rate', (e->>'gst_rate')::numeric) order by n)
      from jsonb_array_elements(service_content_options(_service_key, _city_id)) with ordinality y(e,n)), '[]'::jsonb),
    'details', jsonb_build_object(
      'included_title', x->'details'->>'included_title', 'included_title_mr', coalesce(x->'details'->>'included_title_mr',''),
      'excluded_title', x->'details'->>'excluded_title', 'excluded_title_mr', coalesce(x->'details'->>'excluded_title_mr',''),
      'note', nullif(btrim(coalesce(x->'details'->>'note','')),''), 'note_mr', nullif(btrim(coalesce(x->'details'->>'note_mr','')),''),
      'note_icon', nullif(x->'details'->>'note_icon','')),
    'banners', (select jsonb_object_agg(k, jsonb_build_object('image_url', nullif(v->>'image_url',''), 'title', v->>'title', 'title_mr', coalesce(v->>'title_mr',''), 'subline', coalesce(v->>'subline',''), 'subline_mr', coalesce(v->>'subline_mr','')))
                from jsonb_each(x->'banners') e(k,v)),
    'campaign', jsonb_build_object(
      'enabled', coalesce((cp->>'enabled')::boolean,false),
      'active', coalesce((cp->>'enabled')::boolean,false) and nullif(cp->>'starts_at','') is not null and nullif(cp->>'ends_at','') is not null
                and now() >= (cp->>'starts_at')::timestamptz and now() < (cp->>'ends_at')::timestamptz,
      'image_url', nullif(cp->>'image_url',''), 'title', coalesce(cp->>'title',''), 'title_mr', coalesce(cp->>'title_mr',''),
      'subline', coalesce(cp->>'subline',''), 'subline_mr', coalesce(cp->>'subline_mr',''),
      'link', nullif(cp->>'link',''), 'starts_at', nullif(cp->>'starts_at',''), 'ends_at', nullif(cp->>'ends_at','')));
end $$;