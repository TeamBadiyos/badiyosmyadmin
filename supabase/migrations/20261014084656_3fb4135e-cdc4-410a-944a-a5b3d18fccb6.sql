ALTER FUNCTION public.is_redemption_counted(text, timestamptz, int) SET search_path = public;
ALTER FUNCTION public.event_redemption_effective_status(text, timestamptz) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.event_offers_audit_trg(), public.event_redemptions_audit_trg() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.expire_event_payments(uuid), public.event_offer_check(public.event_offers,uuid,text,uuid),
  public.event_offer_audit(text,uuid,jsonb,jsonb) FROM PUBLIC, anon, authenticated;