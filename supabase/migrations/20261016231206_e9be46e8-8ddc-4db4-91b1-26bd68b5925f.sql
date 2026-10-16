ALTER TABLE public.products ADD COLUMN IF NOT EXISTS original_price numeric;
DO $do$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.product_upsert_core(uuid,uuid,jsonb,text)'::regprocedure);
  d := replace(d, $r$  _cat := nullif(_payload->>'category_id','')::uuid;$r$,
   $r$  IF nullif(_payload->>'original_price','') IS NOT NULL AND (_payload->>'original_price')::numeric <= (_payload->>'price')::numeric THEN RAISE EXCEPTION 'invalid_original_price'; END IF;
  _cat := nullif(_payload->>'category_id','')::uuid;$r$);
  d := replace(d, $r$price=(_payload->>'price')::numeric,$r$, $r$price=(_payload->>'price')::numeric, original_price=nullif(_payload->>'original_price','')::numeric,$r$);
  EXECUTE d;
  d := pg_get_functiondef('public.app_item_card(uuid)'::regprocedure);
  d := replace(d, $r$'original_price',NULL$r$, $r$'original_price',CASE WHEN p.original_price > p.price THEN p.original_price END$r$);
  EXECUTE d;
END $do$;