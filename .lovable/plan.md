# Editable zone boundaries

Right now the zone map only offers "Start Redraw", which throws away the current shape and forces staff to click a whole new polygon. Small corrections should be possible by dragging the existing boundary.

## What changes for staff

In the boundary dialog for a zone there will be two ways to work:

- **Edit Shape** (new, default suggestion): the current blue boundary becomes directly adjustable. Staff can drag any corner, drag the small mid-points to add a new corner, and right-click a corner to delete it. The whole shape can also be dragged to shift it slightly.
- **Start Redraw** (unchanged): wipes the shape and draws a fresh one from scratch.

While editing:
- A live counter shows the number of corners and the area change versus the saved shape (for example "Area +4%").
- **Reset** restores the saved boundary if the edits go wrong.
- **Save Boundary** stores the adjusted shape; the existing >50% area-change confirmation still applies.
- Cancel/close discards edits without saving.

The dialog title and helper text change to reflect editing versus redrawing. Nothing about zone IDs, bookings or expert assignments changes — same as today, only the shape is updated.

## Technical notes

Scope: `src/components/zones-page.tsx`, `RedrawBoundaryModal` only. No backend changes — `redrawZoneBoundary` already accepts a point array.

- Add a mode state: `view | edit | redraw`.
- In `edit` mode set `editable: true, draggable: true` on the existing-boundary polygon (`existingPolyRef`) and keep it as the source of truth; attach `insert_at`, `set_at`, `remove_at` listeners on its path plus `dragend` to refresh point count and area.
- `extractBoundary()` reads from whichever polygon is active (edited existing polygon or newly drawn one).
- Save enablement: `edit` mode requires >= 3 points; `redraw` mode keeps the existing finish-drawing requirement.
- Reset rebuilds the polygon from the cached `existing` query data.
- Starting Redraw from edit mode discards edits and clears listeners; clean up all added listeners in the effect teardown.
- Rename the trigger/title to "Edit Boundary" with Redraw available inside.
