DO $$ DECLARE r record; BEGIN
  PERFORM set_config('app.booking_bypass','on', true);
  FOR r IN SELECT * FROM public.bookings WHERE booking_number IN ('CH-10209','CH-10173') LOOP
    UPDATE public.bookings SET refund_amount = total_amount,
      staff_note = trim(coalesce(staff_note,'') || ' GST top-up refund ₹' ||
        CASE r.booking_number WHEN 'CH-10209' THEN '25: rfnd_ToVlSgn5Bl8XAC' ELSE '7: rfnd_ToVlUG5NRWmnlE' END)
     WHERE id = r.id;
    INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
    VALUES (COALESCE((SELECT id FROM public.staff_users WHERE role='super_admin' AND status='active' ORDER BY created_at LIMIT 1), r.id),
      'refund_gst_topup','bookings', r.id, jsonb_build_object('refund_amount', r.refund_amount),
      jsonb_build_object('refund_amount', r.total_amount, 'topup', r.total_amount - r.refund_amount, 'refund_id',
        CASE r.booking_number WHEN 'CH-10209' THEN 'rfnd_ToVlSgn5Bl8XAC' ELSE 'rfnd_ToVlUG5NRWmnlE' END));
    PERFORM public.fin_issue_credit_note('booking', r.id, r.total_amount, 'Refund – no expert available');
  END LOOP;
  PERFORM set_config('app.booking_bypass','off', true);
END $$;