ALTER TABLE public.account_deletion_requests
  ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'customer';

ALTER TABLE public.account_deletion_requests
  DROP CONSTRAINT IF EXISTS account_deletion_requests_account_type_check;

ALTER TABLE public.account_deletion_requests
  ADD CONSTRAINT account_deletion_requests_account_type_check
  CHECK (account_type IN ('customer', 'expert', 'merchant'));