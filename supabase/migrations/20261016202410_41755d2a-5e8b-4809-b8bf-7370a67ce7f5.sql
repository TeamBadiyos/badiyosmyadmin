create or replace function public.service_content_banner_texts_default(_key text)
returns jsonb language sql immutable set search_path=public as $$
  select jsonb_build_object(
    'open_free', jsonb_build_object('title','{greeting}, {name} 👋','title_mr','{greeting}, {name} 👋',
       'subline', case when _key='wash' then '⚡ Washer available now' else '⚡ Maid available now' end,
       'subline_mr', case when _key='wash' then '⚡ वॉशर आता उपलब्ध' else '⚡ मावशी आता उपलब्ध' end),
    'open_busy', jsonb_build_object('title','Busy right now ⏳','title_mr','सध्या सर्व व्यस्त ⏳','subline','Next free slot {next_slot}','subline_mr','पुढील स्लॉट {next_slot}'),
    'closed', jsonb_build_object('title','{greeting}','title_mr','{greeting}','subline','Book now · slots open {day} at {open_time}','subline_mr','आत्ताच बुक करा · स्लॉट {day} {open_time} पासून'),
    'holiday', jsonb_build_object('title','Holiday today 🎉','title_mr','आज सुट्टी 🎉','subline','Back {day} at {open_time} · book now','subline_mr','{day} {open_time} पासून परत · आत्ताच बुक करा'))
$$;

-- Builds the new banner {slabs, texts}; migrates old fixed state boxes when no new banner is saved.
create or replace function public.service_content_banner(_key text, _c jsonb)
returns jsonb language sql immutable set search_path=public as $$
  with d as (select service_content_banner_texts_default(_key) t)
  select case when jsonb_typeof(_c->'banner'->'slabs')='array' then
    jsonb_build_object('slabs', _c->'banner'->'slabs',
      'texts', (select jsonb_object_agg(k, (t->k) || coalesce(_c->'banner'->'texts'->k,'{}')) from unnest(array['open_free','open_busy','closed','holiday']) k))
  else
    jsonb_build_object('slabs', jsonb_build_array(
        jsonb_build_object('from','05:00','to','10:00','label','Sunrise','text_color','light','image_url',nullif(_c->'banners'->'closed_morning'->>'image_url','')),
        jsonb_build_object('from','10:00','to','17:00','label','Day','text_color','dark','image_url',nullif(_c->'banners'->'open_available'->>'image_url','')),
        jsonb_build_object('from','17:00','to','19:00','label','Evening','text_color','light','image_url',null),
        jsonb_build_object('from','19:00','to','05:00','label','Night','text_color','light','image_url',nullif(_c->'banners'->'closed_evening'->>'image_url',''))),
      'texts', jsonb_build_object(
        'open_free', (t->'open_free') || coalesce((select jsonb_object_agg(k,v) from jsonb_each(_c->'banners'->'open_available') e(k,v) where k in ('title','title_mr','subline','subline_mr') and v is not null and v<>'null'::jsonb),'{}'),
        'open_busy', (t->'open_busy') || coalesce((select jsonb_object_agg(k,v) from jsonb_each(_c->'banners'->'open_busy') e(k,v) where k in ('title','title_mr','subline','subline_mr') and v is not null and v<>'null'::jsonb),'{}'),
        'closed', t->'closed',
        'holiday', (t->'holiday') || coalesce((select jsonb_object_agg(k,v) from jsonb_each(_c->'banners'->'holiday') e(k,v) where k in ('title','title_mr','subline','subline_mr') and v is not null and v<>'null'::jsonb),'{}')))
  end from d
$$;

create or replace function public.service_content_merge_extras(_key text, _c jsonb)
returns jsonb language sql immutable set search_path=public as $$
  with d as (select service_content_extras_defaults(_key) d)
  select jsonb_build_object(
    'details', (d->'details') || coalesce(_c->'details','{}'),
    'banner', service_content_banner(_key, _c),
    'campaign', (d->'campaign') || coalesce(_c->'campaign','{}'))
  from d
$$;

create or replace function public.service_content_check_extras(_p jsonb)
returns void language plpgsql immutable set search_path=public as $$
declare d jsonb := coalesce(_p->'details','{}'); b jsonb; c jsonb := coalesce(_p->'campaign','{}'); k text; u text; s jsonb;
  f int; t int; mins int[] := '{}'; i int; lbl text;
  urlre text := '^https://api\.badiyos\.com/storage/v1/object/public/catalog-images/service-content/';
  tre text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
