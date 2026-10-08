CREATE OR REPLACE FUNCTION public.partner_program_on_at(_program text, _at timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH f AS (SELECT min(changed_at) + interval '1 hour' AS setup_end FROM public.partner_program_toggle_log)
  SELECT
    COALESCE(
      (SELECT enabled FROM public.partner_program_toggle_log, f WHERE program='master' AND changed_at <= _at AND _at > f.setup_end ORDER BY changed_at DESC LIMIT 1),
      (SELECT enabled FROM public.partner_program_toggle_log WHERE program='master' ORDER BY changed_at DESC LIMIT 1),
      false)
    AND COALESCE(
      (SELECT enabled FROM public.partner_program_toggle_log, f WHERE program=_program AND changed_at <= _at AND _at > f.setup_end ORDER BY changed_at DESC LIMIT 1),
      (SELECT enabled FROM public.partner_program_toggle_log WHERE program=_program ORDER BY changed_at DESC LIMIT 1),
      false)
$$;
REVOKE ALL ON FUNCTION public.partner_program_on_at(text, timestamptz) FROM PUBLIC, anon;