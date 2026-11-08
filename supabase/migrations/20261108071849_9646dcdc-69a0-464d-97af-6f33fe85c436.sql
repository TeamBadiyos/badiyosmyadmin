do $$ declare d text; begin
  d := pg_get_functiondef('public.gift_send_trip(uuid,uuid,boolean)'::regprocedure);
  d := replace(d, $o$    insert into business_receivers(merchant_id, name, contact_name, contact_phone, address, lat, lng, notes, created_by_label)
    values (c.merchant_id, d.recipient_name, d.recipient_phone, coalesce(d.recipient_phone, ''), d.address, d.lat, d.lng,
            nullif(d.gift_note,''), 'gifting')
    returning id into rid;
    update business_receivers set contact_name=d.recipient_name where id=rid;$o$,
  $n$    rid := null;
    if coalesce(d.recipient_phone,'') <> '' then
      select id into rid from business_receivers
       where merchant_id=c.merchant_id and is_active is not false
         and right(regexp_replace(contact_phone,'\D','','g'),10) = right(regexp_replace(d.recipient_phone,'\D','','g'),10)
       limit 1 for update;
    end if;
    if rid is not null then
      if rid = any(rorder) then raise exception 'Phone % is on two drops in trip % — move one to another trip', d.recipient_phone, t.trip_no; end if;
      update business_receivers set name=d.recipient_name, contact_name=d.recipient_name, address=d.address, lat=d.lat, lng=d.lng,
        verified_lat=null, verified_lng=null, verified_at=null, notes=nullif(d.gift_note,''), updated_at=now() where id=rid;
    else
      insert into business_receivers(merchant_id, name, contact_name, contact_phone, address, lat, lng, notes, created_by_label)
      values (c.merchant_id, d.recipient_name, d.recipient_name, coalesce(d.recipient_phone, ''), d.address, d.lat, d.lng,
              nullif(d.gift_note,''), 'gifting')
      returning id into rid;
    end if;$n$);
  if position('rid = any(rorder)' in d) = 0 then raise exception 'patch did not apply'; end if;
  execute d;
end $$;