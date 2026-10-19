import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { useCity } from "@/lib/city-scope";
import { fetchOsmCityBoundary } from "@/lib/zones-v2.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
type LL = { lat: number; lng: number };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GJ = { type: string; coordinates: any };
type ZoneType = "core" | "outer" | "not_serviceable";
type Cell = { id: string; name: string; colour: string; area_m2: number; geom: GJ; is_off: boolean; off_reason: string | null; off_until: string | null; live: boolean;
  zone_type?: ZoneType; travel_fee?: number; travel_fee_services?: string[]; expert_share_pct?: number; is_active?: boolean; partner?: string | null };
const TYPE_COLOUR: Record<ZoneType, string> = { core: "#16A34A", outer: "#F97316", not_serviceable: "#94A3B8" };
const TYPE_LABEL: Record<ZoneType, string> = { core: "Core", outer: "Outer", not_serviceable: "Not serviceable" };
type State = {
  boundary: GJ | null; city_area_km2: number | null; gap: GJ | null; gap_pct: number; gap_km2: number; covered_pct: number | null;
  overlap?: boolean; switched: boolean; cells: Cell[]; old_zones: { id: string; name: string; geom: GJ }[];
};
type CityRow = { id: string; name: string; state: string; status: string; area_km2: number | null; zones: number; live_zones: number };
type Mode = { kind: "idle" } | { kind: "zone" } | { kind: "city"; cityId: string; name: string } | { kind: "pocket"; cell: string };
type PocketRow = { cell: string; pockets: LL[][]; fee: number };
type TrimHit = { id: string; name: string; lose_m2: number; partner: string | null };
const COLOURS = ["#00B97A", "#3B82F6", "#F59E0B", "#EF4444", "#8B5CF6", "#06B6D4", "#EC4899", "#84CC16", "#F97316"];
const OFF_GREY = "#64748B";

const rings = (g: GJ | null): LL[][] => {
  if (!g) return [];
  const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return polys.map((p: any) => (p[0] as number[][]).slice(0, -1).map(([lng, lat]) => ({ lat, lng })));
};
const toPolygon = (path: LL[]): GJ => ({ type: "Polygon", coordinates: [[...path, path[0]].map((p) => [p.lng, p.lat])] });
/** Approximate area in km² (good enough for a live hint while drawing). */
function areaKm2(path: LL[]) {
  if (path.length < 3) return 0;
  const lat0 = (path.reduce((s, p) => s + p.lat, 0) / path.length) * (Math.PI / 180);
  const xy = path.map((p) => [p.lng * 111.32 * Math.cos(lat0), p.lat * 110.57]);
  let a = 0;
  for (let i = 0; i < xy.length; i++) { const [x1, y1] = xy[i]; const [x2, y2] = xy[(i + 1) % xy.length]; a += x1 * y2 - x2 * y1; }
  return Math.abs(a) / 2;
}
const centre = (r: LL[]) => ({ lat: r.reduce((s, p) => s + p.lat, 0) / r.length, lng: r.reduce((s, p) => s + p.lng, 0) / r.length });
const errMsg = (e: unknown) => (e as { message?: string })?.message ?? "Something went wrong";

export function ZonesV2Page({ role }: { role: string | null }) {
  return <ZoneEditor role={role} />;
}

