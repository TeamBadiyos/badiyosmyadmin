# Command Center navigation restructure

## Goal
Reorganize the existing Command Center into the requested operational groups without changing any screen’s data, actions, server calls, permissions, or badge counts. Dashboard and Platform Settings > Services remain unchanged.

## Navigation structure

- **Dashboard** — Dashboard
- **Live Ops** — Emergency Alerts, Support Tickets
- **Clean** — Bookings, Service Catalogue, Task Types
- **Courier** — Orders, Rates, Parcel & Vehicle Types, Settings
- **Store** — Orders, Merchants, Categories
- **People** — Customers, Experts, Skill Approvals, Area Partners, Deletion Requests
- **Growth** — Offers & Campaigns, Referrals, Rewards, Homepage Builder, Waitlist, Business Leads
- **Finance** — Wallets & Payouts, Merchant Billing, Reports
- **Platform Settings** — Services, Zones, Dispatch Alerts, Notification Sounds, Legal, Roles & Permissions, Audit Logs

Each group will navigate directly to its first visible item when opened. If a role cannot access that first item, it will open the first item that role can access.

## Implementation

1. **Regroup existing destinations**
   - Keep all current navigation keys for existing screens so dashboard actions and notification targets continue to resolve.
   - Rename only visible labels where requested: Users → Customers, Merchant Approvals → Merchants, Store Categories → Categories, Business Interest → Business Leads.
   - Preserve the current role allow-list and derive group visibility from the same allowed keys.

2. **Expose Courier’s existing tabs as sidebar destinations**
   - Reuse the existing Courier Orders, Rates, Vehicle Types, Courier Types, Zone Mapping, and courier settings controls.
   - Courier > Orders opens the existing Live Orders view.
   - Courier > Rates opens the existing rate view.
   - Courier > Parcel & Vehicle Types presents exactly two tabs: Vehicle Types and Courier Types.
   - Courier > Settings presents the existing fail-wait/return-escalation settings card and Zone Mapping together.
   - Keep the same access check, read-only state, server calls, and mutations already used by Courier.
   - Retain the legacy `courier` destination as a compatibility alias that opens Courier > Orders, so old notification targets continue working.

3. **Add Store > Orders without removing it from Dashboard**
   - Reuse the existing Commerce Operations Kanban as a full-width Store Orders screen.
   - Keep the same live updates, filters/data scope, alert sound, attention badges, order details, reassign, and cancel/refund actions.
   - Leave the same Commerce Kanban on Dashboard, as requested.

4. **Preserve navigation compatibility and indicators**
   - Keep existing `bookings`, `experts`, `support`, `merchants`, `store-categories`, and other legacy keys intact.
   - Update group lookup/auto-expansion so notification targets open the same screen under its new group.
   - Preserve dashboard booking/expert shortcuts and selected-booking behavior.
   - Move the existing support ticket number and collapsed-group red dot from Platform Settings to Live Ops without changing how the count is calculated.

5. **Verify presentation-only behavior**
   - Verify every requested group opens its first role-visible item.
   - Verify super admin, ops manager, and area partner see exactly the screens allowed by today’s role map.
   - Verify Courier’s four destinations, Store Orders, old notification targets, dashboard shortcuts, support badges, and mobile sidebar behavior.
   - Confirm the preview build is clean and inspect the reorganized navigation in the authenticated preview.

## Final old → new mapping

| Current location | New location |
|---|---|
| Dashboard | Dashboard |
| Clean Services > Emergency Alerts | Live Ops > Emergency Alerts |
| Platform Settings > Support Tickets | Live Ops > Support Tickets |
| Clean Services > Bookings | Clean > Bookings |
| Clean Services > Service Catalogue | Clean > Service Catalogue |
| Clean Services > Task Types | Clean > Task Types |
| Courier & Parcels > Courier > Live Orders | Courier > Orders |
| Courier & Parcels > Courier > Rates | Courier > Rates |
| Courier & Parcels > Courier > Vehicle Types / Courier Types | Courier > Parcel & Vehicle Types |
| Courier & Parcels > Courier > courier settings card / Zone Mapping | Courier > Settings |
| Dashboard > Commerce Operations | Store > Orders, while also remaining on Dashboard |
| Stores & Merchants > Merchant Approvals | Store > Merchants |
| Stores & Merchants > Store Categories | Store > Categories |
| Customers & Growth > Users | People > Customers |
| Clean Services > Experts | People > Experts |
| Clean Services > Skill Approvals | People > Skill Approvals |
| Customers & Growth > Area Partners | People > Area Partners |
| Platform Settings > Deletion Requests | People > Deletion Requests |
| Customers & Growth > Offers & Campaigns | Growth > Offers & Campaigns |
| Customers & Growth > Referrals | Growth > Referrals |
| Customers & Growth > Rewards | Growth > Rewards |
| Platform Settings > Homepage Builder | Growth > Homepage Builder |
| Customers & Growth > Waitlist | Growth > Waitlist |
| Customers & Growth > Business Interest | Growth > Business Leads |
| Finance & Reports > Wallets & Payouts | Finance > Wallets & Payouts |
| Stores & Merchants > Merchant Billing | Finance > Merchant Billing |
| Finance & Reports > Reports | Finance > Reports |
| Platform Settings > Services | Platform Settings > Services |
| Platform Settings > Zones | Platform Settings > Zones |
| Courier & Parcels > Dispatch Alerts | Platform Settings > Dispatch Alerts |
| Platform Settings > Notification Sounds | Platform Settings > Notification Sounds |
| Platform Settings > Legal | Platform Settings > Legal |
| Platform Settings > Roles & Permissions | Platform Settings > Roles & Permissions |
| Platform Settings > Audit Logs | Platform Settings > Audit Logs |
