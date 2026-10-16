
-- Helper: the city price row for an option (falls back to the default city when city unknown)
CREATE OR REPLACE FUNCTION public.city_opt(_opt uuid, _city uuid)
RETURNS public.city_price_options LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT c.* FROM public.city_price_options c
   WHERE c.price_option_id=_opt
     AND c.city_id = COALESCE(_city, (SELECT id FROM public.cities WHERE is_default LIMIT 1))
   LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION public.city_opt(uuid,uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.city_opt(uuid,uuid) TO authenticated, service_role;

-- Patch pricing / payout functions to read city prices for every city (incl. Latur)
DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.bookings_before_insert()'::regprocedure);
  d := replace(d, 'NEW.price := _spo.customer_price;',
   $r$NEW.price := (public.city_opt(_spo.id, NEW.city_id)).customer_price;
  IF NEW.price IS NULL OR NOT COALESCE((public.city_opt(_spo.id, NEW.city_id)).is_active, false) THEN
    RAISE EXCEPTION 'SERVICE_OPTION_NOT_AVAILABLE' USING errcode='check_violation', hint='This option is not offered in your city.';
  END IF;$r$);
  EXECUTE d;

  d := pg_get_functiondef('public.bookings_snapshot_commission()'::regprocedure);
  d := replace(d, '_ep := COALESCE(_spo.expert_payout, 0);',
                  '_ep := COALESCE((public.city_opt(_spo.id, NEW.city_id)).expert_payout, 0);');
  EXECUTE d;

  d := pg_get_functiondef('public.resolve_booking_payouts(uuid)'::regprocedure);
  d := replace(d, 'NULLIF(COALESCE(spo.expert_payout,0),0)',
     'NULLIF(COALESCE((public.city_opt(spo.id,(SELECT bk.city_id FROM public.bookings bk WHERE bk.id=_booking_id))).expert_payout,0),0)');
  EXECUTE d;

  d := pg_get_functiondef('public.extend_booking(uuid,integer,text)'::regprocedure);
  d := replace(d, 'spo.customer_price',
     '(public.city_opt(spo.id,(SELECT bk.city_id FROM public.bookings bk WHERE bk.id=_booking_id))).customer_price');
  EXECUTE d;
END $do$;

-- Legacy columns on service_price_options are now a read-only mirror of the default city
CREATE OR REPLACE FUNCTION public.city_price_mirror_legacy()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.city_id = (SELECT id FROM public.cities WHERE is_default LIMIT 1) THEN
    PERFORM set_config('app.price_mirror','on',true);
    UPDATE public.service_price_options SET customer_price=NEW.customer_price,
      strikethrough_price=NEW.strikethrough_price, expert_payout=NEW.expert_payout,
      partner_commission=NEW.partner_commission
     WHERE id=NEW.price_option_id;
    PERFORM set_config('app.price_mirror','off',true);
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS city_price_mirror_legacy ON public.city_price_options;
CREATE TRIGGER city_price_mirror_legacy BEFORE INSERT OR UPDATE ON public.city_price_options
  FOR EACH ROW EXECUTE FUNCTION public.city_price_mirror_legacy();

CREATE OR REPLACE FUNCTION public.spo_legacy_price_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF current_setting('app.price_mirror', true) IS DISTINCT FROM 'on' AND (
     NEW.customer_price IS DISTINCT FROM OLD.customer_price OR
     NEW.strikethrough_price IS DISTINCT FROM OLD.strikethrough_price OR
     NEW.expert_payout IS DISTINCT FROM OLD.expert_payout OR
     NEW.partner_commission IS DISTINCT FROM OLD.partner_commission) THEN
    RAISE EXCEPTION 'LEGACY_PRICE_READ_ONLY: edit prices per city';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS spo_legacy_price_guard ON public.service_price_options;
CREATE TRIGGER spo_legacy_price_guard BEFORE UPDATE ON public.service_price_options
  FOR EACH ROW EXECUTE FUNCTION public.spo_legacy_price_guard();

-- New options get a price row in every city (copied from the values given at creation)
CREATE OR REPLACE FUNCTION public.spo_seed_city_prices()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.city_price_options(city_id, price_option_id, customer_price, strikethrough_price, expert_payout, partner_commission, is_active)
  SELECT c.id, NEW.id, NEW.customer_price, NEW.strikethrough_price, COALESCE(NEW.expert_payout,0), COALESCE(NEW.partner_commission,0), NEW.is_active
    FROM public.cities c ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS spo_seed_city_prices ON public.service_price_options;
CREATE TRIGGER spo_seed_city_prices AFTER INSERT ON public.service_price_options
  FOR EACH ROW EXECUTE FUNCTION public.spo_seed_city_prices();

-- Staff write path: set a price row for one city
CREATE OR REPLACE FUNCTION public.staff_set_city_price(_city_id uuid, _opt uuid, _patch jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _before jsonb; _after jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_users WHERE auth_user_id=auth.uid() AND status='active' AND role IN ('super_admin','ops_manager')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF NOT (_city_id = ANY (public.staff_allowed_city_ids())) THEN RAISE EXCEPTION 'City not allowed'; END IF;
  SELECT to_jsonb(c) INTO _before FROM public.city_price_options c WHERE city_id=_city_id AND price_option_id=_opt;
  INSERT INTO public.city_price_options(city_id, price_option_id, customer_price, strikethrough_price, expert_payout, partner_commission, is_active)
  SELECT _city_id, o.id, o.customer_price, o.strikethrough_price, COALESCE(o.expert_payout,0), COALESCE(o.partner_commission,0), o.is_active
    FROM public.service_price_options o WHERE o.id=_opt
  ON CONFLICT DO NOTHING;
  UPDATE public.city_price_options SET
    customer_price = COALESCE((_patch->>'customer_price')::numeric, customer_price),
    strikethrough_price = CASE WHEN _patch ? 'strikethrough_price' THEN NULLIF(_patch->>'strikethrough_price','')::numeric ELSE strikethrough_price END,
    expert_payout = COALESCE((_patch->>'expert_payout')::numeric, expert_payout),
    partner_commission = COALESCE((_patch->>'partner_commission')::numeric, partner_commission),
    is_active = COALESCE((_patch->>'is_active')::boolean, is_active)
  WHERE city_id=_city_id AND price_option_id=_opt
  RETURNING to_jsonb(city_price_options.*) INTO _after;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before, after)
  VALUES (auth.uid(), 'city_price.update', 'city_price_options', _opt::text, _before, _after);
END $$;
REVOKE EXECUTE ON FUNCTION public.staff_set_city_price(uuid,uuid,jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.staff_set_city_price(uuid,uuid,jsonb) TO authenticated;
