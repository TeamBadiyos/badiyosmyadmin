
ALTER TABLE public.app_config ADD COLUMN IF NOT EXISTS play_store_url text;

UPDATE public.app_config
SET play_store_url = 'https://play.google.com/store/apps/details?id=com.badiyos.customer&pcampaignid=web_share',
    updated_at = now()
WHERE id = 1;

-- Public read so the marketing site can fetch the link for logged-out visitors
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'app_config' AND policyname = 'Public can read app config'
  ) THEN
    CREATE POLICY "Public can read app config" ON public.app_config FOR SELECT TO anon USING (true);
  END IF;
END $$;
GRANT SELECT ON public.app_config TO anon;
