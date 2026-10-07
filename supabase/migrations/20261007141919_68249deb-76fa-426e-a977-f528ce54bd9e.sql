CREATE OR REPLACE FUNCTION public.booking_dispatch_release_due()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare b record; _lead int; _n int := 0;
begin
  if not exists (select 1 from public.bookings where status = 'confirmed'
                 and assigned_expert_id is null and deleted_at is null) then
    return 0;
  end if;
  _lead := public.get_ops_num('booking_dispatch_lead_minutes', 60)::int;
  for b in
    select id from public.bookings
     where status = 'confirmed'
       and assigned_expert_id is null
       and deleted_at is null
       and (is_training or coalesce(razorpay_payment_id,'') <> '' or (coalesce(total_amount,0) = 0 and coalesce(razorpay_order_id,'') like 'free\_%'))
       and public.slot_start_ist(scheduled_date, scheduled_time_slot) is not null
       and public.slot_start_ist(scheduled_date, scheduled_time_slot) <= now() + make_interval(mins => _lead)
     limit 100
  loop
    perform set_config('app.booking_bypass','on', true);
    update public.bookings set status = 'accepted' where id = b.id and status = 'confirmed';
    perform set_config('app.booking_bypass','off', true);
    _n := _n + 1;
  end loop;
  return _n;
end $function$;

CREATE OR REPLACE FUNCTION public.booking_journey_sweeper()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  b record; _n int := 0; _slot timestamptz;
  _asap int; _sched int; _rem int; _warn int; _refund int; _strict boolean;
  _cust text; _paid boolean;
