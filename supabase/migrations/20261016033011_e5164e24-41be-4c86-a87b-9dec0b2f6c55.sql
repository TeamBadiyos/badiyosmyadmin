UPDATE public.city_price_options c SET expert_payout = v.ep, partner_commission = 0, updated_at = now()
FROM (VALUES
 ('822a460f-5a69-4c5f-9c83-3bd45afb8fe8'::uuid,150),('e21a0c1a-4884-48b0-81dd-b9044f080132'::uuid,80),
 ('6d585367-7222-49c1-bf9b-288c6c7c335e'::uuid,320),('acdc740f-24f3-4abc-b416-9f3d043fc1f7'::uuid,160),
 ('fdb7df80-45b1-4b05-a0f2-c3242df3c1ff'::uuid,240),('3947b139-d5be-468f-8b69-ab68586160ff'::uuid,640),
 ('e255955b-f147-4922-a2b8-42ea5af8737f'::uuid,60),('d5085690-da21-4b72-8aa0-05dc5d3a2d8b'::uuid,160)
) v(id,ep)
WHERE c.price_option_id = v.id AND c.city_id = 'a689c0f7-8356-4848-ae4a-af73ab52d041';

CREATE OR REPLACE FUNCTION public.city_price_options_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.is_active AND COALESCE(NEW.expert_payout,0) <= 0 THEN
    RAISE EXCEPTION 'Set expert pay before switching this option on for booking';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_city_price_options_guard ON public.city_price_options;
CREATE TRIGGER trg_city_price_options_guard BEFORE INSERT OR UPDATE ON public.city_price_options
FOR EACH ROW EXECUTE FUNCTION public.city_price_options_guard();

CREATE OR REPLACE FUNCTION public.app_city_price_options(_city_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT coalesce(jsonb_agg(jsonb_build_object('price_option_id',o.id,'service_id',o.service_id,'label',o.label,
     'duration_minutes',o.duration_minutes,'customer_price',c.customer_price,'strikethrough_price',c.strikethrough_price) ORDER BY o.display_order),'[]'::jsonb)
  FROM service_price_options o JOIN city_price_options c ON c.price_option_id = o.id AND c.city_id = _city_id
  WHERE o.is_active AND c.is_active AND c.customer_price IS NOT NULL AND COALESCE(c.expert_payout,0) > 0 $function$;

CREATE OR REPLACE FUNCTION public.bookings_snapshot_commission() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _spo record; _split record; _ep numeric; _pc numeric; _hours numeric; _co record;
BEGIN
  IF COALESCE(NEW.is_training, false) THEN
    NEW.snapshot_expert_payout := 0; NEW.snapshot_partner_payout := 0;
    NEW.snapshot_hq_share := 0; NEW.snapshot_hourly_rate := 0; NEW.commission_rule_id := NULL;
    RETURN NEW;
  END IF;
  IF NEW.price_option_id IS NOT NULL THEN
    SELECT spo.id, spo.expert_payout INTO _spo FROM public.service_price_options spo WHERE spo.id = NEW.price_option_id;
  END IF;
  IF _spo.id IS NULL THEN
    SELECT spo.id, spo.expert_payout INTO _spo
      FROM public.service_price_options spo JOIN public.services s ON s.id = spo.service_id
     WHERE lower(spo.label) = lower(COALESCE(NEW.service_label,''))
       AND (NEW.service_category_id IS NULL OR s.category_id = NEW.service_category_id)
       AND spo.is_active
     ORDER BY (s.category_id = NEW.service_category_id) DESC, spo.display_order LIMIT 1;
  END IF;
  IF public.get_ops_flag('use_new_commission_engine') THEN
    SELECT * INTO _split FROM public.resolve_commission_split(_spo.id, COALESCE(NEW.price,0), NEW.service_duration_minutes);
    NEW.snapshot_expert_payout := _split.expert_amount;
    NEW.snapshot_partner_payout := 0;
    NEW.snapshot_hq_share := _split.hq_amount;
    NEW.snapshot_hourly_rate := _split.hourly_rate;
    NEW.commission_rule_id := _split.rule_id;
  ELSE
    _co := public.city_opt(_spo.id, NEW.city_id);
    _ep := COALESCE(_co.expert_payout, 0);
    _pc := COALESCE(_co.partner_commission, 0);
    IF _ep <= 0 THEN
      RAISE EXCEPTION 'Expert pay is not set for this service option in this city';
    END IF;
    _hours := GREATEST(COALESCE(NEW.service_duration_minutes,60)::numeric / 60.0, 1.0/60.0);
    NEW.snapshot_expert_payout := _ep;
    NEW.snapshot_partner_payout := _pc;
    NEW.snapshot_hq_share := round(COALESCE(NEW.price,0)) - _ep - _pc;
    NEW.snapshot_hourly_rate := round(_ep / _hours, 2);
    NEW.commission_rule_id := NULL;
  END IF;
  RETURN NEW;
END $function$;