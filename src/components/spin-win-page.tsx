import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Download, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SpinRedemptions } from "@/components/spin-redemptions";
import { Link } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type PrizeType = "physical" | "percent_coupon" | "flat_coupon" | "wallet_bonus";
type Prize = {
  id?: string; label: string; label_mr: string; color: string; icon: string; prize_type: PrizeType;
  value: string; max_discount: string; min_order: string; valid_days: string; services: string[];
  stock_limit: string; weight: string; is_fallback: boolean; given?: number; expires_at: string;
};
type Ev = {
  id?: string; name: string; name_mr: string; city_id: string; starts_at: string; ends_at: string;
  eligibility: "new_signups" | "all"; is_active: boolean;
};

const TYPE_LABEL: Record<PrizeType, string> = {
  physical: "Physical prize / ticket", percent_coupon: "% off coupon", flat_coupon: "Flat ₹ coupon", wallet_bonus: "Wallet bonus ₹",
};
const SERVICES = ["clean", "wash", "store", "food", "courier"];
const COLORS = ["#16a34a", "#f59e0b", "#3b82f6", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];

const toLocal = (iso: string) => {
  const d = new Date(iso); const ist = new Date(d.getTime() + 330 * 60000);
  return ist.toISOString().slice(0, 16);
};
const fromLocal = (v: string) => new Date(v + ":00+05:30").toISOString();
const blankPrize = (i: number, fallback = false): Prize => ({
  label: "", label_mr: "", color: COLORS[i % COLORS.length], icon: "", prize_type: "wallet_bonus", value: "",
  max_discount: "", min_order: "", valid_days: "30", services: [], stock_limit: fallback ? "" : "", weight: "1", is_fallback: fallback, expires_at: "",
});

export function SpinWinPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ ev: Ev; prizes: Prize[] } | null>(null);
  const events = useQuery({
    queryKey: ["spin-events"],
    queryFn: async () => {
      const { data, error } = await db.from("spin_events").select("*").order("starts_at", { ascending: false });
      if (error) throw error;
      return data as (Ev & { id: string })[];
    },
  });
  const cities = useQuery({
    queryKey: ["spin-cities"],
    queryFn: async () => (await db.from("cities").select("id,name").order("name")).data as { id: string; name: string }[],
  });

  const openNew = () => {
    const now = new Date(); const later = new Date(now.getTime() + 3 * 3600000);
    setEditing({
      ev: { name: "", name_mr: "", city_id: "", starts_at: toLocal(now.toISOString()), ends_at: toLocal(later.toISOString()), eligibility: "new_signups", is_active: false },
      prizes: [blankPrize(0), blankPrize(1, true)],
    });
  };
  const openEdit = async (e: Ev & { id: string }) => {
    const { data } = await db.from("spin_prizes").select("*").eq("event_id", e.id).eq("is_deleted", false).order("sort_order");
    setEditing({
      ev: { ...e, name_mr: e.name_mr ?? "", city_id: e.city_id ?? "", starts_at: toLocal(e.starts_at), ends_at: toLocal(e.ends_at) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prizes: (data ?? []).map((p: any) => ({
        id: p.id, label: p.label, label_mr: p.label_mr ?? "", color: p.color, icon: p.icon ?? "", prize_type: p.prize_type,
        value: String(p.value ?? ""), max_discount: p.max_discount == null ? "" : String(p.max_discount),
        min_order: String(p.min_order ?? ""), valid_days: String(p.valid_days ?? 30), services: p.services ?? [],
        stock_limit: p.stock_limit == null ? "" : String(p.stock_limit), weight: String(p.weight), is_fallback: p.is_fallback, given: p.given, expires_at: p.expires_at ? toLocal(p.expires_at) : "",
      })),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Wheel events — every spin wins, prizes are drawn on the server.</p>
        <Button onClick={openNew}><Plus className="mr-1 h-4 w-4" />New Spin & Win</Button>
      </div>
      {events.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {events.data?.length === 0 && <p className="text-sm text-muted-foreground">No Spin & Win events yet.</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {events.data?.map((e) => (
          <EventCard key={e.id} ev={e} cityName={cities.data?.find((c) => c.id === e.city_id)?.name ?? "All cities"} onEdit={() => openEdit(e)} />
        ))}
      </div>
      {editing && (
        <EventForm initial={editing} cities={cities.data ?? []} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ["spin-events"] }); qc.invalidateQueries({ queryKey: ["spin-stats"] }); }} />
      )}
    </div>
  );
}

