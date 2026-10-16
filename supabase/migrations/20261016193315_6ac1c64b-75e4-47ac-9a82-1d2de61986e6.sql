
create or replace function public.service_content_check_key(_k text) returns void language plpgsql immutable as $$
begin if _k not in ('clean','wash') then raise exception 'Unknown service key'; end if; end $$;

create or replace function public.service_content_options(_key text, _city uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(x order by x->>'ord', x->>'label'), '[]'::jsonb) from (
    select jsonb_build_object('price_option_id', o.id, 'label', o.label,
      'ord', lpad(coalesce(s.display_order,0)::text,4,'0')||lpad(coalesce(o.display_order,0)::text,4,'0'),
      'price', coalesce(cp.customer_price, o.customer_price),
      'strikethrough_price', coalesce(cp.strikethrough_price, o.strikethrough_price),
      'gst_rate', booking_gst_percent(s.category_id)) x
    from service_price_options o join services s on s.id=o.service_id
    left join city_price_options cp on cp.price_option_id=o.id and cp.city_id=_city
    where o.is_active and s.is_active
      and coalesce(cp.is_active, _city is null or not exists (select 1 from city_price_options c2 where c2.city_id=_city))
      and ((_key='wash') = (s.name ilike '%wash%'))
    order by s.display_order, o.display_order
    limit case when _key='clean' then 6 else 50 end
  ) t
$$;

