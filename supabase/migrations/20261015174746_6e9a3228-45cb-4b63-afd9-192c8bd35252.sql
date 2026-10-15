CREATE TABLE public.expense_categories (
  name text PRIMARY KEY,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_categories TO authenticated;
GRANT ALL ON public.expense_categories TO service_role;
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super admin manages expense categories" ON public.expense_categories FOR ALL TO authenticated
  USING (public.is_super_admin_user()) WITH CHECK (public.is_super_admin_user());
INSERT INTO public.expense_categories(name, sort_order) VALUES
 ('Salary',1),('Rent',2),('Marketing',3),('Travel',4),('Office',5),('Software',6),('Other',7);

CREATE TABLE public.operating_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_date date NOT NULL DEFAULT current_date,
  category text NOT NULL DEFAULT 'Other',
  amount numeric(12,2) NOT NULL DEFAULT 0,
  gst_paid numeric(12,2) NOT NULL DEFAULT 0,
  paid_via text NOT NULL DEFAULT 'Bank',
  vendor text,
  bill_path text,
  note text,
  subscription_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operating_expenses TO authenticated;
GRANT ALL ON public.operating_expenses TO service_role;
ALTER TABLE public.operating_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super admin reads expenses" ON public.operating_expenses FOR SELECT TO authenticated USING (public.is_super_admin_user());

CREATE TABLE public.vendor_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  vendor text,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  billing_cycle text NOT NULL DEFAULT 'monthly',
  next_due_date date NOT NULL DEFAULT current_date,
  auto_renew boolean NOT NULL DEFAULT true,
  payment_method_label text,
  category text NOT NULL DEFAULT 'Software',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendor_subscriptions TO authenticated;
GRANT ALL ON public.vendor_subscriptions TO service_role;
ALTER TABLE public.vendor_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super admin reads subscriptions" ON public.vendor_subscriptions FOR SELECT TO authenticated USING (public.is_super_admin_user());

CREATE OR REPLACE FUNCTION public.fin_save_expense(_id uuid, _p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b jsonb; nid uuid;
BEGIN
  IF NOT public.is_super_admin_user() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF coalesce((_p->>'amount')::numeric,0) <= 0 THEN RAISE EXCEPTION 'Amount must be more than 0'; END IF;
  IF coalesce(_p->>'paid_via','Bank') NOT IN ('Bank','UPI','Cash') THEN RAISE EXCEPTION 'Paid via must be Bank, UPI or Cash'; END IF;
  IF _id IS NULL THEN
    INSERT INTO operating_expenses(expense_date, category, amount, gst_paid, paid_via, vendor, bill_path, note, created_by)
    VALUES (coalesce((_p->>'expense_date')::date, current_date), coalesce(_p->>'category','Other'), (_p->>'amount')::numeric,
      coalesce((_p->>'gst_paid')::numeric,0), coalesce(_p->>'paid_via','Bank'), nullif(_p->>'vendor',''), nullif(_p->>'bill_path',''), nullif(_p->>'note',''), auth.uid())
    RETURNING id INTO nid;
    INSERT INTO audit_logs(actor_id, action, target_table, target_id, before_state, after_state) VALUES (auth.uid(), 'create_expense', 'operating_expenses', nid, NULL, _p);
  ELSE
    SELECT to_jsonb(e) INTO b FROM operating_expenses e WHERE id = _id;
    UPDATE operating_expenses SET expense_date = coalesce((_p->>'expense_date')::date, expense_date), category = coalesce(_p->>'category', category),
      amount = (_p->>'amount')::numeric, gst_paid = coalesce((_p->>'gst_paid')::numeric,0), paid_via = coalesce(_p->>'paid_via', paid_via),
      vendor = nullif(_p->>'vendor',''), bill_path = coalesce(nullif(_p->>'bill_path',''), bill_path), note = nullif(_p->>'note',''), updated_at = now()
    WHERE id = _id;
    nid := _id;
    INSERT INTO audit_logs(actor_id, action, target_table, target_id, before_state, after_state) VALUES (auth.uid(), 'update_expense', 'operating_expenses', nid, b, _p);
  END IF;
  RETURN nid;
END $$;

CREATE OR REPLACE FUNCTION public.fin_delete_expense(_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b jsonb;
BEGIN
  IF NOT public.is_super_admin_user() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT to_jsonb(e) INTO b FROM operating_expenses e WHERE id = _id;
  DELETE FROM operating_expenses WHERE id = _id;
  INSERT INTO audit_logs(actor_id, action, target_table, target_id, before_state, after_state) VALUES (auth.uid(), 'delete_expense', 'operating_expenses', _id, b, NULL);
END $$;

CREATE OR REPLACE FUNCTION public.fin_save_subscription(_id uuid, _p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b jsonb; nid uuid; lbl text := nullif(_p->>'payment_method_label','');
BEGIN
  IF NOT public.is_super_admin_user() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF lbl ~ '\d{9,}' THEN RAISE EXCEPTION 'Do not store full card numbers — use e.g. "Card ending 4417"'; END IF;
  IF coalesce(_p->>'billing_cycle','monthly') NOT IN ('monthly','yearly') THEN RAISE EXCEPTION 'Billing cycle must be monthly or yearly'; END IF;
  IF _id IS NULL THEN
    INSERT INTO vendor_subscriptions(name, vendor, amount, billing_cycle, next_due_date, auto_renew, payment_method_label, category, status)
    VALUES (_p->>'name', nullif(_p->>'vendor',''), coalesce((_p->>'amount')::numeric,0), coalesce(_p->>'billing_cycle','monthly'),
      coalesce((_p->>'next_due_date')::date, current_date), coalesce((_p->>'auto_renew')::boolean, true), lbl, coalesce(nullif(_p->>'category',''),'Software'), coalesce(_p->>'status','active'))
    RETURNING id INTO nid;
    INSERT INTO audit_logs(actor_id, action, target_table, target_id, before_state, after_state) VALUES (auth.uid(), 'create_subscription', 'vendor_subscriptions', nid, NULL, _p);
  ELSE
    SELECT to_jsonb(s) INTO b FROM vendor_subscriptions s WHERE id = _id;
    UPDATE vendor_subscriptions SET name = _p->>'name', vendor = nullif(_p->>'vendor',''), amount = coalesce((_p->>'amount')::numeric,0),
      billing_cycle = coalesce(_p->>'billing_cycle', billing_cycle), next_due_date = coalesce((_p->>'next_due_date')::date, next_due_date),
      auto_renew = coalesce((_p->>'auto_renew')::boolean, auto_renew), payment_method_label = lbl,
      category = coalesce(nullif(_p->>'category',''), category), status = coalesce(_p->>'status', status), updated_at = now()
    WHERE id = _id;
    nid := _id;
    INSERT INTO audit_logs(actor_id, action, target_table, target_id, before_state, after_state) VALUES (auth.uid(), 'update_subscription', 'vendor_subscriptions', nid, b, _p);
  END IF;
  RETURN nid;
END $$;

CREATE OR REPLACE FUNCTION public.fin_mark_subscription_paid(_id uuid, _paid_via text DEFAULT 'Bank') RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s vendor_subscriptions; eid uuid;
BEGIN
  IF NOT public.is_super_admin_user() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT * INTO s FROM vendor_subscriptions WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription not found'; END IF;
  INSERT INTO operating_expenses(expense_date, category, amount, paid_via, vendor, note, subscription_id, created_by)
  VALUES (current_date, s.category, s.amount, coalesce(_paid_via,'Bank'), coalesce(s.vendor, s.name), 'Subscription: ' || s.name, s.id, auth.uid())
  RETURNING id INTO eid;
  UPDATE vendor_subscriptions SET next_due_date = (next_due_date + CASE WHEN billing_cycle = 'yearly' THEN interval '1 year' ELSE interval '1 month' END)::date, updated_at = now() WHERE id = _id;
  INSERT INTO audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), 'pay_subscription', 'vendor_subscriptions', _id, jsonb_build_object('next_due_date', s.next_due_date), jsonb_build_object('expense_id', eid));
  RETURN eid;
END $$;

CREATE OR REPLACE FUNCTION public.fin_save_expense_category(_name text, _active boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin_user() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  INSERT INTO expense_categories(name, sort_order, is_active) VALUES (btrim(_name), 99, _active)
  ON CONFLICT (name) DO UPDATE SET is_active = EXCLUDED.is_active;
  INSERT INTO audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), 'save_expense_category', 'expense_categories', NULL, NULL, jsonb_build_object('name', _name, 'active', _active));
END $$;

-- Daily bell reminders 7 days / 1 day before a subscription is due
CREATE OR REPLACE FUNCTION public.fin_subscription_reminders() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; n int := 0;
BEGIN
  FOR s IN SELECT * FROM vendor_subscriptions WHERE status = 'active' AND next_due_date - current_date IN (7, 1) LOOP
    BEGIN
      INSERT INTO staff_notifications(notif_key, kind, title, detail, target, event_at)
      VALUES ('sub_due:' || s.id || ':' || s.next_due_date || ':' || (s.next_due_date - current_date), 'subscription',
        'Subscription due ' || CASE WHEN s.next_due_date - current_date = 1 THEN 'tomorrow' ELSE 'in 7 days' END,
        s.name || ' — ₹' || s.amount || ' on ' || to_char(s.next_due_date, 'DD Mon'), 'fin-expenses', now());
      n := n + 1;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.fin_save_expense(uuid,jsonb), public.fin_delete_expense(uuid), public.fin_save_subscription(uuid,jsonb),
  public.fin_mark_subscription_paid(uuid,text), public.fin_save_expense_category(text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_save_expense(uuid,jsonb), public.fin_delete_expense(uuid), public.fin_save_subscription(uuid,jsonb),
  public.fin_mark_subscription_paid(uuid,text), public.fin_save_expense_category(text,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.fin_subscription_reminders() FROM PUBLIC, anon, authenticated;

INSERT INTO public.tax_settings(key, label, rate_pct, is_active) VALUES ('instant_fee_gst', 'Instant settlement fee GST', 18, true)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.ops_settings(key, value, label) VALUES ('instant_settlement_fee_pct', '1', 'Instant settlement fee %') ON CONFLICT (key) DO NOTHING;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fin-subscription-reminders') THEN PERFORM cron.unschedule('fin-subscription-reminders'); END IF;
  PERFORM cron.schedule('fin-subscription-reminders', '30 3 * * *', 'SELECT public.fin_subscription_reminders()');
EXCEPTION WHEN OTHERS THEN NULL; END $$;