begin
  if not exists (select 1 from public.bookings where deleted_at is null
                 and status in ('confirmed','accepted','expert_assigned','on_the_way')) then
    return 0;
  end if;

  _asap   := public.get_ops_num('asap_onway_deadline_minutes', 3)::int;
  _sched  := public.get_ops_num('scheduled_onway_deadline_before_slot_minutes', 15)::int;
  _rem    := public.get_ops_num('expert_reminder_before_slot_minutes', 30)::int;
  _warn   := public.get_ops_num('no_expert_alert_before_slot_minutes', 5)::int;
  _refund := public.get_ops_num('no_expert_refund_after_slot_minutes', 30)::int;
  _strict := public.get_ops_flag('expert_journey_steps_enabled');

  for b in
    select * from public.bookings
     where deleted_at is null
       and status in ('confirmed','accepted','expert_assigned','on_the_way')
     limit 500
  loop
    _slot := public.slot_start_ist(b.scheduled_date, b.scheduled_time_slot);
    _paid := coalesce(b.razorpay_payment_id,'') <> '' and b.razorpay_payment_id not like 'free\_%'
             and coalesce(b.total_amount,0) > 0;

    if b.assigned_expert_id is null and b.status in ('confirmed','accepted') then
      if _slot is not null and now() >= _slot + make_interval(mins => _refund) then
        select coalesce(full_name, 'Customer') into _cust from public.users where id = b.user_id;
        perform set_config('app.booking_bypass','on', true);
        update public.bookings
           set status = 'cancelled', cancellation_reason = 'no_expert_available',
               cancelled_by = 'system', cancelled_at = now(), cancellation_fee = 0,
               refund_amount = case when _paid then coalesce(total_amount,0) else 0 end,
               refund_status = case when _paid then 'pending' else 'not_applicable' end,
               refund_next_attempt_at = case when _paid then now() else null end
         where id = b.id and status in ('confirmed','accepted') and assigned_expert_id is null;
        perform set_config('app.booking_bypass','off', true);
        perform public.notify_customer_alert(b.id, 'booking_cancelled', 'Booking cancelled',
          case when _paid then 'Koi expert nahi mil paaya, isliye booking cancel kar di gayi. Refund 5-7 din me aa jayega.'
               else 'Koi expert nahi mil paaya, isliye booking cancel kar di gayi.' end,
          jsonb_build_object('route','my-bookings'));
        perform public.admin_alert_enqueue('booking_no_expert_cancelled', b.id,
          coalesce(b.service_label,'Booking'), _cust, coalesce(b.total_amount,0),
          coalesce(b.scheduled_time_slot,'Now'));
        _n := _n + 1;
      elsif _slot is not null and not b.no_expert_alert_sent
            and now() >= _slot - make_interval(mins => _warn) then
        select coalesce(full_name, 'Customer') into _cust from public.users where id = b.user_id;
        perform set_config('app.booking_bypass','on', true);
        update public.bookings set no_expert_alert_sent = true
         where id = b.id and no_expert_alert_sent is not true;
        perform set_config('app.booking_bypass','off', true);
        perform public.notify_customer_alert(b.id, 'no_expert_found', 'Expert dhoondh rahe hain',
          'Expert dhoondh rahe hain, thoda late ho sakta hai.',
          jsonb_build_object('route','booking/' || b.id::text));
        perform public.admin_alert_enqueue('booking_no_expert_warning', b.id,
          coalesce(b.service_label,'Booking'), _cust, coalesce(b.total_amount,0),
          coalesce(b.scheduled_time_slot,'Now'));
        _n := _n + 1;
      end if;
      continue;
    end if;

    if b.assigned_expert_id is not null and not b.expert_slot_reminder_sent
       and _slot is not null and now() >= _slot - make_interval(mins => _rem) and now() < _slot then
      perform set_config('app.booking_bypass','on', true);
      update public.bookings set expert_slot_reminder_sent = true
       where id = b.id and expert_slot_reminder_sent is not true;
      perform set_config('app.booking_bypass','off', true);
      perform public.notify_expert_alert(
        b.assigned_expert_id, 'reminder_30min',
        'Booking ' || _rem::text || ' min me',
        coalesce(b.service_label,'Aapki booking') || ' ' || coalesce(b.scheduled_time_slot,'') ||
        ' — nikalne ki taiyaari karein.',
        jsonb_build_object('booking_id', b.id, 'type', 'reminder_30min',
                           'priority', 'high', 'route', 'booking/' || b.id::text)
      );
      _n := _n + 1;
    end if;

    if _strict and b.status = 'expert_assigned' and b.assigned_expert_id is not null
       and b.expert_assigned_at is not null then
      if _slot is null then
        if not b.onway_alert_sent and now() >= b.expert_assigned_at + make_interval(mins => _asap) then
          select coalesce(full_name, 'Customer') into _cust from public.users where id = b.user_id;
          perform set_config('app.booking_bypass','on', true);
          update public.bookings set onway_alert_sent = true
           where id = b.id and onway_alert_sent is not true;
          perform set_config('app.booking_bypass','off', true);
          perform public.admin_alert_enqueue('booking_onway_late', b.id,
            coalesce(b.service_label,'Booking'), _cust, coalesce(b.total_amount,0), 'ASAP');
          _n := _n + 1;
        end if;
      elsif now() >= _slot - make_interval(mins => _sched)
            and now() >= b.expert_assigned_at + interval '2 minutes' then
        select coalesce(full_name, 'Customer') into _cust from public.users where id = b.user_id;
        perform public.notify_expert_push(b.assigned_expert_id, 'Job hata diya gaya',
          'Ye job aapse hata diya gaya hai kyunki aap time par nikle nahi.', 'home');
        update public.experts set is_busy = false
         where id = b.assigned_expert_id and is_busy is distinct from false;
        perform set_config('app.booking_bypass','on', true);
        update public.bookings
           set assigned_expert_id = null, status = 'accepted', last_rebroadcast_at = now()
         where id = b.id and status = 'expert_assigned';
        perform set_config('app.booking_bypass','off', true);
        perform public.broadcast_booking_to_experts(b.id, null);
        perform public.admin_alert_enqueue('booking_expert_unassigned', b.id,
          coalesce(b.service_label,'Booking'), _cust, coalesce(b.total_amount,0),
          coalesce(b.scheduled_time_slot,'Now'));
        _n := _n + 1;
      end if;
    end if;
  end loop;
  return _n;
