ALTER TABLE public.app_config ADD COLUMN IF NOT EXISTS expert_latest_version_code integer;

CREATE OR REPLACE FUNCTION public.staff_save_app_versions(_patch jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _before jsonb; _after jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM staff_users WHERE (auth_user_id = auth.uid() OR id = auth.uid()) AND role = 'super_admin' AND status = 'active') THEN
    RAISE EXCEPTION 'Only super admin can change app versions';
  END IF;
  SELECT to_jsonb(c) INTO _before FROM app_config c WHERE id = 1;
  UPDATE app_config SET
    expert_min_version_code = COALESCE((_patch->>'expert_min_version_code')::int, expert_min_version_code),
    expert_latest_version = COALESCE(NULLIF(_patch->>'expert_latest_version',''), expert_latest_version),
    expert_latest_version_code = COALESCE((_patch->>'expert_latest_version_code')::int, expert_latest_version_code),
    expert_play_store_url = COALESCE(NULLIF(_patch->>'expert_play_store_url',''), expert_play_store_url),
    min_supported_version_code = COALESCE((_patch->>'min_supported_version_code')::int, min_supported_version_code),
    current_version = COALESCE(NULLIF(_patch->>'current_version',''), current_version),
    latest_version_code = COALESCE((_patch->>'latest_version_code')::int, latest_version_code),
    play_store_url = COALESCE(NULLIF(_patch->>'play_store_url',''), play_store_url),
    updated_at = now()
  WHERE id = 1;
  SELECT to_jsonb(c) INTO _after FROM app_config c WHERE id = 1;
  INSERT INTO audit_logs(actor_id, action, entity_type, entity_id, before_state, after_state)
  VALUES (auth.uid(), 'app_versions_update', 'app_config', '1', _before, _after);
END $$;
REVOKE ALL ON FUNCTION public.staff_save_app_versions(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_save_app_versions(jsonb) TO authenticated;