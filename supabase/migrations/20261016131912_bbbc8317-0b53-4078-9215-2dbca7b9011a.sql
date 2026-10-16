UPDATE public.merchants
SET service_type = 'store', status = 'suspended', is_open = false, is_accepting_orders = false, updated_at = now()
WHERE id = '81bab737-0da1-4d5e-a9b6-7142825b3e49';
INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
VALUES ('ad3ac608-46a5-49b4-8acc-ec39b043da20', 'merchant_status_suspended', 'merchants', '81bab737-0da1-4d5e-a9b6-7142825b3e49',
  jsonb_build_object('status','approved','service_type','food'),
  jsonb_build_object('status','suspended','service_type','store','reason','Demo store — hidden from user app'));