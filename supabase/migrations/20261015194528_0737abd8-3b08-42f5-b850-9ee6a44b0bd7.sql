ALTER TABLE public.device_tokens DROP CONSTRAINT device_tokens_user_type_check;
ALTER TABLE public.device_tokens ADD CONSTRAINT device_tokens_user_type_check CHECK (user_type = ANY (ARRAY['customer','expert','staff','merchant']));

CREATE OR REPLACE FUNCTION public.notify_merchant_push(_merchant_id uuid, _alert_type text, _title text, _body text, _data jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE _secret text;
BEGIN
  IF _merchant_id IS NULL THEN RETURN; END IF;
  SELECT value INTO _secret FROM public.edge_runtime_config WHERE key='push_trigger_secret';
  IF coalesce(_secret,'')='' THEN RETURN; END IF;
  PERFORM net.http_post(
    url := 'https://project--981f7dd4-309e-4614-b96b-67bc34bd1fdd.lovable.app/api/public/merchant-send-push',
    headers := jsonb_build_object('content-type','application/json','x-trigger-secret',_secret),
    body := jsonb_build_object('merchant_id',_merchant_id,'alert_type',_alert_type,'title',_title,'body',coalesce(_body,''),'data',coalesce(_data,'{}'::jsonb)));
EXCEPTION WHEN others THEN RAISE WARNING '[notify_merchant_push] %', SQLERRM;
END $$;
REVOKE ALL ON FUNCTION public.notify_merchant_push(uuid,text,text,text,jsonb) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.party_notify(_party_type text, _party_id uuid, _kind text, _title text, _body text, _data jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _eid uuid;
BEGIN
  INSERT INTO party_notifications(party_type, party_id, auth_user_id, kind, title, body, data)
  VALUES (_party_type, _party_id, public.party_auth_user(_party_type,_party_id), _kind, _title, _body, coalesce(_data,'{}'));
  IF _party_type = 'merchant' THEN
    PERFORM public.notify_merchant_push(_party_id, _kind, _title, _body, coalesce(_data,'{}') || jsonb_build_object('kind',_kind));
    RETURN;
  END IF;
  IF _party_type = 'expert' THEN _eid := _party_id;
  ELSIF _party_type = 'applicant' THEN SELECT expert_id INTO _eid FROM expert_applications WHERE id=_party_id;
  END IF;
  IF _eid IS NOT NULL THEN
    PERFORM public.notify_push_event('expert', _eid, 'general', _title, coalesce(_body,''),
      coalesce(_data,'{}') || jsonb_build_object('kind', _kind));
  END IF;
EXCEPTION WHEN others THEN RAISE WARNING '[party_notify] %', SQLERRM;
END $$;