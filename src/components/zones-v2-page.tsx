import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { useCity } from "@/lib/city-scope";
import { snapLineToRoads } from "@/lib/zones-v2.functions";
import { ZonesPage } from "@/components/zones-page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
type LL = { lat: number; lng: number };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GJ = { type: string; coordinates: any };
type Cell = { id: string; name: string; colour: string; area_m2: number; geom: GJ };
type State = { boundary: GJ | null; gap: GJ | null; gap_pct: number; undo_count: number; cells: Cell[]; old_zones: { id: string; name: string; geom: GJ }[] };
type Mode = "view" | "boundary" | "draw" | "split" | "merge";

// Convex hull (monotone chain) — wraps all given points in one outer border.
function hull(pts: LL[]): LL[] {
  const a = [...pts].sort((p, q) => p.lng - q.lng || p.lat - q.lat);
  if (a.length < 3) return a;
  const cr = (o: LL, p: LL, q: LL) => (p.lng - o.lng) * (q.lat - o.lat) - (p.lat - o.lat) * (q.lng - o.lng);
  const lo: LL[] = [], up: LL[] = [];
  for (const p of a) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of a.reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

const rings = (g: GJ | null): LL[][] => {
  if (!g) return [];
  const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return polys.map((p: any) => (p[0] as number[][]).slice(0, -1).map(([lng, lat]) => ({ lat, lng })));
};
const toPolygon = (path: LL[]): GJ => ({ type: "Polygon", coordinates: [[...path, path[0]].map((p) => [p.lng, p.lat])] });

export function ZonesV2Page({ role }: { role: string | null }) {
  const [tab, setTab] = useState<"new" | "legacy">("new");
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-border bg-card p-1">
        {(["new", "legacy"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1.5 text-sm font-semibold ${tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
            {t === "new" ? "Zone map (split)" : "Legacy zones"}
          </button>
        ))}
      </div>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      {tab === "new" ? <SplitEditor role={role} /> : <ZonesPage role={role as any} />}
    </div>
  );
}

function SplitEditor({ role }: { role: string | null }) {
  const { city } = useCity();
  const cityId = city?.id ?? "";
  const qc = useQueryClient();
  const canEdit = role === "super_admin" || role === "ops_manager";
  const snap = useServerFn(snapLineToRoads);
  const key = ["zones-v2", cityId];
  const q = useQuery({
    queryKey: key,
    enabled: !!cityId,
    queryFn: async () => {
      const { data, error } = await db.rpc("zv2_state", { _city: cityId });
      if (error) throw error;
      return data as State;
    },
  });
  const st = q.data;
  const [mode, setMode] = useState<Mode>("view");
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draftBoundary, setDraftBoundary] = useState<LL[] | null>(null);
  const [clicks, setClicks] = useState<LL[]>([]);
  const [dots, setDots] = useState<LL[]>([]);
  const [line, setLine] = useState<LL[]>([]);
  const [snapNote, setSnapNote] = useState<string | null>(null);
  const [showOld, setShowOld] = useState(true);
  const [switchOpen, setSwitchOpen] = useState(false);

  const mapDiv = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const map = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const overlays = useRef<any[]>([]);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [ready, setReady] = useState(false);

  async function run(fn: string, args: Record<string, unknown>, ok?: string) {
    setBusy(true);
    try {
      const { data, error } = await db.rpc(fn, args);
      if (error) throw error;
      if (data && typeof data === "object" && "cells" in data) qc.setQueryData(key, data);
      else await qc.invalidateQueries({ queryKey: key });
      if (ok) toast.success(ok);
      return data;
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let dead = false;
    loadGoogleMaps().then(() => {
      if (dead || !mapDiv.current) return;
      const g = window.google;
      map.current = new g.maps.Map(mapDiv.current, { center: { lat: 18.4088, lng: 76.5604 }, zoom: 13, clickableIcons: false, mapTypeControl: false, streetViewControl: false });
      map.current.addListener("click", (e: { latLng: { lat: () => number; lng: () => number } }) => {
        if (modeRef.current === "draw") setDots((d) => [...d, { lat: e.latLng.lat(), lng: e.latLng.lng() }]);
        else if (modeRef.current === "split") setClicks((c) => [...c, { lat: e.latLng.lat(), lng: e.latLng.lng() }]);
      });
      setReady(true);
    }).catch((e) => toast.error(e.message));
    return () => { dead = true; };
  }, []);

  // fit to city once
  const fitted = useRef("");
  useEffect(() => {
    if (!ready || !st || fitted.current === cityId) return;
    const g = window.google;
    const b = new g.maps.LatLngBounds();
    const pts = st.cells.length > 1 ? st.cells.flatMap((c) => rings(c.geom)).flat() : st.old_zones.flatMap((z) => rings(z.geom)).flat();
    pts.forEach((p) => b.extend(p));
    if (!b.isEmpty()) map.current.fitBounds(b);
    else { map.current.setCenter({ lat: 18.4088, lng: 76.5604 }); map.current.setZoom(13); }
    fitted.current = cityId;
  }, [ready, st, cityId]);

  // snap line whenever clicked points change
  useEffect(() => {
    if (clicks.length < 2) { setLine(clicks); return; }
    let live = true;
    snap({ data: { points: clicks } }).then((r) => { if (live) { setLine(r.path); setSnapNote(r.note); } }).catch((e) => toast.error(e.message));
    return () => { live = false; };
  }, [clicks, snap]);

  // draw everything
  useEffect(() => {
    if (!ready || !st) return;
    const g = window.google;
    overlays.current.forEach((o) => o.setMap(null));
    overlays.current = [];
    const add = <T,>(o: T) => { overlays.current.push(o); return o; };
    if (showOld) for (const z of st.old_zones) for (const r of rings(z.geom))
      add(new g.maps.Polygon({ map: map.current, paths: r, strokeColor: "#64748B", strokeOpacity: 0.5, strokeWeight: 1, fillOpacity: 0.04, clickable: false, zIndex: 1 }));
    if (mode === "boundary" && draftBoundary) {
      const p = add(new g.maps.Polygon({ map: map.current, paths: draftBoundary, editable: true, strokeColor: "#0F172A", strokeWeight: 2, fillOpacity: 0.05, zIndex: 5 }));
      const sync = () => setDraftBoundaryQuiet(p.getPath().getArray().map((x: { lat: () => number; lng: () => number }) => ({ lat: x.lat(), lng: x.lng() })));
      ["set_at", "insert_at", "remove_at"].forEach((ev) => p.getPath().addListener(ev, sync));
      p.addListener("rightclick", (e: { vertex?: number }) => { if (e.vertex != null && p.getPath().getLength() > 3) p.getPath().removeAt(e.vertex); });
    } else for (const r of rings(st.boundary))
      add(new g.maps.Polyline({ map: map.current, path: [...r, r[0]], strokeColor: "#0F172A", strokeWeight: 3, zIndex: 4, clickable: false }));
    for (const c of st.cells) for (const r of rings(c.geom)) {
      const isSel = c.id === sel;
      const p = add(new g.maps.Polygon({ map: map.current, paths: r, strokeColor: c.colour, strokeWeight: isSel ? 3 : 1.5, fillColor: c.colour, fillOpacity: isSel ? 0.35 : 0.18, editable: isSel && mode === "view" && canEdit, zIndex: isSel ? 3 : 2 }));
      p.addListener("click", (e: { latLng: { lat: () => number; lng: () => number } }) => {
        if (modeRef.current === "split") { setClicks((cl) => [...cl, { lat: e.latLng.lat(), lng: e.latLng.lng() }]); return; }
        if (modeRef.current === "merge" && sel && sel !== c.id) { setMode("view"); run("zv2_merge", { _a: sel, _b: c.id }, "Zones merged"); return; }
        setSel(c.id);
      });
      if (isSel && mode === "view" && canEdit) {
        const path = p.getPath();
        const orig = r.map((x) => ({ ...x }));
        // moving an existing corner moves it in every neighbouring zone too
        path.addListener("set_at", (i: number) => {
          const o = orig[i]; const n = path.getAt(i);
          if (!o) return;
          run("zv2_move_point", { _city: cityId, _old_lat: o.lat, _old_lng: o.lng, _lat: n.lat(), _lng: n.lng() }, "Border moved");
        });
        path.addListener("insert_at", () => {
          const pts = path.getArray().map((x: { lat: () => number; lng: () => number }) => ({ lat: x.lat(), lng: x.lng() }));
          run("zv2_set_cell_geom", { _cell: c.id, _geojson: toPolygon(pts) }, "Shape updated");
        });
      }
    }
    if (st.gap) for (const r of rings(st.gap))
      add(new g.maps.Polygon({ map: map.current, paths: r, strokeColor: "#DC2626", fillColor: "#DC2626", fillOpacity: 0.45, strokeWeight: 1, clickable: false, zIndex: 6 }));
    if (mode === "draw" && dots.length) {
      add(new g.maps.Polyline({ map: map.current, path: dots.length > 2 ? [...dots, dots[0]] : dots, strokeColor: "#0F172A", strokeWeight: 3, zIndex: 7, clickable: false }));
      dots.forEach((pt, i) => {
        const m = add(new g.maps.Marker({ map: map.current, position: pt, draggable: true, label: String(i + 1), zIndex: 8 }));
        m.addListener("dragend", () => setDots((d) => d.map((x, j) => (j === i ? { lat: m.getPosition().lat(), lng: m.getPosition().lng() } : x))));
      });
    }
    if (mode === "split") {
      if (line.length) add(new g.maps.Polyline({ map: map.current, path: line, strokeColor: "#DC2626", strokeWeight: 3, zIndex: 7, clickable: false }));
      clicks.forEach((pt, i) => {
        const m = add(new g.maps.Marker({ map: map.current, position: pt, draggable: true, label: String(i + 1), zIndex: 8 }));
        m.addListener("dragend", () => setClicks((cl) => cl.map((x, j) => (j === i ? { lat: m.getPosition().lat(), lng: m.getPosition().lng() } : x))));
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, st, sel, mode, line, clicks, dots, showOld, draftBoundary === null]);

  // keep boundary edits without redrawing on every drag
  const boundaryRef = useRef<LL[] | null>(null);
  function setDraftBoundaryQuiet(p: LL[]) { boundaryRef.current = p; }

  function startDraw() { setDots([]); setDraftBoundary(null); setMode("draw"); }
  function wrapOldZones() {
    const pts = (st?.old_zones ?? []).flatMap((z) => rings(z.geom)).flat();
    if (pts.length < 3) return toast.error("No current zones to wrap.");
    setDots(hull(pts)); setMode("draw");
    toast.success("Border drawn around current zones — drag dots to adjust.");
  }
  async function saveDots() {
    if (dots.length < 3) return toast.error("Place at least 3 dots.");
    if (st?.cells.length && !confirm("This replaces the old border and all draft zones with one city zone. Continue?")) return;
    const ok = await run("zv2_save_boundary", { _city: cityId, _geojson: toPolygon(dots), _source: "manual", _reset: true }, "City border saved — now split it into zones");
    if (ok) { setMode("view"); setDots([]); fitted.current = ""; }
  }
  function editBoundary() {
    const r = rings(st?.boundary ?? null)[0];
    if (!r) return toast.error("No saved boundary yet — load a draft first.");
    setDraftBoundary(r); boundaryRef.current = r; setMode("boundary");
  }
  async function saveBoundary(reset: boolean) {
    const p = boundaryRef.current;
    if (!p || p.length < 3) return;
    if (reset && st?.cells.length && !confirm("This replaces all draft zones with one city zone. Continue?")) return;
    const ok = await run("zv2_save_boundary", { _city: cityId, _geojson: toPolygon(p), _source: draftBoundary ? "osm+edited" : "manual", _reset: reset }, "City boundary saved");
    if (ok) { setMode("view"); setDraftBoundary(null); fitted.current = ""; }
  }
  async function confirmSplit() {
    if (!sel) return toast.error("Pick the zone to split first.");
    if (line.length < 2) return;
    const ok = await run("zv2_split", { _cell: sel, _line: { type: "LineString", coordinates: line.map((p) => [p.lng, p.lat]) } }, "Zone split into two");
    if (ok) { setClicks([]); setLine([]); setMode("view"); }
  }

  if (!cityId) return null;
  const selCell = st?.cells.find((c) => c.id === sel) ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && <>
            <Button size="sm" variant={mode === "draw" ? "default" : "outline"} disabled={busy} onClick={startDraw}>Draw city border</Button>
            <Button size="sm" variant="outline" disabled={busy || !st?.old_zones.length} onClick={wrapOldZones}>Border around current zones</Button>
            <Button size="sm" variant="outline" disabled={busy || !st?.boundary} onClick={editBoundary}>Edit boundary</Button>
            <Button size="sm" variant={mode === "split" ? "default" : "outline"} disabled={busy || !st?.cells.length} onClick={() => { setMode(mode === "split" ? "view" : "split"); setClicks([]); }}>Split line</Button>
            <Button size="sm" variant={mode === "merge" ? "default" : "outline"} disabled={busy || !sel} onClick={() => setMode(mode === "merge" ? "view" : "merge")}>Merge</Button>
            <Button size="sm" variant="outline" disabled={busy || !st?.undo_count} onClick={() => run("zv2_undo", { _city: cityId }, "Undone")}>Undo</Button>
          </>}
          <label className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            <input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} /> Old zones
          </label>
        </div>
        {mode === "boundary" && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted p-2 text-sm">
            Drag corners, drag mid-points to add, right-click a corner to remove.
            <Button size="sm" disabled={busy} onClick={() => saveBoundary(false)}>Save boundary</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => saveBoundary(true)}>Save & start as one zone</Button>
            <Button size="sm" variant="ghost" onClick={() => { setMode("view"); setDraftBoundary(null); }}>Cancel</Button>
          </div>
        )}
        {mode === "draw" && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted p-2 text-sm">
            Click on the map to place dots around Latur city ({dots.length} placed). Drag a dot to move it.
            <Button size="sm" disabled={busy || dots.length < 3} onClick={saveDots}>Save border</Button>
            <Button size="sm" variant="ghost" disabled={!dots.length} onClick={() => setDots((d) => d.slice(0, -1))}>Remove last dot</Button>
            <Button size="sm" variant="ghost" disabled={!dots.length} onClick={() => setDots([])}>Clear</Button>
            <Button size="sm" variant="ghost" onClick={() => { setMode("view"); setDots([]); }}>Cancel</Button>
          </div>
        )}
        {mode === "split" && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted p-2 text-sm">
            {sel ? <>Splitting <b>{selCell?.name}</b>. Click points across it, starting and ending outside the zone. Drag numbered points to adjust.</> : "Select a zone first, then click points."}
            {snapNote && <span className="text-xs text-destructive">{snapNote}</span>}
            <Button size="sm" disabled={busy || line.length < 2 || !sel} onClick={confirmSplit}>Confirm split</Button>
            <Button size="sm" variant="ghost" onClick={() => setClicks((c) => c.slice(0, -1))}>Remove last point</Button>
          </div>
        )}
        {mode === "merge" && <div className="rounded-md border border-border bg-muted p-2 text-sm">Click the neighbouring zone to merge into <b>{selCell?.name}</b>.</div>}
        <div ref={mapDiv} className="h-[620px] w-full rounded-lg border border-border bg-muted" />
      </div>

      <div className="space-y-3">
        <div className="rounded-lg border border-border bg-card p-3 text-sm">
          {!st?.boundary ? <p className="text-muted-foreground">No city border yet. Click "Draw city border" and place dots around the city.</p>
            : st.gap_pct > 0 ? <p className="font-semibold text-destructive">{st.gap_pct}% of the city is in no zone (red on map)</p>
            : <p className="font-semibold text-primary">Whole city covered · no overlaps</p>}
          <p className="mt-1 text-xs text-muted-foreground">Overlaps are rejected by the server. Pieces under 2,000 m² merge into the neighbour automatically.</p>
        </div>
        {selCell && canEdit && <CellEditor key={selCell.id} cell={selCell} busy={busy} onSave={(n, c) => run("zv2_update_cell", { _cell: selCell.id, _name: n, _colour: c }, "Zone saved")} />}
        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-3 py-2 text-sm font-semibold">Draft zones ({st?.cells.length ?? 0})</div>
          {st?.cells.map((c) => (
            <button key={c.id} onClick={() => setSel(c.id)} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${c.id === sel ? "bg-muted" : ""}`}>
              <span className="h-3 w-3 rounded-sm" style={{ background: c.colour }} />
              <span className="flex-1">{c.name}</span>
              <span className="text-xs text-muted-foreground">{(c.area_m2 / 1e6).toFixed(2)} km²</span>
            </button>
          ))}
        </div>
        {role === "super_admin" && (
          <Button className="w-full" disabled={busy || !st?.cells.length || (st?.gap_pct ?? 1) > 0} onClick={() => setSwitchOpen(true)}>Review switch-over</Button>
        )}
      </div>
      {switchOpen && <SwitchoverDialog cityId={cityId} cells={st?.cells ?? []} onClose={() => setSwitchOpen(false)} onDone={() => { setSwitchOpen(false); qc.invalidateQueries(); }} />}
    </div>
  );
}

function CellEditor({ cell, busy, onSave }: { cell: Cell; busy: boolean; onSave: (n: string, c: string) => void }) {
  const [name, setName] = useState(cell.name);
  const [colour, setColour] = useState(cell.colour);
  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3">
      <div className="text-sm font-semibold">Selected zone</div>
      <Input value={name} onChange={(e) => setName(e.target.value)} />
      <div className="flex items-center gap-2">
        <input type="color" value={colour} onChange={(e) => setColour(e.target.value)} className="h-9 w-12 rounded border border-input" />
        <Button size="sm" disabled={busy} onClick={() => onSave(name, colour)}>Save</Button>
      </div>
      <p className="text-xs text-muted-foreground">Drag a corner on the map to move the shared border; both neighbours update together.</p>
    </div>
  );
}

type PRow = { old_id: string; old_name: string; suggested: string | null; experts: number; expert_zones: number; partners: number; staff: number; courier_zones: number; merchants: number; alerts: number; bookings: number };
function SwitchoverDialog({ cityId, cells, onClose, onDone }: { cityId: string; cells: Cell[]; onClose: () => void; onDone: () => void }) {
  const q = useQuery({
    queryKey: ["zones-v2-preview", cityId],
    queryFn: async () => {
      const { data, error } = await db.rpc("zv2_switchover_preview", { _city: cityId });
      if (error) throw error;
      return data as { rows: PRow[]; experts_without_location: number };
    },
  });
  const [map, setMap] = useState<Record<string, string>>({});
  useEffect(() => {
    if (q.data) setMap(Object.fromEntries(q.data.rows.map((r) => [r.old_id, r.suggested ?? cells[0]?.id ?? ""])));
  }, [q.data, cells]);
  const [busy, setBusy] = useState(false);
  async function apply() {
    if (!confirm("Activate the new zones and disable the old ones? Past bookings keep their saved zone.")) return;
    setBusy(true);
    const { data, error } = await db.rpc("zv2_switchover_apply", { _city: cityId, _mapping: map });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`New zones live: ${data.new_zones} zones · ${data.experts} experts · ${data.partners} partners · ${data.merchants} stores remapped`);
    onDone();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader><DialogTitle>Switch-over: old zones → new zones</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Experts are remapped by their last known location (falls back to this table). Partners, staff, courier areas and stores follow this table.
          Past bookings and orders keep their saved zone. {q.data?.experts_without_location ? `${q.data.experts_without_location} experts have no location and will use this table.` : ""}
        </p>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr>
              <th className="p-2">Old zone</th><th>Experts</th><th>Expert areas</th><th>Partners</th><th>Staff</th><th>Courier</th><th>Stores</th><th>Alerts</th><th>Bookings (kept)</th><th>New zone</th>
            </tr></thead>
            <tbody>
              {q.data?.rows.map((r) => (
                <tr key={r.old_id} className="border-t border-border">
                  <td className="p-2 font-semibold">{r.old_name}</td><td>{r.experts}</td><td>{r.expert_zones}</td><td>{r.partners}</td><td>{r.staff}</td><td>{r.courier_zones}</td><td>{r.merchants}</td><td>{r.alerts}</td><td>{r.bookings}</td>
                  <td>
                    <select value={map[r.old_id] ?? ""} onChange={(e) => setMap((m) => ({ ...m, [r.old_id]: e.target.value }))} className="h-8 rounded border border-input bg-background px-1">
                      {cells.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !q.data} onClick={apply}>Approve & activate</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
