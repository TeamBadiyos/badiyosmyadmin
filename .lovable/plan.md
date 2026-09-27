# Seal Sticker batch PDF download

## What will change

- Add **Download PDF** beside **Export CSV** on every Seal Stickers batch row.
- Show it to both `super_admin` and `ops_manager`, matching the existing batch export permission.
- Keep the existing CSV export unchanged.

## Download dialog

- Pre-fill **From** and **To** with the batch's complete serial range.
- Allow editing only within that batch and reject reversed, missing, or out-of-range values.
- Enforce a maximum of **5,000 stickers per PDF** and show the selected sticker count.
- Add label-size choices: **25 × 50 mm portrait** (default) and **38 × 50 mm portrait**.
- Add colour choices: **Green** (default) and **Black**.
- Show generation progress and disable closing/restarting the action while the file is being assembled.

## PDF generation

- Fetch the source rows through the existing `staff_seal_batch_export` wrapper, then filter the selected serial range in the browser.
- Generate one portrait label per PDF page using jsPDF.
- Build every QR from `qr_payload` with error correction **H**, using vector module squares rather than a raster QR image.
- Lay out only these centred elements, top to bottom:
  1. small medium-weight lowercase `badiyos`
  2. bold `printed_text`, fitted to the available width
  3. the largest QR that fits with about 1.5 mm side margins and its required quiet zone
- Green mode: QR `#007A52`, brand text `#0CB37B`, number `#111111`, original-colour app icon.
- Black mode: QR/text/number pure black, with the app icon rendered as a black `b` on white.
- Place the icon inside a padded white rounded square, capped at 20% of QR width so it never touches QR modules.
- Load/embed the app icon once per document and reuse the same PDF image resource on every page.
- Yield between small page batches so the interface remains responsive, updating the progress bar after each batch.
- Download as `badiyos-seal-batch-<no>-<from>-<to>-<25x50|38x50>-<green|black>.pdf`.

## Code organization

- Add the browser-compatible `jspdf`, `qrcode`, and `jsqr` packages.
- Keep PDF geometry, QR matrix drawing, logo conversion, and filename construction in a focused client-side sticker PDF utility.
- Keep the dialog and row action in the existing Seal Stickers screen.
- Record the client-side PDF-generation decision in the project architecture notes.

## Verification

- Generate a three-sticker PDF sample for each label size and both colour modes.
- Render the generated pages to images and visually inspect spacing, text fit, portrait dimensions, logo placement, quiet zone, and colour treatment.
- Decode every rendered QR in both Green and Black modes with jsQR and confirm each decoded value exactly equals its source `qr_payload`.
- Check the 5,000-label limit, invalid ranges, progress updates, final filenames, and that CSV export still works.
- Verify both super admins and ops managers can open the PDF dialog, while existing Create Batch and Assign permissions remain unchanged.
