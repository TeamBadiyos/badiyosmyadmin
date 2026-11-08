
alter table public.gift_drops alter column lat drop not null, alter column lng drop not null;
alter table public.gift_drops add column pin_status text not null default 'ok',
  add column business_order_id uuid references public.business_orders(id) on delete set null,
  add column courier_order_id uuid, add column delivered_at timestamptz, add column fail_reason text;
alter table public.gift_trips add column batch_id uuid references public.business_batches(id) on delete set null,
  add column courier_order_id uuid, add column fail_reason text, add column sent_at timestamptz;
alter table public.gift_campaigns add column pickup_point_id uuid references public.business_pickup_points(id) on delete set null;
create index on public.gift_drops(business_order_id);
create index on public.gift_trips(batch_id);

alter table public.business_profiles add column if not exists proof_geofence_m numeric;
alter table public.business_delivery_proofs add column if not exists kind text not null default 'delivered';

-- per-business geofence override in the existing photo-proof flow
do $$ declare d text; begin
  d := pg_get_functiondef('public.courier_complete_drop_with_proof'::regproc);
  if position('proof_geofence_m from public.business_profiles' in d) = 0 then
    d := replace(d, $r$_fence := coalesce(nullif((select value from public.ops_settings where key='proof_geofence_m'),'')::numeric, 150);$r$,
      $r$_fence := coalesce((select proof_geofence_m from public.business_profiles where merchant_id=_mid), nullif((select value from public.ops_settings where key='proof_geofence_m'),'')::numeric, 150);$r$);
    d := replace(d, $r$_fence := coalesce(nullif((select value from public.ops_settings where key='proof_first_delivery_radius_m'),'')::numeric, 1000);$r$,
      $r$_fence := coalesce((select proof_geofence_m from public.business_profiles where merchant_id=_mid), nullif((select value from public.ops_settings where key='proof_first_delivery_radius_m'),'')::numeric, 1000);$r$);
    if position('proof_geofence_m from public.business_profiles' in d) = 0 then raise exception 'geofence patch did not apply'; end if;
    execute d;
  end if; end $$;

