CREATE OR REPLACE FUNCTION public.notify_data_push(_user_type text, _user_id uuid, _data jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $$
DECLARE _secret text; _type text;
BEGIN
  IF _user_id IS NULL THEN RETURN; END IF;
  SELECT value INTO _secret FROM public.edge_runtime_config WHERE key='push_trigger_secret';
  IF coalesce(_secret,'')='' THEN RETURN; END IF;
  IF _user_type = 'merchant' THEN
    _type := CASE WHEN _data->>'reason' = 'cancelled' THEN 'order_cancelled' ELSE 'order_taken' END;
    PERFORM net.http_post(
      url := 'https://badiyos-merchant-hub.lovable.app/api/public/merchant-send-push',
      headers := jsonb_build_object('content-type','application/json','x-trigger-secret',_secret),
      body := jsonb_build_object('merchant_id',_user_id,'order_id',_data->>'order_id',
        'alert_type',_type,'timeout_seconds',60,'data',_data));
  ELSE
    PERFORM net.http_post(
      url := 'https://dkneclwmmjlqswovtqno.supabase.co/functions/v1/send-push-notification',
      headers := jsonb_build_object('content-type','application/json','x-internal-secret',_secret),
      body := jsonb_build_object('user_type',_user_type,'user_id',_user_id,'data_only',true,
        'alert_type',_data->>'alert_type','data',_data));
  END IF;
EXCEPTION WHEN others THEN RAISE WARNING '[notify_data_push] %', SQLERRM;
END $$;
REVOKE ALL ON FUNCTION public.notify_data_push(text,uuid,jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.merchant_order_closed_push()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF OLD.status = 'placed' AND NEW.status IS DISTINCT FROM 'placed' THEN
    PERFORM public.notify_data_push('merchant', NEW.merchant_id,
      jsonb_build_object('alert_type','order_closed','order_id',NEW.id,
        'reason', CASE WHEN NEW.status::text IN ('cancelled','rejected','auto_rejected','expired') THEN 'cancelled' ELSE 'accepted' END));
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN RAISE WARNING '[merchant_order_closed_push] %', SQLERRM; RETURN NEW;
END $$;