create or replace function public.service_content_defaults(_key text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare ids uuid[];
begin
  perform service_content_check_key(_key);
  if _key='wash' then
    select array_agg((e->>'price_option_id')::uuid) into ids from jsonb_array_elements(service_content_options('wash', null)) e;
    return jsonb_build_object(
      'hero', jsonb_build_object('heading','','heading_mr','','subline','A Wash for Every Ride','subline_mr','प्रत्येक गाडीसाठी वॉश','button','Book Now','button_mr','बुक करा','image_url',null,'bg_color','#222831'),
      'cards', jsonb_build_array(
        jsonb_build_object('title','Bike Wash','title_mr','बाईक वॉश','image_url',null,'included','[]'::jsonb,'not_included','[]'::jsonb,'enabled',true,'price_option_id',ids[1]),
        jsonb_build_object('title','Car Wash','title_mr','कार वॉश','image_url',null,'included','[]'::jsonb,'not_included','[]'::jsonb,'enabled',true,'price_option_id',ids[2]),
        jsonb_build_object('title','Combo Wash','title_mr','कॉम्बो वॉश','image_url',null,'included','[]'::jsonb,'not_included','[]'::jsonb,'enabled',true,'price_option_id',ids[3])),
      'options','{}'::jsonb);
  end if;
  return jsonb_build_object(
    'hero', jsonb_build_object('heading','','heading_mr','','subline','Maid for Your Everyday Needs','subline_mr','रोजच्या घरकामासाठी मावशी','button','Book Now','button_mr','बुक करा','image_url',null,'bg_color','#00B97A'),
    'cards', jsonb_build_array(
      jsonb_build_object('title','Daily Cleaning','title_mr','रोजची स्वच्छता','image_url',null,'included','[]'::jsonb,'not_included','[]'::jsonb,'enabled',true,'price_option_id',null),
      jsonb_build_object('title','Kitchen Help','title_mr','किचन मदत','image_url',null,'included','[]'::jsonb,'not_included','[]'::jsonb,'enabled',true,'price_option_id',null),
      jsonb_build_object('title','Deep Cleaning','title_mr','सखोल स्वच्छता','image_url',null,'included','[]'::jsonb,'not_included','[]'::jsonb,'enabled',true,'price_option_id',null)),
    'options','{}'::jsonb);
end $$;

create or replace function public.service_content_resolve(_key text, _city uuid, out content jsonb, out is_default boolean)
language plpgsql stable security definer set search_path=public as $$
begin
  perform service_content_check_key(_key);
  select payload into content from homepage_sections where section_type=_key||'_content' and city_id is not distinct from _city limit 1;
  is_default := content is null and _city is not null;
  if content is null then select payload into content from homepage_sections where section_type=_key||'_content' and city_id is null limit 1; end if;
  if content is null then content := service_content_defaults(_key); if _city is null then is_default := true; end if; end if;
end $$;

create or replace function public.staff_get_service_content(_service_key text, _city uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r record; begin
  perform clean_media_require(_city);
  select * into r from service_content_resolve(_service_key, _city);
  return jsonb_build_object('content', r.content, 'is_default', r.is_default, 'options', service_content_options(_service_key, _city));
end $$;

create or replace function public.staff_save_service_content(_service_key text, _city uuid, _payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare h jsonb; c jsonb; o record; before jsonb; u text; opts jsonb; live numeric; li jsonb;
  urlre text := '^https://api\.badiyos\.com/storage/v1/object/public/catalog-images/service-content/';
begin
  perform service_content_check_key(_service_key);
  perform clean_media_require(_city);
  h := _payload->'hero';
  if jsonb_typeof(h)<>'object' then raise exception 'Hero card is required'; end if;
  if coalesce(h->>'bg_color','') !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Background colour must look like #00B97A'; end if;
  if length(coalesce(h->>'heading',''))>80 or length(coalesce(h->>'heading_mr',''))>80 then raise exception 'Heading max 80 characters'; end if;
  if length(coalesce(h->>'subline','')) not between 1 and 120 or length(coalesce(h->>'subline_mr',''))>120 then raise exception 'Sub-line is required (max 120 characters)'; end if;
  if length(coalesce(h->>'button','')) not between 1 and 30 or length(coalesce(h->>'button_mr',''))>30 then raise exception 'Button text is required (max 30 characters)'; end if;
  if jsonb_typeof(_payload->'cards')<>'array' or jsonb_array_length(_payload->'cards')<>3 then raise exception 'Exactly 3 cards are required'; end if;
  for c in select * from jsonb_array_elements(_payload->'cards') loop
    if length(coalesce(c->>'title','')) not between 1 and 40 or length(coalesce(c->>'title_mr',''))>40 then raise exception 'Each card needs an English title (max 40 characters)'; end if;
    if jsonb_typeof(coalesce(c->'included','[]'))<>'array' or jsonb_typeof(coalesce(c->'not_included','[]'))<>'array' then raise exception 'Invalid list'; end if;
    if jsonb_array_length(coalesce(c->'included','[]'))>15 or jsonb_array_length(coalesce(c->'not_included','[]'))>15 then raise exception 'Max 15 lines per list'; end if;
    for li in select * from jsonb_array_elements(coalesce(c->'included','[]') || coalesce(c->'not_included','[]')) loop
      if length(coalesce(li->>'en','')) not between 1 and 80 or length(coalesce(li->>'mr',''))>80 then raise exception 'Each list line needs English text (max 80 characters)'; end if;
    end loop;
    u := c->>'image_url'; if u is not null and u<>'' and u !~ urlre then raise exception 'Images must be uploaded here'; end if;
  end loop;
  u := h->>'image_url'; if u is not null and u<>'' and u !~ urlre then raise exception 'Images must be uploaded here'; end if;
  opts := service_content_options(_service_key, _city);
  if jsonb_typeof(coalesce(_payload->'options','{}'))<>'object' then raise exception 'Invalid options'; end if;
  for o in select key, value from jsonb_each(coalesce(_payload->'options','{}')) loop
    if length(coalesce(o.value->>'name',''))>40 or length(coalesce(o.value->>'name_mr',''))>40 then raise exception 'Option name max 40 characters'; end if;
    u := o.value->>'image_url'; if u is not null and u<>'' and u !~ urlre then raise exception 'Images must be uploaded here'; end if;
    if nullif(o.value->>'original_price','') is not null then
      select (e->>'price')::numeric into live from jsonb_array_elements(opts) e where e->>'price_option_id'=o.key;
      if live is not null and (o.value->>'original_price')::numeric <= live then raise exception 'Original price must be higher than the current price (₹%)', live; end if;
    end if;
  end loop;
  _payload := jsonb_build_object('hero', h, 'cards', _payload->'cards', 'options', coalesce(_payload->'options','{}'));
  select payload into before from homepage_sections where section_type=_service_key||'_content' and city_id is not distinct from _city;
  if before is null then
    insert into homepage_sections(section_type, display_order, is_active, payload, city_id, updated_by, updated_at)
    values (_service_key||'_content', 0, true, _payload, _city, auth.uid(), now());
  else
    update homepage_sections set payload=_payload, updated_by=auth.uid(), updated_at=now() where section_type=_service_key||'_content' and city_id is not distinct from _city;
  end if;
  insert into audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(),'save_'||_service_key||'_content','homepage_sections',_city, before, _payload);
  return staff_get_service_content(_service_key, _city);
end $$;

create or replace function public.staff_reset_service_content(_service_key text, _city uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare before jsonb; begin
  perform service_content_check_key(_service_key);
  if _city is null then raise exception 'Pick a city'; end if;
  perform clean_media_require(_city);
  delete from homepage_sections where section_type=_service_key||'_content' and city_id=_city returning payload into before;
  insert into audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(),'reset_'||_service_key||'_content','homepage_sections',_city, before, null);
  return staff_get_service_content(_service_key, _city);
end $$;

create or replace function public.app_service_content(_service_key text, _city_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r record; h jsonb; begin
  select * into r from service_content_resolve(_service_key, _city_id);
  h := r.content->'hero';
  return jsonb_build_object(
    'service_key', _service_key, 'city_id', _city_id, 'is_default', r.is_default,
    'hero', jsonb_build_object(
      'heading', nullif(btrim(coalesce(h->>'heading','')),''), 'heading_mr', nullif(btrim(coalesce(h->>'heading_mr','')),''),
      'subline', h->>'subline', 'subline_mr', coalesce(h->>'subline_mr',''),
      'button', h->>'button', 'button_mr', coalesce(h->>'button_mr',''),
      'image_url', nullif(h->>'image_url',''), 'bg_color', h->>'bg_color'),
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
      from jsonb_array_elements(service_content_options(_service_key, _city_id)) with ordinality y(e,n)), '[]'::jsonb));
end $$;

revoke all on function public.service_content_options(text,uuid), public.service_content_defaults(text), public.service_content_resolve(text,uuid), public.staff_get_service_content(text,uuid), public.staff_save_service_content(text,uuid,jsonb), public.staff_reset_service_content(text,uuid), public.app_service_content(text,uuid) from public, anon;
grant execute on function public.staff_get_service_content(text,uuid), public.staff_save_service_content(text,uuid,jsonb), public.staff_reset_service_content(text,uuid) to authenticated;
grant execute on function public.app_service_content(text,uuid) to anon, authenticated;
