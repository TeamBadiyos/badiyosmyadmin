CREATE OR REPLACE FUNCTION public.app_agreement_request_otp(_agreement_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE a agreements; _phone text; _digits text;
BEGIN
  SELECT * INTO a FROM agreements WHERE id=_agreement_id;
  IF a.id IS NULL OR public.party_auth_user(a.party_type,a.party_id) IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Not found'; END IF;
  IF a.status <> 'sent' THEN RAISE EXCEPTION 'Agreement is not awaiting acceptance'; END IF;
  _phone := coalesce(nullif((SELECT phone FROM auth.users WHERE id=auth.uid()),''),
                     (SELECT raw_user_meta_data->>'phone' FROM auth.users WHERE id=auth.uid()), '');
  _digits := right(regexp_replace(_phone,'\D','','g'),10);
  IF length(_digits) <> 10 THEN RAISE EXCEPTION 'No phone number on this account'; END IF;
  -- Reuse the existing login OTP sender (send-otp → AiSensy OTP campaign).
  PERFORM net.http_post(
    url := 'https://dkneclwmmjlqswovtqno.supabase.co/functions/v1/send-otp',
    headers := jsonb_build_object('content-type','application/json'),
    body := jsonb_build_object('phone', _digits));
  UPDATE agreements SET otp_hash=NULL, otp_expires_at=now()+interval '10 minutes', otp_attempts=0 WHERE id=a.id;
  RETURN jsonb_build_object('sent_to', right(_digits,4), 'expires_in_seconds', 600);
END $$;

CREATE OR REPLACE FUNCTION public.app_agreement_accept(_agreement_id uuid, _otp text, _device text DEFAULT NULL, _ip text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a agreements; _ip2 text; _phone text; _digits text; _row otp_codes;
BEGIN
  SELECT * INTO a FROM agreements WHERE id=_agreement_id FOR UPDATE;
  IF a.id IS NULL OR public.party_auth_user(a.party_type,a.party_id) IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Not found'; END IF;
  IF a.status <> 'sent' THEN RAISE EXCEPTION 'Agreement is not awaiting acceptance'; END IF;
  IF a.otp_attempts >= 5 THEN RAISE EXCEPTION 'Too many attempts, request a new OTP'; END IF;
  _phone := coalesce(nullif((SELECT phone FROM auth.users WHERE id=auth.uid()),''),
                     (SELECT raw_user_meta_data->>'phone' FROM auth.users WHERE id=auth.uid()), '');
  _digits := right(regexp_replace(_phone,'\D','','g'),10);
  SELECT * INTO _row FROM otp_codes
   WHERE phone IN ('+91'||_digits, '91'||_digits, _digits) AND is_verified = false AND expires_at > now()
   ORDER BY created_at DESC LIMIT 1;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'OTP expired, request a new one'; END IF;
  IF _row.code <> btrim(coalesce(_otp,'')) THEN
    UPDATE agreements SET otp_attempts=otp_attempts+1 WHERE id=a.id; RAISE EXCEPTION 'Wrong OTP';
  END IF;
  UPDATE otp_codes SET is_verified = true WHERE id = _row.id;
  BEGIN _ip2 := coalesce(_ip, (current_setting('request.headers', true)::jsonb)->>'x-forwarded-for'); EXCEPTION WHEN others THEN _ip2 := _ip; END;
  UPDATE agreements SET status='accepted', signed_method='otp', accepted_at=now(), otp_hash=NULL,
    accepted_phone='+91'||_digits, accepted_device=left(_device,300), accepted_ip=left(_ip2,100)
   WHERE id=a.id;
  RETURN jsonb_build_object('ok',true,'accepted_at',now());
END $$;

CREATE OR REPLACE FUNCTION public.party_notify(_party_type text, _party_id uuid, _kind text, _title text, _body text, _data jsonb DEFAULT '{}')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _eid uuid;
BEGIN
  INSERT INTO party_notifications(party_type, party_id, auth_user_id, kind, title, body, data)
  VALUES (_party_type, _party_id, public.party_auth_user(_party_type,_party_id), _kind, _title, _body, coalesce(_data,'{}'));
  -- Push through the existing push system (send-push-notification via notify_push_event).
  IF _party_type = 'expert' THEN _eid := _party_id;
  ELSIF _party_type = 'applicant' THEN SELECT expert_id INTO _eid FROM expert_applications WHERE id=_party_id;
  END IF;
  IF _eid IS NOT NULL THEN
    PERFORM public.notify_push_event('expert', _eid, 'general', _title, coalesce(_body,''),
      coalesce(_data,'{}') || jsonb_build_object('kind', _kind));
  END IF;
EXCEPTION WHEN others THEN RAISE WARNING '[party_notify] %', SQLERRM;
END $$;
REVOKE EXECUTE ON FUNCTION public.party_notify(text,uuid,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;