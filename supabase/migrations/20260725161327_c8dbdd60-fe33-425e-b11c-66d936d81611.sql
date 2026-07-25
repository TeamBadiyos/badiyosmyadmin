DROP POLICY IF EXISTS "Users can read expert assigned to their booking" ON public.experts;

CREATE OR REPLACE VIEW public.assigned_expert_public
WITH (security_invoker = off) AS
SELECT
  e.id,
  e.name,
  e.phone,
  e.photo_url,
  e.level,
  e.status,
  e.zone_id
FROM public.experts e
WHERE EXISTS (
  SELECT 1 FROM public.bookings b
  WHERE b.assigned_expert_id = e.id
    AND b.user_id = auth.uid()
);

GRANT SELECT ON public.assigned_expert_public TO authenticated;