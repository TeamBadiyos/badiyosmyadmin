DO $$ DECLARE d text; o text; BEGIN
SELECT pg_get_functiondef('public.partner_kpi_actuals(uuid,date)'::regprocedure) INTO d;
o := 'SELECT DISTINCT ON (b.user_id) b.user_id, b.assigned_expert_id, b.zone_id, b.city_id, COALESCE(b.service_end_at,b.updated_at) t
      FROM public.bookings b WHERE b.status=''completed'' AND b.deleted_at IS NULL AND NOT COALESCE(b.is_training,false) AND b.user_id IS NOT NULL
     ORDER BY b.user_id, COALESCE(b.service_end_at,b.updated_at)) f';
IF position(o in d) = 0 THEN RAISE EXCEPTION 'new_customers block not found'; END IF;
d := replace(d, o, 'SELECT DISTINCT ON (u.user_id) u.* FROM (
      SELECT b.user_id, b.assigned_expert_id, b.zone_id, b.city_id, COALESCE(b.service_end_at,b.updated_at) t
        FROM public.bookings b WHERE b.status=''completed'' AND b.deleted_at IS NULL AND NOT COALESCE(b.is_training,false) AND b.user_id IS NOT NULL
      UNION ALL
      SELECT c.customer_id, c.assigned_expert_id, c.zone_id, c.city_id, c.completed_at
        FROM public.courier_orders c WHERE upper(c.status)=''COMPLETED'' AND c.completed_at IS NOT NULL
         AND c.customer_id IS NOT NULL AND c.business_merchant_id IS NULL
     ) u ORDER BY u.user_id, u.t) f');
EXECUTE d; END $$;

UPDATE public.partners SET last_activity_at = COALESCE(agreement_start::timestamp AT TIME ZONE 'Asia/Kolkata', now())
 WHERE last_activity_at IS NULL;

DO $$ DECLARE d text; o text; BEGIN
SELECT pg_get_functiondef('public.partner_daily_lifecycle()'::regprocedure) INTO d;
o := 'OR agreement_end < _today) LOOP';
IF position(o in d) = 0 THEN RAISE EXCEPTION 'exit block not found'; END IF;
d := replace(d, o, 'OR (agreement_start IS NOT NULL AND agreement_end IS NOT NULL AND agreement_end < _today)) LOOP');
EXECUTE d; END $$;