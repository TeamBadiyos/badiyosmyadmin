ALTER TABLE public.store_categories
  ADD COLUMN IF NOT EXISTS icon text,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.store_categories SET sort_order = rank WHERE sort_order = 0 AND rank <> 0;

CREATE OR REPLACE FUNCTION public.store_categories_sync_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.sort_order = 0 AND NEW.rank <> 0 THEN
      NEW.sort_order := NEW.rank;
    ELSIF NEW.rank = 0 AND NEW.sort_order <> 0 THEN
      NEW.rank := NEW.sort_order;
    END IF;
  ELSE
    IF NEW.sort_order IS DISTINCT FROM OLD.sort_order THEN
      NEW.rank := NEW.sort_order;
    ELSIF NEW.rank IS DISTINCT FROM OLD.rank THEN
      NEW.sort_order := NEW.rank;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_store_categories_sync_touch ON public.store_categories;
CREATE TRIGGER trg_store_categories_sync_touch
BEFORE INSERT OR UPDATE ON public.store_categories
FOR EACH ROW EXECUTE FUNCTION public.store_categories_sync_touch();

GRANT SELECT ON public.store_categories TO anon;
GRANT SELECT, INSERT, UPDATE ON public.store_categories TO authenticated;
GRANT ALL ON public.store_categories TO service_role;