-- Run transactionally; never posts a real payment.
BEGIN;
DO $test$
DECLARE definition text;
BEGIN
  IF coalesce('2026-10-16'::date::timestamp AT TIME ZONE 'Asia/Kolkata', '2026-10-22T04:55:00Z'::timestamptz) <> '2026-10-15T18:30:00Z'::timestamptz THEN
    RAISE EXCEPTION 'Backdated adjustment must belong to 16 October in India';
  END IF;
  SELECT pg_get_functiondef('public.staff_wallet_adjust(text,uuid,numeric,text,text,date)'::regprocedure) INTO definition;
  IF position('public.staff_wallet_adjust(_owner_type, _owner_id, _amount, _type, _reason)' in definition) = 0 THEN
    RAISE EXCEPTION 'Dated adjustments must reuse the audited, authorized money posting';
  END IF;
  IF position('SET adjustment_date = _adjustment_date' in definition) = 0 THEN
    RAISE EXCEPTION 'Selected date must be stored separately';
  END IF;
  SELECT pg_get_functiondef('public.staff_generate_payout_batch_range(text,date,date,text)'::regprocedure) INTO definition;
  IF position('l.effective_at < _end_ts' in definition) = 0 THEN
    RAISE EXCEPTION 'Payout cutoff must respect selected date';
  END IF;
END $test$;
ROLLBACK;