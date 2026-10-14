CREATE OR REPLACE FUNCTION public.get_offer_remaining(p_offer_id uuid)
RETURNS int LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.event_offers; n int;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO o FROM public.event_offers WHERE id = p_offer_id;
  IF NOT FOUND OR NOT o.is_active OR now() < o.starts_at OR now() > o.ends_at
     OR NOT o.show_remaining OR o.total_stock IS NULL THEN RETURN NULL; END IF;
  SELECT count(*) INTO n FROM public.event_redemptions
   WHERE offer_id = o.id AND public.is_redemption_counted(status, created_at, o.payment_hold_minutes);
  RETURN GREATEST(0, o.total_stock - n);
END $$;
REVOKE EXECUTE ON FUNCTION public.get_offer_remaining(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_offer_remaining(uuid) TO authenticated, service_role;