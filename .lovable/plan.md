# Services placement cleanup

## What will change

1. **Platform Settings navigation**
   - Rename **System Settings** to **Platform Settings**.
   - Add **Services** as its first item.
   - Keep the existing single `/dashboard` Command Center route and current role visibility model: super admin and ops manager can open Services; area partners cannot.

2. **New Services screen**
   - Add a city selector, defaulting to **Latur**, using the cities already returned by the existing service-control data.
   - Add two tabs:
     - **Service Controls**
     - **Capacity Messages**
   - Service Controls shows one card each for **Clean**, **Store**, and **Courier** for the selected city.
   - Reuse the existing controls and calls without changing their business rules:
     - **Show in app** for Clean and Store uses the matching `segments.is_active` value and the existing segment toggle function.
     - Courier shows **“Opens from the Send Parcel button”** with no segment toggle.
     - Status, English/Marathi note, resume time, hours enabled, weekly hours, holidays, Close today, and Reopen use the existing service-control components and RPC wrappers.
   - Preserve each control’s current authorization and disabled/read-only behavior; no permission checks will be widened or narrowed.
   - Add the two requested state warnings:
     - Segment off + service status otherwise live: **“Customers cannot see this service in the app”**.
     - Segment on + status not live: **“Visible in app but not taking orders”**.
   - Keep the existing shared status preset/undo and customer-state preview available on the Services screen so moving the controls does not remove existing functionality.

3. **Capacity Messages placement**
   - The live `capacity_messages` table has no service identifier or relationship; it only has message key, text, city, active state, and timestamps.
   - Therefore, reuse the existing Capacity Messages list unchanged as the **Capacity Messages** tab on Services.
   - Remove its standalone item from **Courier & Parcels**.

4. **Courier cleanup**
   - Remove the **Service Toggle** tab and its old rendering from Courier.
   - Leave Vehicle Types, Rates, Courier Types, Zone Mapping, Live Orders, courier settings, and all their existing calls unchanged.

5. **Service Catalogue cleanup**
   - Filter the existing Service Catalogue presentation to the **badiyos Clean** segment only, including its preview data.
   - Do not delete or modify the Store or Courier segment rows.
   - Keep all Clean category/service/price/availability editing behavior and existing RPCs unchanged.

6. **Requested category cleanup**
   - Apply one narrowly scoped database migration after rechecking references inside the migration.
   - **Kirana & Grocery** (`service_categories.id = ed016233-40e8-483f-a664-cb6ba86bd883`, current slug `demo`) has 0 services, 0 catalogue-price rows, 0 bookings, 0 partner skills, and 0 courier-vehicle references, so delete this row.
   - **Courier Delivery** (`service_categories.id = 250ebe17-dfc8-4d9b-95ef-1f60a9372142`) has 0 services but is referenced by **4 partner skills** and **1 courier vehicle type**, so do not delete it; set `is_active = false` instead.
   - No schema, RPC, segment row, service row, or permission changes.

## Verification

- Check Services as super admin and ops manager, including city switching, warnings, status/hours/holiday/close controls, and capacity-message tab.
- Confirm Courier opens without Service Toggle and retains all remaining tabs.
- Confirm Service Catalogue renders only badiyos Clean and its existing edits still work.
- Confirm the database result: Kirana & Grocery removed; Courier Delivery retained but inactive with all five references intact.
- Check desktop and mobile layouts and verify the current preview build has no errors.