function ZoneEditor({ role }: { role: string | null }) {
  const { city, cities, setCityId } = useCity();
  const cityId = city?.id ?? "";
  const qc = useQueryClient();
  // Drawing/editing zones and city areas is super admin only; Ops can only turn zones On/Off.
  const canEdit = role === "super_admin";
  const canToggle = role === "super_admin" || role === "ops_manager";
  const key = ["zones-v2", cityId];
  const q = useQuery({
    queryKey: key, enabled: !!cityId,
    queryFn: async () => { const { data, error } = await db.rpc("zv2_state", { _city: cityId }); if (error) throw error; return data as State; },
  });
  const citiesQ = useQuery({
    queryKey: ["zones-v2-cities"],
    queryFn: async () => { const { data, error } = await db.rpc("zv2_cities"); if (error) throw error; return data as CityRow[]; },
  });
  const st = q.data;
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [dots, setDots] = useState<LL[]>([]);
  const [namingOpen, setNamingOpen] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [showGaps, setShowGaps] = useState(false);
  const [showOuter, setShowOuter] = useState(false);
  const [busy, setBusy] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [fillOpen, setFillOpen] = useState(false);
  const [offFor, setOffFor] = useState<Cell | null>(null);
  const [deleteFor, setDeleteFor] = useState<{ cell: Cell; total: number } | null>(null);
  const [addCity, setAddCity] = useState(false);
  const [showPins, setShowPins] = useState(false);
  const [trimFor, setTrimFor] = useState<{ cell: string; name: string; colour: string; geo: GJ; hits: TrimHit[] } | null>(null);
  const outsideQ = useQuery({
    queryKey: ["zones-outside", cityId], enabled: !!cityId && canToggle,
    queryFn: async () => {
      const { data, error } = await db.rpc("zv2_outside_zone_bookings", { _city: cityId });
      if (error) throw error;
      return data as { policy: "allow" | "allow_outer" | "block"; pins: { id: string; number: string | null; lat: number; lng: number; at: string }[] };
    },
  });
  const pocketsQ = useQuery({
    queryKey: ["zones-pockets", cityId], enabled: !!cityId && canToggle,
    queryFn: async () => {
      const { data, error } = await db.rpc("zv2_outer_pockets", { _city: cityId });
      if (error) throw error;
      return (data ?? []) as PocketRow[];
    },
  });
  const pocketsOf = (cell: string) => pocketsQ.data?.find((p) => p.cell === cell) ?? null;
  async function savePockets(cell: string, pockets: LL[][], fee: number) {
    setBusy(true);
    const { error } = await db.rpc("staff_set_zone_outer_pockets", { _cell: cell, _pockets: pockets, _fee: fee });
    setBusy(false);
    if (error) { toast.error(errMsg(error)); return false; }
    toast.success("Outer areas saved");
    await qc.invalidateQueries({ queryKey: ["zones-pockets", cityId] });
    return true;
  }
  async function finishPocket() {
    if (mode.kind !== "pocket" || dots.length < 3) return toast.error("Place at least 3 points");
    const cur = pocketsOf(mode.cell);
    if (await savePockets(mode.cell, [...(cur?.pockets ?? []), dots], cur?.fee ?? 20)) cancelDraw();
  }
  async function setPolicy(p: string) {
    const { error } = await db.rpc("staff_set_outside_zone_policy", { _city: cityId, _policy: p });
    if (error) return toast.error(errMsg(error));
    toast.success("Saved");
    qc.invalidateQueries({ queryKey: ["zones-outside", cityId] });
  }
  const osm = useServerFn(fetchOsmCityBoundary);

  const mapDiv = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const map = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const overlays = useRef<any[]>([]);
  const drawingRef = useRef(false);
  drawingRef.current = mode.kind !== "idle";
  const editRef = useRef<LL[] | null>(null);
  const [ready, setReady] = useState(false);
  const refreshAll = () => { qc.invalidateQueries({ queryKey: ["zones-v2-cities"] }); };

  async function run(fn: string, args: Record<string, unknown>, ok?: string) {
    setBusy(true);
    try {
      const { data, error } = await db.rpc(fn, args);
      if (error) throw error;
      if (data && typeof data === "object" && "cells" in data) qc.setQueryData(key, data);
      else await qc.invalidateQueries({ queryKey: key });
      refreshAll();
      if (ok) toast.success(ok);
      return data ?? true;
    } catch (e) { toast.error(errMsg(e)); return null; } finally { setBusy(false); }
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
    const pts = st.boundary ? rings(st.boundary).flat() : st.cells.length ? st.cells.flatMap((c) => rings(c.geom)).flat() : st.old_zones.flatMap((z) => rings(z.geom)).flat();
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
    const dashed = (path: LL[], colour: string, weight: number, z: number) => add(new g.maps.Polyline({
      map: map.current, path: [...path, path[0]], strokeOpacity: 0, clickable: false, zIndex: z,
      icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, strokeColor: colour, strokeWeight: weight, scale: weight }, offset: "0", repeat: `${weight * 5}px` }],
    }));
    const label = (pos: LL, text: string, colour: string, z: number) => add(new g.maps.Marker({
      map: map.current, position: pos, clickable: false, zIndex: z,
      icon: { path: g.maps.SymbolPath.CIRCLE, scale: 0 }, label: { text, color: colour, fontSize: "11px", fontWeight: "700" },
    }));
    // city area: thick dashed line
    if (st.boundary && !(mode.kind === "city" && mode.cityId === cityId)) for (const r of rings(st.boundary)) dashed(r, "#0F172A", 4, 4);
    for (const c of st.cells) {
      const isSel = c.id === sel;
      const rs = rings(c.geom);
      rs.forEach((r, i) => {
        const zt = c.zone_type ?? "core"; const colour = c.is_off ? OFF_GREY : zt === "core" ? (c.colour || TYPE_COLOUR.core) : TYPE_COLOUR[zt];
        const p = add(new g.maps.Polygon({
          map: map.current, paths: r, strokeColor: colour, strokeWeight: isSel ? 3 : 1.5, fillColor: colour,
          fillOpacity: c.is_off ? 0.45 : isSel ? 0.35 : 0.2, editable: isSel && canEdit && mode.kind === "idle" && i === 0, zIndex: isSel ? 3 : 2,
        }));
        if (c.is_off) {
          // hatch: diagonal lines clipped by eye to the zone's box
          const lats = r.map((x) => x.lat), lngs = r.map((x) => x.lng);
          const [s, n, w, e] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
          const step = Math.max((e - w), (n - s)) / 14;
          for (let k = -14; k <= 14; k++) {
            const a = { lat: s, lng: w + k * step }, b = { lat: n, lng: w + k * step + (n - s) };
            const seg = clipSegment(a, b, r);
            for (const sg of seg) add(new g.maps.Polyline({ map: map.current, path: sg, strokeColor: "#334155", strokeOpacity: 0.5, strokeWeight: 1, clickable: false, zIndex: 3 }));
          }
        }
        if (i === 0) label(centre(r), c.is_off ? `${c.name} · Off` : c.name, c.is_off ? "#334155" : "#0F172A", 5);
        p.addListener("click", (e: { latLng: { lat: () => number; lng: () => number } }) => {
          if (drawingRef.current) { setDots((d) => [...d, { lat: e.latLng.lat(), lng: e.latLng.lng() }]); return; }
          select(c);
        });
        if (isSel && canEdit && i === 0) {
          const path = p.getPath();
          const sync = () => { editRef.current = path.getArray().map((x: { lat: () => number; lng: () => number }) => ({ lat: x.lat(), lng: x.lng() })); };
          ["set_at", "insert_at", "remove_at"].forEach((ev) => path.addListener(ev, sync));
          p.addListener("rightclick", (e: { vertex?: number }) => { if (e.vertex != null && path.getLength() > 3) path.removeAt(e.vertex); });
        }
      });
    }
    // custom outer areas inside zones: orange overlay with dashed edge
    if (showOuter || mode.kind === "pocket") for (const row of pocketsQ.data ?? []) {
      const cell = st.cells.find((c) => c.id === row.cell);
      if (!cell) continue;
      for (const r of row.pockets ?? []) {
        if (!Array.isArray(r) || r.length < 3) continue;
        const p = add(new g.maps.Polygon({ map: map.current, paths: r, strokeColor: TYPE_COLOUR.outer, strokeWeight: 2, fillColor: TYPE_COLOUR.outer, fillOpacity: 0.45, zIndex: 4 }));
        dashed(r, "#9A3412", 2, 5);
        label(centre(r), `Outer ₹${row.fee}`, "#7C2D12", 6);
        p.addListener("click", (e: { latLng: { lat: () => number; lng: () => number } }) => {
          if (drawingRef.current) { setDots((d) => [...d, { lat: e.latLng.lat(), lng: e.latLng.lng() }]); return; }
          select(cell);
        });
      }
    }
    if (showGaps && st.gap) for (const r of rings(st.gap))
      add(new g.maps.Polygon({ map: map.current, paths: r, strokeColor: "#DC2626", fillColor: "#DC2626", fillOpacity: 0.5, strokeWeight: 1, clickable: false, zIndex: 6 }));
    if (showPins) for (const pin of outsideQ.data?.pins ?? [])
      add(new g.maps.Marker({ map: map.current, position: { lat: Number(pin.lat), lng: Number(pin.lng) }, zIndex: 9, title: `${pin.number ?? ""} · ${new Date(pin.at).toLocaleDateString("en-IN")}`,
        icon: { path: g.maps.SymbolPath.CIRCLE, scale: 6, fillColor: "#DC2626", fillOpacity: 1, strokeColor: "#FFFFFF", strokeWeight: 2 } }));
    if (mode.kind !== "idle" && dots.length) {
      const colour = mode.kind === "city" ? "#0F172A" : mode.kind === "pocket" ? TYPE_COLOUR.outer : "#2563EB";
      add(new g.maps.Polyline({ map: map.current, path: dots.length >= 3 ? [...dots, dots[0]] : dots, strokeColor: colour, strokeWeight: 3, zIndex: 7, clickable: false }));
      dots.forEach((pt, i) => {
        const m = add(new g.maps.Marker({ map: map.current, position: pt, draggable: true, label: dots.length <= 60 ? String(i + 1) : undefined, zIndex: 8 }));
        m.addListener("dragend", () => setDots((d) => d.map((x, j) => (j === i ? { lat: m.getPosition().lat(), lng: m.getPosition().lng() } : x))));
        m.addListener("rightclick", () => setDots((d) => d.filter((_, j) => j !== i)));
        if (i === 0) m.addListener("click", () => { if (dots.length >= 3) finishDrawing(); });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, st, sel, dots, mode, showGaps, showPins, showOuter, outsideQ.data, pocketsQ.data]);

  function select(c: Cell) { setSel(c.id); editRef.current = rings(c.geom)[0] ?? null; }
  function startZone() {
    if (!st?.boundary) return toast.error("Draw the city area first");
    setSel(null); setDots([]); setMode({ kind: "zone" });
  }
  function startCity(c: { id: string; name: string }, existing: GJ | null) {
    setSel(null); setDots(rings(existing)[0] ?? []); setMode({ kind: "city", cityId: c.id, name: c.name });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function cancelDraw() { setMode({ kind: "idle" }); setDots([]); setNamingOpen(false); }
  function finishDrawing() {
    if (mode.kind === "zone") setNamingOpen(true);
    else if (mode.kind === "city") saveCity();
    else if (mode.kind === "pocket") finishPocket();
  }
  async function saveCity() {
    if (mode.kind !== "city" || dots.length < 3) return toast.error("Place at least 3 points");
    setBusy(true);
    const { error } = await db.rpc("zv2_save_boundary", { _city: mode.cityId, _geojson: toPolygon(dots), _source: "manual", _reset: false });
    setBusy(false);
    if (error) return toast.error(errMsg(error));
    toast.success(`City area saved: ${mode.name}`);
    const id = mode.cityId;
    cancelDraw(); fitted.current = ""; setCityId(id);
    qc.invalidateQueries({ queryKey: ["zones-v2"] }); refreshAll();
  }
  async function loadOsm() {
    if (mode.kind !== "city") return;
    const c = cities.find((x) => x.id === mode.cityId);
    setBusy(true);
    try {
      const r = await osm({ data: { city: mode.name, state: c?.state } });
      const step = Math.max(1, Math.ceil(r.path.length / 80));
      setDots(r.path.filter((_, i) => i % step === 0));
      toast.success("OpenStreetMap shape loaded as a draft. Check the area before saving.");
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  }
  async function saveNew(name: string, colour: string) {
    const ok = await run("zv2_save_zone", { _city: cityId, _cell: null, _name: name, _colour: colour, _geojson: toPolygon(dots) }, "Zone saved");
    if (ok) cancelDraw();
  }
  async function saveSel(name: string, colour: string) {
    if (!sel) return;
    const p = editRef.current;
    if (!p || p.length < 3) return toast.error("A zone needs at least 3 points.");
    const geo = toPolygon(p);
    const { data: hits, error } = await db.rpc("zv2_trim_preview", { _city: cityId, _cell: sel, _geojson: geo });
    if (error) return toast.error(errMsg(error));
    const list = (hits ?? []) as TrimHit[];
    if (list.length) return setTrimFor({ cell: sel, name, colour, geo, hits: list });
    await doSave(sel, name, colour, geo, null);
  }
  async function doSave(cell: string, name: string, colour: string, geo: GJ, reason: string | null) {
    const ok = reason
      ? await run("zv2_save_zone_confirmed", { _city: cityId, _cell: cell, _name: name, _colour: colour, _geojson: geo, _reason: reason }, "Zone saved")
      : await run("zv2_save_zone", { _city: cityId, _cell: cell, _name: name, _colour: colour, _geojson: geo }, "Zone saved");
    if (ok) { setTrimFor(null); const c = (ok as State).cells?.find((x) => x.id === cell); if (c) select(c); }
  }
  async function askDelete(c: Cell) {
    const { data, error } = await db.rpc("zv2_cell_refs", { _cell: c.id });
    if (error) return toast.error(errMsg(error));
    if (Number(data?.total ?? 0) > 0) return setDeleteFor({ cell: c, total: Number(data.total) });
    if (!confirm(`Delete zone "${c.name}"?`)) return;
    if (await run("zv2_delete_cell", { _cell: c.id, _move_to: null }, "Zone deleted")) setSel(null);
  }
  async function toggleOff(c: Cell, on: boolean) {
    if (on) return setOffFor(c);
    await run("staff_set_zone_off", { _cell: c.id, _off: false, _reason: null, _until: null }, `${c.name} is On`);
  }

  if (!cityId) return null;
  const selCell = st?.cells.find((c) => c.id === sel) ?? null;
  const nextColour = COLOURS[(st?.cells.length ?? 0) % COLOURS.length];
  const full = !!st?.boundary && (st?.gap_pct ?? 0) === 0 && (st?.cells.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      <Dialog open={!!trimFor} onOpenChange={(o) => { if (!o) setTrimFor(null); }}>
        {trimFor && <TrimDialog hits={trimFor.hits} isSuper={role === "super_admin"} busy={busy} onCancel={() => setTrimFor(null)}
          onConfirm={(reason) => doSave(trimFor.cell, trimFor.name, trimFor.colour, trimFor.geo, reason)} />}
      </Dialog>
      <div className="grid gap-4 lg:grid-cols-[1fr_330px]">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="City" value={cityId} onChange={(e) => { fitted.current = ""; setSel(null); setCityId(e.target.value); }}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm font-semibold" disabled={mode.kind !== "idle"}>
              {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {canEdit && <Button size="sm" disabled={busy || mode.kind !== "idle"} onClick={startZone}>+ New zone</Button>}
            {canEdit && <Button size="sm" variant="outline" disabled={busy || mode.kind !== "idle" || !st?.gap} onClick={() => setFillOpen(true)}>Fill gaps</Button>}
            <Button size="sm" variant={showGaps ? "default" : "outline"} onClick={() => setShowGaps((v) => !v)}>Show gaps</Button>
            <Button size="sm" variant={showOuter ? "default" : "outline"} onClick={() => setShowOuter((v) => !v)}>{showOuter ? "Hide outer areas" : "Show outer areas"}</Button>
          </div>
          {mode.kind === "zone" && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted p-2 text-sm">
              <span><b>{dots.length}</b> points · <b>{areaKm2(dots).toFixed(2)}</b> km² — click the map to add points, click point 1 to close.</span>
              <Button size="sm" disabled={dots.length < 3} onClick={() => setNamingOpen(true)}>Finish</Button>
              <Button size="sm" variant="ghost" disabled={!dots.length} onClick={() => setDots((d) => d.slice(0, -1))}>Remove last point</Button>
              <Button size="sm" variant="ghost" onClick={cancelDraw}>Cancel</Button>
            </div>
          )}
          {mode.kind === "pocket" && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border-2 border-primary bg-muted p-2 text-sm">
              <span className="font-semibold">Drawing outer area in {st?.cells.find((c) => c.id === mode.cell)?.name}</span>
              <span className="text-muted-foreground">{dots.length} points · {areaKm2(dots).toFixed(2)} km²</span>
              <Button size="sm" disabled={busy || dots.length < 3} onClick={finishPocket}>Save outer area</Button>
              <Button size="sm" variant="ghost" disabled={!dots.length} onClick={() => setDots((d) => d.slice(0, -1))}>Remove last point</Button>
              <Button size="sm" variant="ghost" onClick={cancelDraw}>Cancel</Button>
              <span className="w-full text-xs text-muted-foreground">Click inside the zone to add points. Customers inside this area pay the zone's outer Travel Fee; the rest of the zone stays Core.</span>
            </div>
          )}
          {mode.kind === "city" && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border-2 border-foreground bg-muted p-2 text-sm">
              <span className="font-semibold">Drawing city area: {mode.name}</span>
              <span className="text-muted-foreground">{dots.length} points · {areaKm2(dots).toFixed(1)} km²</span>
              <Button size="sm" disabled={busy || dots.length < 3} onClick={saveCity}>Save</Button>
              <Button size="sm" variant="ghost" onClick={cancelDraw}>Cancel</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={loadOsm}>Load OpenStreetMap boundary</Button>
              <Button size="sm" variant="ghost" disabled={!dots.length} onClick={() => setDots((d) => d.slice(0, -1))}>Remove last point</Button>
              <span className="w-full text-xs text-muted-foreground">Click to add points, drag to move, right-click a point to remove it.</span>
            </div>
          )}
          <div className="relative">
            <div ref={mapDiv} className="h-[620px] w-full rounded-lg border border-border bg-muted" />
            {st && !st.boundary && mode.kind === "idle" && city && (
              <div className="absolute inset-x-0 top-4 mx-auto w-fit rounded-lg border border-border bg-card p-3 text-center text-sm shadow">
                <p className="font-semibold">Draw the city area first</p>
                <p className="text-xs text-muted-foreground">Zones are drawn inside it. Outside it = "Bring badiyos".</p>
                {canEdit && <Button size="sm" className="mt-2" onClick={() => startCity(city, null)}>Draw city area</Button>}
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Thick dashed line = city area. Hatched grey = zone Off.</p>
        </div>

        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-card p-3 text-sm space-y-0.5">
            <p>City area: <b>{st?.city_area_km2 != null ? `${st.city_area_km2} km²` : "not drawn"}</b></p>
            <p>Covered: <b className={full ? "text-primary" : ""}>{st?.covered_pct != null ? `${st.covered_pct}%` : "—"}</b></p>
            <p className={st?.gap_km2 ? "text-destructive font-semibold" : "text-muted-foreground"}>
              Gaps: {st?.gap_km2 ?? 0} km² {st?.gap ? <button className="underline ml-1" onClick={() => setShowGaps(true)}>Show</button> : null}
            </p>
            {st?.overlap && <p className="font-semibold text-destructive">Overlap found</p>}
            <p className="pt-1 text-xs text-muted-foreground">On save: the edited zone keeps its new shape and neighbours give way (no overlaps), points snap to the city edge and nearby zones, and small gaps under 0.1 km² join the nearest zone automatically.</p>
          </div>
          {selCell && canEdit && mode.kind === "idle" && (
            <ZoneForm key={selCell.id} title="Selected zone" initialName={selCell.name} initialColour={selCell.colour} busy={busy}
              hint="Drag points to move, drag mid-points to add, right-click a point to remove."
              off={selCell} onToggleOff={(v) => toggleOff(selCell, v)}
              onSave={saveSel} onDelete={() => askDelete(selCell)} onClose={() => setSel(null)} />
          )}
          {selCell && canToggle && mode.kind === "idle" && (
            <PricingForm key={`p-${selCell.id}`} cell={selCell} busy={busy}
              onSave={(v) => run("staff_set_zone_pricing", { _cell: selCell.id, ...v }, "Zone saved")} />
          )}
          {selCell && canToggle && mode.kind === "idle" && (selCell.zone_type ?? "core") === "core" && (
            <OuterAreasForm key={`o-${selCell.id}-${pocketsOf(selCell.id)?.fee ?? 20}`} cell={selCell} row={pocketsOf(selCell.id)} canEdit={canEdit} busy={busy}
              onDraw={() => { setDots([]); setMode({ kind: "pocket", cell: selCell.id }); }}
              onSave={(pockets, fee) => savePockets(selCell.id, pockets, fee)} />
          )}
          <div className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-3 py-2 text-sm font-semibold">Zones ({st?.cells.length ?? 0}){st?.switched ? " · live" : ""}</div>
            {!st?.cells.length && <p className="px-3 py-3 text-sm text-muted-foreground">No zones yet. Click "+ New zone".</p>}
            {st?.cells.map((c) => {
              const t = c.zone_type ?? "core";
              return (
                <div key={c.id} className={`flex items-center gap-2 px-3 py-2 text-sm ${c.id === sel ? "bg-muted" : ""}`}>
                  <button onClick={() => select(c)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: c.is_off ? OFF_GREY : t === "core" ? (c.colour || TYPE_COLOUR.core) : TYPE_COLOUR[t] }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{c.name}{c.is_off && <span className="ml-1 rounded bg-muted px-1 text-[10px] font-bold">Off</span>}{c.is_active === false && <span className="ml-1 rounded bg-muted px-1 text-[10px] font-bold">Inactive</span>}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {TYPE_LABEL[t]}{t === "outer" ? ` · ₹${c.travel_fee ?? 0}` : ""} · {c.partner ?? "No partner"}
                      </span>
                    </span>
                  </button>
                  {canToggle && <Switch checked={!c.is_off} disabled={busy} onCheckedChange={(v) => toggleOff(c, !v)} aria-label={`${c.name} on/off`} />}
                </div>
              );
            })}
          </div>
          {role === "super_admin" && !st?.switched && (
            <>
              <Button className="w-full" disabled={busy || !full} onClick={() => setSwitchOpen(true)}>Use these zones</Button>
              {!full && <p className="text-xs text-muted-foreground">Available when the city area is 100% covered.</p>}
            </>
          )}
          {!st?.switched && <p className="text-xs text-muted-foreground">On/Off takes effect once these zones are live.</p>}
        </div>
      </div>

      <CitiesList rows={citiesQ.data ?? []} canEdit={canEdit} busy={mode.kind !== "idle"} isSuper={role === "super_admin"}
        onDraw={async (c) => {
          const { data } = c.id === cityId ? { data: st } : await db.rpc("zv2_state", { _city: c.id });
          startCity(c, (data as State | null)?.boundary ?? null);
        }} onAdd={() => setAddCity(true)} />

      {namingOpen && (
        <Dialog open onOpenChange={(o) => !o && setNamingOpen(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Name this zone</DialogTitle></DialogHeader>
            <ZoneForm initialName="" initialColour={nextColour} busy={busy} onSave={saveNew} onClose={() => setNamingOpen(false)} />
          </DialogContent>
        </Dialog>
      )}
      {offFor && <OffDialog cell={offFor} busy={busy} onClose={() => setOffFor(null)}
        onSave={async (reason, until) => { if (await run("staff_set_zone_off", { _cell: offFor.id, _off: true, _reason: reason || null, _until: until }, `${offFor.name} is Off`)) setOffFor(null); }} />}
      {deleteFor && <MoveDeleteDialog cell={deleteFor.cell} total={deleteFor.total} cells={(st?.cells ?? []).filter((c) => c.id !== deleteFor.cell.id && c.live)} busy={busy}
        onClose={() => setDeleteFor(null)}
        onConfirm={async (to) => { if (await run("zv2_delete_cell", { _cell: deleteFor.cell.id, _move_to: to }, "Zone deleted")) { setDeleteFor(null); setSel(null); } }} />}
      {fillOpen && <FillGapsDialog cityId={cityId} onClose={() => setFillOpen(false)}
        onApply={async (asNew) => { const r = await run("zv2_fill_gaps_apply", { _city: cityId, _as_new: asNew }); if (r) { toast.success(`Gaps filled (${(r as { filled?: number }).filled ?? 0} pieces)`); setFillOpen(false); } }} />}
      {switchOpen && <SwitchoverDialog cityId={cityId} cells={st?.cells ?? []} onClose={() => setSwitchOpen(false)} onDone={() => { setSwitchOpen(false); qc.invalidateQueries(); }} />}
      {addCity && <AddCityDialog onClose={() => setAddCity(false)} onCreated={(id, name) => {
        setAddCity(false); qc.invalidateQueries({ queryKey: ["staff", "my-cities"] }); refreshAll(); startCity({ id, name }, null);
      }} />}
    </div>
  );
}

/** Pieces of segment a→b that lie inside polygon r (for the hatch on Off zones). */
function clipSegment(a: LL, b: LL, r: LL[]): LL[][] {
  const ts: number[] = [];
  for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + 1) % r.length];
    const d = (b.lng - a.lng) * (q.lat - p.lat) - (b.lat - a.lat) * (q.lng - p.lng);
    if (Math.abs(d) < 1e-15) continue;
    const t = ((p.lng - a.lng) * (q.lat - p.lat) - (p.lat - a.lat) * (q.lng - p.lng)) / d;
    const u = ((p.lng - a.lng) * (b.lat - a.lat) - (p.lat - a.lat) * (b.lng - a.lng)) / d;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  const at = (t: number) => ({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
  const out: LL[][] = [];
  for (let i = 0; i + 1 < ts.length; i += 2) out.push([at(ts[i]), at(ts[i + 1])]);
  return out;
}

function ZoneForm({ title, initialName, initialColour, busy, hint, off, onToggleOff, onSave, onDelete, onClose }: {
  title?: string; initialName: string; initialColour: string; busy: boolean; hint?: string;
  off?: Cell; onToggleOff?: (off: boolean) => void;
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
      {off && onToggleOff && (
        <div className="flex items-center justify-between rounded-md bg-muted px-2 py-1.5 text-sm">
          <span>{off.is_off ? <>Off{off.off_until ? ` · back on ${new Date(off.off_until).toLocaleString("en-IN")}` : ""}{off.off_reason ? ` · ${off.off_reason}` : ""}</> : "On"}</span>
          <Switch checked={!off.is_off} disabled={busy} onCheckedChange={(v) => onToggleOff(!v)} />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || !name.trim()} onClick={() => onSave(name.trim(), colour)}>Save</Button>
        {onDelete && <Button size="sm" variant="outline" disabled={busy} onClick={onDelete}>Delete</Button>}
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

type PricingValues = { _zone_type: ZoneType; _travel_fee: number; _services: string[]; _expert_share_pct: number; _is_active: boolean };
function PricingForm({ cell, busy, onSave }: { cell: Cell; busy: boolean; onSave: (v: PricingValues) => void }) {
  const [type, setType] = useState<ZoneType>(cell.zone_type ?? "core");
  const [fee, setFee] = useState(String(cell.travel_fee ?? 20));
  const [svcs, setSvcs] = useState<string[]>(cell.travel_fee_services ?? ["clean", "auto_care"]);
  const [share, setShare] = useState(String(cell.expert_share_pct ?? 100));
  const [active, setActive] = useState(cell.is_active ?? true);
  const toggle = (k: string) => setSvcs((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  if (!cell.live) return <p className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">Type and Travel Fee can be set once these zones are live.</p>;
  function save() {
    const f = Number(fee), sh = Number(share);
    if (!Number.isFinite(f) || f < 0 || f > 1000) return toast.error("Travel Fee: enter 0–1000");
    if (!Number.isFinite(sh) || sh < 0 || sh > 100) return toast.error("Expert share: enter 0–100");
    onSave({ _zone_type: type, _travel_fee: f, _services: svcs, _expert_share_pct: sh, _is_active: active });
  }
  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3 text-sm">
      <div className="font-semibold">{cell.name} · Type & fee</div>
      <div className="flex gap-1">
        {(Object.keys(TYPE_LABEL) as ZoneType[]).map((t) => (
          <Button key={t} size="sm" type="button" variant={type === t ? "default" : "outline"} onClick={() => setType(t)}>{TYPE_LABEL[t]}</Button>
        ))}
      </div>
      {type === "outer" && (
        <>
          <label className="flex items-center justify-between gap-2">Travel Fee ₹<Input className="h-8 w-24" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} /></label>
          <div className="flex gap-3">
            {[["clean", "Clean"], ["auto_care", "Auto Care"]].map(([k, l]) => (
              <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={svcs.includes(k)} onChange={() => toggle(k)} />{l}</label>
            ))}
          </div>
          <label className="flex items-center justify-between gap-2">Expert share %<Input className="h-8 w-24" inputMode="decimal" value={share} onChange={(e) => setShare(e.target.value)} /></label>
        </>
      )}
      <label className="flex items-center justify-between">Active<Switch checked={active} onCheckedChange={setActive} /></label>
      <p className="text-xs text-muted-foreground">Franchise partner: {cell.partner ?? "None"}</p>
      <Button size="sm" disabled={busy} onClick={save}>Save</Button>
    </div>
  );
}

function OffDialog({ cell, busy, onClose, onSave }: { cell: Cell; busy: boolean; onClose: () => void; onSave: (reason: string, until: string | null) => void }) {
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Turn off {cell.name}?</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Customers here can browse but can't book or order. Existing bookings and orders continue.</p>
        <Input placeholder="Reason (optional)" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
        <label className="block text-sm">Turn back on at (optional)
          <Input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={() => onSave(reason.trim(), until ? new Date(until).toISOString() : null)}>Turn off</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MoveDeleteDialog({ cell, total, cells, busy, onClose, onConfirm }: { cell: Cell; total: number; cells: Cell[]; busy: boolean; onClose: () => void; onConfirm: (to: string) => void }) {
  const [to, setTo] = useState(cells[0]?.id ?? "");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Delete {cell.name}</DialogTitle></DialogHeader>
        <p className="text-sm">{total} experts, partners, staff or stores use this zone. Move them to:</p>
        <select value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
          {cells.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={busy || !to} onClick={() => onConfirm(to)}>Move & delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Piece = { idx: number; area_m2: number; target: string | null; target_name: string | null };
function FillGapsDialog({ cityId, onClose, onApply }: { cityId: string; onClose: () => void; onApply: (asNew: number[]) => void }) {
  const q = useQuery({
    queryKey: ["zones-v2-gaps", cityId],
    queryFn: async () => { const { data, error } = await db.rpc("zv2_fill_gaps_preview", { _city: cityId }); if (error) throw error; return data as Piece[]; },
  });
  const [asNew, setAsNew] = useState<number[]>([]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Fill gaps</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Each uncovered piece joins the neighbouring zone it shares the longest edge with — or tick "New zone".</p>
        <div className="max-h-[360px] overflow-auto rounded border border-border">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="p-2">Piece</th><th>Area</th><th>Joins</th><th>New zone</th></tr></thead>
            <tbody>
              {q.data?.map((p) => (
                <tr key={p.idx} className="border-t border-border">
                  <td className="p-2">#{p.idx}</td>
                  <td>{p.area_m2 >= 1e5 ? `${(p.area_m2 / 1e6).toFixed(2)} km²` : `${Math.round(p.area_m2)} m²`}</td>
                  <td>{asNew.includes(p.idx) || !p.target ? <i>New zone</i> : p.target_name}</td>
                  <td><input type="checkbox" disabled={!p.target} checked={asNew.includes(p.idx) || !p.target}
                    onChange={(e) => setAsNew((a) => (e.target.checked ? [...a, p.idx] : a.filter((x) => x !== p.idx)))} /></td>
                </tr>
              ))}
              {q.data && !q.data.length && <tr><td className="p-3 text-muted-foreground" colSpan={4}>No gaps.</td></tr>}
            </tbody>
          </table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!q.data?.length} onClick={() => onApply(asNew)}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CitiesList({ rows, canEdit, busy, isSuper, onDraw, onAdd }: { rows: CityRow[]; canEdit: boolean; busy: boolean; isSuper: boolean; onDraw: (c: CityRow) => void; onAdd: () => void }) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-semibold">Cities</span>
        {isSuper && <Button size="sm" variant="outline" disabled={busy} onClick={onAdd}>+ Add city</Button>}
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground"><tr><th className="p-2">City</th><th>Status</th><th>Area</th><th>Zones</th><th></th></tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-t border-border">
              <td className="p-2 font-semibold">{c.name}<span className="ml-1 text-xs font-normal text-muted-foreground">{c.state}</span></td>
              <td>{c.status === "active" ? "Live" : "Coming soon"}</td>
              <td>{c.area_km2 != null ? `${c.area_km2} km²` : "—"}</td>
              <td>{c.zones}{c.live_zones ? <span className="text-xs text-muted-foreground"> · {c.live_zones} live</span> : null}</td>
              <td className="p-2 text-right">{canEdit && <Button size="sm" variant="outline" disabled={busy} onClick={() => onDraw(c)}>{c.area_km2 != null ? "Edit area" : "Draw area"}</Button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddCityDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string, name: string) => void }) {
  const { cities } = useCity();
  const [name, setName] = useState("");
  const [state, setState] = useState("Maharashtra");
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    try {
      const from = cities.find((c) => c.is_default)?.id ?? cities[0]?.id ?? null;
      const tpl = from ? (await db.rpc("staff_city_template", { _from: from })).data : null;
      const { data, error } = await db.rpc("staff_create_city", { _name: name.trim(), _state: state.trim(), _state_code: null, _copy_from: from,
        _prices: tpl?.prices ?? [], _delivery: tpl?.delivery ?? [], _vehicle_rates: tpl?.vehicle_rates ?? [] });
      if (error) throw error;
      const id = typeof data === "string" ? data : data?.id;
      if (!id) throw new Error("City created — refresh to draw its area");
      toast.success(`${name.trim()} added (Coming soon). Now draw its area.`);
      onCreated(id, name.trim());
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Add city</DialogTitle></DialogHeader>
        <Input placeholder="City name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <Input placeholder="State" value={state} maxLength={60} onChange={(e) => setState(e.target.value)} />
        <p className="text-xs text-muted-foreground">Prices and settings are copied from the default city. It starts as Coming soon.</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !name.trim() || !state.trim()} onClick={create}>Add & draw area</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
    if (!confirm("Make these zones live and retire the old ones? Past bookings keep their saved zone.")) return;
    setBusy(true);
    const { data, error } = await db.rpc("zv2_switchover_apply", { _city: cityId, _mapping: map });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`New zones live: ${data.new_zones} zones · ${data.experts} experts · ${data.partners} partners · ${data.merchants} stores moved`);
    onDone();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader><DialogTitle>Use these zones: old zones → new zones</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Experts and stores move by their location (falls back to this table). Partners, staff and courier areas follow this table.
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
          <Button disabled={busy || !q.data} onClick={apply}>Approve & switch</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TrimDialog({ hits, isSuper, busy, onCancel, onConfirm }: { hits: TrimHit[]; isSuper: boolean; busy: boolean; onCancel: () => void; onConfirm: (reason: string | null) => void }) {
  const [reason, setReason] = useState("");
  const needsReason = hits.some((h) => h.partner);
  const blocked = needsReason && !isSuper;
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>These zones will be trimmed</DialogTitle></DialogHeader>
      <ul className="space-y-1 text-sm">
        {hits.map((h) => (
          <li key={h.id} className="flex justify-between gap-2">
            <span><b>{h.name}</b>{h.partner ? <> · Partner: <b>{h.partner}</b></> : <span className="text-muted-foreground"> · no partner</span>}</span>
            <span className="text-muted-foreground">−{(h.lose_m2 / 1e6).toFixed(2)} km²</span>
          </li>
        ))}
      </ul>
      {blocked && <p className="text-sm text-destructive">A franchise partner zone is affected. Only super admin can confirm.</p>}
      {needsReason && isSuper && <Input placeholder="Reason (needed)" value={reason} onChange={(e) => setReason(e.target.value)} />}
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button disabled={busy || blocked || (needsReason && !reason.trim())} onClick={() => onConfirm(needsReason ? reason.trim() : null)}>Trim and save</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function OuterAreasForm({ cell, row, canEdit, busy, onDraw, onSave }: {
  cell: Cell; row: PocketRow | null; canEdit: boolean; busy: boolean;
  onDraw: () => void; onSave: (pockets: LL[][], fee: number) => Promise<boolean> | void;
}) {
  const pockets = row?.pockets ?? [];
  const [fee, setFee] = useState(String(row?.fee ?? 20));
  if (!cell.live) return null;
  const feeNum = Number(fee);
  const feeOk = Number.isFinite(feeNum) && feeNum >= 0 && feeNum <= 1000;
  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3 text-sm">
      <div className="font-semibold">{cell.name} · Outer areas</div>
      <p className="text-xs text-muted-foreground">Mark only part of this zone as Outer. Bookings inside an orange area get the Travel Fee; the rest of the zone stays Core. Same franchise partner.</p>
      <label className="flex items-center justify-between gap-2">Travel Fee ₹
        <Input className="h-8 w-24" inputMode="decimal" value={fee} disabled={!canEdit} onChange={(e) => setFee(e.target.value)} />
      </label>
      {pockets.length === 0 && <p className="text-xs text-muted-foreground">No outer areas yet.</p>}
      {pockets.map((p, i) => (
        <div key={i} className="flex items-center justify-between rounded-md bg-muted px-2 py-1">
          <span>Outer area {i + 1} · {areaKm2(p).toFixed(2)} km²</span>
          {canEdit && <Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (confirm(`Remove outer area ${i + 1}?`)) onSave(pockets.filter((_, j) => j !== i), feeOk ? feeNum : 20); }}>Remove</Button>}
        </div>
      ))}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={onDraw}>+ Draw outer area</Button>
          <Button size="sm" disabled={busy || !feeOk} onClick={() => onSave(pockets, feeNum)}>Save fee</Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Services charged: {(cell.travel_fee_services ?? ["clean", "auto_care"]).map((s) => (s === "clean" ? "Clean" : "Auto Care")).join(", ") || "none"}</p>
    </div>
  );
}
