ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_url_2 text;
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_approval_status_check;
ALTER TABLE public.products ADD CONSTRAINT products_approval_status_check CHECK (approval_status IN ('pending','approved','rejected','query_raised'));