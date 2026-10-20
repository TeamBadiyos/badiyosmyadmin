CREATE OR REPLACE FUNCTION public.notify_data_push(_user_type text, _user_id uuid, _data jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $$
DECLARE _secret text;
BEGIN
  IF _user_id IS NULL THEN RETURN; END IF;
  SELECT value INTO _secret FROM public.edge_runtime_config WHERE key='push_trigger_secret';
  IF coalesce(_secret,'')='' THEN RETURN; END IF;
  PERFORM net.http_post(
    url := 'https://dkneclwmmjlqswovtqno.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object('content-type','application/json','x-internal-secret',_secret),
    body := jsonb_build_object('user_type',_user_type,'user_id',_user_id,'data_only',true,
      'alert_type',_data->>'alert_type','data',_data));
EXCEPTION WHEN others THEN RAISE WARNING '[notify_data_push] %', SQLERRM;
END $$;
REVOKE ALL ON FUNCTION public.notify_data_push(text,uuid,jsonb) FROM PUBLIC, anon, authenticated;

-- Record every expert who receives a booking offer
CREATE OR REPLACE FUNCTION public.notify_expert_broadcast(_expert_id uuid, _booking_id uuid, _title text, _body text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $$
BEGIN
  IF _expert_id IS NULL THEN RETURN; END IF;
  BEGIN
    INSERT INTO public.booking_broadcast_pings(booking_id, expert_id, last_pinged_at)
    VALUES (_booking_id, _expert_id, now())
    ON CONFLICT (booking_id, expert_id) DO UPDATE SET last_pinged_at = now();
  EXCEPTION WHEN others THEN NULL; END;
  PERFORM public.notify_expert_alert(
    _expert_id, 'new_order', _title, _body,
    jsonb_build_object('booking_id', _booking_id, 'type', 'new_booking_broadcast', 'route', 'booking/' || _booking_id::text));
END $$;

-- Bookings: accepted / assigned / reassigned / cancelled / expired
CREATE OR REPLACE FUNCTION public.booking_already_taken_push()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; _closed boolean;
BEGIN
  _closed := NEW.status IN ('cancelled','expired','rejected','auto_cancelled')
             AND OLD.status IS DISTINCT FROM NEW.status;
  IF NOT _closed AND (NEW.assigned_expert_id IS NULL
      OR NEW.assigned_expert_id IS NOT DISTINCT FROM OLD.assigned_expert_id) THEN
    RETURN NEW;
  END IF;
  FOR r IN SELECT expert_id FROM public.booking_broadcast_pings
            WHERE booking_id = NEW.id
              AND expert_id IS DISTINCT FROM (CASE WHEN _closed THEN NULL ELSE NEW.assigned_expert_id END)
  LOOP
    PERFORM public.notify_data_push('expert', r.expert_id,
      jsonb_build_object('alert_type','already_taken','booking_id',NEW.id));
  END LOOP;
  IF _closed OR NEW.assigned_expert_id IS NOT NULL THEN
    DELETE FROM public.booking_broadcast_pings WHERE booking_id = NEW.id;
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN RAISE WARNING '[booking_already_taken_push] %', SQLERRM; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_booking_already_taken_push ON public.bookings;
CREATE TRIGGER trg_booking_already_taken_push AFTER UPDATE OF assigned_expert_id, status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.booking_already_taken_push();

-- Rider offers (parcel + store/food delivery)
CREATE OR REPLACE FUNCTION public.courier_offer_already_taken_push()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status OR OLD.status <> 'pending' THEN RETURN NEW; END IF;
  IF NEW.status IN ('cancelled','expired') THEN
    PERFORM public.notify_data_push('expert', NEW.expert_id,
      jsonb_build_object('alert_type','already_taken','order_id',NEW.order_id));
  ELSIF NEW.status = 'accepted' THEN
    FOR r IN SELECT DISTINCT expert_id FROM public.courier_offers
              WHERE order_id = NEW.order_id AND status = 'pending' AND expert_id <> NEW.expert_id
    LOOP
      PERFORM public.notify_data_push('expert', r.expert_id,
        jsonb_build_object('alert_type','already_taken','order_id',NEW.order_id));
    END LOOP;
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN RAISE WARNING '[courier_offer_already_taken_push] %', SQLERRM; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_courier_offer_already_taken_push ON public.courier_offers;
CREATE TRIGGER trg_courier_offer_already_taken_push AFTER UPDATE OF status ON public.courier_offers
  FOR EACH ROW EXECUTE FUNCTION public.courier_offer_already_taken_push();

-- Merchant ringing stop
CREATE OR REPLACE FUNCTION public.merchant_order_closed_push()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF OLD.status = 'placed' AND NEW.status IS DISTINCT FROM 'placed' THEN
    PERFORM public.notify_data_push('merchant', NEW.merchant_id,
      jsonb_build_object('alert_type','order_closed','order_id',NEW.id));
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN RAISE WARNING '[merchant_order_closed_push] %', SQLERRM; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_merchant_order_closed_push ON public.merchant_orders;
CREATE TRIGGER trg_merchant_order_closed_push AFTER UPDATE OF status ON public.merchant_orders
  FOR EACH ROW EXECUTE FUNCTION public.merchant_order_closed_push();

REVOKE ALL ON FUNCTION public.booking_already_taken_push() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.courier_offer_already_taken_push() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merchant_order_closed_push() FROM PUBLIC, anon, authenticated;