begin
  perform service_content_check_text(d->>'included_title','Included section title',40,true);
  perform service_content_check_text(d->>'included_title_mr','Included section title (मराठी)',40,false);
  perform service_content_check_text(d->>'excluded_title','Not-included section title',40,true);
  perform service_content_check_text(d->>'excluded_title_mr','Not-included section title (मराठी)',40,false);
  perform service_content_check_text(d->>'note','Note',140,false);
  perform service_content_check_text(d->>'note_mr','Note (मराठी)',140,false);
  if coalesce(d->>'note_icon','') not in ('','info','supplies','water','clock','star','alert') then raise exception 'Unknown note icon'; end if;
  foreach k in array array['open_free','open_busy','closed','holiday'] loop
    b := coalesce(_p->'banner'->'texts'->k,'{}');
    perform service_content_check_text(b->>'title','Banner title ('||k||')',80,true);
    perform service_content_check_text(b->>'title_mr','Banner title मराठी ('||k||')',80,false);
    perform service_content_check_text(b->>'subline','Banner sub-line ('||k||')',120,false);
    perform service_content_check_text(b->>'subline_mr','Banner sub-line मराठी ('||k||')',120,false);
  end loop;
  if jsonb_typeof(_p->'banner'->'slabs')<>'array' or jsonb_array_length(_p->'banner'->'slabs')>12 then raise exception 'Banner images: up to 12 time slabs'; end if;
  for s in select * from jsonb_array_elements(_p->'banner'->'slabs') loop
    if coalesce(s->>'from','') !~ tre or coalesce(s->>'to','') !~ tre then raise exception 'Slab times must look like 05:00'; end if;
    if s->>'from' = s->>'to' then raise exception 'Slab % has the same start and end', s->>'from'; end if;
    if coalesce(s->>'text_color','') not in ('light','dark') then raise exception 'Slab text colour must be Light or Dark'; end if;
    if length(coalesce(s->>'label',''))>30 then raise exception 'Slab label max 30 characters'; end if;
    u := s->>'image_url'; if u is not null and u<>'' and u !~ urlre then raise exception 'Images must be uploaded here'; end if;
    f := split_part(s->>'from',':',1)::int*60 + split_part(s->>'from',':',2)::int;
    t := split_part(s->>'to',':',1)::int*60 + split_part(s->>'to',':',2)::int;
    i := f;
    while i <> t loop
      if i = any(mins) then raise exception 'Banner time slabs overlap at %:%', lpad((i/60)::text,2,'0'), lpad((i%60)::text,2,'0'); end if;
      mins := mins || i; i := (i+1) % 1440;
    end loop;
  end loop;
  u := c->>'image_url'; if u is not null and u<>'' and u !~ urlre then raise exception 'Images must be uploaded here'; end if;
  if coalesce((c->>'enabled')::boolean,false) then
    perform service_content_check_text(c->>'title','Campaign title',80,true);
    if nullif(c->>'starts_at','') is null or nullif(c->>'ends_at','') is null then raise exception 'Campaign needs a start and end date'; end if;
    if (c->>'ends_at')::timestamptz <= (c->>'starts_at')::timestamptz then raise exception 'Campaign end must be after start'; end if;
  else
    perform service_content_check_text(c->>'title','Campaign title',80,false);
  end if;
  perform service_content_check_text(c->>'title_mr','Campaign title (मराठी)',80,false);
  perform service_content_check_text(c->>'subline','Campaign sub-line',120,false);
  perform service_content_check_text(c->>'subline_mr','Campaign sub-line (मराठी)',120,false);
  if length(coalesce(c->>'link',''))>300 then raise exception 'Campaign link too long'; end if;
end $$;

create or replace function public.staff_get_service_content(_service_key text, _city uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r record; begin
  perform clean_media_require(_city);
  select * into r from service_content_resolve(_service_key, _city);
  return jsonb_build_object('content', (r.content - 'banners') || jsonb_build_object('hero', coalesce(r.content->'hero','{}') - 'morning_switch_time') || service_content_merge_extras(_service_key, r.content), 'is_default', r.is_default, 'options', service_content_options(_service_key, _city));
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
  h := h - 'morning_switch_time';
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
  _payload := jsonb_build_object('hero', h, 'cards', _payload->'cards', 'options', coalesce(_payload->'options','{}'))
    || service_content_merge_extras(_service_key, _payload);
  perform service_content_check_extras(_payload);
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
    'banner', jsonb_build_object(
      'slabs', coalesce((select jsonb_agg(jsonb_build_object('from', s->>'from', 'to', s->>'to', 'label', coalesce(s->>'label',''), 'image_url', nullif(s->>'image_url',''), 'text_color', coalesce(s->>'text_color','light')) order by n)
                from jsonb_array_elements(x->'banner'->'slabs') with ordinality z(s,n)), '[]'::jsonb),
      'texts', (select jsonb_object_agg(k, jsonb_build_object('title', v->>'title', 'title_mr', coalesce(v->>'title_mr',''), 'subline', coalesce(v->>'subline',''), 'subline_mr', coalesce(v->>'subline_mr','')))
                from jsonb_each(x->'banner'->'texts') e(k,v))),
    'campaign', jsonb_build_object(
      'enabled', coalesce((cp->>'enabled')::boolean,false),
      'active', coalesce((cp->>'enabled')::boolean,false) and nullif(cp->>'starts_at','') is not null and nullif(cp->>'ends_at','') is not null
                and now() >= (cp->>'starts_at')::timestamptz and now() < (cp->>'ends_at')::timestamptz,
      'image_url', nullif(cp->>'image_url',''), 'title', coalesce(cp->>'title',''), 'title_mr', coalesce(cp->>'title_mr',''),
      'subline', coalesce(cp->>'subline',''), 'subline_mr', coalesce(cp->>'subline_mr',''),
      'link', nullif(cp->>'link',''), 'starts_at', nullif(cp->>'starts_at',''), 'ends_at', nullif(cp->>'ends_at','')));
end $$;

-- One-time: move saved rows to the new banner shape.
update public.homepage_sections
set payload = (payload - 'banners')
  || jsonb_build_object('banner', public.service_content_banner(split_part(section_type,'_',1), payload))
  || case when payload ? 'hero' then jsonb_build_object('hero', (payload->'hero') - 'morning_switch_time') else '{}'::jsonb end
where section_type in ('clean_content','wash_content');

revoke all on function public.service_content_banner_texts_default(text), public.service_content_banner(text,jsonb), public.service_content_merge_extras(text,jsonb), public.service_content_check_extras(jsonb) from public, anon;
revoke all on function public.staff_get_service_content(text,uuid), public.staff_save_service_content(text,uuid,jsonb), public.app_service_content(text,uuid) from public;
grant execute on function public.staff_get_service_content(text,uuid), public.staff_save_service_content(text,uuid,jsonb) to authenticated;
grant execute on function public.app_service_content(text,uuid) to anon, authenticated;