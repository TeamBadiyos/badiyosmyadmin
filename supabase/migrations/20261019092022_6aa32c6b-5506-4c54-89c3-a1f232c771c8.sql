DO $m$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.bookings_before_insert'::regproc);
  n := regexp_replace(d, 'if _bypass is distinct from ''on'' and not public\.service_hours_bypass\(\)',
        'if _bypass is distinct from ''on'' and coalesce(current_setting(''app.booking_paid_recovery'', true), '''') <> ''on'' and not public.service_hours_bypass()', 'gi');
  IF n = d THEN RAISE EXCEPTION 'bookings_before_insert hours check not found'; END IF;
  EXECUTE n;

  d := pg_get_functiondef('public.system_fulfill_payment_intent'::regproc);
  n := replace(d, 'SET attempts = attempts + 1, last_error = SQLERRM,',
        'SET attempts = attempts + 1, last_error = SQLERRM, razorpay_payment_id = COALESCE(_payment_id, razorpay_payment_id),');
  IF n = d THEN RAISE EXCEPTION 'system_fulfill_payment_intent error handler not found'; END IF;
  EXECUTE n;
END $m$;

UPDATE public.payment_intents
   SET razorpay_payment_id = 'pay_ToSZmFS2xnD1j3', status = 'refunded',
       last_error = 'Refunded in full: rfnd_TpiOBgMZ2vsyhb (booking was never created)', updated_at = now()
 WHERE id = 'd6e2dda5-964a-4e47-b8f9-7ceca567669e';

INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, after_state)
VALUES ('00000000-0000-0000-0000-000000000000','staff_refund_stranded_payment','payment_intents','d6e2dda5-964a-4e47-b8f9-7ceca567669e',
 jsonb_build_object('razorpay_payment_id','pay_ToSZmFS2xnD1j3','refund_id','rfnd_TpiOBgMZ2vsyhb','amount',944));