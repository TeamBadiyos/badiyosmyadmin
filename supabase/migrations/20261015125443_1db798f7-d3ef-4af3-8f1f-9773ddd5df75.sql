
ALTER TABLE public.merchant_order_items
  ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS variant_name text,
  ADD COLUMN IF NOT EXISTS unit_price numeric,
  ADD COLUMN IF NOT EXISTS addons jsonb,
  ADD COLUMN IF NOT EXISTS line_total numeric;

-- Bill lines carry product name, variant name and addon objects (DB prices)
DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.order_bill_core(uuid,jsonb,numeric,numeric)'::regprocedure);
  d := replace(d, $a$'name', _p.name || coalesce(' (' || _vname || ')', '') || coalesce(' + ' || _anames, ''));$a$,
    $b$'name', _p.name || coalesce(' (' || _vname || ')', '') || coalesce(' + ' || _anames, ''),
      'product_name', _p.name, 'variant_name', _vname,
      'addons', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'price', a.price) order by a.sort_order, a.name)
         from public.product_addons a where a.product_id = _p.id and a.is_active
          and a.id in (select (x)::uuid from jsonb_array_elements_text(coalesce(_it->'addon_ids','[]'::jsonb)) x)), '[]'::jsonb));$b$);
  IF position('''variant_name'', _vname' in d) = 0 THEN RAISE EXCEPTION 'order_bill_core patch failed'; END IF;
  EXECUTE d;

  d := pg_get_functiondef('public.store_create_order(uuid,jsonb,uuid,text,text)'::regprocedure);
  d := replace(d, $a$insert into public.merchant_order_items (order_id, product_id, product_name_snapshot, price_snapshot, quantity, is_mrp_snapshot)
    values (_order_id, (_l->>'product_id')::uuid, _l->>'name', (_l->>'unit_price')::numeric, (_l->>'qty')::int, (_l->>'is_mrp')::boolean);$a$,
    $b$insert into public.merchant_order_items (order_id, product_id, product_name_snapshot, price_snapshot, quantity, is_mrp_snapshot,
      variant_id, variant_name, unit_price, addons, line_total)
    values (_order_id, (_l->>'product_id')::uuid, _l->>'name', (_l->>'unit_price')::numeric, (_l->>'qty')::int, (_l->>'is_mrp')::boolean,
      nullif(_l->>'variant_id','')::uuid, _l->>'variant_name', (_l->>'unit_price')::numeric, coalesce(_l->'addons','[]'::jsonb), (_l->>'line_total')::numeric);$b$);
  IF position('variant_name, unit_price, addons, line_total' in d) = 0 THEN RAISE EXCEPTION 'store_create_order patch failed'; END IF;
  EXECUTE d;
END $mig$;

-- Audited merchant status change
CREATE OR REPLACE FUNCTION public.staff_set_merchant_status(_merchant_id uuid, _status text, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _before jsonb; _after jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'insufficient_role'; END IF;
  IF _status NOT IN ('approved','suspended') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT to_jsonb(m) INTO _before FROM public.merchants m WHERE id = _merchant_id AND deleted_at IS NULL FOR UPDATE;
  IF _before IS NULL THEN RAISE EXCEPTION 'merchant_not_found'; END IF;
  UPDATE public.merchants SET status = _status, updated_at = now() WHERE id = _merchant_id;
  SELECT to_jsonb(m) INTO _after FROM public.merchants m WHERE id = _merchant_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'merchant_status_' || _status, 'merchants', _merchant_id,
    jsonb_build_object('status', _before->>'status'),
    jsonb_build_object('status', _status, 'reason', btrim(_reason)));
END $$;
REVOKE ALL ON FUNCTION public.staff_set_merchant_status(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_set_merchant_status(uuid, text, text) TO authenticated;

-- Store types
ALTER TABLE public.store_categories ADD COLUMN IF NOT EXISTS image_path text;

ALTER TABLE public.sponsored_slots ADD COLUMN IF NOT EXISTS store_category_id uuid REFERENCES public.store_categories(id) ON DELETE CASCADE;
DROP INDEX IF EXISTS public.uq_sponsored_active;
CREATE UNIQUE INDEX uq_sponsored_active ON public.sponsored_slots (service_type,
  COALESCE(CASE WHEN service_type = 'store' THEN store_category_id ELSE category_id END, '00000000-0000-0000-0000-000000000000'::uuid),
  position) WHERE is_active;
