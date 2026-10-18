CREATE OR REPLACE FUNCTION public.spin_is_staff() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM staff_users WHERE auth_user_id=auth.uid() AND status='active') $$;
REVOKE ALL ON FUNCTION public.spin_is_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spin_is_staff() TO authenticated;
ALTER FUNCTION public.spin_mask_phone(text) SET search_path=public;

CREATE OR REPLACE FUNCTION public.staff_spin_scan_check(_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE d spin_draws; p spin_prizes; v_st text;
BEGIN
  IF NOT public.spin_is_staff() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO d FROM spin_draws WHERE redemption_code=upper(trim(_code));
  IF d.id IS NULL THEN RETURN jsonb_build_object('status','not_found'); END IF;
  SELECT * INTO p FROM spin_prizes WHERE id=d.prize_id;
  v_st := spin_draw_status(d,p.expires_at);
  RETURN jsonb_build_object('status', CASE v_st WHEN 'won' THEN 'valid' WHEN 'pending_undo' THEN 'used' WHEN 'redeemed' THEN 'used' ELSE v_st END,
    'code',d.redemption_code,'prize',p.label,'winner',(SELECT full_name FROM users WHERE id=d.user_id),
    'phone_masked',spin_mask_phone(d.phone),'won_at',d.created_at,'expires_at',p.expires_at,
    'redeemed_at',d.redeemed_at,'gate_label',d.gate_label,'method',d.redeem_method,
    'redeemed_by',(SELECT name FROM staff_users WHERE auth_user_id=d.redeemed_by));
END $$;

CREATE OR REPLACE FUNCTION public.staff_spin_scan_redeem(_code text, _gate text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d spin_draws; v_exp timestamptz;
BEGIN
  IF NOT public.spin_is_staff() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO d FROM spin_draws WHERE redemption_code=upper(trim(_code)) FOR UPDATE;
  IF d.id IS NULL THEN RETURN jsonb_build_object('ok',false,'status','not_found'); END IF;
  IF d.redeemed_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'status','used','redeemed_at',d.redeemed_at,'gate_label',d.gate_label); END IF;
  SELECT expires_at INTO v_exp FROM spin_prizes WHERE id=d.prize_id;
  IF v_exp IS NOT NULL AND v_exp < now() THEN RETURN jsonb_build_object('ok',false,'status','expired','expires_at',v_exp); END IF;
  UPDATE spin_draws SET redeemed_at=now(), undo_deadline=NULL, redeemed_by=auth.uid(), redeem_method='scan',
    gate_label=nullif(trim(_gate),'') WHERE id=d.id;
  INSERT INTO audit_logs(actor_id, action, target_type, target_id, after_state)
  VALUES (auth.uid(),'spin_prize_redeemed','spin_draw',d.id,jsonb_build_object('code',d.redemption_code,'gate',_gate,'method','scan'));
  RETURN jsonb_build_object('ok',true,'status','redeemed');
END $$;