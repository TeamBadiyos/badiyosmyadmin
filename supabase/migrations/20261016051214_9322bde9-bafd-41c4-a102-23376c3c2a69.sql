-- 1a. record the ₹14 top-ups and credit notes
DO $$ DECLARE r record; BEGIN
  PERFORM set_config('app.booking_bypass','on', true);
  FOR r IN SELECT * FROM public.bookings WHERE booking_number IN ('CH-10215','CH-10217') LOOP
    UPDATE public.bookings SET refund_amount = 303,
      staff_note = trim(coalesce(staff_note,'') || ' GST top-up refund ₹14: ' ||
        CASE r.booking_number WHEN 'CH-10215' THEN 'rfnd_ToSW1aSDm5QcFm' ELSE 'rfnd_ToSW3MAJ3l7xkk' END)
     WHERE id = r.id;
    INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
    VALUES (COALESCE((SELECT id FROM public.staff_users WHERE role='super_admin' AND status='active' ORDER BY created_at LIMIT 1), r.id),
      'refund_gst_topup','bookings', r.id, jsonb_build_object('refund_amount', r.refund_amount),
      jsonb_build_object('refund_amount',303,'topup',14,'refund_id',
        CASE r.booking_number WHEN 'CH-10215' THEN 'rfnd_ToSW1aSDm5QcFm' ELSE 'rfnd_ToSW3MAJ3l7xkk' END));
    PERFORM public.fin_issue_credit_note('booking', r.id, 303, 'Refund – no expert available');
  END LOOP;
  PERFORM set_config('app.booking_bypass','off', true);
END $$;

