
-- Table access
GRANT SELECT ON public.notification_sounds TO authenticated, anon;
GRANT ALL ON public.notification_sounds TO service_role;

DROP POLICY IF EXISTS "notification_sounds_read_all" ON public.notification_sounds;
CREATE POLICY "notification_sounds_read_all" ON public.notification_sounds
  FOR SELECT TO authenticated, anon USING (true);

-- Staff-only update RPC
CREATE OR REPLACE FUNCTION public.staff_upsert_notification_sound(_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid := nullif(_payload->>'id','')::uuid;
  _before jsonb;
  _after jsonb;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _id IS NULL THEN
    RAISE EXCEPTION 'id is required';
  END IF;

  SELECT to_jsonb(n) INTO _before FROM public.notification_sounds n WHERE n.id = _id;
  IF _before IS NULL THEN
    RAISE EXCEPTION 'Notification sound not found';
  END IF;

  UPDATE public.notification_sounds
     SET audio_url = COALESCE(_payload->>'audio_url', audio_url),
         is_active = COALESCE((_payload->>'is_active')::boolean, is_active),
         updated_at = now()
   WHERE id = _id
   RETURNING to_jsonb(notification_sounds) INTO _after;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), 'update', 'notification_sounds', _id, _before, _after);

  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.staff_upsert_notification_sound(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_upsert_notification_sound(jsonb) TO authenticated;

-- Storage policies for notification-sounds bucket
DROP POLICY IF EXISTS "notification_sounds_read" ON storage.objects;
CREATE POLICY "notification_sounds_read" ON storage.objects
  FOR SELECT TO authenticated, anon
  USING (bucket_id = 'notification-sounds');

DROP POLICY IF EXISTS "notification_sounds_staff_write" ON storage.objects;
CREATE POLICY "notification_sounds_staff_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'notification-sounds'
    AND public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

DROP POLICY IF EXISTS "notification_sounds_staff_update" ON storage.objects;
CREATE POLICY "notification_sounds_staff_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'notification-sounds'
    AND public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

DROP POLICY IF EXISTS "notification_sounds_staff_delete" ON storage.objects;
CREATE POLICY "notification_sounds_staff_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'notification-sounds'
    AND public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));
