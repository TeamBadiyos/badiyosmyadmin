ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS reuploaded_at timestamptz;

CREATE OR REPLACE FUNCTION public.merchants_mark_reupload()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.awaiting_reupload AND OLD.status = 'draft' AND NEW.status = 'pending_review' THEN
    NEW.awaiting_reupload := false;
    NEW.reuploaded_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_merchants_mark_reupload ON public.merchants;
CREATE TRIGGER trg_merchants_mark_reupload BEFORE UPDATE OF status ON public.merchants
FOR EACH ROW EXECUTE FUNCTION public.merchants_mark_reupload();

-- Fix existing rows that were resubmitted already
UPDATE public.merchants m SET awaiting_reupload = false,
  reuploaded_at = COALESCE((SELECT max(created_at) FROM public.audit_logs a WHERE a.target_id = m.id AND a.created_at > m.queried_at), now())
WHERE awaiting_reupload AND status = 'pending_review';