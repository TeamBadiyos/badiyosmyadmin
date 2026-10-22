DO $$
DECLARE _sig text; _def text;
BEGIN
  FOREACH _sig IN ARRAY ARRAY[
    'public._send_action_otp(text)',
    'public.notify_data_push(text,uuid,jsonb)',
    'public.notify_push_event(text,uuid,text,text,text,jsonb)',
    'public.send_daily_go_live_reminder()'
  ] LOOP
    _def := pg_get_functiondef(_sig::regprocedure);
    _def := replace(_def, 'https://dkneclwmmjlqswovtqno.supabase.co', 'https://api.badiyos.com');
    IF position('dkneclwmmjlqswovtqno' in _def) > 0 THEN
      RAISE EXCEPTION 'Old ref still present in %', _sig;
    END IF;
    EXECUTE _def;
  END LOOP;
END $$;