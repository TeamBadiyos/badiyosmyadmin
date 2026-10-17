create or replace function public.service_content_check_key(_k text) returns void language plpgsql immutable set search_path=public as $$
begin if _k not in ('clean','wash','courier') then raise exception 'Unknown service key'; end if; end $$;

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
    where _key in ('clean','wash') and o.is_active and s.is_active
      and coalesce(cp.is_active, _city is null or not exists (select 1 from city_price_options c2 where c2.city_id=_city))
      and ((_key='wash') = (s.name ilike '%wash%'))
    order by s.display_order, o.display_order
    limit case when _key='clean' then 6 else 50 end
  ) t
$$;

create or replace function public.service_content_banner_texts_default(_key text)
returns jsonb language sql immutable set search_path=public as $$
  select case when _key='courier' then jsonb_build_object(
    'open_free', jsonb_build_object('title','Send anything, anywhere in the city','title_mr','शहरात कुठेही, काहीही पाठवा','subline','Doorstep pickup · Live tracking · OTP delivery','subline_mr','दारातून पिकअप · लाईव्ह ट्रॅकिंग · OTP डिलिव्हरी'),
    'open_busy', jsonb_build_object('title','Send anything, anywhere in the city','title_mr','शहरात कुठेही, काहीही पाठवा','subline','Doorstep pickup · Live tracking · OTP delivery','subline_mr','दारातून पिकअप · लाईव्ह ट्रॅकिंग · OTP डिलिव्हरी'),
    'closed', jsonb_build_object('title','Send anything, anywhere in the city','title_mr','शहरात कुठेही, काहीही पाठवा','subline','Doorstep pickup · Live tracking · OTP delivery','subline_mr','दारातून पिकअप · लाईव्ह ट्रॅकिंग · OTP डिलिव्हरी'),
    'holiday', jsonb_build_object('title','Send anything, anywhere in the city','title_mr','शहरात कुठेही, काहीही पाठवा','subline','Doorstep pickup · Live tracking · OTP delivery','subline_mr','दारातून पिकअप · लाईव्ह ट्रॅकिंग · OTP डिलिव्हरी'))
  else jsonb_build_object(
    'open_free', jsonb_build_object('title','{greeting}, {name} 👋','title_mr','{greeting}, {name} 👋',
       'subline', case when _key='wash' then '⚡ Washer available now' else '⚡ Maid available now' end,
       'subline_mr', case when _key='wash' then '⚡ वॉशर आता उपलब्ध' else '⚡ मावशी आता उपलब्ध' end),
    'open_busy', jsonb_build_object('title','Busy right now ⏳','title_mr','सध्या सर्व व्यस्त ⏳','subline','Next free slot {next_slot}','subline_mr','पुढील स्लॉट {next_slot}'),
    'closed', jsonb_build_object('title','{greeting}','title_mr','{greeting}','subline','Book now · slots open {day} at {open_time}','subline_mr','आत्ताच बुक करा · स्लॉट {day} {open_time} पासून'),
    'holiday', jsonb_build_object('title','Holiday today 🎉','title_mr','आज सुट्टी 🎉','subline','Back {day} at {open_time} · book now','subline_mr','{day} {open_time} पासून परत · आत्ताच बुक करा')) end
$$;

create or replace function public.service_content_defaults(_key text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare ids uuid[];
begin
  perform service_content_check_key(_key);
  if _key='courier' then
    return jsonb_build_object(
      'hero', jsonb_build_object('heading','Send anything, anywhere in the city','heading_mr','शहरात कुठेही, काहीही पाठवा','subline','Doorstep pickup · Live tracking · OTP delivery','subline_mr','दारातून पिकअप · लाईव्ह ट्रॅकिंग · OTP डिलिव्हरी','button','Send now','button_mr','आता पाठवा','image_url',null,'bg_color','#1E3A8A','card_title','Parcel','card_title_mr','पार्सल'),
      'cards', jsonb_build_array(
        jsonb_build_object('title','Documents','title_mr','कागदपत्रे','image_url',null,'included','[]'::jsonb,'not_included','[]'::jsonb,'enabled',true,'price_option_id',null),
        jsonb_build_object('title','Parcels','title_mr','पार्सल','image_url',null,'included','[]'::jsonb,'not_included','[]'::jsonb,'enabled',true,'price_option_id',null),
        jsonb_build_object('title','Essentials','title_mr','आवश्यक वस्तू','image_url',null,'included','[]'::jsonb,'not_included','[]'::jsonb,'enabled',true,'price_option_id',null)),
      'options','{}'::jsonb);
  end if;
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