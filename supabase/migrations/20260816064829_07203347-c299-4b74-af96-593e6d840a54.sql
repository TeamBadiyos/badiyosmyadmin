
GRANT SELECT ON public.legal_pages TO anon;
GRANT SELECT, INSERT, UPDATE ON public.legal_pages TO authenticated;
GRANT ALL ON public.legal_pages TO service_role;

ALTER TABLE public.legal_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read active legal pages" ON public.legal_pages;
CREATE POLICY "Public can read active legal pages"
ON public.legal_pages FOR SELECT
TO anon, authenticated
USING (is_active = true);

DROP POLICY IF EXISTS "Staff can read all legal pages" ON public.legal_pages;
CREATE POLICY "Staff can read all legal pages"
ON public.legal_pages FOR SELECT
TO authenticated
USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

DROP POLICY IF EXISTS "Staff can insert legal pages" ON public.legal_pages;
CREATE POLICY "Staff can insert legal pages"
ON public.legal_pages FOR INSERT
TO authenticated
WITH CHECK (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

DROP POLICY IF EXISTS "Staff can update legal pages" ON public.legal_pages;
CREATE POLICY "Staff can update legal pages"
ON public.legal_pages FOR UPDATE
TO authenticated
USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']))
WITH CHECK (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

CREATE OR REPLACE FUNCTION public.staff_upsert_legal_page(_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _staff_id uuid;
  _slug text := _payload->>'slug';
  _id uuid;
  _before jsonb;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF _slug IS NULL OR length(trim(_slug)) = 0 THEN
    RAISE EXCEPTION 'slug is required';
  END IF;

  SELECT id INTO _staff_id FROM public.staff_users WHERE auth_user_id = auth.uid();
  SELECT to_jsonb(l) INTO _before FROM public.legal_pages l WHERE l.slug = _slug;

  INSERT INTO public.legal_pages (slug, title, content, effective_date, is_active, updated_by, last_updated_at)
  VALUES (
    _slug,
    coalesce(_payload->>'title', _slug),
    coalesce(_payload->>'content', ''),
    nullif(_payload->>'effective_date','')::date,
    coalesce((_payload->>'is_active')::boolean, true),
    _staff_id,
    now()
  )
  ON CONFLICT (slug) DO UPDATE SET
    title = excluded.title,
    content = excluded.content,
    effective_date = excluded.effective_date,
    is_active = excluded.is_active,
    updated_by = excluded.updated_by,
    last_updated_at = now()
  RETURNING id INTO _id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  SELECT auth.uid(), CASE WHEN _before IS NULL THEN 'legal_page_create' ELSE 'legal_page_update' END,
         'legal_pages', _id, _before, to_jsonb(l)
  FROM public.legal_pages l WHERE l.id = _id;

  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.staff_upsert_legal_page(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_upsert_legal_page(jsonb) TO authenticated, service_role;

INSERT INTO public.legal_pages (slug, title, effective_date, content) VALUES
('privacy-policy', 'Privacy Policy', '2026-08-15', '# Privacy Policy

_Draft starter content — replace from Command Center > Legal._

## 1. Introduction
Badiyos ("we", "us") respects your privacy. This policy explains what personal information we collect when you use the Badiyos website and apps, how we use it, and the choices you have.

## 2. Information we collect
- Account details such as your name, phone number and email address.
- Service addresses, location data and landmark photos used to deliver a booking.
- Booking, payment and transaction records.
- Device information and app usage data used to keep the service secure and reliable.

## 3. How we use your information
We use your information to create and manage your account, assign and dispatch service partners, process payments and refunds, provide customer support, prevent fraud, and comply with legal obligations.

## 4. Sharing
We share only what is necessary with assigned service partners, payment processors and other service providers, or where required by law. We do not sell your personal data.

## 5. Data retention and security
We retain information for as long as your account is active or as required by law, and protect it with industry-standard technical and organisational safeguards.

## 6. Your rights
You may access, correct or delete your account information, and opt out of promotional communications, by contacting us through the app or our support page.

## 7. Contact
For privacy questions, reach us via the Badiyos support page.'),
('terms', 'Terms & Conditions', '2026-08-15', '# Terms & Conditions

_Draft starter content — replace from Command Center > Legal._

## 1. Acceptance
By using the Badiyos website or apps, you agree to these Terms & Conditions.

## 2. Our role
Badiyos is a technology platform that connects customers with independent service partners and merchants. Services are performed by those partners.

## 3. Bookings and pricing
Prices, service durations and applicable taxes are shown before you confirm a booking. Additional time or services may be charged separately.

## 4. Payments
Payments are collected online at the time of booking through our payment partners. Receipts are available in the app.

## 5. Customer responsibilities
You agree to provide accurate address and contact details, safe access to the service location, and respectful conduct toward service partners.

## 6. Cancellations and refunds
Cancellations and refunds are governed by our Refund & Cancellation Policy.

## 7. Limitation of liability
To the extent permitted by law, Badiyos is not liable for indirect or consequential losses arising from use of the platform.

## 8. Changes
We may update these terms; the effective date above reflects the latest version.

## 9. Governing law
These terms are governed by the laws of India.'),
('refund-policy', 'Refund & Cancellation Policy', '2026-08-15', '# Refund & Cancellation Policy

_Draft starter content — replace from Command Center > Legal._

## 1. Cancelling a booking
You can cancel a booking from the Badiyos app at any time before the service begins.

## 2. Cancellation charges
- Free cancellation shortly after booking and before a partner is dispatched.
- A partial cancellation fee may apply once a partner has been assigned and is en route.
- No refund is available once the service has started.

The exact fee applicable to your booking is shown in the app before you confirm the cancellation.

## 3. Refund processing
Approved refunds are issued to your original payment method. Refunds are typically processed within 5–7 business days, subject to your bank or payment provider.

## 4. Service quality issues
If a service was not delivered as promised, contact support within 48 hours. We may offer a re-service, partial refund or full refund after review.

## 5. Contact
For refund queries, reach us via the Badiyos support page.'),
('shipping-policy', 'Shipping & Delivery Policy', '2026-08-15', '> **Note:** Product/catalog delivery is not yet live on badiyos — this policy will apply once those categories launch.

# Shipping & Delivery Policy

_Draft starter content — replace from Command Center > Legal._

## 1. Service delivery
For home services, "delivery" means the arrival of an assigned Badiyos service partner at your chosen address within the selected time slot.

## 2. Product delivery (upcoming)
When product and merchant catalog categories launch, orders will be delivered to the address provided at checkout by the merchant or their delivery partner.

## 3. Delivery timelines
Estimated delivery windows are shown at checkout. Timelines may vary due to weather, traffic, serviceability limits or other conditions outside our control.

## 4. Delivery charges
Any applicable delivery fee is displayed before payment and may be borne by the merchant or the customer depending on the merchant''s settings.

## 5. Serviceable areas
Delivery is available only in areas currently serviceable by Badiyos. You can check serviceability in the app by entering your address.

## 6. Contact
For delivery queries, reach us via the Badiyos support page.')
ON CONFLICT (slug) DO NOTHING;
