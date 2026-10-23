
CREATE OR REPLACE FUNCTION public.phone_std(_p text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE d text;
BEGIN
  IF _p IS NULL OR btrim(_p) = '' OR _p ~ '[A-Za-z]' THEN RETURN _p; END IF;
  d := regexp_replace(_p, '\D', '', 'g');
  IF d ~ '^[6-9][0-9]{9}$' THEN RETURN '+91' || d; END IF;
  IF d ~ '^91[6-9][0-9]{9}$' THEN RETURN '+' || d; END IF;
  IF d ~ '^0[6-9][0-9]{9}$' THEN RETURN '+91' || substr(d, 2); END IF;
  RETURN _p;
END $$;

CREATE OR REPLACE FUNCTION public.trg_phone_std() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE j jsonb := to_jsonb(NEW); c text; v text;
BEGIN
  FOREACH c IN ARRAY TG_ARGV LOOP
    v := j->>c;
    IF v IS NOT NULL AND public.phone_std(v) IS DISTINCT FROM v THEN
      j := jsonb_set(j, ARRAY[c], to_jsonb(public.phone_std(v)));
    END IF;
  END LOOP;
  NEW := jsonb_populate_record(NEW, j);
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.trg_phone_std() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phone_std(text) TO authenticated, service_role;

ALTER TABLE public.vehicles DROP CONSTRAINT IF EXISTS vehicles_customer_phone_check;
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT conname FROM pg_constraint WHERE conrelid='public.vehicles'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%customer_phone%' LOOP
    EXECUTE format('ALTER TABLE public.vehicles DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_customer_phone_check CHECK (customer_phone ~ '^\+91[6-9][0-9]{9}$') NOT VALID;

DO $$
DECLARE
  spec text[][] := ARRAY[
    ['users','phone'],['experts','phone'],['merchants','phone'],['merchant_staff','phone'],
    ['waitlist_requests','phone'],['courier_orders','customer_phone,pickup_contact_phone,drop_contact_phone'],
    ['courier_order_stops','contact_phone'],['merchant_orders','customer_phone'],['customer_invoices','customer_phone'],
    ['offline_sales','customer_phone'],['vehicles','customer_phone'],['business_pickup_points','contact_phone'],
    ['business_receivers','contact_phone'],['partners','phone'],['staff_users','phone'],['expert_applications','phone'],
    ['expert_leads','phone'],['business_interest_leads','phone'],['city_interest_leads','phone'],
    ['account_deletion_requests','phone'],['merchant_referral_invites','phone'],['suggestions','phone'],
    ['agreements','accepted_phone'],['internal_testers','phone'],['merchant_bank_change_requests','verified_phone']];
  i int; tbl text; cols text[]; c text; trg record; enabled text[]; setlist text; wherelist text; args text;
BEGIN
  FOR i IN 1..array_length(spec,1) LOOP
    tbl := spec[i][1]; cols := string_to_array(spec[i][2], ',');
    enabled := ARRAY(SELECT t.tgname FROM pg_trigger t WHERE t.tgrelid = format('public.%I',tbl)::regclass AND NOT t.tgisinternal AND t.tgenabled <> 'D');
    FOREACH c IN ARRAY enabled LOOP EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER %I', tbl, c); END LOOP;
    setlist := ''; wherelist := ''; args := '';
    FOREACH c IN ARRAY cols LOOP
      setlist := setlist || CASE WHEN setlist='' THEN '' ELSE ', ' END || format('%1$I = public.phone_std(%1$I)', c);
      wherelist := wherelist || CASE WHEN wherelist='' THEN '' ELSE ' OR ' END || format('%1$I IS DISTINCT FROM public.phone_std(%1$I)', c);
      args := args || CASE WHEN args='' THEN '' ELSE ', ' END || quote_literal(c);
    END LOOP;
    EXECUTE format('UPDATE public.%I SET %s WHERE %s', tbl, setlist, wherelist);
    FOREACH c IN ARRAY enabled LOOP EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER %I', tbl, c); END LOOP;
    EXECUTE format('DROP TRIGGER IF EXISTS a00_phone_std ON public.%I', tbl);
    EXECUTE format('CREATE TRIGGER a00_phone_std BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.trg_phone_std(%s)', tbl, args);
  END LOOP;
END $$;

-- Phone matching that compared all digits now compares the last 10 digits.
DO $$
DECLARE f text; def text; nd text;
BEGIN
  def := pg_get_functiondef('public.merchant_verify_pin_internal(text,text)'::regprocedure);
  nd := replace(def, $q$WHERE regexp_replace(coalesce(phone,''), '\D', '', 'g') = v_phone$q$, $q$WHERE right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 10) = right(v_phone, 10)$q$);
  IF nd = def THEN RAISE EXCEPTION 'merchant_verify_pin_internal pattern not found'; END IF;
  EXECUTE nd;

  def := pg_get_functiondef('public.merchant_claim_staff_invite()'::regprocedure);
  nd := replace(def, $q$where regexp_replace(coalesce(ms.phone, ''), '\D', '', 'g') = _phone$q$, $q$where right(regexp_replace(coalesce(ms.phone, ''), '\D', '', 'g'), 10) = _phone$q$);
  IF nd = def THEN RAISE EXCEPTION 'merchant_claim_staff_invite pattern not found'; END IF;
  EXECUTE nd;

  SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p WHERE p.proname='business_upsert_receiver' AND p.pronamespace='public'::regnamespace;
  nd := replace(def, 'contact_phone=_ph and is_active', 'public.business_phone10(contact_phone)=_ph and is_active');
  IF nd = def THEN RAISE EXCEPTION 'business_upsert_receiver pattern not found'; END IF;
  EXECUTE nd;

  SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p WHERE p.proname='business_set_receiver_active' AND p.pronamespace='public'::regnamespace;
  nd := replace(def, 'contact_phone=_r.contact_phone', 'public.business_phone10(contact_phone)=public.business_phone10(_r.contact_phone)');
  IF nd = def THEN RAISE EXCEPTION 'business_set_receiver_active pattern not found'; END IF;
  EXECUTE nd;
END $$;
