# Category suggestions from merchants

## How things are today
- Items have a fixed category (`category_id`) and a free-text label typed by the merchant (`category_label`).
- **81 items have no category at all.** They only have free-text labels, about 28 different ones: "Bags", "Disposable Plates & Food Packaging", "Jewelari", "Kitchen use"…
- 50 items are in a real category (Snacks & Namkeen) and still carry old labels such as "Namkeen" and "Upvas". Those need no action.
- There is no "suggestion" record yet. From now on, an item saved under "Other" (or with no category) plus a typed name counts as a suggestion.

## 1. Suggestions chip (Store → Categories, Food → Categories)
- A "Suggestions (N)" chip opens a list with one row per merchant and suggested name. Each row shows the merchant, the suggested name, the number of items using it, and the latest date.
- **Create as new category:** the EN name is filled in from the suggestion, and you add मराठी and an icon. It's created for the merchant's city (Default if they have no city).
- **Map to existing:** pick a category from that service's list.
- Either way, that merchant's items in Other / no category with that name move to the chosen category. The suggestion is marked Done, and the merchant gets an in-app and push notification: "Your category '<name>' is now '<category>'".
- **Reject** (reason required): the items stay in Other, and the merchant is notified with the reason. The same name from the same merchant doesn't come back unless they type it again on a new item.
- Super admin and ops manager can act on suggestions. Every action is audited.

## 2. Clean-up of existing free-text categories
- A one-time "Review old categories" list, shown under the same chip. It groups the current free-text labels (trimmed, capital letters ignored), with service, item count and number of merchants.
- Each row gets a suggested category from the new lists. Matching is by name similarity plus a few keyword rules (Disposable… → Disposable & Packaging / Pooja items, Jewelari → Jewellery, Grocery → Grocery & Staples). If nothing fits, the suggestion is "Other".
- You can change any suggestion and tick rows, then press "Apply selected". Items move, and merchants are notified the same way.
- Nothing moves until you approve it.

## Technical section
- New table `category_suggestions` (merchant_id, service, city_id, label, norm_label, status pending/created/mapped/rejected, target_category_id, reason, decided_by/at, timestamps). Unique (merchant_id, service, norm_label) while pending. Grants, RLS: staff read, plus the cc_city_scope and cc_reader_all policies.
- Trigger on `products` insert/update: when the category is Other or missing and the label isn't blank, add or refresh a pending suggestion. The service comes from the merchant's service type.
- RPCs (SECURITY DEFINER, staff role check, audited): `staff_list_category_suggestions(_service)`, `staff_resolve_category_suggestion(_id, _mode create|map, _target_id, _name_en, _name_mr, _image_path)`, `staff_reject_category_suggestion(_id, _reason)`, `staff_legacy_label_mapping(_service)` (with the suggested target), `staff_apply_label_mapping(_rows jsonb)`.
- Item moves are a direct category update, so they don't create a merchant approval. Notifications go through `party_notifications` and the existing push sender.
- Backfill: create pending suggestions for the 81 uncategorised items so they show up in both lists.
- UI: chip and dialog inside the shared `category-manager.tsx`, so Store and Food get the same screen. Server fns go in `categories.functions.ts`.
- The Merchant App needs no change for now. It already saves the label. It can later show the notification.
