import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Copy, Download, Pencil, Plus, RotateCcw, Ticket, Upload, Users } from "lucide-react";
import {
  listEventOffers, listOfferRedemptions, upsertEventOffer, setEventOfferPin,
  refundOfferRedemption, processOfferRefunds, type EventOfferRow, type RedemptionRow,
} from "@/lib/event-offers.functions";
import { listZones } from "@/lib/zones.functions";
import { supabase } from "@/integrations/supabase/client";
import { CATALOG_BUCKET, catalogImageUrl } from "@/lib/catalog-images";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const TZ = "Asia/Kolkata";
const fmt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-IN", { timeZone: TZ, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
/** ISO → "YYYY-MM-DDTHH:mm" in IST for datetime-local inputs. */
function toIstInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 330 * 60000);
  return d.toISOString().slice(0, 16);
}
const fromIstInput = (v: string) => (v ? new Date(`${v}:00+05:30`).toISOString() : null);
const maskPhone = (p: string | null) => {
  const d = (p ?? "").replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `${d.slice(0, 2)}XXXXX${d.slice(7)}` : p ?? "—";
};

type Status = "Draft" | "Scheduled" | "Live" | "Ended";
function offerStatus(o: { is_active: boolean; starts_at: string; ends_at: string }): Status {
  const now = Date.now();
  if (new Date(o.ends_at).getTime() < now) return "Ended";
  if (!o.is_active) return "Draft";
  if (new Date(o.starts_at).getTime() > now) return "Scheduled";
  return "Live";
}
const STATUS_CLS: Record<Status, string> = {
  Draft: "bg-muted text-muted-foreground",
  Scheduled: "bg-accent text-accent-foreground",
  Live: "bg-primary text-primary-foreground",
  Ended: "bg-secondary text-secondary-foreground",
};

