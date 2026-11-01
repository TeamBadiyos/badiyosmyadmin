CREATE OR REPLACE FUNCTION public.notify_low_rating()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _exp text; _cust text;
BEGIN
  IF NEW.rating IS NULL OR NEW.rating >= 4 OR NEW.is_training THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.rating IS NOT DISTINCT FROM NEW.rating THEN RETURN NEW; END IF;
  SELECT name INTO _exp FROM public.experts WHERE id = NEW.assigned_expert_id;
  SELECT full_name INTO _cust FROM public.users WHERE id = NEW.user_id;
  INSERT INTO public.staff_notifications(notif_key, kind, title, detail, target, target_id, event_at)
  VALUES ('low_rating:'||NEW.id||':'||NEW.rating, 'booking',
    NEW.rating||'★ rating · '||coalesce(NEW.booking_number,'Booking'),
    'Expert: '||coalesce(_exp,'—')||' · Customer: '||coalesce(_cust,'—')||coalesce(' · "'||left(NEW.review_text,180)||'"',''),
    'bookings', NEW.id, now())
  ON CONFLICT DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_low_rating failed: %', sqlerrm; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notify_low_rating() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_notify_low_rating ON public.bookings;
CREATE TRIGGER zz_notify_low_rating AFTER INSERT OR UPDATE OF rating ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.notify_low_rating();