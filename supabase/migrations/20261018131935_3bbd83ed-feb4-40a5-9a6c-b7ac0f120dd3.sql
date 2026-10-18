ALTER TABLE public.staff_users ADD COLUMN IF NOT EXISTS phone text, ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
ALTER TABLE public.staff_users DROP CONSTRAINT staff_users_role_check;
ALTER TABLE public.staff_users ADD CONSTRAINT staff_users_role_check CHECK (role IN ('super_admin','ops_manager','area_partner'));

ALTER TABLE public.expert_applications ADD COLUMN IF NOT EXISTS recommended_by uuid, ADD COLUMN IF NOT EXISTS recommended_at timestamptz, ADD COLUMN IF NOT EXISTS recommend_note text;

CREATE TABLE IF NOT EXISTS public.expert_leave_days (
  expert_id uuid NOT NULL REFERENCES public.experts(id) ON DELETE CASCADE,
  leave_date date NOT NULL,
  marked_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (expert_id, leave_date)
);
GRANT SELECT ON public.expert_leave_days TO authenticated;
GRANT ALL ON public.expert_leave_days TO service_role;
ALTER TABLE public.expert_leave_days ENABLE ROW LEVEL SECURITY;
CREATE POLICY eld_staff_read ON public.expert_leave_days FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM staff_users s WHERE s.auth_user_id=auth.uid() AND s.status='active') OR expert_id IN (SELECT id FROM experts WHERE auth_user_id=auth.uid()));

CREATE OR REPLACE FUNCTION public.staff_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT role FROM staff_users WHERE auth_user_id=auth.uid() AND status='active' $$;
CREATE OR REPLACE FUNCTION public.staff_my_zone_ids() RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT coalesce(array_agg(DISTINCT z), ARRAY[]::uuid[]) FROM (
    SELECT s.zone_id z FROM staff_users s WHERE s.auth_user_id=auth.uid() AND s.zone_id IS NOT NULL
    UNION SELECT sz.zone_id FROM staff_user_zones sz JOIN staff_users s ON s.id=sz.staff_user_id WHERE s.auth_user_id=auth.uid()) x $$;
