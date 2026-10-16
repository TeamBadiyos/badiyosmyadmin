# Zones v2 — split system (no overlaps, no gaps)

Today: 10 live zones, all in Latur, stored as free-drawn point lists (no geometry engine). PostGIS is available but not yet switched on. Zone is referenced by: bookings, courier orders, business batches, courier zone mapping, dispatch alerts, expert home zones (single + multi), experts, merchants, area partners, public store listing, staff zones.

## What staff will see (Settings → Zones, one city at a time)

**Step 1 — City boundary**
- "Load draft boundary" pulls the city's municipal outline from OpenStreetMap.
- Staff drag / add / remove corners, then Save. Old zones show as a faint grey layer underneath.
- Outside this outline = outside service area (Customer App shows "Bring badiyos").

**Step 2 — Split into zones**
- The draft city starts as one zone.
- Pick a zone, click points to draw a split line; between clicks the line follows roads (Google road snapping). Points stay draggable before confirming.
- Confirm → the zone becomes two zones sharing the exact same border. Repeat as needed.

**Step 3 — Edit**
- Drag a shared border point → both neighbours change together.
- Merge two neighbouring zones, rename, set colour.
- Undo last change (step-by-step history for the draft).

**Step 4 — Guards (enforced by the server, not just the screen)**
- Any save that creates overlap is rejected with a clear message.
- Uncovered parts inside the city shown in red with "X% of the city is in no zone"; Activate stays disabled until 0%.
- Pieces smaller than 2,000 m² are merged into the neighbour that shares the longest border, automatically.
- A point exactly on a border belongs to the nearest zone centre (deterministic, one answer).

**Step 5 — Switch-over (needs your approval)**
- "Review switch-over" screen lists everything using zones with counts: expert home zones, area partners, staff zones, courier zone mapping, merchants/stores, zone-based alerts and reports.
- Shows an old → new mapping table (suggested by largest area overlap; you can change each row).
- On Approve: new zones go live, experts are remapped by their home location (experts without a home location are listed for manual pick), partners/staff/courier mapping follow the approved table, past bookings and orders keep their saved zone untouched, old zones are disabled (kept for history, not deleted).

**Step 6 — Lookup for all apps**
- One function: lat/lng → city + zone, or "outside". Used by Customer, Expert and Merchant apps and by Command Center.

Every change (boundary save, split, border move, merge, rename, colour, sliver merge, activation, remap) is written to the audit log with before/after.

## Technical details

- Enable `postgis`. Add `geom geometry(MultiPolygon,4326)` + `colour`, `version`, `is_draft` to zones; add `city_boundaries (city_id, geom, source, saved_by)`; `zone_drafts` / `zone_draft_history` for undo; `zone_switchover_mappings` for the approval table. Grants + RLS + `cc_city_scope` + `cc_reader_all` as per project rules. Keep legacy `boundary` jsonb mirrored from geom so existing readers keep working.
- Server RPCs (SECURITY DEFINER, super_admin/ops_manager, audited): `zone_city_boundary_save`, `zone_split(zone, line)` using `ST_Split` on the shared draft so both halves share identical vertices, `zone_move_shared_vertex`, `zone_merge` (`ST_Union`, must `ST_Touches`), `zone_draft_undo`, `zone_draft_validate` (overlap via `ST_Overlaps/ST_Intersection` area > 0, gap = `ST_Difference(city, ST_Union(zones))` area %, sliver auto-merge < 2000 m² using `geography` area), `zone_switchover_preview`, `zone_switchover_apply` (super_admin only).
- Topology: zones are stored as a coverage of the city; snapping with `ST_SnapToGrid` + `ST_Snap` before save so borders match exactly.
- `zone_lookup(lat,lng)` public RPC returning only city id/name + zone id/name or `outside`; ties broken by `ST_Distance` to centroid. Existing `point_in_polygon` callers (courier checks, `app_city_for_location`, dispatch) switched to it.
- OSM fetch: server function calling Nominatim (polygon_geojson) with Overpass fallback, proper User-Agent, staff-only.
- Road snap: server function via Google Maps gateway (Routes API compute route between consecutive clicked points, decode polyline); Roads API not required. Needs the Google Maps connector linked (currently the map uses a custom GOOGLE_API_KEY browser key — the server calls need the connector).
- UI: new `zones-v2` editor in `src/components/` replacing the Zones tab body; old list stays reachable as "Legacy zones" until switch-over.
- Record in AGENTS.md: zones are a PostGIS coverage per city; all zone lookups go through `zone_lookup`.

## Open points

- Experts' home location source must be confirmed during build; experts without one go to the manual list.
- Google road snapping costs per request; it only runs while staff draw lines.