export function EventOffersPage() {
  const [view, setView] = useState<{ kind: "list" } | { kind: "redemptions"; offer: EventOfferRow }>({ kind: "list" });
  const [editing, setEditing] = useState<Partial<EventOfferRow> | null>(null);
  if (view.kind === "redemptions") return <RedemptionsView offer={view.offer} onBack={() => setView({ kind: "list" })} />;
  return (
    <>
      <OfferList onEdit={setEditing} onRedemptions={(o) => setView({ kind: "redemptions", offer: o })} />
      {editing && <OfferForm initial={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

/* ------------------------------------------------------------------ list */

function OfferList({ onEdit, onRedemptions }: { onEdit: (o: Partial<EventOfferRow>) => void; onRedemptions: (o: EventOfferRow) => void }) {
  const list = useServerFn(listEventOffers);
  const upsert = useServerFn(upsertEventOffer);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["event-offers"], queryFn: () => list(), refetchInterval: 15000 });
  const toggle = useMutation({
    mutationFn: (o: EventOfferRow) => upsert({ data: { offer: { id: o.id, is_active: !o.is_active } } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["event-offers"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const duplicate = (o: EventOfferRow) => {
    const { id: _id, counts: _c, revenue: _r, pin_set: _p, created_at: _ca, ...rest } = o as EventOfferRow & { created_at?: string };
    onEdit({ ...rest, title: `Copy of ${o.title}`, is_active: false });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Event Offers</h1>
          <p className="text-sm text-muted-foreground">Live counter offers · counts refresh every 15 seconds</p>
        </div>
        <Button onClick={() => onEdit({})}><Plus className="mr-1 h-4 w-4" />New offer</Button>
      </div>
      {q.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : q.error ? (
        <p className="text-sm text-destructive">{(q.error as Error).message}</p>
      ) : !q.data?.length ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">No event offers yet.</div>
      ) : (
        <div className="grid gap-3">
          {q.data.map((o) => {
            const st = offerStatus(o);
            const remaining = o.total_stock == null ? "Unlimited" : Math.max(0, o.total_stock - o.counts.used);
            return (
              <div key={o.id} className="rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="text-3xl leading-none">{(o.emoji as string) || "🎁"}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{o.title}</span>
                      <Badge variant="outline">{o.price > 0 ? `₹${o.price}` : "FREE"}</Badge>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLS[st]}`}>{st}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{fmt(o.starts_at)} → {fmt(o.ends_at)} IST</div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      <span>Confirmed <b>{o.counts.confirmed}</b></span>
                      <span>Pending undo <b>{o.counts.pending}</b></span>
                      <span>Undone <b>{o.counts.undone}</b></span>
                      {o.price > 0 && <span>Paid not redeemed <b>{o.counts.paid}</b></span>}
                      <span>Remaining <b>{remaining}</b></span>
                      {o.price > 0 && <span>Revenue <b>₹{o.revenue.toLocaleString("en-IN")}</b></span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Switch checked={o.is_active} onCheckedChange={() => toggle.mutate(o)} disabled={toggle.isPending} />Active
                    </div>
                    <Button size="sm" variant="outline" onClick={() => onEdit(o)}><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button>
                    <Button size="sm" variant="outline" onClick={() => duplicate(o)}><Copy className="mr-1 h-3.5 w-3.5" />Duplicate</Button>
                    <Button size="sm" variant="outline" onClick={() => onRedemptions(o)}><Users className="mr-1 h-3.5 w-3.5" />Redemptions</Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ form */

type F = {
  title: string; description: string; rules_text: string; button_text: string; success_title: string; success_message: string;
  emoji: string; image_url: string; card_color: string; price: string; mrp: string; starts_at: string; ends_at: string;
  is_active: boolean; per_user_limit: string; per_device_limit: string; total_stock: string; show_remaining: boolean;
  audience: "all" | "new_users"; new_users_since: string; city_ids: string[]; undo_seconds: string; require_staff_pin: boolean;
  payment_hold_minutes: string; unredeemed_refund_policy: "auto_refund" | "no_refund"; show_as_home_banner: boolean; sort_order: string;
};
const s = (v: unknown) => (v == null ? "" : String(v));

function OfferForm({ initial, onClose }: { initial: Partial<EventOfferRow>; onClose: () => void }) {
  const qc = useQueryClient();
  const upsert = useServerFn(upsertEventOffer);
  const setPin = useServerFn(setEventOfferPin);
  const zonesFn = useServerFn(listZones);
  const zones = useQuery({ queryKey: ["zones-list"], queryFn: () => zonesFn({ data: {} }) });
  const i = initial as Record<string, unknown>;
  const [id, setId] = useState<string | null>((i.id as string) ?? null);
  const [pinSet, setPinSet] = useState<boolean>(!!i.pin_set);
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPinValue] = useState("");
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<"normal" | "success" | "used">("normal");
  const now = new Date().toISOString();
  const [f, setF] = useState<F>({
    title: s(i.title), description: s(i.description), rules_text: s(i.rules_text), button_text: s(i.button_text) || "Swipe to Redeem",
    success_title: s(i.success_title), success_message: s(i.success_message), emoji: s(i.emoji), image_url: s(i.image_url),
    card_color: s(i.card_color) || "#0f7a4a", price: s(i.price ?? 0), mrp: s(i.mrp),
    starts_at: toIstInput((i.starts_at as string) ?? now),
    ends_at: toIstInput((i.ends_at as string) ?? new Date(Date.now() + 7 * 86400000).toISOString()),
    is_active: !!i.is_active, per_user_limit: s(i.per_user_limit ?? 1), per_device_limit: i.id ? s(i.per_device_limit) : "1",
    total_stock: s(i.total_stock), show_remaining: !!i.show_remaining, audience: (i.audience as F["audience"]) ?? "all",
    new_users_since: toIstInput(i.new_users_since as string), city_ids: (i.city_ids as string[]) ?? [],
    undo_seconds: s(i.undo_seconds ?? 10), require_staff_pin: !!i.require_staff_pin, payment_hold_minutes: s(i.payment_hold_minutes ?? 10),
    unredeemed_refund_policy: (i.unredeemed_refund_policy as F["unredeemed_refund_policy"]) ?? "auto_refund",
    show_as_home_banner: !!i.show_as_home_banner, sort_order: s(i.sort_order ?? 0),
  });
  const set = <K extends keyof F>(k: K, v: F[K]) => setF((p) => ({ ...p, [k]: v }));
  const price = Number(f.price || 0);

  const errors = useMemo(() => {
    const e: string[] = [];
    if (!f.title.trim()) e.push("Title is required");
    if (!f.starts_at || !f.ends_at || new Date(fromIstInput(f.ends_at)!) <= new Date(fromIstInput(f.starts_at)!)) e.push("End must be after start");
    if (!Number.isInteger(price) || price < 0) e.push("Price must be a whole ₹ amount ≥ 0");
    if (f.total_stock && Number(f.total_stock) < 1) e.push("Stock must be at least 1");
    const u = Number(f.undo_seconds);
    if (!Number.isInteger(u) || u < 0 || u > 60) e.push("Undo seconds must be 0–60");
    if (Number(f.per_user_limit) < 1) e.push("Per-user limit must be at least 1");
    if (f.audience === "new_users" && !f.new_users_since) e.push("Pick the 'new users since' date");
    return e;
  }, [f, price]);

  const intOrNull = (v: string) => (v.trim() === "" ? null : Math.round(Number(v)));
  const save = useMutation({
    mutationFn: async () => {
      const offer = {
        ...(id ? { id } : {}),
        title: f.title.trim(), description: f.description || null, rules_text: f.rules_text || null, button_text: f.button_text || "Swipe to Redeem",
        success_title: f.success_title || null, success_message: f.success_message || null, emoji: f.emoji || null,
        image_url: f.image_url || null, card_color: f.card_color || null, price, mrp: intOrNull(f.mrp),
        starts_at: fromIstInput(f.starts_at), ends_at: fromIstInput(f.ends_at), is_active: f.is_active,
        per_user_limit: intOrNull(f.per_user_limit) ?? 1, per_device_limit: intOrNull(f.per_device_limit),
        total_stock: intOrNull(f.total_stock), show_remaining: f.show_remaining, audience: f.audience,
        new_users_since: f.audience === "new_users" ? fromIstInput(f.new_users_since) : null,
        city_ids: f.city_ids.length ? f.city_ids : null, undo_seconds: Number(f.undo_seconds),
        require_staff_pin: f.require_staff_pin, payment_hold_minutes: intOrNull(f.payment_hold_minutes) ?? 10,
        unredeemed_refund_policy: f.unredeemed_refund_policy, show_as_home_banner: f.show_as_home_banner,
        sort_order: intOrNull(f.sort_order) ?? 0,
      };
      return upsert({ data: { offer } });
    },
    onSuccess: (r) => {
      setId(r.id);
      qc.invalidateQueries({ queryKey: ["event-offers"] });
      toast.success("Offer saved");
      if (f.require_staff_pin && !pinSet) toast.info("Staff PIN required — set the PIN before going live");
      else onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const savePin = useMutation({
    mutationFn: () => setPin({ data: { offerId: id!, pin } }),
    onSuccess: () => { setPinSet(true); setPinValue(""); setPinOpen(false); toast.success("PIN set"); qc.invalidateQueries({ queryKey: ["event-offers"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  async function upload(file: File) {
    setUploading(true);
    try {
      const path = `event-offers/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
      const { error } = await supabase.storage.from(CATALOG_BUCKET).upload(path, file, { upsert: false, contentType: file.type });
      if (error) throw error;
      set("image_url", catalogImageUrl(path)!);
    } catch (e) { toast.error((e as Error).message); } finally { setUploading(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto">
        <DialogHeader><DialogTitle>{id ? "Edit event offer" : "New event offer"}</DialogTitle></DialogHeader>
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="space-y-5">
            <Section title="Content">
              <Field label="Title"><Input value={f.title} onChange={(e) => set("title", e.target.value)} /></Field>
              <Field label="Description"><Textarea rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
              <Field label="Rules (one per line)"><Textarea rows={3} value={f.rules_text} onChange={(e) => set("rules_text", e.target.value)} /></Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Button text"><Input value={f.button_text} onChange={(e) => set("button_text", e.target.value)} /></Field>
                <Field label="Emoji"><Input value={f.emoji} maxLength={4} onChange={(e) => set("emoji", e.target.value)} /></Field>
                <Field label="Success title"><Input value={f.success_title} onChange={(e) => set("success_title", e.target.value)} /></Field>
                <Field label="Success message"><Input value={f.success_message} onChange={(e) => set("success_message", e.target.value)} /></Field>
                <Field label="Card colour">
                  <div className="flex gap-2"><input type="color" className="h-9 w-12 rounded border" value={f.card_color} onChange={(e) => set("card_color", e.target.value)} />
                    <Input value={f.card_color} onChange={(e) => set("card_color", e.target.value)} /></div>
                </Field>
                <Field label="Image">
                  <div className="flex items-center gap-2">
                    <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-3 py-2 text-sm">
                      <Upload className="h-3.5 w-3.5" />{uploading ? "Uploading…" : "Upload"}
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                    </label>
                    {f.image_url && <button className="text-xs text-destructive" onClick={() => set("image_url", "")}>Remove</button>}
                  </div>
                </Field>
              </div>
            </Section>
            <Section title="Price">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Price ₹ (0 = FREE)"><Input type="number" min={0} value={f.price} onChange={(e) => set("price", e.target.value)} /></Field>
                <Field label="MRP ₹ (optional)"><Input type="number" min={0} value={f.mrp} onChange={(e) => set("mrp", e.target.value)} /></Field>
              </div>
            </Section>
            <Section title="Timing (IST)">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Starts"><Input type="datetime-local" value={f.starts_at} onChange={(e) => set("starts_at", e.target.value)} /></Field>
                <Field label="Ends"><Input type="datetime-local" value={f.ends_at} onChange={(e) => set("ends_at", e.target.value)} /></Field>
              </div>
              <Toggle label="Active" checked={f.is_active} onChange={(v) => set("is_active", v)} />
            </Section>
            <Section title="Limits">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Ek user kitni baar"><Input type="number" min={1} value={f.per_user_limit} onChange={(e) => set("per_user_limit", e.target.value)} /></Field>
                <Field label="Ek phone pe kitni baar"><Input type="number" min={1} placeholder="No check" value={f.per_device_limit} onChange={(e) => set("per_device_limit", e.target.value)} /></Field>
                <Field label="Total stock"><Input type="number" min={1} placeholder="Unlimited" value={f.total_stock} onChange={(e) => set("total_stock", e.target.value)} /></Field>
              </div>
              <Toggle label="Show remaining to customers" checked={f.show_remaining} onChange={(v) => set("show_remaining", v)} />
            </Section>
            <Section title="Audience">
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-1"><input type="radio" checked={f.audience === "all"} onChange={() => set("audience", "all")} />All users</label>
                <label className="flex items-center gap-1"><input type="radio" checked={f.audience === "new_users"} onChange={() => set("audience", "new_users")} />New users since</label>
                {f.audience === "new_users" && <Input type="datetime-local" className="h-8 w-56" value={f.new_users_since} onChange={(e) => set("new_users_since", e.target.value)} />}
              </div>
              <Field label="Cities (none selected = all cities)">
                <div className="flex flex-wrap gap-2">
                  {(zones.data ?? []).filter((z) => z.status === "active").map((z) => {
                    const on = f.city_ids.includes(z.id);
                    return (
                      <button key={z.id} type="button" onClick={() => set("city_ids", on ? f.city_ids.filter((x) => x !== z.id) : [...f.city_ids, z.id])}
                        className={`rounded-full border px-3 py-1 text-xs ${on ? "border-primary bg-primary text-primary-foreground" : ""}`}>
                        {z.name} · {z.city}
                      </button>
                    );
                  })}
                </div>
              </Field>
            </Section>
            <Section title="Counter">
              <Field label="Undo seconds (0–60)"><Input type="number" min={0} max={60} className="w-32" value={f.undo_seconds} onChange={(e) => set("undo_seconds", e.target.value)} /></Field>
              <Toggle label="Require staff PIN" checked={f.require_staff_pin} onChange={(v) => set("require_staff_pin", v)} />
              {f.require_staff_pin && (
                <div className="flex items-center gap-3 text-sm">
                  {pinSet && <span className="font-medium text-primary">PIN set ✓</span>}
                  <Button size="sm" variant="outline" disabled={!id} onClick={() => setPinOpen(true)}>{pinSet ? "Change PIN" : "Set PIN"}</Button>
                  {!id && <span className="text-xs text-muted-foreground">Save the offer first, then set the PIN.</span>}
                </div>
              )}
            </Section>
            {price > 0 && (
              <Section title="Paid settings">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Payment hold minutes"><Input type="number" min={1} value={f.payment_hold_minutes} onChange={(e) => set("payment_hold_minutes", e.target.value)} /></Field>
                  <Field label="If paid but not redeemed">
                    <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={f.unredeemed_refund_policy}
                      onChange={(e) => set("unredeemed_refund_policy", e.target.value as F["unredeemed_refund_policy"])}>
                      <option value="auto_refund">Auto refund</option><option value="no_refund">No refund</option>
                    </select>
                  </Field>
                </div>
              </Section>
            )}
            <Section title="Display">
              <Toggle label="Show as home banner" checked={f.show_as_home_banner} onChange={(v) => set("show_as_home_banner", v)} />
              <Field label="Sort order"><Input type="number" className="w-32" value={f.sort_order} onChange={(e) => set("sort_order", e.target.value)} /></Field>
            </Section>
          </div>
          <div className="lg:sticky lg:top-0 lg:self-start">
            <div className="mb-2 flex gap-1 rounded-lg bg-muted p-1 text-xs">
              {(["normal", "success", "used"] as const).map((k) => (
                <button key={k} onClick={() => setPreview(k)} className={`flex-1 rounded-md px-2 py-1 ${preview === k ? "bg-background font-medium shadow-sm" : ""}`}>
                  {k === "normal" ? "Normal" : k === "success" ? "Success" : "Already used"}
                </button>
              ))}
            </div>
            <CardPreview f={f} state={preview} />
          </div>
        </div>
        {errors.length > 0 && <ul className="list-disc pl-5 text-xs text-destructive">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button disabled={errors.length > 0 || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save offer"}</Button>
        </DialogFooter>
        <Dialog open={pinOpen} onOpenChange={setPinOpen}>
          <DialogContent className="max-w-xs">
            <DialogHeader><DialogTitle>Set 4-digit staff PIN</DialogTitle></DialogHeader>
            <Input inputMode="numeric" maxLength={4} autoComplete="off" value={pin} onChange={(e) => setPinValue(e.target.value.replace(/\D/g, "").slice(0, 4))}
              className="text-center text-2xl tracking-[0.5em]" />
            <p className="text-xs text-muted-foreground">The PIN will not be shown again after saving.</p>
            <DialogFooter><Button disabled={pin.length !== 4 || savePin.isPending} onClick={() => savePin.mutate()}>Save PIN</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="space-y-3 rounded-xl border p-4"><h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>{children}</div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label>{children}</div>;
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="flex items-center gap-2 text-sm"><Switch checked={checked} onCheckedChange={onChange} />{label}</label>;
}

function CardPreview({ f, state }: { f: F; state: "normal" | "success" | "used" }) {
  const price = Number(f.price || 0);
  const rules = f.rules_text.split("\n").filter(Boolean);
  if (state === "success") {
    return (
      <div className="rounded-2xl bg-primary p-6 text-center text-primary-foreground shadow-lg">
        <div className="text-5xl">✓</div>
        <div className="mt-3 text-lg font-semibold">{f.success_title || "Redeemed!"}</div>
        <div className="mt-1 text-sm opacity-90">{f.success_message || "Show this screen at the counter."}</div>
        <div className="mt-2 text-xs opacity-80">{new Date().toLocaleTimeString("en-IN", { timeZone: TZ })}</div>
        {Number(f.undo_seconds) > 0 && <div className="mt-4 inline-block rounded-full border border-current px-4 py-1 text-sm">Undo ({f.undo_seconds})</div>}
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-2xl text-primary-foreground shadow-lg" style={{ background: f.card_color || undefined }}>
      {f.image_url && <img src={f.image_url} alt="" className="h-36 w-full object-cover" />}
      <div className="space-y-2 p-5">
        <div className="text-3xl">{f.emoji || "🎁"}</div>
        <div className="text-lg font-semibold">{f.title || "Offer title"}</div>
        {f.description && <div className="text-sm opacity-90">{f.description}</div>}
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold">{price > 0 ? `₹${price}` : "FREE"}</span>
          {f.mrp && <span className="text-sm line-through opacity-70">₹{f.mrp}</span>}
        </div>
        {rules.length > 0 && <ul className="list-disc pl-4 text-xs opacity-90">{rules.map((r, k) => <li key={k}>{r}</li>)}</ul>}
        {f.show_remaining && f.total_stock && <div className="text-xs opacity-90">{f.total_stock} left</div>}
        <div className={`mt-3 rounded-full px-4 py-3 text-center text-sm font-semibold ${state === "used" ? "bg-background/30" : "bg-background text-foreground"}`}>
          {state === "used" ? "Already used" : price > 0 ? `Pay ₹${price} & ${f.button_text || "Redeem"}` : f.button_text || "Swipe to Redeem"}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ redemptions */

const STATUS_LABEL: Record<string, string> = {
  confirmed: "Confirmed", pending: "Pending undo", undone: "Undone", paid: "Paid not redeemed",
  payment_pending: "Payment pending", payment_failed: "Payment failed", expired: "Expired", refunded: "Refunded",
};

function RedemptionsView({ offer, onBack }: { offer: EventOfferRow; onBack: () => void }) {
  const list = useServerFn(listOfferRedemptions);
  const refundFn = useServerFn(refundOfferRedemption);
  const processFn = useServerFn(processOfferRefunds);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["event-redemptions", offer.id], queryFn: () => list({ data: { offerId: offer.id } }), refetchInterval: 15000 });
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState<RedemptionRow | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["event-redemptions", offer.id] }); qc.invalidateQueries({ queryKey: ["event-offers"] }); };
  const refund = useMutation({
    mutationFn: (id: string) => refundFn({ data: { redemptionId: id } }),
    onSuccess: (r) => { if (r.ok) toast.success("Refund started"); else toast.error(String(r.error)); setConfirm(null); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const processAll = useMutation({
    mutationFn: () => processFn({ data: { offerId: offer.id } }),
    onSuccess: (r) => { toast.success(`${r.refunded} refunded${r.failed.length ? `, ${r.failed.length} failed` : ""}`); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = (q.data?.rows ?? []).filter((r) => {
    if (status !== "all" && r.status !== status) return false;
    const t = search.trim().toLowerCase();
    if (!t) return true;
    return (r.name ?? "").toLowerCase().includes(t) || (r.phone ?? "").includes(t.replace(/\D/g, "") || "\u0000");
  });
  const refundable = new Set(q.data?.refundable ?? []);
  const ended = new Date(offer.ends_at).getTime() < Date.now();

  function exportCsv() {
    const head = ["Customer", "Phone", "Status", "Amount", "Payment ID", "Time (IST)", "Device", "Same phone"];
    const lines = rows.map((r) => [r.name ?? "", maskPhone(r.phone), STATUS_LABEL[r.status] ?? r.status, r.amount, r.paymentId ?? "",
      fmt(r.createdAt), (r.deviceKey ?? "").slice(0, 8), r.samePhone ? "yes" : ""]);
    const csv = [head, ...lines].map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${offer.title.replace(/\W+/g, "-")}-redemptions.csv`;
    a.click();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="mr-1 h-4 w-4" />Back</Button>
        <h1 className="flex items-center gap-2 text-xl font-semibold"><Ticket className="h-5 w-5" />{offer.title} · Redemptions</h1>
        <div className="ml-auto flex gap-2">
          {ended && offer.price > 0 && offer.unredeemed_refund_policy === "auto_refund" && (
            <Button variant="outline" disabled={processAll.isPending} onClick={() => processAll.mutate()}>
              <RotateCcw className="mr-1 h-4 w-4" />{processAll.isPending ? "Processing…" : "Process refunds for unredeemed"}
            </Button>
          )}
          <Button variant="outline" onClick={exportCsv}><Download className="mr-1 h-4 w-4" />Export CSV</Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input placeholder="Search name or phone" className="w-64" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>{["Customer", "Phone", "Status", "Amount", "Payment ID", "Time", "Device", ""].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr>
          </thead>
          <tbody>
            {q.isLoading ? <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
              : rows.length === 0 ? <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No redemptions.</td></tr>
              : rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2">{r.name ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{maskPhone(r.phone)}</td>
                  <td className="px-3 py-2"><Badge variant="outline">{STATUS_LABEL[r.status] ?? r.status}</Badge></td>
                  <td className="px-3 py-2">₹{r.amount}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.paymentId ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{fmt(r.createdAt)}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {(r.deviceKey ?? "—").slice(0, 8)}
                    {r.samePhone && <Badge variant="destructive" className="ml-2">Same phone</Badge>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {refundable.has(r.id) && <Button size="sm" variant="outline" onClick={() => setConfirm(r)}>Refund</Button>}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Refund ₹{confirm?.amount}?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{confirm?.name ?? "Customer"} ({maskPhone(confirm?.phone ?? null)}) ko Razorpay se refund jayega.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button disabled={refund.isPending} onClick={() => confirm && refund.mutate(confirm.id)}>{refund.isPending ? "Refunding…" : "Confirm refund"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
