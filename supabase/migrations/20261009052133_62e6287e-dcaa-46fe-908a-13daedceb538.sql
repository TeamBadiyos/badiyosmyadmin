CREATE OR REPLACE FUNCTION public.expand_stale_broadcasts()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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

  -- Scheduled bookings are never "exhausted" before their slot time starts.
  perform set_config('app.booking_bypass','on', true);
  update public.bookings set dispatch_exhausted_at = now()
   where status = 'accepted' and assigned_expert_id is null and deleted_at is null
     and dispatch_exhausted_at is null and broadcast_started_at is not null
     and broadcast_started_at < now()
         - make_interval(mins => greatest(coalesce(cfg.no_expert_timeout_minutes, 30), 1))
     and coalesce(current_search_radius_km, cfg.broadcast_radius_km) >= cfg.radius_expand_max_km
     and (public.slot_start_ist(scheduled_date, scheduled_time_slot) is null
          or public.slot_start_ist(scheduled_date, scheduled_time_slot) <= now());
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
end $$;

DO $$
BEGIN
  PERFORM set_config('app.booking_bypass','on',true);
  UPDATE public.bookings SET dispatch_exhausted_at = NULL
  WHERE status = 'accepted' AND assigned_expert_id IS NULL
    AND dispatch_exhausted_at IS NOT NULL
    AND public.slot_start_ist(scheduled_date, scheduled_time_slot) > now();
  PERFORM set_config('app.booking_bypass','off',true);
END $$;