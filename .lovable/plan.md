# Service Hours — Service Toggle tab ke andar

Courier → Service Toggle tab me neeche ek naya "Service Hours" section jodenge. Yeh sirf Command Center ka UI hai. Tables aur RPC Customer App project ke plan me ban rahe hain — unke naam wahi se lekar yahan wire karenge (jab tak naam confirm nahi hote, screen read-only placeholder dikhayegi, koi guess kiya hua RPC call nahi karenge).

## Kya dikhega

City chunne ke baad har service (courier + baaki services) ka ek card:

1. **Weekly hours** — Somvar se Ravivar, har din ke liye open aur close time, ek "band" switch (us din service nahi), aur last-order cutoff time (close se pehle aakhri order kab tak liya jaye).
2. **Holiday calendar** — date chuno, reason English aur Marathi dono me likho, add karo. Neeche list me sab holidays, har row par edit aur hatao.
3. **Aaj band rakho** — ek bada button: turant aaj ke liye band, reason maango (English + Marathi). Band hone par wahi button "Wapas kholo" ban jata hai, saath me kab tak band hai woh dikhega.
4. **Customer message box** — after-hours par customer ko jo text dikhega, English aur Marathi dono. Alag-alag text: band hai, holiday hai, aur aaj band rakha hai.
5. **Impact count** — koi bhi band karne wala action (din band, holiday, aaj band) save karne se pehle confirm dialog: us service + city me abhi chal rahe orders aur aage schedule hue bookings ki ginti, "kuch delete nahi hoga" wali line ke saath.
6. **Customer ko kya dikhega preview** — ek preview panel jo abhi ke hisaab se dikhata hai: service khuli hai ya band, agla khulne ka time, aur wahi message jo customer app me aayega. Language toggle (English / मराठी) aur "kisi aur time par test karo" ke liye date-time picker.

## Access

- super_admin: sab kuch badal sakta hai.
- ops_manager: sirf dekh sakta hai — sab switch, buttons aur form disabled.
- Baaki roles: section dikhega hi nahi (jaise abhi Courier section).

Har save staff RPC se jayega aur audit_logs me before/after ke saath record hoga — yeh RPC ke andar hota hai, direct table write kahin nahi.

## Technical notes

- Naya file `src/components/courier/service-hours-section.tsx`, aur server functions `src/lib/service-hours.functions.ts` (authenticated, `requireSupabaseAuth`, role resolve wahi pattern jo `courier.functions.ts` me hai).
- Customer App project se chahiye: table/column naam aur in RPC ke exact naam —
  - weekly hours upsert (service, city, weekday, open, close, closed flag, last-order cutoff)
  - holiday add / update / delete (date, reason_en, reason_mr)
  - "closed today" set / clear (reason_en, reason_mr)
  - after-hours message upsert (3 message types × 2 languages)
  - current status read (open/closed + next open time) — preview aur customer app dono isi ko use karenge
- Impact count ke liye naya RPC nahi: existing `bookings` aur `courier_orders` par scoped count query, wahi tareeka jo Service Toggle ke confirm dialog me pehle se hai.
- Preview client-side calculate nahi karega — wahi status RPC call karega taaki customer app aur admin ek hi jawab dikhayein.
- Styling existing Command Center tokens: Badiyos Green #00B97A, Nunito Sans, 8pt grid, wahi card/switch/modal patterns.

## Build order

1. Customer App se RPC naam confirm.
2. Server functions + role gating.
3. UI section (weekly hours → holidays → aaj band → messages → preview).
4. Ops manager read-only aur audit verify.
