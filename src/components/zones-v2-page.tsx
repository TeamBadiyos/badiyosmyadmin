import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { useCity } from "@/lib/city-scope";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
type LL = { lat: number; lng: number };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GJ = { type: string; coordinates: any };
type Cell = { id: string; name: string; colour: string; area_m2: number; geom: GJ };
type State = { gap: GJ | null; gap_pct: number; overlap?: boolean; cells: Cell[]; old_zones: { id: string; name: string; geom: GJ }[] };
const COLOURS = ["#00B97A", "#3B82F6", "#F59E0B", "#EF4444", "#8B5CF6", "#06B6D4", "#EC4899", "#84CC16", "#F97316"];

const rings = (g: GJ | null): LL[][] => {
  if (!g) return [];
  const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return polys.map((p: any) => (p[0] as number[][]).slice(0, -1).map(([lng, lat]) => ({ lat, lng })));
};
const toPolygon = (path: LL[]): GJ => ({ type: "Polygon", coordinates: [[...path, path[0]].map((p) => [p.lng, p.lat])] });

export function ZonesV2Page({ role }: { role: string | null }) {
  return <ZoneEditor role={role} />;
}

function ZoneEditor({ role }: { role: string | null }) {
  const { city } = useCity();
  const cityId = city?.id ?? "";
  const qc = useQueryClient();
  const canEdit = role === "super_admin" || role === "ops_manager";
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
  const [drawing, setDrawing] = useState(false);
  const [dots, setDots] = useState<LL[]>([]);
  const [namingOpen, setNamingOpen] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [editPath, setEditPath] = useState<LL[] | null>(null);
  const [showGaps, setShowGaps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);

  const mapDiv = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const map = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const overlays = useRef<any[]>([]);
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;
  const editRef = useRef<LL[] | null>(null);
  const [ready, setReady] = useState(false);

  async function run(fn: string, args: Record<string, unknown>, ok?: string) {
    setBusy(true);
    try {
      const { data, error } = await db.rpc(fn, args);
      if (error) throw error;
      if (data && typeof data === "object" && "cells" in data) qc.setQueryData(key, data);
      else await qc.invalidateQueries({ queryKey: key });
      if (ok) toast.success(ok);
      return data ?? true;
    } catch (e) {
      toast.error((e as Error).message);
      return null;
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
        if (drawingRef.current) setDots((d) => [...d, { lat: e.latLng.lat(), lng: e.latLng.lng() }]);
      });
      setReady(true);
    }).catch((e) => toast.error(e.message));
    return () => { dead = true; };
  }, []);

  const fitted = useRef("");
  useEffect(() => {
    if (!ready || !st || fitted.current === cityId) return;
    const b = new window.google.maps.LatLngBounds();
    const pts = st.cells.length ? st.cells.flatMap((c) => rings(c.geom)).flat() : st.old_zones.flatMap((z) => rings(z.geom)).flat();
    pts.forEach((p) => b.extend(p));
    if (!b.isEmpty()) map.current.fitBounds(b);
    fitted.current = cityId;
  }, [ready, st, cityId]);

  useEffect(() => {
    if (!ready || !st) return;
    const g = window.google;
    overlays.current.forEach((o) => o.setMap(null));
    overlays.current = [];
    const add = <T,>(o: T) => { overlays.current.push(o); return o; };
    // live zones as faint reference until switch-over
    for (const z of st.old_zones) for (const r of rings(z.geom))
      add(new g.maps.Polygon({ map: map.current, paths: r, strokeColor: "#64748B", strokeOpacity: 0.4, strokeWeight: 1, fillOpacity: 0, clickable: false, zIndex: 1 }));
    for (const c of st.cells) {
      const isSel = c.id === sel;
      const rs = isSel && editPath ? [editPath] : rings(c.geom);
      for (const r of rs) {
        const p = add(new g.maps.Polygon({ map: map.current, paths: r, strokeColor: c.colour, strokeWeight: isSel ? 3 : 1.5, fillColor: c.colour, fillOpacity: isSel ? 0.35 : 0.2, editable: isSel && canEdit && !drawing, zIndex: isSel ? 3 : 2 }));
        p.addListener("click", (e: { latLng: { lat: () => number; lng: () => number } }) => {
          if (drawingRef.current) { setDots((d) => [...d, { lat: e.latLng.lat(), lng: e.latLng.lng() }]); return; }
          selectCell(c);
        });
        if (isSel && canEdit) {
          const path = p.getPath();
          const sync = () => { editRef.current = path.getArray().map((x: { lat: () => number; lng: () => number }) => ({ lat: x.lat(), lng: x.lng() })); };
          ["set_at", "insert_at", "remove_at"].forEach((ev) => path.addListener(ev, sync));
          p.addListener("rightclick", (e: { vertex?: number }) => { if (e.vertex != null && path.getLength() > 3) path.removeAt(e.vertex); });
        }
      }
    }
    if (showGaps && st.gap) for (const r of rings(st.gap))
      add(new g.maps.Polygon({ map: map.current, paths: r, strokeColor: "#DC2626", fillColor: "#DC2626", fillOpacity: 0.5, strokeWeight: 1, clickable: false, zIndex: 6 }));
    if (drawing && dots.length) {
      add(new g.maps.Polyline({ map: map.current, path: dots, strokeColor: "#0F172A", strokeWeight: 3, zIndex: 7, clickable: false }));
      dots.forEach((pt, i) => {
        const m = add(new g.maps.Marker({ map: map.current, position: pt, draggable: true, label: String(i + 1), zIndex: 8 }));
        m.addListener("dragend", () => setDots((d) => d.map((x, j) => (j === i ? { lat: m.getPosition().lat(), lng: m.getPosition().lng() } : x))));
        if (i === 0) m.addListener("click", () => { if (dots.length >= 3) setNamingOpen(true); });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, st, sel, dots, drawing, showGaps, editPath]);

  function selectCell(c: Cell) {
    setSel(c.id);
    const r = rings(c.geom)[0] ?? null;
    setEditPath(r); editRef.current = r;
  }
  function startNew() { setSel(null); setEditPath(null); setDots([]); setDrawing(true); }
  function cancelDraw() { setDrawing(false); setDots([]); setNamingOpen(false); }

  async function saveNew(name: string, colour: string) {
    const ok = await run("zv2_save_zone", { _city: cityId, _cell: null, _name: name, _colour: colour, _geojson: toPolygon(dots) }, "Zone saved");
    if (ok) cancelDraw();
  }
  async function saveSel(name: string, colour: string) {
    if (!sel) return;
    const p = editRef.current;
    if (!p || p.length < 3) return toast.error("A zone needs at least 3 points.");
    const ok = await run("zv2_save_zone", { _city: cityId, _cell: sel, _name: name, _colour: colour, _geojson: toPolygon(p) }, "Zone saved");
    if (ok) { const c = (ok as State).cells?.find((x) => x.id === sel); if (c) selectCell(c); }
  }
  async function deleteSel() {
    if (!sel || !confirm("Delete this zone?")) return;
    const ok = await run("zv2_delete_cell", { _cell: sel }, "Zone deleted");
    if (ok) { setSel(null); setEditPath(null); }
  }

  if (!cityId) return null;
  const selCell = st?.cells.find((c) => c.id === sel) ?? null;
  const nextColour = COLOURS[(st?.cells.length ?? 0) % COLOURS.length];

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && <Button size="sm" disabled={busy || drawing} onClick={startNew}>+ New zone</Button>}
          <Button size="sm" variant={showGaps ? "default" : "outline"} onClick={() => setShowGaps((v) => !v)}>Show gaps</Button>
        </div>
        {drawing && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted p-2 text-sm">
            Click on the map to add points ({dots.length}). Click point 1 to close the shape.
            <Button size="sm" disabled={dots.length < 3} onClick={() => setNamingOpen(true)}>Finish</Button>
            <Button size="sm" variant="ghost" disabled={!dots.length} onClick={() => setDots((d) => d.slice(0, -1))}>Remove last point</Button>
            <Button size="sm" variant="ghost" onClick={cancelDraw}>Cancel</Button>
          </div>
        )}
        <div ref={mapDiv} className="h-[620px] w-full rounded-lg border border-border bg-muted" />
        <p className="text-xs text-muted-foreground">Grey outlines are the current live zones (still in use until you switch over). Outside all zones = "Bring Badiyos" for customers.</p>
      </div>

      <div className="space-y-3">
        <div className="rounded-lg border border-border bg-card p-3 text-sm">
          <p className={`font-semibold ${st?.overlap ? "text-destructive" : "text-primary"}`}>{st?.overlap ? "Overlap found" : "No overlaps"}</p>
          <p className={st?.gap_pct ? "font-semibold text-destructive" : "text-muted-foreground"}>{st?.gap_pct ?? 0}% gaps{st?.gap_pct ? " — tap Show gaps" : ""}</p>
          <p className="mt-1 text-xs text-muted-foreground">On save, overlapping parts are trimmed and points within 50 m of a neighbour snap onto its edge.</p>
        </div>
        {selCell && canEdit && !drawing && (
          <ZoneForm key={selCell.id} title="Selected zone" initialName={selCell.name} initialColour={selCell.colour} busy={busy}
            hint="Drag points to move, drag mid-points to add, right-click a point to remove."
            onSave={saveSel} onDelete={deleteSel} onClose={() => { setSel(null); setEditPath(null); }} />
        )}
        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-3 py-2 text-sm font-semibold">New zones ({st?.cells.length ?? 0})</div>
          {!st?.cells.length && <p className="px-3 py-3 text-sm text-muted-foreground">No zones yet. Click "+ New zone".</p>}
          {st?.cells.map((c) => (
            <button key={c.id} onClick={() => selectCell(c)} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${c.id === sel ? "bg-muted" : ""}`}>
              <span className="h-3 w-3 rounded-sm" style={{ background: c.colour }} />
              <span className="flex-1">{c.name}</span>
              <span className="text-xs text-muted-foreground">{(c.area_m2 / 1e6).toFixed(2)} km²</span>
            </button>
          ))}
        </div>
        {role === "super_admin" && (
          <Button className="w-full" disabled={busy || !st?.cells.length} onClick={() => setSwitchOpen(true)}>Use these zones</Button>
        )}
      </div>
      {namingOpen && (
        <Dialog open onOpenChange={(o) => !o && setNamingOpen(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Name this zone</DialogTitle></DialogHeader>
            <ZoneForm initialName="" initialColour={nextColour} busy={busy} onSave={saveNew} onClose={() => setNamingOpen(false)} />
          </DialogContent>
        </Dialog>
      )}
      {switchOpen && <SwitchoverDialog cityId={cityId} cells={st?.cells ?? []} onClose={() => setSwitchOpen(false)} onDone={() => { setSwitchOpen(false); qc.invalidateQueries(); }} />}
    </div>
  );
}

function ZoneForm({ title, initialName, initialColour, busy, hint, onSave, onDelete, onClose }: {
  title?: string; initialName: string; initialColour: string; busy: boolean; hint?: string;
  onSave: (n: string, c: string) => void; onDelete?: () => void; onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [colour, setColour] = useState(initialColour);
  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3">
      {title && <div className="text-sm font-semibold">{title}</div>}
      <Input placeholder="Zone name, e.g. Ganj Golai" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      <div className="flex flex-wrap gap-1">
        {COLOURS.map((c) => (
          <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => setColour(c)} className={`h-6 w-6 rounded-full border-2 ${colour === c ? "border-foreground" : "border-transparent"}`} style={{ background: c }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || !name.trim()} onClick={() => onSave(name.trim(), colour)}>Save</Button>
        {onDelete && <Button size="sm" variant="outline" disabled={busy} onClick={onDelete}>Delete</Button>}
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
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
        <DialogHeader><DialogTitle>Use these zones: old zones → new zones</DialogTitle></DialogHeader>
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
