# Settings → Zones: one simple tab with one shared map

## Where things stand now
- Latur has 10 live zones in use. There are no new draft zones (the bad 7,200 km² draft is already gone) and no saved city area for any city.
- Latur is the only city.
- Split, Merge, Undo and Edit boundary are still in the database but not on screen. The Legacy zones tab and the separate Cities page still exist.

## What you will see

### Top: Zones
- One bar with: City dropdown, **+ New zone**, **Fill gaps**, **Show gaps**.
- One map, zoomed to the city. It always shows:
  - the city area as a thick dashed line
  - the current live zones as grey dashed outlines with their names, behind everything
  - the new zones in their own colours
- **If the city has no area yet**, the map shows "Draw the city area first" with a button to start drawing.
- **New zone**
  - Click points on the map, then click point 1 to close the shape.
  - While drawing you see the point count and area in km², with **Remove last point** and **Cancel**.
  - Then enter a name and colour and **Save**.
  - On save, any part outside the city area or overlapping another zone is trimmed automatically (no error).
  - Points within 50 m of a neighbouring zone's edge, or of the city edge, snap onto that edge. This stops thin slivers and gaps between zones.
- **Tap a zone** to rename it, change its colour, or drag, add and remove points (same trim and snap on save).
  - **Delete**: if experts or partners use the zone, you are asked "Move to…" first.
- **Zone On/Off**
  - The toggle is in the zone list and on the selected zone.
  - Only super admin and ops manager can use it. Every change is logged.
  - You can add an optional reason and an optional "turn back on at" date/time; the zone switches back on by itself then.
  - Off zones show hatched grey with an "Off" tag and still count as covered.
  - **Customers** in an Off zone can browse but cannot book or order. They see "We're not serving your area right now" / "सध्या तुमच्या भागात सेवा बंद आहे" with **Notify me**, which is saved to Demand with source "zone off".
  - **Existing bookings and orders** continue as normal.
  - **Stores** inside an Off zone stop getting new orders.
  - **Experts and riders** are not offered new jobs inside an Off zone.
- **Fill gaps**
  - Each empty piece inside the city is joined to the neighbouring zone it shares the longest edge with.
  - You see a preview first, then **Apply**. Or choose **Make it a new zone** for that piece.
- **Right panel**
  - City area in km², covered %, and gaps in km². **Show** highlights the gaps in red.
  - Zone list: colour, name, km², On/Off toggle. Tap a zone to select it.
  - **Use these zones** works only at 100% coverage.
    - It first shows how old zones map to new ones for experts, partners and zone-based settings, for your approval.
    - Then it switches over. Past bookings and orders keep their saved zone, and the old zones keep working until then.

### Bottom: Cities
- List of cities: name, status (Live / Coming soon), area km², number of zones, and **Edit area** or **Draw area**.
- **+ Add city**: name and state, then draw its area.
- Drawing or editing a city area uses the SAME map above.
  - A bar shows "Drawing city area: Latur · Save · Cancel". You click, drag, add and remove points, with an optional **Load OpenStreetMap boundary** as a starting point.
  - After saving, that city is selected in the top dropdown.
- The city area is the service area. Any address outside it shows "Bring badiyos" in the Customer App.

## What gets removed
- Split line, Merge, Confirm split, Undo, Edit boundary and Border around current zones.
- The Old zones checkbox, the Legacy zones tab and Review switch-over.
- The separate city-border step and the old Cities page. Cities move into this tab.
- Any leftover draft zones or city border. There are none today.

## After switch-over
- The Customer App, Expert/Rider offers, store ordering and every zone lookup use the city area, the new zones and the On/Off state.
- Before switch-over, lookups keep using the current 10 live zones.

## Technical details
- **Server**
  - `zv2_save_boundary` (city area): requires a closed ring, keeps a 2,000 m² minimum and a 2,000 km² maximum, and is audited. City area km² comes from `city_boundaries`.
  - `zv2_save_zone`: clip to the city boundary (`ST_Intersection`), then the existing overlap trim, then a 50 m `ST_Snap` to neighbours and to the boundary.
  - New `zv2_fill_gaps_preview` / `zv2_fill_gaps_apply(_mode)`: gap = `ST_Difference(boundary, union)`. Each gap is merged into the neighbour with the longest shared edge (`ST_Length(ST_Intersection(ST_Boundary...))`), or created as a new cell.
  - `zv2_state` returns the boundary, its area, covered %, gap km² and each cell's on/off state.
  - Delete: `zv2_delete_cell(_cell, _move_to)` remaps references first.
  - Switch-over is blocked unless coverage is 100%.
- **On/Off**
  - New columns on zones and draft cells: `is_off`, `off_reason`, `off_until`, `off_by`.
  - RPC `staff_set_zone_off(_id, _off, _reason, _until)` is audited and allowed for super_admin/ops_manager only.
  - An auto-on sweep runs every minute (pg_cron) and turns zones back on when `off_until` has passed.
  - `zone_lookup` adds `is_off` and returns `outside` when the point is outside `city_boundaries` (once a boundary exists).
  - Guards are added to the booking, store order and parcel create triggers; existing rows are untouched.
  - Expert/rider offer and broadcast filters skip jobs inside Off zones.
  - The commerce home/listing and `app_store_live` hide stores in Off zones.
  - New `app_zone_status(lat,lng)` returns the bilingual message for the Customer App. Notify me is saved to Demand with source `zone_off`.
- **UI**
  - Rewrite `src/components/zones-v2-page.tsx` as one shared map in two modes (zone / city area), with a Cities list below.
  - Remove the Legacy zones tab, the old `zones-page` entry and the Cities nav entry from Settings.
  - Off zones use a hatched style (an SVG pattern overlay, or grey fill plus an "Off" label marker).
- **Customer App**
  - It must call `app_zone_status` (or read `is_off` from `zone_lookup`) and show the Off message. The function names will be listed after the build.
