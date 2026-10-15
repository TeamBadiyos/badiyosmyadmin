DO $$
DECLARE d text; s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['public.store_commission_snapshot(uuid,numeric)','public.store_commission_snapshot(uuid,numeric,numeric)'] LOOP
    d := pg_get_functiondef(s::regprocedure);
    d := replace(d, $x$_gst_on := public.store_setting('store_commission_gst_enabled', 0) >= 1;$x$, $x$_gst_on := true;$x$);
    d := replace(d, $x$greatest(public.store_setting('store_commission_gst_pct', 18), 0)$x$, $x$public.tax_rate('commission_gst')$x$);
    IF position('store_commission_gst' in d) > 0 THEN RAISE EXCEPTION 'patch failed %', s; END IF;
    EXECUTE d;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.merchants_default_commission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare _d numeric := least(greatest(public.store_setting('store_default_commission_pct', 10), 0), 50);
begin
  if TG_OP = 'INSERT' and (NEW.commission_pct is null or NEW.commission_pct = 10) then
    NEW.commission_pct := _d;
  end if;
  if NEW.status = 'approved' and (TG_OP = 'INSERT' or coalesce(OLD.status,'') <> 'approved')
     and coalesce(NEW.commission_value,0) = 0 then
    NEW.commission_type  := 'PERCENTAGE';
    NEW.commission_value := _d;
  end if;
  return NEW;
end $function$;

DROP TRIGGER IF EXISTS trg_merchants_default_commission ON public.merchants;
CREATE TRIGGER trg_merchants_default_commission BEFORE INSERT OR UPDATE ON public.merchants
FOR EACH ROW EXECUTE FUNCTION public.merchants_default_commission();