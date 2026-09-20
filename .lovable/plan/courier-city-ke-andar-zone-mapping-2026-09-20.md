# Courier — City ke andar Zone Mapping

Courier abhi sirf city level par on/off hota hai. Har active zone serviceable maana jaata hai, aur order banate waqt pickup/drop ki location check hi nahi hoti — is wajah se ek city se doosri city ka parcel bhi ban sakta hai.

## Kya banega

**Courier section me naya tab: "Zone Mapping"**

- Upar city ka dropdown (wahi cities jinke liye courier service flag hai).
- Us city ke saare zones checkbox list me — multiple select karke "Save mapping".
- Har zone ke saamne mapped / not mapped badge, aur "Select all" / "Clear" shortcuts.
- Jo zones map hain unhi me courier chalega; kisi city me ek bhi zone map na ho to us city me courier band mana jayega (aaj ke "sab allowed" behaviour ki jagah — ye screen par साफ warning me likha rahega).
- Write sirf Super Admin; Ops Manager ko read-only (buttons disabled), baaki roles ko tab dikhega hi nahi.

**Sirf local delivery (same city) enforcement**

Order banate waqt:

1. Pickup point aur drop point dono kisi mapped courier zone ke andar hone chahiye — warna साफ message: "Pickup/Drop location courier area ke bahar hai".
2. Dono zones ki city same honi chahiye, aur wahi city order ki city ho — alag city hui to: "Abhi sirf city ke andar hi parcel delivery hoti hai".

Ye check quote/booking dono jagah lagega, isliye customer ko pehle hi pata chal jayega.

## Technical details

- Table `public.courier_zones` (zone_id, is_active) pehle se hai aur khali hai — koi naya table nahi banega, isi me rows aayengi.
- Naya audited RPC `staff_courier_set_zones(_city text, _zone_ids uuid[])`: `courier_is_super_admin()` gate, us city ke mapping rows ko replace karta hai (missing zones `is_active=false`, selected `true`), aur `audit_logs` me before/after likhta hai.
- Read ke liye `courier.functions.ts` me `listCourierZoneMapping(city)` (zones + mapped flag) aur `saveCourierZoneMapping`.
- `courier_create_order` me validation add hogi: `point_in_polygon` se pickup aur drop ka zone resolve, dono mapped + active, dono ki `zones.city` same aur payload city ke barabar. Same check `courier_quote_internal` me ek optional coords branch ke saath, taaki quote stage par hi rok lage.
- `courier_check_serviceability` already mapping-aware hai — mapping rows aate hi automatically zone-scoped ho jayega.
- UI: `src/components/courier-page.tsx` me chhatha tab, existing Badiyos tokens (green #00B97A, Nunito Sans, 8pt grid) ke saath; `src/lib/courier.functions.ts` me naye server functions.

## Files

- `src/lib/courier.functions.ts` (naye functions)
- `src/components/courier-page.tsx` (Zone Mapping tab)
- Ek migration: `staff_courier_set_zones` + `courier_create_order` / `courier_quote_internal` me same-city validation
