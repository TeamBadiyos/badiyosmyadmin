ALTER TABLE public.device_sessions DROP CONSTRAINT device_sessions_user_type_check;
ALTER TABLE public.device_sessions ADD CONSTRAINT device_sessions_user_type_check CHECK (user_type = ANY (ARRAY['customer'::text,'expert'::text,'staff'::text,'merchant'::text]));

CREATE OR REPLACE FUNCTION public.resolve_caller_identity(_auth_uid uuid)
 RETURNS TABLE(user_type text, user_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _id uuid;
BEGIN
  IF _auth_uid IS NULL THEN RETURN; END IF;

  SELECT id INTO _id FROM public.staff_users WHERE auth_user_id = _auth_uid AND status='active' LIMIT 1;
  IF _id IS NOT NULL THEN user_type := 'staff'; user_id := _id; RETURN NEXT; RETURN; END IF;

  SELECT id INTO _id FROM public.experts WHERE auth_user_id = _auth_uid LIMIT 1;
  IF _id IS NOT NULL THEN user_type := 'expert'; user_id := _id; RETURN NEXT; RETURN; END IF;

  SELECT id INTO _id FROM public.users WHERE id = _auth_uid LIMIT 1;
  IF _id IS NOT NULL THEN user_type := 'customer'; user_id := _id; RETURN NEXT; RETURN; END IF;

  SELECT id INTO _id FROM public.merchants WHERE auth_user_id = _auth_uid LIMIT 1;
  IF _id IS NOT NULL THEN user_type := 'merchant'; user_id := _id; RETURN NEXT; RETURN; END IF;
END $function$;

REVOKE EXECUTE ON FUNCTION public.resolve_caller_identity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_caller_identity(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_merchant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT user_id FROM public.resolve_caller_identity(auth.uid()) WHERE user_type = 'merchant' LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.current_merchant_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_merchant_id() TO authenticated, service_role;

-- Grants (no anon anywhere)
GRANT SELECT, INSERT, UPDATE ON public.merchants, public.merchant_documents, public.products, public.merchant_orders, public.merchant_order_items, public.merchant_roles, public.merchant_staff TO authenticated;
GRANT ALL ON public.merchants, public.merchant_documents, public.products, public.merchant_orders, public.merchant_order_items, public.merchant_roles, public.merchant_staff TO service_role;
REVOKE ALL ON public.merchants, public.merchant_documents, public.products, public.merchant_orders, public.merchant_order_items, public.merchant_roles, public.merchant_staff FROM anon;

-- merchants
CREATE POLICY "Merchants can view own store" ON public.merchants FOR SELECT TO authenticated USING (id = public.current_merchant_id());
CREATE POLICY "Merchants can update own store" ON public.merchants FOR UPDATE TO authenticated USING (id = public.current_merchant_id()) WITH CHECK (id = public.current_merchant_id());
CREATE POLICY "Staff can view all merchants" ON public.merchants FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));
CREATE POLICY "Staff can update merchants" ON public.merchants FOR UPDATE TO authenticated USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager'])) WITH CHECK (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

-- merchant_documents
CREATE POLICY "Merchants manage own documents" ON public.merchant_documents FOR SELECT TO authenticated USING (merchant_id = public.current_merchant_id());
CREATE POLICY "Merchants insert own documents" ON public.merchant_documents FOR INSERT TO authenticated WITH CHECK (merchant_id = public.current_merchant_id());
CREATE POLICY "Merchants update own documents" ON public.merchant_documents FOR UPDATE TO authenticated USING (merchant_id = public.current_merchant_id()) WITH CHECK (merchant_id = public.current_merchant_id());
CREATE POLICY "Staff can view all merchant documents" ON public.merchant_documents FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

-- products
CREATE POLICY "Merchants view own products" ON public.products FOR SELECT TO authenticated USING (merchant_id = public.current_merchant_id());
CREATE POLICY "Merchants insert own products" ON public.products FOR INSERT TO authenticated WITH CHECK (merchant_id = public.current_merchant_id());
CREATE POLICY "Merchants update own products" ON public.products FOR UPDATE TO authenticated USING (merchant_id = public.current_merchant_id()) WITH CHECK (merchant_id = public.current_merchant_id());
CREATE POLICY "Staff can view all products" ON public.products FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

-- merchant_orders
CREATE POLICY "Merchants view own orders" ON public.merchant_orders FOR SELECT TO authenticated USING (merchant_id = public.current_merchant_id());
CREATE POLICY "Merchants insert own orders" ON public.merchant_orders FOR INSERT TO authenticated WITH CHECK (merchant_id = public.current_merchant_id());
CREATE POLICY "Merchants update own orders" ON public.merchant_orders FOR UPDATE TO authenticated USING (merchant_id = public.current_merchant_id()) WITH CHECK (merchant_id = public.current_merchant_id());
CREATE POLICY "Staff can view all merchant orders" ON public.merchant_orders FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

-- merchant_order_items (scoped through parent order's merchant)
CREATE POLICY "Merchants view own order items" ON public.merchant_order_items FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.merchant_orders o WHERE o.id = order_id AND o.merchant_id = public.current_merchant_id()));
CREATE POLICY "Merchants insert own order items" ON public.merchant_order_items FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.merchant_orders o WHERE o.id = order_id AND o.merchant_id = public.current_merchant_id()));
CREATE POLICY "Merchants update own order items" ON public.merchant_order_items FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.merchant_orders o WHERE o.id = order_id AND o.merchant_id = public.current_merchant_id())) WITH CHECK (EXISTS (SELECT 1 FROM public.merchant_orders o WHERE o.id = order_id AND o.merchant_id = public.current_merchant_id()));
CREATE POLICY "Staff can view all merchant order items" ON public.merchant_order_items FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

-- merchant_roles
CREATE POLICY "Merchants view own roles" ON public.merchant_roles FOR SELECT TO authenticated USING (merchant_id = public.current_merchant_id());
CREATE POLICY "Merchants insert own roles" ON public.merchant_roles FOR INSERT TO authenticated WITH CHECK (merchant_id = public.current_merchant_id());
CREATE POLICY "Merchants update own roles" ON public.merchant_roles FOR UPDATE TO authenticated USING (merchant_id = public.current_merchant_id()) WITH CHECK (merchant_id = public.current_merchant_id());
CREATE POLICY "Staff can view all merchant roles" ON public.merchant_roles FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

-- merchant_staff
CREATE POLICY "Merchants view own staff" ON public.merchant_staff FOR SELECT TO authenticated USING (merchant_id = public.current_merchant_id());
CREATE POLICY "Merchants insert own staff" ON public.merchant_staff FOR INSERT TO authenticated WITH CHECK (merchant_id = public.current_merchant_id());
CREATE POLICY "Merchants update own staff" ON public.merchant_staff FOR UPDATE TO authenticated USING (merchant_id = public.current_merchant_id()) WITH CHECK (merchant_id = public.current_merchant_id());
CREATE POLICY "Staff can view all merchant staff" ON public.merchant_staff FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));