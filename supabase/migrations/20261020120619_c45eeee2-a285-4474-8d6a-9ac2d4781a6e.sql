ALTER TABLE public.experts ADD COLUMN IF NOT EXISTS online_at timestamptz;

CREATE OR REPLACE FUNCTION public.experts_track_online_at()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.is_online AND (TG_OP = 'INSERT' OR NOT COALESCE(OLD.is_online,false)) THEN
    NEW.online_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS experts_track_online_at ON public.experts;
CREATE TRIGGER experts_track_online_at BEFORE INSERT OR UPDATE OF is_online ON public.experts
FOR EACH ROW EXECUTE FUNCTION public.experts_track_online_at();

UPDATE public.experts SET online_at = COALESCE(location_updated_at, now()) WHERE is_online AND online_at IS NULL;

UPDATE public.ops_settings SET value = '1440' WHERE key = 'expert_stale_online_minutes';

CREATE OR REPLACE FUNCTION public.expire_stale_online_experts()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _minutes int; _count int;
BEGIN
  SELECT COALESCE(NULLIF(value,'')::int, 1440) INTO _minutes
    FROM public.ops_settings WHERE key = 'expert_stale_online_minutes';
  _minutes := COALESCE(_minutes, 1440);
  WITH upd AS (
    UPDATE public.experts SET is_online = false
     WHERE is_online = true
       AND COALESCE(is_busy,false) = false
       AND (COALESCE(online_at, to_timestamp(0)) < now() - make_interval(mins => _minutes)
         OR COALESCE(location_updated_at, to_timestamp(0)) < now() - make_interval(mins => _minutes))
    RETURNING id)
  SELECT count(*) INTO _count FROM upd;
  RETURN _count;
END $$;
REVOKE ALL ON FUNCTION public.expire_stale_online_experts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_online_experts() TO service_role;