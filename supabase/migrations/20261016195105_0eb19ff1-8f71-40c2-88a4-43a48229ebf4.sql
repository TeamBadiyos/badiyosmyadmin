
create or replace function public.service_content_extras_defaults(_key text)
returns jsonb language sql immutable set search_path=public as $$
  select jsonb_build_object(
    'details', jsonb_build_object(
      'included_title','The expert will do','included_title_mr','एक्सपर्ट हे करेल',
      'excluded_title','Not included','excluded_title_mr','यात समाविष्ट नाही',
      'note', case when _key='wash' then 'Please keep water and parking access ready' else 'Please keep cleaning supplies ready at home' end,
      'note_mr', case when _key='wash' then 'कृपया पाणी आणि पार्किंगची सोय तयार ठेवा' else 'कृपया घरी स्वच्छतेचे साहित्य तयार ठेवा' end,
      'note_icon', case when _key='wash' then 'water' else 'supplies' end),
    'banners', jsonb_build_object(
      'open_available', jsonb_build_object('image_url',null,'title','{greeting}, {name} 👋','title_mr','{greeting}, {name} 👋',
         'subline', case when _key='wash' then '⚡ Washer available now' else '⚡ Maid available now' end,
         'subline_mr', case when _key='wash' then '⚡ वॉशर आता उपलब्ध' else '⚡ मावशी आता उपलब्ध' end),
      'open_busy', jsonb_build_object('image_url',null,'title','All experts are busy','title_mr','सर्व एक्सपर्ट व्यस्त आहेत','subline','Next slot {next_slot}','subline_mr','पुढील स्लॉट {next_slot}'),
      'closed_evening', jsonb_build_object('image_url',null,'title','Closed for today 🌙','title_mr','आजसाठी बंद 🌙','subline','Book for tomorrow · slots open {day} {open_time}','subline_mr','उद्यासाठी बुक करा · स्लॉट {day} {open_time} ला सुरू'),
      'closed_morning', jsonb_build_object('image_url',null,'title','Good morning ☀️','title_mr','सुप्रभात ☀️','subline','Today''s slots open at {open_time} · book now','subline_mr','आजचे स्लॉट {open_time} ला सुरू · आता बुक करा'),
      'holiday', jsonb_build_object('image_url',null,'title','Holiday today','title_mr','आज सुट्टी','subline','Back {day}','subline_mr','{day} ला परत')),
    'campaign', jsonb_build_object('enabled',false,'image_url',null,'title','','title_mr','','subline','','subline_mr','','link',null,'starts_at',null,'ends_at',null))
$$;

create or replace function public.service_content_merge_extras(_key text, _c jsonb)
returns jsonb language sql immutable set search_path=public as $$
  with d as (select service_content_extras_defaults(_key) d)
  select jsonb_build_object(
    'details', (d->'details') || coalesce(_c->'details','{}'),
    'banners', (select jsonb_object_agg(k, (d->'banners'->k) || coalesce(_c->'banners'->k,'{}'))
                from unnest(array['open_available','open_busy','closed_evening','closed_morning','holiday']) k),
    'campaign', (d->'campaign') || coalesce(_c->'campaign','{}'))
  from d
$$;

create or replace function public.service_content_check_text(_v text, _label text, _max int, _required boolean)
returns void language plpgsql immutable set search_path=public as $$
declare m text; begin
  if _required and btrim(coalesce(_v,''))='' then raise exception '% is required', _label; end if;
  if length(coalesce(_v,''))>_max then raise exception '% max % characters', _label, _max; end if;
  for m in select (regexp_matches(coalesce(_v,''), '\{([^}]*)\}', 'g'))[1] loop
    if m not in ('greeting','name','open_time','day','next_slot') then raise exception '% has an unknown placeholder {%}', _label, m; end if;
  end loop;
end $$;

create or replace function public.service_content_check_extras(_p jsonb)
returns void language plpgsql immutable set search_path=public as $$
declare d jsonb := coalesce(_p->'details','{}'); b jsonb; c jsonb := coalesce(_p->'campaign','{}'); k text; u text;
  urlre text := '^https://api\.badiyos\.com/storage/v1/object/public/catalog-images/service-content/';
begin
  perform service_content_check_text(d->>'included_title','Included section title',40,true);
  perform service_content_check_text(d->>'included_title_mr','Included section title (मराठी)',40,false);
  perform service_content_check_text(d->>'excluded_title','Not-included section title',40,true);
  perform service_content_check_text(d->>'excluded_title_mr','Not-included section title (मराठी)',40,false);
  perform service_content_check_text(d->>'note','Note',140,false);
  perform service_content_check_text(d->>'note_mr','Note (मराठी)',140,false);
  if coalesce(d->>'note_icon','') not in ('','info','supplies','water','clock','star','alert') then raise exception 'Unknown note icon'; end if;
  foreach k in array array['open_available','open_busy','closed_evening','closed_morning','holiday'] loop
    b := coalesce(_p->'banners'->k,'{}');
    perform service_content_check_text(b->>'title','Banner title ('||k||')',80,true);
    perform service_content_check_text(b->>'title_mr','Banner title मराठी ('||k||')',80,false);
    perform service_content_check_text(b->>'subline','Banner sub-line ('||k||')',120,false);
    perform service_content_check_text(b->>'subline_mr','Banner sub-line मराठी ('||k||')',120,false);
    u := b->>'image_url'; if u is not null and u<>'' and u !~ urlre then raise exception 'Images must be uploaded here'; end if;
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
  return jsonb_build_object('content', r.content || service_content_merge_extras(_service_key, r.content), 'is_default', r.is_default, 'options', service_content_options(_service_key, _city));
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

-- Old clean_media editor retired: data + app_clean_media stay read-only. Delete after 2026-11-15.
create or replace function public.staff_save_clean_media(_city uuid, _payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
begin raise exception 'The old App content editor is retired. Use App content instead.'; end $$;
create or replace function public.staff_reset_clean_media(_city uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin raise exception 'The old App content editor is retired. Use App content instead.'; end $$;
comment on function public.app_clean_media(uuid) is 'Read-only legacy (old Customer App versions). Safe to delete after 2026-11-15.';

revoke all on function public.service_content_extras_defaults(text), public.service_content_merge_extras(text,jsonb), public.service_content_check_text(text,text,int,boolean), public.service_content_check_extras(jsonb) from public, anon;
revoke all on function public.staff_get_service_content(text,uuid), public.staff_save_service_content(text,uuid,jsonb), public.app_service_content(text,uuid) from public;
grant execute on function public.staff_get_service_content(text,uuid), public.staff_save_service_content(text,uuid,jsonb) to authenticated;
grant execute on function public.app_service_content(text,uuid) to anon, authenticated;
