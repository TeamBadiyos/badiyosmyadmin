# Services Cards — Perfect Alignment Fix

## Problem
Teeno service cards (Maid / Home Cleaning, Local Parcel, Car & Bike Wash) ek upar ek niche lag rahe hain:
- Card ki heights alag hain (Maid card me 3 tags do lines me wrap hote hain, baaki me ek line)
- Icon, "LIVE TODAY" badge, tags aur "Book on the app" link ki position har card me alag line par aa rahi hai
- Reveal wrapper stretch nahi hota, isliye `h-full` card ko poori row height nahi milti

## Fix (sirf `src/routes/index.tsx` — Services section)

1. **Equal height cards**
   - Grid par `items-stretch` (default) rakhenge, aur Reveal wrapper ko `h-full` denge taaki har card poori row ki height le.
   - Card article ko `flex flex-col h-full` banayenge.

2. **Content ko fixed slots me align karna**
   - Title ke liye `min-h` taaki lambe naam (2 line) aur chhote naam (1 line) me bhi description same line par shuru ho.
   - Description ko flexible rakhenge.
   - Tags row ko `min-h-[64px]` (do tag-lines ki jagah) denge — taaki teeno cards me divider line bilkul same height par aaye.
   - "Book on the app" CTA ko `mt-auto` se har card ke bottom par pin karenge — teeno cards me link bilkul ek line par dikhega.

3. **Kya nahi badlega**
   - Card ka design, colors, hover effect, badge, icon — sab waisa hi rahega.
   - Content, tags, descriptions same rahenge.
   - Mobile view (ek column) as-is rahega.

## Files
- `src/routes/index.tsx` — Services section ke card markup me alignment classes

## Verify
- Desktop preview me teeno cards same height, badge/title/tags/CTA ek line par.
- Typecheck pass.
