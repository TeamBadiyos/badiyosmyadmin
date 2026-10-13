SELECT set_config('app.booking_bypass','on',true);
UPDATE public.bookings SET snapshot_expert_payout=640, snapshot_hq_share=259, snapshot_hourly_rate=75.29, commission_rule_id='d472cd66-cdf2-47b4-ac16-461c5ccc8f1b'
WHERE id IN ('4ccde6a1-ab0e-488c-8f78-5b940290bfdd','69335656-186f-424c-b2b9-69263cfd8e25') AND snapshot_expert_payout=680;