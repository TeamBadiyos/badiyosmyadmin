DO $$
DECLARE v_b uuid := 'bf162185-5a25-45c0-9a39-20fd9d03504e'; v_e uuid := '365960e5-c119-45a4-b505-e92e94db61b7';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.booking_tips WHERE razorpay_payment_id = 'pay_Ts9cCgX6FlQ72c') THEN
    INSERT INTO public.booking_tips (booking_id, expert_id, user_id, amount, razorpay_payment_id, status)
    VALUES (v_b, v_e, '9a84beb9-ac45-43e7-a228-dadaa9aee927', 50, 'pay_Ts9cCgX6FlQ72c', 'paid');
    UPDATE public.experts SET wallet_balance = COALESCE(wallet_balance,0) + 50 WHERE id = v_e;
    INSERT INTO public.wallet_ledger (owner_type, owner_id, amount, type, reason, created_by)
    VALUES ('expert', v_e, 50, 'credit', 'Customer tip (CH-10350) pay_Ts9cCgX6FlQ72c', NULL);
  END IF;
END $$;