DO $$
BEGIN
  PERFORM set_config('app.booking_bypass','on',true);
  UPDATE public.bookings SET
    broadcast_started_at = now(),
    current_search_radius_km = NULL,
    dispatch_exhausted_at = NULL,
    dispatch_alert_sent = false,
    no_expert_alert_sent = false,
    last_rebroadcast_at = NULL
  WHERE status = 'accepted' AND assigned_expert_id IS NULL
    AND dispatch_exhausted_at IS NOT NULL
    AND public.slot_start_ist(scheduled_date, scheduled_time_slot) > now();
  PERFORM set_config('app.booking_bypass','off',true);
END $$;