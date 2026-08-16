ALTER TABLE public.service_price_options
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS gallery_urls text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS video_url text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS inclusions text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS exclusions text[] NOT NULL DEFAULT '{}'::text[];

-- Item media lives in the existing service-images bucket under items/<option_id>/...
CREATE OR REPLACE FUNCTION public.is_public_service_image(object_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN split_part(object_name, '/', 1) = 'items' THEN EXISTS (
      SELECT 1
      FROM public.service_price_options o
      JOIN public.services sv ON sv.id = o.service_id
      JOIN public.service_categories c ON c.id = sv.category_id
      JOIN public.segments s ON s.id = c.segment_id
      WHERE o.is_active AND sv.is_active AND c.is_active AND s.is_active
        AND o.id::text = split_part(object_name, '/', 2)
    )
    ELSE EXISTS (
      SELECT 1
      FROM public.services sv
      JOIN public.service_categories c ON c.id = sv.category_id
      JOIN public.segments s ON s.id = c.segment_id
      WHERE sv.is_active AND c.is_active AND s.is_active
        AND sv.id::text = split_part(object_name, '/', 1)
    )
  END;
$function$;

-- Remove the legacy shared (segment-wide) inclusion/exclusion text
DROP FUNCTION IF EXISTS public.staff_upsert_task_detail(uuid, jsonb);
DROP FUNCTION IF EXISTS public.staff_delete_task_detail(uuid);
DROP FUNCTION IF EXISTS public.staff_reorder_task_details(jsonb);
DROP TABLE IF EXISTS public.service_task_details;