# Fix: live site shows "This page didn't load"

## What is happening
- The preview works, but the **published site** (badiyos.com, including /dashboard and the scheduled booking-expiry job) has failed every request since about 13:36 UTC today, right after the latest publish.
- The server crashes while starting up, before any page loads. The live server logs show the same error every time: the startup code asks for a file location the live server doesn't provide (`createRequire(undefined)` inside the bundled runtime file).
- This is not a database or store-permission problem. The changes made a few minutes earlier only touched permissions and deleted Gaurav Mart, and they cannot break startup.

## Plan
1. **Find the source:** Create a production build in the sandbox and search the bundled server files for `createRequire` / `import.meta.url`. Then trace which add-on or file brought it into the server bundle. The main suspect is a PDF/zip helper (jspdf → fflate) or another browser-only library that a recently added server-side file now imports.
2. **Fix it:** Keep that library out of the server bundle. Either load it only in the browser, where it is actually used, or move the shared code so server files no longer import it. No features change.
3. **Check it:** Rebuild for production, confirm the bundle no longer contains the bad `createRequire` call, and confirm /, /auth and /dashboard load in the local preview.
4. **Republish:** Ask you to publish again, then check the live server logs to confirm badiyos.com loads and the booking-expiry job returns 200 again.

## Quick workaround while this is fixed
If the site has to be back up right away, restore the previous published version from History. The last version that worked is the one published before 13:36 UTC.

## Technical details
- Error: `TypeError: The argument 'path' ... Received 'undefined' at createRequire (node:module) at _runtime.mjs:1:743` on all worker requests (content hash 1b9a71d8...).
- Do not set `ssr.external` or `resolve.external`. Fix by changing the import graph (dynamic `import()` inside browser-only code paths) instead.
