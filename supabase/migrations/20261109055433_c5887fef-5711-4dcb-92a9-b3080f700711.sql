CREATE OR REPLACE FUNCTION public.courier_is_gifting_order(_order_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $$
 SELECT EXISTS(SELECT 1 FROM public.gift_trips t WHERE t.courier_order_id=_order_id)
 OR EXISTS(SELECT 1 FROM public.gift_drops d JOIN public.business_orders b ON b.id=d.business_order_id
 LEFT JOIN public.business_batches bt ON bt.id=b.batch_id WHERE b.courier_order_id=_order_id OR bt.courier_order_id=_order_id)
$$;