-- rider: photo when receiver not available (call before courier_rider_fail_stop)
create or replace function public.courier_rider_fail_photo(_stop_id uuid, _paths text[], _lat numeric default null, _lng numeric default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare _eid uuid; _st courier_order_stops; _o courier_orders; _mid uuid; _p text; _rid uuid;
begin
  _eid := public.get_expert_id_for_auth(auth.uid());
  if _eid is null then raise exception 'Not a rider' using errcode='42501'; end if;
  select * into _st from courier_order_stops where id=_stop_id;
  select * into _o from courier_orders where id=_st.order_id;
  if _o.assigned_expert_id is distinct from _eid then raise exception 'Forbidden' using errcode='42501'; end if;
  if _o.source <> 'business' or _st.stop_type <> 'drop' then return jsonb_build_object('ok',false,'reason','NOT_BUSINESS_DROP'); end if;
  if coalesce(array_length(_paths,1),0) < 1 or array_length(_paths,1) > 5 then return jsonb_build_object('ok',false,'reason','PHOTO_COUNT'); end if;
  select merchant_id into _mid from business_batches where courier_order_id=_o.id limit 1;
  foreach _p in array _paths loop
    if _p not like _mid::text || '/%/' || _stop_id::text || '/%'
       or not exists (select 1 from storage.objects where bucket_id='delivery-proofs' and name=_p) then
      return jsonb_build_object('ok',false,'reason','PHOTO_NOT_FOUND','path',_p); end if;
  end loop;
  select receiver_id into _rid from business_orders where drop_stop_id=_stop_id limit 1;
  insert into business_delivery_proofs(courier_order_id, stop_id, merchant_id, receiver_id, expert_id, storage_path, seal_codes, lat, lng, location_unverified, captured_at, kind)
  select _o.id, _stop_id, _mid, _rid, _eid, p, '{}', _lat, _lng, true, now(), 'not_delivered' from unnest(_paths) p;
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.courier_rider_fail_photo(uuid,text[],numeric,numeric) from public, anon;
grant execute on function public.courier_rider_fail_photo(uuid,text[],numeric,numeric) to authenticated;

-- training trips for gifting tests: transaction-local setting read at insert
create or replace function public.gift_training_order() returns trigger language plpgsql set search_path=public as $$
declare v text := current_setting('gift.training_ids', true);
begin
  if NEW.source = 'business' and coalesce(v,'') <> '' then
    NEW.is_training := true; NEW.training_expert_ids := string_to_array(v, ',')::uuid[];
  end if; return NEW; end $$;
create trigger gift_training_order before insert on public.courier_orders for each row execute function public.gift_training_order();

-- status back-sync
create or replace function public.gift_sync_from_business_order() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if NEW.status is not distinct from OLD.status then return NEW; end if;
  update gift_drops set
    status = case NEW.status when 'delivered' then 'delivered' when 'in_transit' then 'in_transit'
                             when 'failed' then 'failed' when 'returned' then 'failed' when 'cancelled' then 'failed'
                             when 'pending' then 'planned' else status end,
    delivered_at = case when NEW.status='delivered' then coalesce(NEW.delivered_at, now()) else delivered_at end,
    fail_reason = case when NEW.status in ('failed','returned','cancelled') then coalesce(NEW.cancel_reason, NEW.status) else fail_reason end,
    courier_order_id = coalesce(NEW.courier_order_id, courier_order_id)
  where business_order_id = NEW.id;
  return NEW; end $$;
create trigger gift_sync_from_business_order after update on public.business_orders for each row execute function public.gift_sync_from_business_order();

create or replace function public.gift_sync_from_batch() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if NEW.status is not distinct from OLD.status then return NEW; end if;
  if NEW.status = 'completed' then
    update gift_trips set status='completed' where batch_id=NEW.id;
  elsif NEW.status in ('failed','rejected') then
    -- trip cancelled before pickup: back to planned so it can be sent again
    update gift_trips set status='planned', fail_reason=NEW.fail_reason, batch_id=null, courier_order_id=null where batch_id=NEW.id;
    update gift_drops d set status='planned', business_order_id=null, courier_order_id=null
      from gift_trips t where d.trip_id=t.id and t.status='planned' and d.status in ('sent','planned')
        and d.business_order_id in (select id from business_orders where batch_id is null or batch_id=NEW.id);
  end if;
  return NEW; end $$;
create trigger gift_sync_from_batch after update on public.business_batches for each row execute function public.gift_sync_from_batch();

-- guard: allow planned -> sent only via gift_send_trip (test drops never)
create or replace function public.gift_trips_guard() returns trigger language plpgsql set search_path=public as $$
begin
  if NEW.status<>'planned' and OLD.status='planned' and exists (select 1 from gift_drops where trip_id=NEW.id and is_test) then
    raise exception 'Test trips can never be dispatched to riders'; end if;
  return NEW; end $$;

-- re-plan only what is not sent yet; pins missing stay out
create or replace function public.gift_plan_trips(_campaign uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c gift_campaigns; z record; ids uuid[]; ordered uuid[]; n int; made int := 0; i int; cap int; tid uuid; zl jsonb; d record;
begin
  c := public.gift_require_campaign(_campaign);
  if c.pickup_lat is null then raise exception 'Set the pickup point first'; end if;
  cap := greatest(coalesce(c.max_drops_per_trip,12),1);
  for d in select id, lat, lng from gift_drops where campaign_id=_campaign and status in ('pending','planned') and lat is not null loop
    begin zl := public.zone_lookup(d.lat, d.lng); exception when others then zl := '{}'; end;
    update gift_drops set zone_id = nullif(zl->>'zone_id','')::uuid, zone_name = coalesce(zl->>'zone','Outside zones') where id=d.id;
  end loop;
  update gift_drops set trip_id=null, stop_seq=null, status='pending'
   where campaign_id=_campaign and status in ('pending','planned');
  delete from gift_trips t where t.campaign_id=_campaign and t.status='planned'
    and not exists (select 1 from gift_drops where trip_id=t.id);
  select coalesce(max(trip_no),0) into n from gift_trips where campaign_id=_campaign;
  for z in select zone_id, zone_name, array_agg(id) a from gift_drops
           where campaign_id=_campaign and status='pending' and lat is not null
           group by zone_id, zone_name order by zone_name loop
    ordered := public.gift_route_order(c.pickup_lat, c.pickup_lng, z.a);
    i := 1;
    while i <= array_length(ordered,1) loop
      n := n + 1; made := made + 1;
      insert into gift_trips(campaign_id, merchant_id, trip_no, zone_id, zone_name)
        values (_campaign, c.merchant_id, n, z.zone_id, z.zone_name) returning id into tid;
      ids := ordered[i : least(i+cap-1, array_length(ordered,1))];
      update gift_drops g set trip_id=tid, stop_seq=s.ord, status='planned'
        from unnest(ids) with ordinality s(id, ord) where g.id=s.id;
      perform public.gift_trip_recalc(tid);
      i := i + cap;
    end loop;
  end loop;
  update gift_campaigns set status = case when exists (select 1 from gift_trips where campaign_id=_campaign) then 'planned' else 'draft' end
   where id=_campaign and status in ('draft','planned');
  perform public.business_audit('gift_plan_trips','gift_campaigns',_campaign,null,jsonb_build_object('trips',made),null);
  return jsonb_build_object('trips', made);
end $$;

create or replace function public.gift_set_pin(_drop uuid, _lat double precision, _lng double precision) returns void
language plpgsql security definer set search_path=public as $$
declare d gift_drops; c gift_campaigns; zl jsonb; begin
  select * into d from gift_drops where id=_drop for update;
  if d.id is null then raise exception 'Drop not found'; end if;
  c := public.gift_require_campaign(d.campaign_id);
  if d.status not in ('pending','planned','failed') then raise exception 'Drop already sent'; end if;
  if _lat is null or _lng is null or abs(_lat)>90 or abs(_lng)>180 then raise exception 'Invalid location'; end if;
  begin zl := public.zone_lookup(_lat,_lng); exception when others then zl := '{}'; end;
  update gift_drops set lat=_lat, lng=_lng, pin_status='ok', zone_id=nullif(zl->>'zone_id','')::uuid,
    zone_name=coalesce(zl->>'zone','Outside zones') where id=_drop;
  if d.address_id is not null then update gift_client_addresses set lat=_lat, lng=_lng where id=d.address_id; end if;
  if d.trip_id is not null then perform public.gift_trip_recalc(d.trip_id); end if;
  perform public.business_audit('gift_set_pin','gift_drops',_drop,jsonb_build_object('lat',d.lat,'lng',d.lng),jsonb_build_object('lat',_lat,'lng',_lng),null);
end $$;

create or replace function public.gift_send_trip(_trip uuid, _expert uuid default null, _training boolean default false) returns jsonb
language plpgsql security definer set search_path=public as $$
declare t gift_trips; c gift_campaigns; d record; pp uuid; rid uuid; oid uuid; rorder uuid[] := '{}'; bid uuid; res jsonb; cid uuid;
  nmiss int; labels jsonb;
begin
  perform public.require_staff();
  if not public.courier_is_ops_staff() then raise exception 'Not authorized' using errcode='42501'; end if;
  select * into t from gift_trips where id=_trip for update;
  if t.id is null then raise exception 'Trip not found'; end if;
  if t.status <> 'planned' then raise exception 'Trip % is already %', t.trip_no, t.status; end if;
  c := public.gift_require_campaign(t.campaign_id);
  if exists (select 1 from gift_drops where trip_id=_trip and is_test) then raise exception 'Test trips can never be dispatched to riders'; end if;
  select count(*) into nmiss from gift_drops where trip_id=_trip and (lat is null or pin_status='missing');
  if nmiss > 0 then raise exception '% drop(s) in trip % have no pin yet', nmiss, t.trip_no; end if;
  if not exists (select 1 from gift_drops where trip_id=_trip) then raise exception 'Trip has no drops'; end if;
  if _training and _expert is null then raise exception 'Pick the trainee for a training trip'; end if;

  pp := c.pickup_point_id;
  if pp is null or not exists (select 1 from business_pickup_points where id=pp and is_active is not false) then
    if c.pickup_lat is null or coalesce(c.pickup_address,'')='' then raise exception 'Set the pickup point first'; end if;
    insert into business_pickup_points(merchant_id, name, address, lat, lng, contact_phone, is_default, is_active)
    values (c.merchant_id, coalesce(c.pickup_name,'Gift pickup'), c.pickup_address, c.pickup_lat, c.pickup_lng, nullif(c.pickup_contact,''),
            not exists (select 1 from business_pickup_points where merchant_id=c.merchant_id), true)
    returning id into pp;
    update gift_campaigns set pickup_point_id=pp where id=c.id;
  end if;

  for d in select * from gift_drops where trip_id=_trip order by stop_seq loop
    insert into business_receivers(merchant_id, name, contact_name, contact_phone, address, lat, lng, notes, created_by_label)
    values (c.merchant_id, d.recipient_name, d.recipient_phone, coalesce(d.recipient_phone, ''), d.address, d.lat, d.lng,
            nullif(d.gift_note,''), 'gifting')
    returning id into rid;
    update business_receivers set contact_name=d.recipient_name where id=rid;
    insert into business_orders(merchant_id, receiver_id, pickup_point_id, reference_no, description, packet_count, status, batched_at, created_by_label)
    values (c.merchant_id, rid, pp, 'GIFT-' || t.trip_no || '-' || d.stop_seq, coalesce(nullif(d.gift_note,''),'Gift'), d.packet_count, 'batched', now(), 'gifting')
    returning id into oid;
    update gift_drops set business_order_id=oid where id=d.id;
    rorder := rorder || rid;
  end loop;

  select jsonb_agg(jsonb_build_object('receiver_id', r, 'label', 'C' || i) order by i) into labels
    from unnest(rorder) with ordinality u(r, i);
  insert into business_batches(merchant_id, pickup_point_id, zone_id, trigger, status, drops_count, trip_label, drop_labels, receiver_order, distance_km, distance_source)
  values (c.merchant_id, pp, t.zone_id, 'manual', 'planning', array_length(rorder,1), left(c.name,40) || ' · Trip ' || t.trip_no, labels, rorder, t.distance_km, 'gift_nearest_next')
  returning id into bid;
  update business_orders set batch_id=bid where id in (select business_order_id from gift_drops where trip_id=_trip);

  if _training then perform set_config('gift.training_ids', _expert::text, true); end if;
  res := public.business_finalize_batch(bid, t.distance_km, 'gift_nearest_next', rorder);
  perform set_config('gift.training_ids', '', true);
  if not coalesce((res->>'ok')::boolean,false) then
    raise exception 'Trip % not sent: %', t.trip_no,
      case res->>'reason' when 'LOW_BALANCE' then 'business wallet is low (needs ₹' || (res->>'total') || ')'
        when 'NO_PLAN' then 'business has no pricing plan' when 'OWNER_NOT_SIGNED_IN' then 'business has never signed in to the app'
        else coalesce(res->>'reason','unknown') end;
  end if;
  cid := (res->>'courier_order_id')::uuid;
  if _expert is not null and not _training then perform public.staff_courier_reassign_rider(cid, _expert); end if;

  update gift_trips set status='sent', batch_id=bid, courier_order_id=cid, sent_at=now(), fail_reason=null where id=_trip;
  update gift_drops set status='sent', courier_order_id=cid where trip_id=_trip;
  update gift_campaigns set status='dispatched' where id=c.id and status in ('draft','planned');
  perform public.business_audit('gift_send_trip','gift_trips',_trip,null,
    jsonb_build_object('courier_order_id',cid,'expert',_expert,'training',_training,'total',res->>'total'),null);
  return jsonb_build_object('ok',true,'courier_order_id',cid,'total',res->'total');
end $$;

create or replace function public.gift_send_all(_campaign uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c gift_campaigns; t record; ok int := 0; errs jsonb := '[]'; begin
  c := public.gift_require_campaign(_campaign);
  for t in select id, trip_no from gift_trips where campaign_id=_campaign and status='planned' order by trip_no loop
    begin perform public.gift_send_trip(t.id, null, false); ok := ok + 1;
    exception when others then errs := errs || jsonb_build_object('trip', t.trip_no, 'error', sqlerrm); end;
  end loop;
  return jsonb_build_object('sent', ok, 'errors', errs);
end $$;

create or replace function public.gift_retry_drops(_campaign uuid, _drop_ids uuid[]) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c gift_campaigns; ids uuid[]; tid uuid; n int; begin
  c := public.gift_require_campaign(_campaign);
  select array_agg(id) into ids from gift_drops where campaign_id=_campaign and id = any(_drop_ids) and status='failed';
  if ids is null then raise exception 'No failed drops selected'; end if;
  select coalesce(max(trip_no),0)+1 into n from gift_trips where campaign_id=_campaign;
  insert into gift_trips(campaign_id, merchant_id, trip_no, zone_name) values (_campaign, c.merchant_id, n, 'Retry') returning id into tid;
  update gift_drops g set trip_id=tid, stop_seq=s.ord, status='planned', business_order_id=null, courier_order_id=null, fail_reason=null
    from unnest(public.gift_route_order(c.pickup_lat, c.pickup_lng, ids)) with ordinality s(id, ord) where g.id=s.id;
  perform public.gift_trip_recalc(tid);
  perform public.business_audit('gift_retry_drops','gift_campaigns',_campaign,null,jsonb_build_object('trip',n,'drops',array_length(ids,1)),null);
  return jsonb_build_object('trip_no', n, 'drops', array_length(ids,1));
end $$;

do $$ declare f text; begin
  foreach f in array array['gift_plan_trips(uuid)','gift_set_pin(uuid,double precision,double precision)','gift_send_trip(uuid,uuid,boolean)','gift_send_all(uuid)','gift_retry_drops(uuid,uuid[])'] loop
    execute 'revoke all on function public.'||f||' from public, anon';
    execute 'grant execute on function public.'||f||' to authenticated';
  end loop; end $$;
revoke all on function public.gift_sync_from_business_order() from public, anon, authenticated;
revoke all on function public.gift_sync_from_batch() from public, anon, authenticated;

update public.business_profiles set drop_proof_mode='bill_photo', proof_geofence_m=100,
  pricing_plan_id=coalesce(pricing_plan_id,'c81a37d2-9ddd-47c9-ae25-083144d7d6a4')
 where business_name='Growth Story Company';
