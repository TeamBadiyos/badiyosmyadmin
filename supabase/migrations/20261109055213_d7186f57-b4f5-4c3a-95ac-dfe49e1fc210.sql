CREATE OR REPLACE FUNCTION public.business_stop_proof_mode(_stop_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $$
 SELECT CASE WHEN public.courier_is_gifting_order((SELECT order_id FROM public.courier_order_stops WHERE id=_stop_id)) THEN 'none'
 ELSE coalesce((SELECT bp.drop_proof_mode FROM public.courier_order_stops s JOIN public.courier_orders o ON o.id=s.order_id AND o.source='business' JOIN public.business_batches b ON b.courier_order_id=o.id JOIN public.business_profiles bp ON bp.merchant_id=b.merchant_id WHERE s.id=_stop_id LIMIT 1),'otp') END
$$;