end $function$;

CREATE OR REPLACE FUNCTION public.courier_sweeper_tick()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _r record; _esc int;
begin
  perform public.courier_sweeper();
  perform public.courier_dispatch_refund_job();
  begin
    if exists (select 1 from public.courier_order_stops where stop_type='return' and status='arrived') then
      _esc := public.courier_setting('courier_return_payment_escalation_minutes', 15)::int;
      for _r in select distinct o.id, o.order_code, o.total_amount, o.status
                  from public.courier_order_stops s
                  join public.courier_orders o on o.id=s.order_id
                 where s.stop_type='return' and s.status='arrived'
                   and s.arrived_at < now() - make_interval(mins => _esc)
                   and not coalesce(o.needs_ops_attention,false)
                   and exists (select 1 from public.courier_order_charges c
                                join public.courier_order_parcels p on p.id=c.parcel_id
                               where p.return_stop_id=s.id and c.status='pending') loop
        update public.courier_orders set needs_ops_attention=true
         where id=_r.id and not coalesce(needs_ops_attention,false);
        insert into public.courier_order_events(order_id, from_status, to_status, actor_type, actor_id, meta)
        values (_r.id, _r.status, _r.status, 'system', null, jsonb_build_object('event','return_payment_escalated'));
        perform public.admin_alert_enqueue('courier_return_payment', _r.id, coalesce(_r.order_code,'Parcel return'),
                                           'Return charge unpaid', _r.total_amount, 'Now');
      end loop;
    end if;

    for _r in select id, status from public.courier_orders
               where earnings_credited_at is null
                 and ((status='CANCELLED' and cancel_reason_code='ALL_PICKUPS_FAILED')
                      or (status='FAILED_DELIVERY' and incident_code is null)) loop
      if _r.status = 'FAILED_DELIVERY'
         and not public.courier_order_clean_return(_r.id) then continue; end if;
      perform set_config('app.courier_actor_type','system',true);
      perform public.courier_settle_order(_r.id);
    end loop;
  exception when others then raise warning 'courier_sweeper_tick extras failed: %', sqlerrm;
  end;

  begin
    perform public.business_slot_tick();
  exception when others then raise warning 'business_slot_tick failed: %', sqlerrm;
  end;
end $function$;

CREATE OR REPLACE FUNCTION public.expand_stale_broadcasts()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare cfg record; b record; _new_radius numeric; _expanded integer := 0;
begin
  if not exists (select 1 from public.bookings where deleted_at is null and assigned_expert_id is null
                 and status in ('accepted','confirmed','pending')) then
    return 0;
  end if;

  select * into cfg from public.dispatch_config limit 1;
  if cfg.id is null then return 0; end if;

  for b in
    select id, coalesce(current_search_radius_km, cfg.broadcast_radius_km) as radius
    from public.bookings
    where status = 'accepted' and assigned_expert_id is null and deleted_at is null
      and broadcast_started_at is not null
      and broadcast_started_at < now() - make_interval(secs => cfg.radius_expand_after_seconds)
      and coalesce(current_search_radius_km, cfg.broadcast_radius_km) < cfg.radius_expand_max_km
  loop
    _new_radius := least(b.radius + cfg.radius_expand_step_km, cfg.radius_expand_max_km);
    perform set_config('app.booking_bypass','on', true);
    update public.bookings set current_search_radius_km = _new_radius
     where id = b.id and current_search_radius_km is distinct from _new_radius;
    perform set_config('app.booking_bypass','off', true);
    perform public.broadcast_booking_to_experts(b.id, _new_radius);
    _expanded := _expanded + 1;
  end loop;

  perform set_config('app.booking_bypass','on', true);
  update public.bookings set dispatch_exhausted_at = now()
   where status = 'accepted' and assigned_expert_id is null and deleted_at is null
     and dispatch_exhausted_at is null and broadcast_started_at is not null
     and broadcast_started_at < now()
         - make_interval(mins => greatest(coalesce(cfg.no_expert_timeout_minutes, 30), 1))
     and coalesce(current_search_radius_km, cfg.broadcast_radius_km) >= cfg.radius_expand_max_km;
  perform set_config('app.booking_bypass','off', true);

  for b in
    select id from public.bookings
     where deleted_at is null and dispatch_alert_sent = false
       and dispatch_exhausted_at is not null and assigned_expert_id is null
       and status in ('accepted','confirmed','pending')
  loop
    perform public.notify_customer_alert(
      b.id, 'no_expert_found', 'Still looking for an expert',
      'No expert is available near you right now. We are still trying — you can also cancel for a full refund.',
      jsonb_build_object('route', 'booking/' || b.id::text));
    perform set_config('app.booking_bypass','on', true);
    update public.bookings set dispatch_alert_sent = true where id = b.id and dispatch_alert_sent = false;
    perform set_config('app.booking_bypass','off', true);
  end loop;
  return _expanded;
