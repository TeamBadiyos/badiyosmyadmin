DO $$ DECLARE f text; src text; BEGIN
  FOREACH f IN ARRAY ARRAY['public.staff_spin_save(jsonb,jsonb)','public.staff_spin_redeem(text)','public.app_spin(uuid,text,text)'] LOOP
    src := pg_get_functiondef(f::regprocedure);
    src := replace(src, 'target_type', 'target_table');
    src := replace(src, $q$translate(encode(gen_random_bytes(6),'base64'),'+/=0O1IL','XYZ23456')$q$, $q$translate(upper(md5(random()::text||clock_timestamp()::text)),'0O1I','2345')$q$);
    EXECUTE src;
  END LOOP;
END $$;