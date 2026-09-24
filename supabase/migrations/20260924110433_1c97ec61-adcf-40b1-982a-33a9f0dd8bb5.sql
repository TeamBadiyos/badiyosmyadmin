ALTER TABLE public.products ADD COLUMN IF NOT EXISTS admin_hidden boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS admin_hidden_reason text;

CREATE OR REPLACE FUNCTION public.products_guard_admin_hidden()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF current_user NOT IN ('authenticated','anon') OR coalesce(auth.role(),'') = 'service_role' THEN RETURN NEW; END IF;
  IF public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.admin_hidden OR NEW.admin_hidden_reason IS NOT NULL THEN
      RAISE EXCEPTION 'Not allowed to set admin_hidden on product' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.admin_hidden IS DISTINCT FROM OLD.admin_hidden OR NEW.admin_hidden_reason IS DISTINCT FROM OLD.admin_hidden_reason THEN
    RAISE EXCEPTION 'Not allowed to change admin_hidden on product' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS products_guard_admin_hidden ON public.products;
CREATE TRIGGER products_guard_admin_hidden BEFORE INSERT OR UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.products_guard_admin_hidden();