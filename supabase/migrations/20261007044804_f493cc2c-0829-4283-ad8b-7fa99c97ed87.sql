ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS approval_reason text,
  ADD COLUMN IF NOT EXISTS approval_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_reviewed_by uuid;

DO $$ BEGIN
  ALTER TABLE public.products ADD CONSTRAINT products_approval_status_check CHECK (approval_status IN ('pending','approved','rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.products_guard_approval()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF current_user NOT IN ('authenticated','anon') OR coalesce(auth.role(),'') = 'service_role' THEN RETURN NEW; END IF;
  IF public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.approval_status := 'pending';
    NEW.approval_reason := NULL;
    NEW.approval_reviewed_at := NULL;
    NEW.approval_reviewed_by := NULL;
  ELSIF NEW.approval_status IS DISTINCT FROM OLD.approval_status
     OR NEW.approval_reason IS DISTINCT FROM OLD.approval_reason
     OR NEW.approval_reviewed_at IS DISTINCT FROM OLD.approval_reviewed_at
     OR NEW.approval_reviewed_by IS DISTINCT FROM OLD.approval_reviewed_by THEN
    RAISE EXCEPTION 'Not allowed to change product approval' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS products_guard_approval ON public.products;
CREATE TRIGGER products_guard_approval BEFORE INSERT OR UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.products_guard_approval();

CREATE OR REPLACE FUNCTION public.products_notify_pending()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.approval_status = 'pending' THEN
    INSERT INTO public.staff_notifications (notif_key, kind, title, detail, target, target_id, event_at)
    SELECT 'product:'||NEW.id, 'merchant', 'Item pending approval',
           coalesce(NEW.name,'New item')||' — '||coalesce(m.store_name,'Store'),
           'merchants', NEW.merchant_id, now()
    FROM (SELECT 1) x LEFT JOIN public.merchants m ON m.id = NEW.merchant_id
    ON CONFLICT (notif_key) DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.products_notify_pending() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS products_notify_pending ON public.products;
CREATE TRIGGER products_notify_pending AFTER INSERT ON public.products
FOR EACH ROW EXECUTE FUNCTION public.products_notify_pending();

CREATE INDEX IF NOT EXISTS products_pending_idx ON public.products (merchant_id) WHERE approval_status = 'pending';