DO $$ DECLARE d text; n text; BEGIN
  d := pg_get_functiondef('public.order_bill_core(uuid,jsonb,numeric,numeric)'::regprocedure);
  n := regexp_replace(d, 'if _svc = ''food'' then(\s+)if _m\.latitude is null', 'if _svc in (''food'',''store'') then\1if _m.latitude is null');
  n := replace(n, '''method'', ''food_service_settings''', '''method'', _svc || ''_service_settings''');
  IF n = d OR position('_svc in (''food'',''store'')' in n) = 0 THEN RAISE EXCEPTION 'order_bill_core patch failed'; END IF;
  EXECUTE n;
END $$;

UPDATE public.service_settings SET delivery_min_fare = 30, delivery_per_km = 10, rider_share_pct = 75, updated_at = now() WHERE service_key = 'store';
COMMENT ON COLUMN public.service_settings.delivery_min_fare IS 'Delivery minimum fare for store and food (each own row). Parcel uses courier_vehicle_rates.';
COMMENT ON COLUMN public.service_settings.delivery_per_km IS 'Delivery per-km rate for store and food (each own row). Parcel uses courier_vehicle_rates.';

INSERT INTO public.catalog_categories (service_type, name, is_active, sort_order)
SELECT 'food', v.name, false, v.ord FROM (VALUES ('Thali',1),('South Indian',2),('Chinese',3),('Pizza & Burger',4),('Sandwich',5),('Snacks',6),('Sweets',7),('Ice Cream',8),('Beverages',9)) v(name, ord)
WHERE NOT EXISTS (SELECT 1 FROM public.catalog_categories c WHERE c.service_type='food' AND lower(c.name)=lower(v.name));