-- 2. one auto-cancel setting per city per service
INSERT INTO public.city_ops_settings(city_id, key, value)
SELECT c.id, k, '120' FROM public.cities c CROSS JOIN unnest(ARRAY['clean_auto_cancel_minutes','wash_auto_cancel_minutes']) k
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.auto_cancel_minutes(_service_key text, _city_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT greatest(1, public.city_ops_num(COALESCE(_city_id, public.default_city_id()),
    CASE WHEN _service_key IN ('wash','clean_auto') THEN 'wash_auto_cancel_minutes' ELSE 'clean_auto_cancel_minutes' END, 120)::int) $$;

CREATE OR REPLACE FUNCTION public.booking_auto_cancel_minutes(_booking_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.auto_cancel_minutes(public.booking_capacity_group(b.service_category_id, b.service_label), b.city_id)
  FROM public.bookings b WHERE b.id = _booking_id $$;

CREATE OR REPLACE FUNCTION public.app_auto_cancel_minutes(_service_key text, _city_id uuid DEFAULT NULL)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.auto_cancel_minutes(_service_key, _city_id) $$;

DROP FUNCTION IF EXISTS public.system_list_expired_unassigned_bookings();
CREATE FUNCTION public.system_list_expired_unassigned_bookings()
 RETURNS TABLE (id uuid, price numeric, total_amount numeric, razorpay_payment_id text, broadcast_started_at timestamptz, created_at timestamptz, minutes integer)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT b.id, b.price, COALESCE(b.total_amount, b.price), b.razorpay_payment_id, b.broadcast_started_at, b.created_at, m.mins
  FROM public.bookings b
  CROSS JOIN LATERAL (SELECT public.auto_cancel_minutes(public.booking_capacity_group(b.service_category_id, b.service_label), b.city_id) AS mins) m
  WHERE b.status IN ('confirmed','accepted')
    AND b.assigned_expert_id IS NULL AND b.deleted_at IS NULL
    AND COALESCE(b.broadcast_started_at, b.created_at) < now() - make_interval(mins => m.mins)
  ORDER BY COALESCE(b.broadcast_started_at, b.created_at) LIMIT 50 $$;
REVOKE ALL ON FUNCTION public.system_list_expired_unassigned_bookings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.system_list_expired_unassigned_bookings() TO service_role;

DO $$ DECLARE d text; BEGIN
  SELECT pg_get_functiondef('public.expand_stale_broadcasts()'::regprocedure) INTO d;
  d := replace(d, 'greatest(coalesce(cfg.no_expert_timeout_minutes, 30), 1)', 'public.booking_auto_cancel_minutes(id)');
  IF position('booking_auto_cancel_minutes(id)' in d) = 0 THEN RAISE EXCEPTION 'expand_stale_broadcasts patch failed'; END IF;
  EXECUTE d;
END $$;
COMMENT ON COLUMN public.dispatch_config.no_expert_timeout_minutes IS 'LEGACY – not used. Use city_ops_settings clean_/wash_auto_cancel_minutes.';

-- 3/4. real availability
CREATE OR REPLACE FUNCTION public.expert_has_push_device(_expert_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.device_tokens d WHERE d.user_type='expert' AND d.user_id=_expert_id AND d.fcm_token IS NOT NULL) $$;

CREATE OR REPLACE FUNCTION public.expert_matches_group(_expert_id uuid, _g text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.partner_skills ps JOIN public.service_categories sc ON sc.id=ps.service_category_id
    WHERE ps.expert_id=_expert_id AND ps.status='approved'
      AND sc.slug = ANY(CASE WHEN _g='wash' THEN ARRAY['car-bike-wash'] ELSE ARRAY['home-cleaning','festival-special-cleaning'] END)) $$;

CREATE OR REPLACE FUNCTION public.live_expert_counts(_service_key text, _city_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH e AS (
    SELECT x.id, public.rider_is_busy(x.id) AS busy, public.expert_has_push_device(x.id) AS dev
    FROM public.experts x
    WHERE x.status='active' AND x.is_online AND x.mode='LIVE'
      AND x.city_id = COALESCE(_city_id, public.default_city_id())
      AND public.expert_matches_group(x.id, CASE WHEN _service_key IN ('wash','clean_auto') THEN 'wash' ELSE 'clean' END))
  SELECT jsonb_build_object('online', count(*), 'free', count(*) FILTER (WHERE NOT busy AND dev),
    'busy', count(*) FILTER (WHERE busy), 'no_device', count(*) FILTER (WHERE NOT dev)) FROM e $$;

DO $$ DECLARE d text; BEGIN
  SELECT pg_get_functiondef('public.service_instant_allowed(text,integer,uuid)'::regprocedure) INTO d;
  d := replace(d, $x$  select * into f from public.service_flags where service_key = _service_key and city_id = _cid order by created_at limit 1;$x$,
$x$  if _service_key in ('clean','maid','clean_home','house_help','wash','clean_auto')
     and coalesce((public.live_expert_counts(_service_key, _cid)->>'free')::int, 0) < 1 then
    return jsonb_build_object('ok', false, 'reason_code', 'all_busy',
      'message', 'All experts are busy right now', 'actions', jsonb_build_array('notify_me','schedule'));
  end if;
  select * into f from public.service_flags where service_key = _service_key and city_id = _cid order by created_at limit 1;$x$);
  IF position('all_busy' in d) = 0 THEN RAISE EXCEPTION 'service_instant_allowed patch failed'; END IF;
  EXECUTE d;
END $$;

CREATE OR REPLACE FUNCTION public.staff_live_expert_counts(_service_key text, _city_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager','area_partner','finance']) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF _city_id IS NOT NULL AND NOT (_city_id = ANY(public.staff_allowed_city_ids())) THEN RAISE EXCEPTION 'Not authorized for this city'; END IF;
  RETURN public.live_expert_counts(_service_key, _city_id);
END $$;

CREATE OR REPLACE FUNCTION public.staff_experts_without_device()
RETURNS TABLE(id uuid, name text, is_online boolean, city_id uuid) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager','area_partner','finance']) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY SELECT x.id, x.name, x.is_online, x.city_id FROM public.experts x
   WHERE x.status='active' AND x.city_id = ANY(public.staff_allowed_city_ids())
     AND NOT public.expert_has_push_device(x.id) ORDER BY x.is_online DESC, x.name;
END $$;

REVOKE ALL ON FUNCTION public.auto_cancel_minutes(text,uuid), public.booking_auto_cancel_minutes(uuid), public.expert_has_push_device(uuid),
  public.expert_matches_group(uuid,text), public.live_expert_counts(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_auto_cancel_minutes(text,uuid) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.staff_live_expert_counts(text,uuid), public.staff_experts_without_device() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_live_expert_counts(text,uuid), public.staff_experts_without_device() TO authenticated;