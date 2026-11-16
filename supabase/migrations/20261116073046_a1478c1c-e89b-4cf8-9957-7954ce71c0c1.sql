DO $live$
DECLARE _count int; _r jsonb;
BEGIN
 SELECT count(*) INTO _count FROM courier_orders o JOIN users u ON u.id=o.customer_id WHERE u.full_name='Sushant Kulkarni' AND o.status='IN_TRANSIT';
 IF _count<>1 THEN RAISE EXCEPTION 'Expected exactly one active Sushant Kulkarni delivery'; END IF;
 IF NOT EXISTS(SELECT 1 FROM courier_orders WHERE id='d8baf515-5e33-45ef-9795-563880c3a56c' AND status='IN_TRANSIT' AND earnings_credited_at IS NULL) OR NOT EXISTS(SELECT 1 FROM courier_order_stops WHERE id='9b182717-e36a-4167-9c65-1be7cc7099ed' AND order_id='d8baf515-5e33-45ef-9795-563880c3a56c' AND status='pending') THEN RAISE EXCEPTION 'Order changed; completion aborted'; END IF;
 _r:=public.staff_courier_override('d8baf515-5e33-45ef-9795-563880c3a56c','complete','App issue','Requested by user: complete Sushant pending delivery to verify emergency override','9b182717-e36a-4167-9c65-1be7cc7099ed',NULL,NULL,NULL,NULL,'ad3ac608-46a5-49b4-8acc-ec39b043da20');
 IF _r->>'order_status'<>'COMPLETED' THEN RAISE EXCEPTION 'Completion failed'; END IF;
 IF (SELECT sum(amount) FROM wallet_ledger WHERE reason='courier_order:d8baf515-5e33-45ef-9795-563880c3a56c')<>21 OR (SELECT count(*) FROM wallet_ledger WHERE reason='courier_order:d8baf515-5e33-45ef-9795-563880c3a56c')<>1 THEN RAISE EXCEPTION 'Unexpected payout'; END IF;
END $live$;