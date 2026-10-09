CREATE TABLE public.gateway_settlements (
  id text PRIMARY KEY,
  amount numeric NOT NULL DEFAULT 0,
  fees numeric NOT NULL DEFAULT 0,
  tax numeric NOT NULL DEFAULT 0,
  gross_amount numeric NOT NULL DEFAULT 0,
  status text,
  utr text,
  settled_at timestamptz,
  bank_reconciled boolean NOT NULL DEFAULT false,
  bank_reconciled_at timestamptz,
  bank_reconciled_by uuid,
  bank_reference_note text,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.gateway_settlements TO authenticated;
GRANT ALL ON public.gateway_settlements TO service_role;
ALTER TABLE public.gateway_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read settlements" ON public.gateway_settlements FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.staff_users s WHERE s.auth_user_id = auth.uid() AND s.status='active' AND s.role IN ('super_admin','ops_manager')));

CREATE TABLE public.gateway_settlement_items (
  id text PRIMARY KEY,
  settlement_id text NOT NULL REFERENCES public.gateway_settlements(id) ON DELETE CASCADE,
  entity_id text,
  type text,
  amount numeric NOT NULL DEFAULT 0,
  fee numeric NOT NULL DEFAULT 0,
  tax numeric NOT NULL DEFAULT 0,
  credit numeric NOT NULL DEFAULT 0,
  debit numeric NOT NULL DEFAULT 0,
  order_id text,
  description text,
  txn_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.gateway_settlement_items(settlement_id);
GRANT SELECT ON public.gateway_settlement_items TO authenticated;
GRANT ALL ON public.gateway_settlement_items TO service_role;
ALTER TABLE public.gateway_settlement_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read settlement items" ON public.gateway_settlement_items FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.staff_users s WHERE s.auth_user_id = auth.uid() AND s.status='active' AND s.role IN ('super_admin','ops_manager')));

CREATE TABLE public.gateway_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger text NOT NULL,
  ok boolean NOT NULL,
  settlements_synced integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.gateway_sync_log TO authenticated;
GRANT ALL ON public.gateway_sync_log TO service_role;
ALTER TABLE public.gateway_sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read sync log" ON public.gateway_sync_log FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.staff_users s WHERE s.auth_user_id = auth.uid() AND s.status='active' AND s.role IN ('super_admin','ops_manager')));

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
SELECT cron.unschedule('sync-razorpay-settlements') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='sync-razorpay-settlements');
SELECT cron.schedule('sync-razorpay-settlements', '30 18 * * *', $$
  SELECT net.http_post(
    url := 'https://badiyosmyadmin.lovable.app/api/public/hooks/sync-razorpay-settlements',
    headers := jsonb_build_object('Content-Type','application/json','apikey','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRrbmVjbHdtbWpscXN3b3Z0cW5vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4OTExMjMsImV4cCI6MjEwMDQ2NzEyM30.5wHGl9oFmY2AJysu9KlTpUwb-HQGtZZ6q-SHi1ced1Q'),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
$$);