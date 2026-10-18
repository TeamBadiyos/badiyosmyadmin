DO $do$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.staff_spin_export'::regproc);
  d := replace(d, 'SELECT u.full_name, d.phone,', 'SELECT u.full_name, CASE WHEN public.is_super_admin_user() THEN d.phone ELSE public.mask_phone(d.phone) END,');
  EXECUTE d;
END $do$;

CREATE OR REPLACE FUNCTION public.staff_log_export(_name text, _rows integer, _has_phone boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _r text := public.staff_role();
BEGIN
  IF _r IS NULL THEN RAISE EXCEPTION 'Forbidden' USING errcode='42501'; END IF;
  INSERT INTO audit_logs(actor_id, action, target_table, after_state)
  VALUES (auth.uid(), 'export_download', 'exports',
    jsonb_build_object('file', left(coalesce(_name,''),200), 'rows', _rows, 'raw_phones', coalesce(_has_phone,false) AND _r='super_admin', 'role', _r));
END $$;
REVOKE ALL ON FUNCTION public.staff_log_export(text,integer,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_log_export(text,integer,boolean) TO authenticated;