function EventCard({ ev, cityName, onEdit }: { ev: Ev & { id: string }; cityName: string; onEdit: () => void }) {
  const [code, setCode] = useState("");
  const stats = useQuery({
    queryKey: ["spin-stats", ev.id],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await db.rpc("staff_spin_stats", { _event_id: ev.id });
      if (error) throw error;
      return data as { spins: number; tickets_redeemed: number; tickets_total: number; new_signups: number;
        prizes: { id: string; label: string; type: PrizeType; given: number; stock_limit: number | null }[] };
    },
  });
  const [showRed, setShowRed] = useState(false);
  const exportCsv = async () => {
    const { data, error } = await db.rpc("staff_spin_export", { _event_id: ev.id });
    if (error) return toast.error(error.message);
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const fmt = (v: string | null) => (v ? new Date(v).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (data as any[]).map((r) => [r.name, r.phone, r.prize, TYPE_LABEL[r.prize_type as PrizeType], fmt(r.won_at), r.redemption_code, r.prize_type === "physical" ? (r.redeemed_at ? `Yes ${fmt(r.redeemed_at)}` : "No") : "Issued"].map(esc).join(","));
    const csv = ["Name,Phone,Prize,Type,Time (IST),Code,Redeemed", ...rows].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `spin-win-${ev.name.replace(/\W+/g, "-")}.csv`; a.click();
  };
  const now = Date.now();
  const live = ev.is_active && now >= +new Date(ev.starts_at) && now <= +new Date(ev.ends_at);
  const s = stats.data;
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{ev.name}</CardTitle>
            <p className="text-xs text-muted-foreground">
              {cityName} · {new Date(ev.starts_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} → {new Date(ev.ends_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", timeStyle: "short", dateStyle: "medium" })}
            </p>
          </div>
          <Badge variant={live ? "default" : "secondary"}>{live ? "Live" : ev.is_active ? "Scheduled / ended" : "Off"}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Spins" v={s?.spins} />
          <Stat label="Tickets redeemed" v={s ? `${s.tickets_redeemed}/${s.tickets_total}` : undefined} />
          <Stat label="New sign-ups" v={s?.new_signups} />
        </div>
        <div className="space-y-1">
          {s?.prizes.map((p) => {
            const out = p.stock_limit != null && p.given >= p.stock_limit;
            return (
              <div key={p.id} className={`flex justify-between text-sm ${out ? "text-muted-foreground" : ""}`}>
                <span>{p.label} <span className="text-xs text-muted-foreground">· {TYPE_LABEL[p.type]}</span></span>
                <span>{p.given}{p.stock_limit != null ? ` / ${p.stock_limit}` : " / ∞"}{out && " · Sold out"}</span>
              </div>
            );
          })}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onEdit}>Edit</Button>
          <Button size="sm" variant="outline" onClick={exportCsv}><Download className="mr-1 h-4 w-4" />CSV</Button>
          <Button size="sm" variant="outline" onClick={() => setShowRed(true)}>Redemptions</Button>
          <Button size="sm" variant="secondary" asChild><Link to="/scan-redeem">Scan & Redeem</Link></Button>
        </div>
        {showRed && <SpinRedemptions eventId={ev.id} name={ev.name} onClose={() => setShowRed(false)} />}
      </CardContent>
    </Card>
  );
}

function Stat({ label, v }: { label: string; v: number | string | undefined }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-lg font-semibold">{v ?? "—"}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function EventForm({ initial, cities, onClose, onSaved }: {
  initial: { ev: Ev; prizes: Prize[] }; cities: { id: string; name: string }[]; onClose: () => void; onSaved: () => void;
}) {
  const [ev, setEv] = useState<Ev>(initial.ev);
  const [prizes, setPrizes] = useState<Prize[]>(initial.prizes);
  const setP = (i: number, patch: Partial<Prize>) => setPrizes((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : patch.is_fallback ? { ...p, is_fallback: false } : p)));
  const move = (i: number, d: number) => setPrizes((ps) => { const n = [...ps]; const j = i + d; if (j < 0 || j >= n.length) return ps; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const totalW = prizes.reduce((a, p) => a + (Number(p.weight) || 0), 0);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await db.rpc("staff_spin_save", {
        _event: { ...ev, starts_at: fromLocal(ev.starts_at), ends_at: fromLocal(ev.ends_at) },
        _prizes: prizes.map((p) => ({ ...p, stock_limit: p.is_fallback ? "" : p.stock_limit })),
      });
      if (error) throw error;
      // prize expiry (physical prizes)
      let evId = ev.id;
      if (!evId) {
        const { data: e2 } = await db.from("spin_events").select("id").eq("name", ev.name).order("created_at", { ascending: false }).limit(1);
        evId = e2?.[0]?.id;
      }
      if (evId) {
        const { data: ps } = await db.from("spin_prizes").select("id,sort_order,prize_type").eq("event_id", evId).eq("is_deleted", false).order("sort_order");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const [i, row] of ((ps ?? []) as any[]).entries()) {
          const p = prizes[i];
          if (row.prize_type === "physical" && p) {
            const { error: e3 } = await db.rpc("staff_spin_set_prize_expiry", { _prize_id: row.id, _expires_at: p.expires_at ? fromLocal(p.expires_at) : null });
            if (e3) throw e3;
          }
        }
      }
    },
    onSuccess: () => { toast.success("Spin & Win saved"); onSaved(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>{ev.id ? "Edit" : "New"} Spin & Win</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <F label="Name (English)"><Input value={ev.name} onChange={(e) => setEv({ ...ev, name: e.target.value })} /></F>
          <F label="Name (मराठी)"><Input value={ev.name_mr} onChange={(e) => setEv({ ...ev, name_mr: e.target.value })} /></F>
          <F label="City">
            <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={ev.city_id} onChange={(e) => setEv({ ...ev, city_id: e.target.value })}>
              <option value="">All cities</option>
              {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </F>
          <F label="Who can spin">
            <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={ev.eligibility} onChange={(e) => setEv({ ...ev, eligibility: e.target.value as Ev["eligibility"] })}>
              <option value="new_signups">Customers who sign up during the event</option>
              <option value="all">All customers</option>
            </select>
          </F>
          <F label="Starts (IST)"><Input type="datetime-local" value={ev.starts_at} onChange={(e) => setEv({ ...ev, starts_at: e.target.value })} /></F>
          <F label="Ends (IST)"><Input type="datetime-local" value={ev.ends_at} onChange={(e) => setEv({ ...ev, ends_at: e.target.value })} /></F>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Switch checked={ev.is_active} onCheckedChange={(v) => setEv({ ...ev, is_active: v })} />
            <span className="text-sm">On · one spin per phone and per device</span>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <h3 className="font-medium">Prizes (wheel slices)</h3>
          <Button size="sm" variant="outline" onClick={() => setPrizes([...prizes, blankPrize(prizes.length)])}><Plus className="mr-1 h-4 w-4" />Add prize</Button>
        </div>
        <div className="space-y-3">
          {prizes.map((p, i) => (
            <div key={i} className="space-y-2 rounded-md border p-3" style={{ borderLeft: `6px solid ${p.color}` }}>
              <div className="grid gap-2 sm:grid-cols-4">
                <Input placeholder="Label (English)" value={p.label} onChange={(e) => setP(i, { label: e.target.value })} />
                <Input placeholder="Label (मराठी)" value={p.label_mr} onChange={(e) => setP(i, { label_mr: e.target.value })} />
                <select className="h-9 rounded-md border bg-background px-2 text-sm" value={p.prize_type} onChange={(e) => setP(i, { prize_type: e.target.value as PrizeType })}>
                  {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <div className="flex items-center gap-1">
                  <input type="color" value={p.color} onChange={(e) => setP(i, { color: e.target.value })} className="h-9 w-10 rounded border" />
                  <Input placeholder="Icon/emoji" value={p.icon} onChange={(e) => setP(i, { icon: e.target.value })} />
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-4">
                {p.prize_type !== "physical" && (
                  <Input placeholder={p.prize_type === "percent_coupon" ? "% off" : "₹ amount"} type="number" value={p.value} onChange={(e) => setP(i, { value: e.target.value })} />
                )}
                {p.prize_type === "percent_coupon" && <Input placeholder="Max ₹ discount" type="number" value={p.max_discount} onChange={(e) => setP(i, { max_discount: e.target.value })} />}
                {(p.prize_type === "percent_coupon" || p.prize_type === "flat_coupon") && (
                  <>
                    <Input placeholder="Min order ₹" type="number" value={p.min_order} onChange={(e) => setP(i, { min_order: e.target.value })} />
                    <Input placeholder="Valid days" type="number" value={p.valid_days} onChange={(e) => setP(i, { valid_days: e.target.value })} />
                  </>
                )}
                {p.prize_type === "physical" && (
                  <Label className="flex items-center gap-1 text-xs sm:col-span-2">Collect by (IST)
                    <Input type="datetime-local" className="h-9" value={p.expires_at} onChange={(e) => setP(i, { expires_at: e.target.value })} />
                  </Label>
                )}
                {p.prize_type === "wallet_bonus" && <p className="self-center text-xs text-muted-foreground">Bonus expires in 30 days</p>}
              </div>
              {(p.prize_type === "percent_coupon" || p.prize_type === "flat_coupon") && (
                <div className="flex flex-wrap gap-1">
                  {SERVICES.map((s) => (
                    <Button key={s} type="button" size="sm" variant={p.services.includes(s) ? "default" : "outline"} className="h-7"
                      onClick={() => setP(i, { services: p.services.includes(s) ? p.services.filter((x) => x !== s) : [...p.services, s] })}>{s}</Button>
                  ))}
                  <span className="self-center text-xs text-muted-foreground">(none = all services)</span>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Label className="flex items-center gap-1 text-xs">Stock
                  <Input className="h-8 w-24" type="number" placeholder={p.is_fallback ? "Unlimited" : "Unlimited"} disabled={p.is_fallback} value={p.is_fallback ? "" : p.stock_limit} onChange={(e) => setP(i, { stock_limit: e.target.value })} />
                </Label>
                <Label className="flex items-center gap-1 text-xs">Weight
                  <Input className="h-8 w-20" type="number" value={p.weight} onChange={(e) => setP(i, { weight: e.target.value })} />
                </Label>
                <span className="text-xs text-muted-foreground">{totalW ? `${(((Number(p.weight) || 0) / totalW) * 100).toFixed(1)}% chance` : ""}</span>
                {p.given ? <span className="text-xs text-muted-foreground">Given {p.given}</span> : null}
                <Label className="flex items-center gap-1 text-xs">
                  <input type="radio" checked={p.is_fallback} onChange={() => setP(i, { is_fallback: true })} />Guaranteed fallback
                </Label>
                <div className="ml-auto flex gap-1">
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" disabled={prizes.length <= 2} onClick={() => setPrizes(prizes.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label>{children}</div>;
}
