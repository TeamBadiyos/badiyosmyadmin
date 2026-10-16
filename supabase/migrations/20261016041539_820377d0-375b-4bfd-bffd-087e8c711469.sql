
DO $$ DECLARE f text; d text; BEGIN
  FOREACH f IN ARRAY ARRAY['public.staff_set_city_ops(uuid,jsonb)','public.staff_set_city_service(uuid,text,jsonb)'] LOOP
    d := pg_get_functiondef(f::regprocedure);
    d := replace(d, 'AND is_active AND role', 'AND status = ''active'' AND role');
    d := replace(d, 'audit_logs (actor_id, action, table_name, record_id, old_data, new_data)', 'audit_logs (actor_id, action, target_table, target_id, before_state, after_state)');
    EXECUTE d;
  END LOOP;
END $$;
