# Lucky Draw Enrolments — Sort & Filter on Table Headers

## Goal
Add the same sort/filter dropdowns used on other tables (Customers, Experts) to the Lucky Draw Enrolments table headers, so staff can sort/filter any column manually. Default view: highest referrals on top.

## Changes

### 1. `src/components/lucky-draw-page.tsx` — EnrolmentsTable
- Reuse the existing `useSortFilter` + `SortFilterHeader` from `@/components/table-sort-filter.tsx` (already used elsewhere in the app — no new component needed).
- Columns get sort/filter behaviour:
  - **Ticket No** — sortable (A→Z / Z→A), filterable by ticket code
  - **Full name** — sortable, filterable
  - **Phone** — sortable, filterable
  - **Type** — filterable (Signup / Ref bonus checklist)
  - **Referrals** — numeric sort (high→low / low→high), filterable
  - **Entries** — numeric sort, filterable
  - **Enrolled at** — sortable by date
- **Default sort: Referrals, high → low** (set as the initial sort state so the table opens with top referrers first; user can change or clear it).
- Search box and CSV export stay; CSV exports the currently sorted/filtered rows so the download matches what is on screen.
- "Reset sort & filters" button appears when any manual sort/filter is active.

## Technical notes
- `useSortFilter` takes an initial sort override (small tweak: allow passing a default `SortState`, or set sort state right after init inside EnrolmentsTable via `setSort({ key: "referrals", dir: "desc" })` in a `useEffect`/initial state).
- No database or RPC changes — purely a UI change on the already-loaded rows.
- Publish → Update required to see it live.
