create or replace function public.booking_gst_percent(_category_id uuid) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare slug text; k text; r numeric; begin
  select c.slug into slug from service_categories c where c.id=_category_id;
  k := case when slug='car-bike-wash' then 'wash_gst' when slug in ('home-cleaning','festival-special-cleaning') then 'maid_gst' end;
  if k is null then raise exception 'No GST rate set up for this service' using errcode='check_violation'; end if;
  select rate_pct into r from tax_settings where key=k and is_active;
  if r is null or r<0 or r>100 then raise exception 'GST rate % is not active in Tax Settings', k using errcode='check_violation'; end if;
  return r; end $$;
revoke all on function public.booking_gst_percent(uuid) from public, anon, authenticated;

do $$ declare d text; begin
  d := pg_get_functiondef('public.bookings_before_insert'::regproc);
  if position('_gst := coalesce(public.get_gst_percent(), 0);' in d) = 0 then raise exception 'bookings_before_insert changed; patch not applied'; end if;
  d := replace(d, '_gst := coalesce(public.get_gst_percent(), 0);',
    '_gst := public.booking_gst_percent((select s2.category_id from public.service_price_options o2 join public.services s2 on s2.id=o2.service_id where o2.id = NEW.price_option_id));');
  execute d;
end $$;

create or replace function public.app_booking_quote(_price_option_id uuid, _city_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p numeric; cat uuid; g numeric; tot numeric; begin
  select coalesce(cp.customer_price, o.customer_price), s.category_id into p, cat
  from service_price_options o join services s on s.id=o.service_id
  left join city_price_options cp on cp.price_option_id=o.id and cp.city_id=_city_id and cp.is_active
  where o.id=_price_option_id;
  if p is null then raise exception 'Unknown service option'; end if;
  g := booking_gst_percent(cat);
  tot := round(p + p*g/100.0);
  return jsonb_build_object('price',p,'gst_rate',g,'gst_amount',tot-p,'total',tot);
end $$;

create or replace function public.app_svc_key(_k text) returns text language plpgsql immutable as $$
begin if _k not in ('clean','wash') then raise exception 'service must be clean or wash'; end if; return _k; end $$;

create or replace function public.app_ops_value(_city uuid, _key text) returns text
language sql stable security definer set search_path = public as $$
  select trim(both '"' from value::text) from city_ops_settings
  where key=_key and city_id = coalesce(_city,(select id from cities where is_default limit 1)) $$;
revoke all on function public.app_ops_value(uuid,text) from public, anon, authenticated;

create or replace function public.app_service_hours(_service_key text, _city_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f record; cname text; begin
  perform app_svc_key(_service_key);
  select name into cname from cities where id=coalesce(_city_id,(select id from cities where is_default limit 1));
  select * into f from service_flags where service_key=_service_key and city_id=coalesce(_city_id,(select id from cities where is_default limit 1));
  return jsonb_build_object('service_key',_service_key,'city_id',_city_id,
    'state', service_effective_state(_service_key, cname),
    'hours_enabled', f.hours_enabled,
    'hours', coalesce((select jsonb_agg(jsonb_build_object('weekday',weekday,'open',open_time,'close',close_time,'closed',is_closed) order by weekday) from service_hours where service_flag_id=f.id),'[]'),
    'holidays', coalesce((select jsonb_agg(jsonb_build_object('start',start_date,'end',end_date,'reason',reason,'reason_mr',reason_mr) order by start_date) from service_holidays where service_flag_id=f.id and end_date>=current_date),'[]'));
end $$;

create or replace function public.app_book_now_allowed(_service_key text, _city_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare k text; on_ text; st jsonb; cid uuid := coalesce(_city_id,(select id from cities where is_default limit 1)); begin
  perform app_svc_key(_service_key);
  on_ := app_ops_value(cid, case when _service_key='wash' then 'wash_instant_booking_enabled' else 'instant_booking_enabled' end);
  if coalesce(on_,'true') not in ('true','1','on') then return jsonb_build_object('allowed',false,'reason','book_now_off'); end if;
  st := service_effective_state(_service_key, (select name from cities where id=cid));
  if coalesce(st->>'is_open', st->>'open', 'true') in ('false') then return jsonb_build_object('allowed',false,'reason','closed','state',st); end if;
  if instant_slot_full(_service_key, 60, cid) then return jsonb_build_object('allowed',false,'reason','slot_full'); end if;
  return jsonb_build_object('allowed',true,'reason',null);
end $$;

create or replace function public.app_fully_booked_slots(_service_key text, _city_id uuid, _from date, _to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform app_svc_key(_service_key);
  if _to < _from or _to - _from > 31 then raise exception 'Date range up to 31 days'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('date',slot_date,'hour',start_hour,'minute',start_minute) order by slot_date,start_hour,start_minute)
    from list_fully_booked_slots(_service_key,_from,_to,coalesce(_city_id,(select id from cities where is_default limit 1)))),'[]');
end $$;

grant execute on function public.app_booking_quote(uuid,uuid), public.app_service_hours(text,uuid), public.app_book_now_allowed(text,uuid),
  public.app_fully_booked_slots(text,uuid,date,date), public.app_svc_key(text) to anon, authenticated;

-- clean_media: exact app format
create or replace function public.clean_media_normalize(_p jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare d_en text[] := array['House Cleaning','Dusting & Wiping','Bathroom Cleaning','Wash Fold & Arrange','Cleaning Dishes','And many more'];
  d_mr text[] := array['घराची स्वच्छता','धूळ पुसणे','बाथरूम स्वच्छता','कपडे धुणे व घडी','भांडी घासणे','आणि बरेच काही'];
  t jsonb := '[]'; i int; e jsonb; begin
  _p := coalesce(_p,'{}');
  for i in 1..6 loop
    e := case when jsonb_typeof(_p->'tiles')='array' then _p->'tiles'->(i-1) end;
    t := t || jsonb_build_array(jsonb_build_object(
      'title', coalesce(nullif(e->>'title',''), nullif(e->>'title_en',''), d_en[i]),
      'title_mr', coalesce(e->>'title_mr', d_mr[i]),
      'url', coalesce(e->>'url', case when jsonb_typeof(_p->'tile_urls')='array' then _p->'tile_urls'->>(i-1) end),
      'enabled', coalesce((e->>'enabled')::boolean, true)));
  end loop;
  return jsonb_build_object('maid_url', _p->>'maid_url',
    'heading', coalesce(nullif(_p->>'heading',''), nullif(_p->>'heading_en',''), 'One Expert who can do it all'),
    'heading_mr', coalesce(nullif(_p->>'heading_mr',''),'एक एक्सपर्ट, सगळी कामे'), 'tiles', t);
end $$;

create or replace function public.staff_save_clean_media(_city uuid, _payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p jsonb; t jsonb; before jsonb; u text; begin
  perform clean_media_require(_city);
  if jsonb_typeof(_payload->'tiles')<>'array' or jsonb_array_length(_payload->'tiles')<>6 then raise exception 'Exactly 6 tiles are required'; end if;
  if length(coalesce(_payload->>'heading','')) not between 1 and 80 or length(coalesce(_payload->>'heading_mr','')) > 80 then raise exception 'Heading is required (max 80 characters)'; end if;
  for t in select * from jsonb_array_elements(_payload->'tiles') loop
    if length(coalesce(t->>'title','')) not between 1 and 40 or length(coalesce(t->>'title_mr','')) > 40 then raise exception 'Each tile needs an English title (max 40 characters)'; end if;
    if jsonb_typeof(t->'enabled')<>'boolean' then raise exception 'Invalid on/off value'; end if;
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
end $$;