CREATE OR REPLACE FUNCTION public.mask_phone(_p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN _p IS NULL THEN NULL ELSE left(right(regexp_replace(_p,'\D','','g'),10),2)||'xxxxx'||right(regexp_replace(_p,'\D','','g'),3) END $$;
GRANT EXECUTE ON FUNCTION public.staff_role(), public.staff_my_zone_ids(), public.mask_phone(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_touch_login() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  UPDATE staff_users SET last_login_at=now() WHERE auth_user_id=auth.uid() AND status='active' $$;
GRANT EXECUTE ON FUNCTION public.staff_touch_login() TO authenticated;

-- Area partner: booking must be in one of caller's zones
CREATE OR REPLACE FUNCTION public.ap_require_booking(_booking_id uuid) RETURNS bookings LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE _r text := staff_role(); _b bookings;
BEGIN
  IF _r IS NULL THEN RAISE EXCEPTION 'Forbidden' USING errcode='42501'; END IF;
  SELECT * INTO _b FROM bookings WHERE id=_booking_id;
  IF _b.id IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _r='area_partner' AND NOT (_b.zone_id = ANY(staff_my_zone_ids())) THEN RAISE EXCEPTION 'This booking is not in your zones' USING errcode='42501'; END IF;
  RETURN _b;
END $$;
REVOKE ALL ON FUNCTION public.ap_require_booking(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.staff_update_booking_location(_booking_id uuid, _lat numeric, _lng numeric, _address text, _reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _b bookings := ap_require_booking(_booking_id);
BEGIN
  IF coalesce(trim(_reason),'')='' THEN RAISE EXCEPTION 'Reason required'; END IF;
  IF _lat NOT BETWEEN -90 AND 90 OR _lng NOT BETWEEN -180 AND 180 THEN RAISE EXCEPTION 'Invalid pin'; END IF;
  PERFORM set_config('app.booking_bypass','on',true);
  UPDATE bookings SET booking_lat=_lat, booking_lng=_lng WHERE id=_booking_id;
  INSERT INTO audit_logs(actor_id,action,target_table,target_id,before_state,after_state)
  VALUES (auth.uid(),'update_booking_location','bookings',_booking_id,
    jsonb_build_object('lat',_b.booking_lat,'lng',_b.booking_lng),
    jsonb_build_object('lat',_lat,'lng',_lng,'address',_address,'reason',_reason));
END $$;
GRANT EXECUTE ON FUNCTION public.staff_update_booking_location(uuid,numeric,numeric,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_connect_via_badiyos(_booking_id uuid, _reason text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _b bookings := ap_require_booking(_booking_id); _id uuid;
BEGIN
  IF coalesce(trim(_reason),'')='' THEN RAISE EXCEPTION 'Reason required'; END IF;
  INSERT INTO support_tickets(user_id,message,status,source,category,subject,booking_id,city_id,internal_note)
  VALUES (_b.user_id, 'Please call the customer: '||_reason, 'open','connect_via_badiyos','callback',
    'Call customer — booking '||coalesce(_b.booking_number::text,''), _b.id, _b.city_id,
    'Requested by '||coalesce((SELECT name FROM staff_users WHERE auth_user_id=auth.uid()),'staff'))
  RETURNING id INTO _id;
  INSERT INTO audit_logs(actor_id,action,target_table,target_id,after_state)
  VALUES (auth.uid(),'connect_via_badiyos','support_tickets',_id,jsonb_build_object('booking_id',_booking_id,'reason',_reason));
  RETURN _id;
END $$;
GRANT EXECUTE ON FUNCTION public.staff_connect_via_badiyos(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_set_expert_leave_today(_expert_id uuid, _on boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _r text := staff_role(); _d date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF _r IS NULL THEN RAISE EXCEPTION 'Forbidden' USING errcode='42501'; END IF;
  IF _r='area_partner' AND NOT EXISTS (SELECT 1 FROM expert_zones ez WHERE ez.expert_id=_expert_id AND ez.zone_id = ANY(staff_my_zone_ids()))
     AND NOT EXISTS (SELECT 1 FROM experts e WHERE e.id=_expert_id AND e.zone_id = ANY(staff_my_zone_ids())) THEN
    RAISE EXCEPTION 'This expert is not in your zones' USING errcode='42501'; END IF;
  IF _on THEN INSERT INTO expert_leave_days(expert_id,leave_date,marked_by) VALUES (_expert_id,_d,auth.uid()) ON CONFLICT DO NOTHING;
  ELSE DELETE FROM expert_leave_days WHERE expert_id=_expert_id AND leave_date=_d; END IF;
  INSERT INTO audit_logs(actor_id,action,target_table,target_id,after_state)
  VALUES (auth.uid(), CASE WHEN _on THEN 'expert_leave_today' ELSE 'expert_leave_cleared' END,'experts',_expert_id,jsonb_build_object('date',_d));
END $$;
GRANT EXECUTE ON FUNCTION public.staff_set_expert_leave_today(uuid,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_recommend_application(_id uuid, _note text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _r text := staff_role(); _a expert_applications;
BEGIN
  IF _r IS NULL THEN RAISE EXCEPTION 'Forbidden' USING errcode='42501'; END IF;
  SELECT * INTO _a FROM expert_applications WHERE id=_id;
  IF _a.id IS NULL THEN RAISE EXCEPTION 'Application not found'; END IF;
  IF _r='area_partner' AND NOT (_a.preferred_zone_id = ANY(staff_my_zone_ids())) THEN RAISE EXCEPTION 'Not in your zones' USING errcode='42501'; END IF;
  UPDATE expert_applications SET recommended_by=auth.uid(), recommended_at=now(), recommend_note=_note WHERE id=_id;
  INSERT INTO audit_logs(actor_id,action,target_table,target_id,after_state)
  VALUES (auth.uid(),'recommend_expert_application','expert_applications',_id,jsonb_build_object('note',_note));
END $$;
GRANT EXECUTE ON FUNCTION public.staff_recommend_application(uuid,text) TO authenticated;