end
$function$;

CREATE OR REPLACE FUNCTION public.send_completion_reminders()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _r record; _count integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.bookings WHERE status = 'in_progress' AND reminder_sent = false) THEN
    RETURN 0;
  END IF;
  FOR _r IN
    SELECT id, assigned_expert_id
      FROM public.bookings
     WHERE status = 'in_progress'
       AND reminder_sent = false
       AND service_end_at IS NOT NULL
       AND service_end_at BETWEEN now() + interval '9 minutes' AND now() + interval '11 minutes'
     FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM public.notify_customer_alert(
      _r.id, 'reminder_10min', 'Service ending soon',
      'Your service ends in about 10 minutes. Need more time? You can request an extension.',
      jsonb_build_object('route', 'booking/' || _r.id::text)
    );
    IF _r.assigned_expert_id IS NOT NULL THEN
      PERFORM public.notify_expert_alert(
        _r.assigned_expert_id, 'reminder_10min', 'Job ending soon',
        'This job ends in about 10 minutes.',
        jsonb_build_object('booking_id', _r.id, 'route', 'booking/' || _r.id::text)
      );
    END IF;
    PERFORM set_config('app.booking_bypass','on', true);
    UPDATE public.bookings SET reminder_sent = true WHERE id = _r.id AND reminder_sent = false;
    PERFORM set_config('app.booking_bypass','off', true);
    _count := _count + 1;
  END LOOP;
  RETURN _count;
END;$function$;

CREATE OR REPLACE FUNCTION public.system_check_no_accept_alerts()
 RETURNS SETOF uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  b record;
  _default integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.bookings
     WHERE status IN ('confirmed','accepted') AND assigned_expert_id IS NULL
       AND deleted_at IS NULL AND broadcast_started_at IS NOT NULL
       AND COALESCE(dispatch_alert_sent, false) = false
  ) THEN
    RETURN;
  END IF;

  _default := (SELECT COALESCE(no_accept_alert_threshold_seconds,180) FROM public.dispatch_config LIMIT 1);

  FOR b IN
    SELECT bk.id, bk.broadcast_started_at,
           COALESCE(zc.threshold, _default, 180) AS threshold
      FROM public.bookings bk
      LEFT JOIN LATERAL (
        SELECT COALESCE(cfg.no_accept_alert_threshold_seconds, 180) AS threshold
          FROM public.zones z
          LEFT JOIN public.dispatch_config cfg ON cfg.city = z.city
         WHERE z.id = bk.zone_id
         LIMIT 1
      ) zc ON true
     WHERE bk.status IN ('confirmed','accepted')
       AND bk.assigned_expert_id IS NULL
       AND bk.deleted_at IS NULL
       AND bk.broadcast_started_at IS NOT NULL
       AND COALESCE(bk.dispatch_alert_sent, false) = false
  LOOP
    IF b.broadcast_started_at <= now() - make_interval(secs => b.threshold) THEN
      IF public.raise_dispatch_alert(b.id, 'no_accept') THEN
        RETURN NEXT b.id;
      END IF;
    END IF;
  END LOOP;
END;
$function$;