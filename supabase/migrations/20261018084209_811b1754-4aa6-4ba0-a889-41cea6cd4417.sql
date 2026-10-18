DO $$
DECLARE d text; n text; f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.booking_cancel_core','public.system_auto_cancel_booking_no_expert'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p WHERE p.oid = f::regproc;
    n := replace(d, '''refund'',''cash''', '''refund_in'',''cash''');
    n := regexp_replace(n, '''refund'',''bonus'',([^;]*?),NULL,(_actor_uid|NULL)\); END IF;',
         '''bonus'',''bonus'',\1,now()+make_interval(days=>public.wallet_bonus_days()),\2); END IF;', 'g');
    IF n = d OR position('''refund'',' in n) > 0 THEN RAISE EXCEPTION 'pattern not found in %', f; END IF;
    EXECUTE n;
  END LOOP;
END $$;