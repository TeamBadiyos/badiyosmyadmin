import { useCity } from "@/lib/city-scope";
import { PartyAgreementCard } from "@/components/agreements";
import { useEffect, useMemo, useState } from "react";
import { SectionTabs, FilterBar, FilterField, filterInputCls, filterSelectCls, tableCls, countLabel, StatusPill } from "@/components/section-chrome";
import { ClipboardList, Store as StoreIcon, CheckCircle2, Tags, Megaphone, Settings } from "lucide-react";
import { ServiceHoursPanel } from "@/components/ops-panels";
import { StoreSettingsPage } from "@/components/store-settings-page";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ChevronLeft, ExternalLink, MapPin, MessageCircle, MoreHorizontal, Plus, Search, Upload } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { RejectModal, QueryModal } from "@/components/merchant-approvals-page";
import { decideMerchant, setMerchantCommission, getStoreCommissionSettings, deleteRejectedMerchant } from "@/lib/merchants.functions";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { catalogImageUrl } from "@/lib/catalog-images";
import { useReportPageTab } from "@/lib/page-tab";
import { OrderPaymentSummary } from "@/components/order-payment-summary";
import {
  type Svc,
  listServiceOrders, getServiceOrder, listServiceStores, getStoreDetail, storeAction,
  listProductApprovals, reviewProduct, listCatalogCategories, saveCatalogCategory, reorderCatalogCategories,
  listStoreTypes, saveStoreType, reorderStoreTypes,
  listSponsored, saveSponsoredSlot, deleteSponsoredSlot, getServiceSettings, saveServiceSettings, createDraftMerchant,
} from "@/lib/service-commerce.functions";
import { cancelStoreOrderWithRefund, reassignStoreRider } from "@/lib/commerce.functions";

const inr = (n: unknown) => `₹${Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const dt = (s?: string | null) => (s ? new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");
const imgUrl = (p?: string | null, fallback?: string | null) => catalogImageUrl(p) ?? catalogImageUrl(fallback);
const SizeHint = ({ text }: { text: string }) => <p className="text-xs text-muted-foreground">{text} · JPG/PNG/WebP · max 10 MB</p>;
const move = <T,>(arr: T[], i: number, d: -1 | 1) => {
  const j = i + d; if (j < 0 || j >= arr.length) return arr;
  const c = [...arr]; [c[i], c[j]] = [c[j], c[i]]; return c;
};
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Tab = "orders" | "stores" | "approvals" | "categories" | "sponsored" | "settings";

function useLabels(svc: Svc) {
  return svc === "food"
    ? { stores: "Restaurants", store: "Restaurant", products: "Menu", product: "Dish" }
    : { stores: "Stores", store: "Store", products: "Products", product: "Product" };
}

function Arrows({ onUp, onDown }: { onUp: () => void; onDown: () => void }) {
  return (
    <span className="inline-flex gap-0.5">
      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onUp} aria-label="Move up"><ArrowUp size={14} /></Button>
      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onDown} aria-label="Move down"><ArrowDown size={14} /></Button>
    </span>
  );
}

async function uploadImage(file: File, folder: string) {
  const ext = file.name.split(".").pop() || "jpg";
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("catalog-images").upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw new Error(error.message);
  return path;
}

export function ServiceCommerceModule({ service, role }: { service: Svc; role: string }) {
  const L = useLabels(service);
  const [tab, setTab] = useState<Tab>("orders");
  const approvalsFn = useServerFn(listProductApprovals);
  const appr = useQuery({ queryKey: ["svc", service, "approvals"], queryFn: () => approvalsFn({ data: { service } }) });
  const pending = (appr.data?.stores ?? []).reduce((a: number, s: any) => a + s.products.length, 0);

  const tabs: { k: Tab; label: string; icon: any }[] = [
    { k: "orders", label: "Orders", icon: ClipboardList }, { k: "stores", label: L.stores, icon: StoreIcon }, { k: "approvals", label: "Approvals", icon: CheckCircle2 },
    { k: "categories", label: "Categories", icon: Tags }, { k: "sponsored", label: "Sponsored", icon: Megaphone }, { k: "settings", label: "Settings", icon: Settings },
  ];
  useReportPageTab(tabs.find((t) => t.k === tab)?.label ?? null);
  return (
    <div className="space-y-6" key={service}>
      <SectionTabs
        items={tabs.map((t) => ({ key: t.k, label: t.label, icon: t.icon, badge: t.k === "approvals" ? pending : undefined }))}
        active={tab}
        onChange={setTab}
      />
      {tab === "orders" && <OrdersTab service={service} />}
      {tab === "stores" && <StoresTab service={service} role={role} />}
      {tab === "approvals" && <ApprovalsTab service={service} />}
      {tab === "categories" && <CategoriesTab service={service} role={role} />}
      {tab === "sponsored" && <SponsoredTab service={service} role={role} />}
      {tab === "settings" && <SettingsTab service={service} role={role} />}
    </div>
  );
}

/* ================= Orders ================= */

const ORDER_STATUS: { v: string; l: string }[] = [
  { v: "", l: "All" }, { v: "delivered", l: "Delivered" }, { v: "cancelled", l: "Cancelled" }, { v: "refunded", l: "Refunded" },
];
type OSort = "customer" | "store" | "items" | "amount" | "status" | "rider" | "placed";

function OrdersTab({ service }: { service: Svc }) {
  const fn = useServerFn(listServiceOrders);
  const storesFn = useServerFn(listServiceStores);
  const [status, setStatus] = useState("");
  const [store, setStore] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<{ k: OSort; asc: boolean }>({ k: "placed", asc: false });
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    // Opened from a bell alert
    try {
      const id = sessionStorage.getItem("cc-open-order");
      if (id) { sessionStorage.removeItem("cc-open-order"); setOpenId(id); }
    } catch { /* ignore */ }
  }, []);
  const L = useLabels(service);
  const qc = useQueryClient();
  const r = useQuery({
    queryKey: ["svc", service, "orders", status === "refunded" ? "" : status, q, from, to],
    queryFn: () => fn({ data: { service, status: status === "refunded" ? null : status || null, q, from: from || null, to: to || null } }),
  });
  const stores = useQuery({ queryKey: ["svc", service, "stores"], queryFn: () => storesFn({ data: { service } }) });
  // Keep the list fresh quietly (no sound, no live chips).
  useEffect(() => {
    const ch = supabase.channel(`svc-orders-${service}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "merchant_orders" }, () => {
        qc.invalidateQueries({ queryKey: ["svc", service, "orders"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [service, qc]);
  const val = (o: any, k: OSort): string | number => {
    switch (k) {
      case "customer": return (o.customer_name || "").toLowerCase();
      case "store": return (o.store_name || "").toLowerCase();
      case "items": return Number(o.item_count ?? o.items_count ?? 0);
      case "amount": return Number(o.total_payable ?? o.total_amount ?? 0);
      case "status": return o.status || "";
      case "rider": return (o.rider_name || "").toLowerCase();
      default: return o.created_at || "";
    }
  };
  const rows = useMemo(() => {
    let x = (r.data ?? []) as any[];
    if (status === "refunded") x = x.filter((o) => o.refund_status === "done");
    if (store) x = x.filter((o) => o.merchant_id === store || o.store_name === store);
    return [...x].sort((a, b) => {
      const A = val(a, sort.k), B = val(b, sort.k);
      return (A < B ? -1 : A > B ? 1 : 0) * (sort.asc ? 1 : -1);
    });
  }, [r.data, status, store, sort]);
  const H = ({ k, l, right }: { k: OSort; l: string; right?: boolean }) => (
    <th className={`${tableCls.th} ${right ? "text-right" : ""}`}>
      <button className="inline-flex items-center gap-1 uppercase hover:text-foreground" onClick={() => setSort((s) => ({ k, asc: s.k === k ? !s.asc : true }))}>
        {l}{sort.k === k ? (sort.asc ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : null}
      </button>
    </th>
  );
  return (
    <div className="space-y-6">
      <FilterBar count={countLabel(rows.length, "order")}>
        <FilterField label="Search">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input className={`${filterInputCls} pl-8 min-w-[230px]`} placeholder="Customer, order no or phone" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </FilterField>
        <FilterField label="Status">
          <select className={filterSelectCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            {ORDER_STATUS.map((s) => <option key={s.v} value={s.v}>{s.v ? s.l : "All statuses"}</option>)}
          </select>
        </FilterField>
        <FilterField label={L.store}>
          <select className={`${filterSelectCls} max-w-56`} value={store} onChange={(e) => setStore(e.target.value)}>
            <option value="">All {L.stores.toLowerCase()}</option>
            {(stores.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.store_name}</option>)}
          </select>
        </FilterField>
        <FilterField label="From"><input type="date" className={filterInputCls} value={from} onChange={(e) => setFrom(e.target.value)} /></FilterField>
        <FilterField label="To"><input type="date" className={filterInputCls} value={to} onChange={(e) => setTo(e.target.value)} /></FilterField>
      </FilterBar>
      <div className={tableCls.wrap}><div className={tableCls.scroll}>
        <table className={tableCls.table}>
          <thead className={tableCls.thead}><tr>
            <H k="customer" l="Customer" /><H k="store" l={L.store} /><H k="items" l="Items" right /><H k="amount" l="Amount" right />
            <H k="status" l="Status" /><H k="rider" l="Rider" /><H k="placed" l="Placed" />
          </tr></thead>
          <tbody>
            {r.isLoading && <tr><td colSpan={7} className="text-center py-10 text-muted-foreground">Loading…</td></tr>}
            {r.error && <tr><td colSpan={7} className="p-4 text-destructive">{errMsg(r.error)}</td></tr>}
            {r.data && rows.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-muted-foreground">No orders.</td></tr>}
            {rows.map((o: any) => (
              <tr key={o.id} onClick={() => setOpenId(o.id)} className={tableCls.tr}>
                <td className={tableCls.td}><p className="font-semibold">{o.customer_name || "Customer"}</p><p className="text-xs text-muted-foreground">{o.order_number}</p></td>
                <td className={tableCls.td}>{o.store_name}</td>
                <td className={`${tableCls.td} text-right`}>{o.item_count ?? o.items_count ?? "—"}</td>
                <td className={`${tableCls.td} text-right font-semibold`}>{inr(o.total_payable ?? o.total_amount)}</td>
                <td className={tableCls.td}><StatusPill status={o.refund_status === "done" ? "refunded" : o.status} /></td>
                <td className={tableCls.td}>{o.rider_name || "—"}</td>
                <td className={`${tableCls.td} whitespace-nowrap text-muted-foreground`}>{dt(o.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div></div>
      {openId && <OrderDetail id={openId} service={service} storeLabel={L.store} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function itemLabel(it: any) {
  const unit = Number(it.unit_price ?? it.price_snapshot ?? 0);
  if (it.unit_price == null) return `${it.quantity} × ${it.product_name_snapshot}`; // old orders: saved note
  const name = String(it.product_name_snapshot ?? "").replace(/ \(.*$/, "").replace(/ \+ .*$/, "");
  const extras = [it.variant_name, ...((Array.isArray(it.addons) ? it.addons : []) as any[]).map((a) => a.name)].filter(Boolean);
  return `${it.quantity} × ${name}${extras.length ? ` — ${extras.join(" + ")}` : ""}, ${inr(unit)} each`;
}

function Row({ k, v, strong }: { k: string; v: React.ReactNode; strong?: boolean }) {
  return (
    <div className={`flex justify-between text-sm py-0.5 ${strong ? "font-bold" : ""}`}>
      <span className="text-muted-foreground">{k}</span><span>{v}</span>
    </div>
  );
}

function OrderDetail({ id, service, storeLabel, onClose }: { id: string; service: Svc; storeLabel: string; onClose: () => void }) {
  const qc = useQueryClient();
  const fn = useServerFn(getServiceOrder);
  const cancelFn = useServerFn(cancelStoreOrderWithRefund);
  const reassignFn = useServerFn(reassignStoreRider);
  const r = useQuery({ queryKey: ["svc", service, "order", id], queryFn: () => fn({ data: { id, service } }) });
  const [reason, setReason] = useState("");
  const done = () => { qc.invalidateQueries({ queryKey: ["svc", service] }); };
  const cancel = useMutation({ mutationFn: () => cancelFn({ data: { orderId: id, reason } }), onSuccess: () => { toast.success("Cancelled; refund started"); done(); }, onError: (e) => toast.error(errMsg(e)) });
  const reassign = useMutation({ mutationFn: () => reassignFn({ data: { orderId: id } }), onSuccess: () => { toast.success("Rider search restarted"); done(); }, onError: (e) => toast.error(errMsg(e)) });
  const o: any = r.data?.order;
  const snap = (o?.tax_rates_snapshot ?? {}) as Record<string, any>;
  const dGstRate = snap.order_delivery_gst ?? snap.delivery_gst;
  const isFood = service === "food";
  const timeline: [string, string | null][] = o ? [
    ["Created", o.created_at], ["Paid", o.paid_at], ["Placed", o.placed_at], ["Accepted", o.accepted_at],
    ["Ready", o.ready_at], ["Picked up", o.picked_up_at], ["Delivered", o.delivered_at], ["Cancelled", o.cancelled_at],
  ] : [];
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{o ? `Order ${o.order_number}` : "Order"}</DialogTitle></DialogHeader>
        {r.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {r.error && <p className="text-sm text-destructive">{errMsg(r.error)}</p>}
        {o && (
          <div className="space-y-4">
            <div className="grid sm:grid-cols-3 gap-3 text-sm">
              <div><p className="text-xs text-muted-foreground">Customer</p><p>{o.customer_name || "—"}</p><p className="text-xs">{o.customer_phone}</p><p className="text-xs text-muted-foreground">{o.delivery_address}</p></div>
              <div><p className="text-xs text-muted-foreground">{storeLabel}</p><p>{r.data?.store?.store_name}</p><p className="text-xs">{r.data?.store?.phone}</p></div>
              <div><p className="text-xs text-muted-foreground">Rider</p><p>{r.data?.rider?.name ?? "No rider yet"}</p><p className="text-xs">{r.data?.rider?.phone}</p><p className="text-xs text-muted-foreground">{r.data?.courier?.status}</p></div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Items</p>
              {(r.data?.items ?? []).map((it: any) => (
                <Row key={it.id} k={itemLabel(it)} v={inr(it.line_total ?? Number(it.price_snapshot) * Number(it.quantity))} />
              ))}
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Money (order snapshot)</p>
              <Row k="Item total" v={inr(o.item_total ?? o.items_total)} />
              {isFood ? <Row k={`Food GST${snap.food_gst_9_5 != null ? ` (${snap.food_gst_9_5}%)` : ""}`} v={inr(o.gst_items)} />
                : <Row k={`TCS${snap.store_tcs != null ? ` (${snap.store_tcs}%)` : ""}`} v={inr(o.tcs_amount)} />}
              <Row k="Delivery" v={inr(o.delivery_fee)} />
              <Row k={`Delivery GST${dGstRate != null ? ` (${dGstRate}%)` : ""}`} v={inr(o.gst_delivery)} />
              <Row k="Platform fee" v={inr(o.platform_fee)} />
              <Row k="Total" v={inr(o.total_payable ?? o.total_amount)} strong />
              <div className="border-t my-2" />
              <Row k={`Commission${o.commission_pct_applied != null ? ` (${o.commission_pct_applied}%)` : ""}`} v={inr(o.commission_amount)} />
              <Row k="Commission GST" v={inr(o.commission_gst ?? o.commission_gst_amount)} />
              <Row k="TDS" v={inr(o.tds_amount)} />
              <Row k="Rider share" v={inr(o.rider_share_amount)} />
              <Row k="Merchant net" v={inr(o.merchant_net)} strong />
              <p className="text-xs text-muted-foreground mt-2">Payment: {o.payment_mode} / {o.payment_status} · Refund: {o.refund_status}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Timeline</p>
              {timeline.filter(([, t]) => t).map(([k, t]) => <Row key={k} k={k} v={dt(t)} />)}
            </div>
            <div className="space-y-2 border-t pt-3">
              <Input placeholder="Reason (needed to cancel)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <div className="flex gap-2">
                <Button variant="destructive" size="sm" disabled={!reason.trim() || cancel.isPending} onClick={() => cancel.mutate()}>Cancel & refund</Button>
                <Button variant="outline" size="sm" disabled={reassign.isPending} onClick={() => reassign.mutate()}>Reassign rider</Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ================= Stores ================= */

type SChip = "live" | "pending" | "draft" | "closed" | "suspended" | "rejected";
const chipOf = (s: any): SChip | null =>
  s.status === "pending_review" ? "pending" : s.status === "draft" ? "draft" : s.status === "suspended" ? "suspended" : s.status === "rejected" ? "rejected"
    : s.status === "approved" ? (s.is_open ? "live" : "closed") : null;
const CHIP_LABEL: Record<SChip, string> = { live: "Live", pending: "Pending review", draft: "Draft", closed: "Closed", suspended: "Suspended", rejected: "Rejected" };
const todayHours = (h: any): string => {
  if (!h) return "Hours not set";
  if (typeof h === "string") return h;
  const day = new Date().toLocaleDateString("en-US", { weekday: "short" }).toLowerCase();
  const d = h[day] ?? h[day.slice(0, 3)] ?? h[new Date().getDay()];
  if (!d) return "Hours not set";
  if (typeof d === "string") return d;
  if (d.closed) return "Closed today";
  return d.open && d.close ? `${d.open} – ${d.close}` : "Hours not set";
};

function StoresTab({ service, role }: { service: Svc; role: string }) {
  const L = useLabels(service);
  const qc = useQueryClient();
  const fn = useServerFn(listServiceStores);
  const settingsFn = useServerFn(getStoreCommissionSettings);
  const decide = useServerFn(decideMerchant);
  const setComm = useServerFn(setMerchantCommission);
  const r = useQuery({ queryKey: ["svc", service, "stores"], queryFn: () => fn({ data: { service } }) });
  const def = useQuery({ queryKey: ["store", "commission-settings"], queryFn: () => settingsFn() });
  const [chip, setChip] = useState<SChip>("live");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [approveFor, setApproveFor] = useState<any | null>(null);
  const [commission, setCommission] = useState("");
  const [rejectFor, setRejectFor] = useState<any | null>(null);
  const [queryFor, setQueryFor] = useState<any | null>(null);
  const [deleteFor, setDeleteFor] = useState<any | null>(null);
  const [adding, setAdding] = useState(false);
  const [delReason, setDelReason] = useState("");
  const delFn = useServerFn(deleteRejectedMerchant);
  const del = useMutation({
    mutationFn: () => delFn({ data: { merchantId: deleteFor.id, reason: delReason } }),
    onSuccess: () => { toast.success(`${L.store} deleted — the merchant can apply again from the start`); setDeleteFor(null); setDelReason(""); qc.invalidateQueries({ queryKey: ["svc", service] }); qc.invalidateQueries({ queryKey: ["merchants"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const canManage = role === "super_admin" || role === "ops_manager";
  const defPct = Number(def.data?.defaultPct ?? 10);
  const approve = useMutation({
    mutationFn: async () => {
      const pct = Number(commission);
      if (commission.trim() && Number.isFinite(pct) && pct !== Number(approveFor.commission_pct ?? -1)) {
        await setComm({ data: { merchantId: approveFor.id, pct } });
      }
      await decide({ data: { merchantId: approveFor.id, decision: "approved" } });
    },
    onSuccess: () => { toast.success(`${L.store} approved`); setApproveFor(null); qc.invalidateQueries({ queryKey: ["svc", service] }); qc.invalidateQueries({ queryKey: ["merchants"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  if (sel) return <StoreDetail service={service} storeId={sel} role={role} onBack={() => setSel(null)} />;
  const all = (r.data ?? []) as any[];
  const counts = all.reduce((m: Record<string, number>, s) => { const c = chipOf(s); if (c) m[c] = (m[c] ?? 0) + 1; return m; }, {});
  const needle = q.trim().toLowerCase();
  const rows = all.filter((s) => chipOf(s) === chip && (!needle || [s.store_name, s.owner_name, s.phone, s.city].some((v) => String(v ?? "").toLowerCase().includes(needle))));
  const noComm = (s: any) => s.commission_pct == null || Number(s.commission_pct) === 0;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        {(Object.keys(CHIP_LABEL) as SChip[]).map((c) => (
          <button key={c} onClick={() => setChip(c)}
            className={`h-9 px-4 rounded-full text-sm font-semibold border whitespace-nowrap ${chip === c ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:text-foreground"}`}>
            {CHIP_LABEL[c]} {counts[c] ?? 0}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input className="pl-8 w-60" placeholder={`Search ${L.stores.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {service === "food" && canManage && <Button onClick={() => setAdding(true)}><Plus size={14} /> Add restaurant</Button>}
      </div>
      {r.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {r.error && <p className="text-sm text-destructive">{errMsg(r.error)}</p>}
      {r.data && rows.length === 0 && <p className="text-sm text-muted-foreground py-8 text-center">Nothing here.</p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((s) => {
          const c = chipOf(s)!;
          const review = c === "pending" || c === "draft";
          return (
            <div key={s.id} className="rounded-2xl border bg-card overflow-hidden flex flex-col">
              <button onClick={() => setSel(s.id)} className="text-left flex-1">
                <div className="h-32 bg-muted">
                  {s.photo ? <img src={imgUrl(s.photo)!} alt={s.store_name} className="h-full w-full object-cover" /> : null}
                </div>
                <div className="p-4 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-bold truncate">{s.store_name || "Unnamed"}</p>
                    <Badge variant={c === "live" ? "default" : c === "suspended" ? "destructive" : "secondary"} className="whitespace-nowrap">{CHIP_LABEL[c]}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{s.store_type || (service === "food" ? "Restaurant" : "Store type not set")}</p>
                  <p className="text-xs text-muted-foreground">{todayHours(s.store_hours)} · {s.live_items} live items</p>
                  {review && noComm(s) && <p className="text-xs text-muted-foreground">Commission will be {defPct}% (default)</p>}
                </div>
              </button>
              {review && canManage && (
                <div className="px-4 pb-4 flex gap-2">
                  <Button size="sm" onClick={() => { setApproveFor(s); setCommission(noComm(s) ? "" : String(s.commission_pct)); }}>Approve</Button>
                  <Button size="sm" variant="outline" onClick={() => setQueryFor(s)}>Raise query</Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setRejectFor(s)}>Reject</Button>
                </div>
              )}
              {c === "rejected" && canManage && (
                <div className="px-4 pb-4 flex gap-2">
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteFor(s)}>Delete</Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {adding && <AddMerchantDialog service={service} defPct={defPct} onClose={() => setAdding(false)} onDone={() => { setAdding(false); setChip("draft"); qc.invalidateQueries({ queryKey: ["svc", service] }); }} />}
      {deleteFor && (
        <Dialog open onOpenChange={(v) => !v && setDeleteFor(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Delete {deleteFor.store_name || "store"}</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">The store is removed and the merchant can sign up again with the same phone and start from step 1.</p>
            <div className="space-y-1">
              <Label>Reason</Label>
              <Input value={delReason} onChange={(e) => setDelReason(e.target.value)} placeholder="Why delete?" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteFor(null)}>Cancel</Button>
              <Button variant="destructive" disabled={!delReason.trim() || del.isPending} onClick={() => del.mutate()}>{del.isPending ? "Deleting…" : "Delete"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {approveFor && (
        <Dialog open onOpenChange={(v) => !v && setApproveFor(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Approve {approveFor.store_name}</DialogTitle></DialogHeader>
            <div className="space-y-1">
              <Label>Commission %</Label>
              <Input type="number" min={0} max={50} placeholder={`${defPct} (default)`} value={commission} onChange={(e) => setCommission(e.target.value)} />
              <p className="text-xs text-muted-foreground">{commission.trim() ? `Commission will be ${commission}%` : `Commission will be ${defPct}% (default)`}</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setApproveFor(null)}>Cancel</Button>
              <Button disabled={approve.isPending} onClick={() => approve.mutate()}>{approve.isPending ? "Approving…" : "Approve"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {rejectFor && <RejectModal merchant={{ id: rejectFor.id, storeName: rejectFor.store_name } as any} onClose={() => { setRejectFor(null); qc.invalidateQueries({ queryKey: ["svc", service] }); }} />}
      {queryFor && <QueryModal merchant={{ id: queryFor.id, storeName: queryFor.store_name } as any} onClose={() => { setQueryFor(null); qc.invalidateQueries({ queryKey: ["svc", service] }); }} />}
    </div>
  );
}

function AddMerchantDialog({ service, defPct, onClose, onDone }: { service: Svc; defPct: number; onClose: () => void; onDone: () => void }) {
  const fn = useServerFn(createDraftMerchant);
  const [f, setF] = useState({ name: "", owner: "", phone: "", address: "", lat: "", lng: "", comm: "" });
  const [locating, setLocating] = useState(false);
  const m = useMutation({
    mutationFn: () => fn({ data: { service, storeName: f.name, ownerName: f.owner, phone: f.phone, address: f.address,
      lat: f.lat ? Number(f.lat) : null, lng: f.lng ? Number(f.lng) : null, commissionPct: f.comm.trim() ? Number(f.comm) : null } }),
    onSuccess: () => { toast.success("Restaurant added as Draft — the owner can now log in to the Merchant App with this phone"); onDone(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const pin = () => {
    if (!navigator.geolocation) return toast.error("Location not available");
    setLocating(true);
    navigator.geolocation.getCurrentPosition((p) => { setF((x) => ({ ...x, lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) })); setLocating(false); },
      () => { toast.error("Couldn't get location"); setLocating(false); });
  };
  const mapUrl = f.lat && f.lng ? `https://www.google.com/maps?q=${f.lat},${f.lng}` : `https://www.google.com/maps/search/${encodeURIComponent(f.address || "Latur")}`;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add restaurant</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Restaurant name</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Owner name</Label><Input value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} /></div>
            <div><Label>Owner phone</Label><Input inputMode="numeric" maxLength={10} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value.replace(/\D/g, "") })} /></div>
          </div>
          <div><Label>Address</Label><Textarea rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
          <div>
            <Label>Map pin</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Latitude" value={f.lat} onChange={(e) => setF({ ...f, lat: e.target.value })} />
              <Input placeholder="Longitude" value={f.lng} onChange={(e) => setF({ ...f, lng: e.target.value })} />
            </div>
            <div className="flex gap-3 mt-1 text-xs">
              <button type="button" className="text-primary" onClick={pin}>{locating ? "Locating…" : "Use my location"}</button>
              <a className="text-primary inline-flex items-center gap-0.5" href={mapUrl} target="_blank" rel="noreferrer">Open in Maps <ExternalLink size={11} /></a>
            </div>
          </div>
          <div><Label>Commission %</Label><Input type="number" min={0} max={50} placeholder={`${defPct} (default)`} value={f.comm} onChange={(e) => setF({ ...f, comm: e.target.value })} />
            <p className="text-xs text-muted-foreground mt-1">{f.comm.trim() ? `Commission will be ${f.comm}%` : `Blank = default ${defPct}%`}</p></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={m.isPending} onClick={() => m.mutate()}>{m.isPending ? "Adding…" : "Add restaurant"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type DTab = "profile" | "commercials" | "products" | "staff" | "settlements" | "agreement";

function StoreDetail({ service, storeId, role, onBack }: { service: Svc; storeId: string; role: string; onBack: () => void }) {
  const L = useLabels(service);
  const qc = useQueryClient();
  const fn = useServerFn(getStoreDetail);
  const actFn = useServerFn(storeAction);
  const key = ["svc", service, "store", storeId];
  const r = useQuery({ queryKey: key, queryFn: () => fn({ data: { storeId, service } }) });
  const act = useMutation({
    mutationFn: (a: any) => actFn({ data: { storeId, service, act: a } }),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["svc", service] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const [t, setT] = useState<DTab>("profile");
  const s: any = r.data?.store;
  return (
    <div className="space-y-3">
      <Button variant="ghost" size="sm" onClick={onBack}><ChevronLeft size={16} /> All {L.stores.toLowerCase()}</Button>
      {r.error && <p className="text-sm text-destructive">{errMsg(r.error)}</p>}
      {s && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            {s.shop_photo_url ? <img src={imgUrl(s.shop_photo_url)!} alt="" className="h-14 w-14 rounded-xl object-cover" /> : <div className="h-14 w-14 rounded-xl bg-muted" />}
            <div className="min-w-0">
              <h2 className="text-lg font-bold truncate">{s.store_name}</h2>
              <p className="text-xs text-muted-foreground">{(r.data?.storeTypes ?? []).find((x: any) => x.id === s.store_category_id)?.name ?? (service === "food" ? "Restaurant" : "Store type not set")} · {s.status === "suspended" ? "Suspended" : s.status}</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-sm">{s.is_open ? "Open" : "Closed"}</span>
              <Switch checked={!!s.is_open} onCheckedChange={(v) => act.mutate({ kind: "open", value: v })} />
              {s.phone && <Button size="icon" variant="outline" asChild aria-label="WhatsApp"><a href={`https://wa.me/91${String(s.phone).replace(/\D/g, "").slice(-10)}`} target="_blank" rel="noreferrer"><MessageCircle size={16} /></a></Button>}
              {(s.latitude != null || s.address) && <Button size="icon" variant="outline" asChild aria-label="Maps"><a href={s.latitude != null ? `https://www.google.com/maps?q=${s.latitude},${s.longitude}` : `https://www.google.com/maps/search/${encodeURIComponent(s.address)}`} target="_blank" rel="noreferrer"><MapPin size={16} /></a></Button>}
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label="More"><MoreHorizontal size={16} /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {s.status === "suspended" ? (
                    <DropdownMenuItem onClick={() => { const reason = window.prompt("Reason to reactivate"); if (reason?.trim()) act.mutate({ kind: "approve", reason }); }}>Reactivate</DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem className="text-destructive" onClick={() => { const reason = window.prompt("Reason to suspend"); if (reason?.trim()) act.mutate({ kind: "suspend", reason }); }}>Suspend</DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div className="flex gap-1 border-b overflow-x-auto">
            {([["profile", "Overview"], ["products", L.products], ["commercials", "Commercials"], ["staff", "Staff"], ["settlements", "Settlements"], ["agreement", "Agreement"]] as [DTab, string][]).map(([k, l]) => (
              <button key={k} onClick={() => setT(k)} className={`px-3 py-2 text-sm border-b-2 ${t === k ? "border-primary text-primary font-semibold" : "border-transparent text-muted-foreground"}`}>{l}</button>
            ))}
          </div>
          {t === "profile" && <ProfilePane s={s} act={act} storeTypes={service === "store" ? r.data?.storeTypes : undefined} />}
          {t === "commercials" && <CommercialsPane s={s} act={act} />}
          {t === "agreement" && <PartyAgreementCard partyType="merchant" partyId={storeId} canManage={role === "super_admin" || role === "ops_manager"} />}
          {t === "products" && <ProductsPane data={r.data} act={act} service={service} storeId={storeId} />}
          {t === "staff" && (
            <div className="rounded-lg border bg-card divide-y">
              {r.data!.staff.map((m: any) => (
                <div key={m.id} className="p-3 flex justify-between text-sm"><span>{m.name || "—"} · {m.phone}</span><span><Badge variant={m.role === "Owner" ? "default" : "outline"}>{m.role}</Badge> <span className="text-xs text-muted-foreground">{m.status}</span></span></div>
              ))}
            </div>
          )}
          {t === "settlements" && (
            <div className="rounded-lg border bg-card overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground"><tr className="border-b"><th className="p-2 text-left">Period</th><th className="p-2 text-left">Type</th><th className="p-2 text-right">Gross</th><th className="p-2 text-right">Adjust</th><th className="p-2 text-right">Net</th><th className="p-2 text-left">Status</th><th className="p-2 text-left">Invoice</th></tr></thead>
                <tbody>
                  {r.data!.settlements.length === 0 && <tr><td colSpan={7} className="p-3 text-muted-foreground">No settlements yet.</td></tr>}
                  {r.data!.settlements.map((x: any) => (
                    <tr key={x.id} className="border-b last:border-0"><td className="p-2">{x.period_from} → {x.period_to}</td><td className="p-2">{x.type}</td><td className="p-2 text-right">{inr(x.gross_amount)}</td><td className="p-2 text-right">{inr(x.adjustment_total)}</td><td className="p-2 text-right font-semibold">{inr(x.net_amount)}</td><td className="p-2">{x.status}</td><td className="p-2 text-xs">{x.invoice_no ?? "—"}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="p-2 text-xs text-muted-foreground">Read-only. Pay and manage settlements in Finance → Settlement.</p>
            </div>
          )}
        </>
      )}
      {role !== "super_admin" && t !== "profile" && null}
    </div>
  );
}

function ProfilePane({ s, act, storeTypes }: { s: any; act: any; storeTypes?: { id: string; name: string; is_active: boolean }[] }) {
  const [offer, setOffer] = useState(s.offer_text ?? "");
  const [reason, setReason] = useState("");
  useEffect(() => setOffer(s.offer_text ?? ""), [s.offer_text]);
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="rounded-lg border bg-card p-4 space-y-1 text-sm">
        <Row k="Owner" v={s.owner_name || "—"} /><Row k="Phone" v={s.phone || "—"} /><Row k="City" v={s.city || "—"} />
        <Row k="Address" v={<span className="text-right max-w-[60%] inline-block">{s.address || "—"}</span>} />
        <Row k="GSTIN" v={s.gstin || "—"} /><Row k="PAN" v={s.pan || "—"} /><Row k="Bank" v={s.bank_account_number ? `${s.bank_account_holder_name || "—"} · ••••${String(s.bank_account_number).slice(-4)}` : <span className="text-destructive font-semibold">Bank details pending</span>} /><Row k="Approval" v={<Badge variant="outline">{s.status}</Badge>} />
        <Row k="Rating" v={Number(s.rating_count) >= 3 ? `${Number(s.rating_avg).toFixed(1)} (${s.rating_count})` : ""} />
      </div>
      <div className="rounded-lg border bg-card p-4 space-y-4">
        {storeTypes && (
          <div className="space-y-1">
            <Label>Store type</Label>
            <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={s.store_category_id ?? ""}
              onChange={(e) => act.mutate({ kind: "storeType", storeCategoryId: e.target.value || null })}>
              <option value="">— Not set —</option>
              {storeTypes.map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_active ? "" : " (inactive)"}</option>)}
            </select>
          </div>
        )}
        <div className="space-y-1">
          <Label>Offer line ({offer.length}/60)</Label>
          <div className="flex gap-2"><Input maxLength={60} value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="e.g. 20% off on first order" />
            <Button size="sm" onClick={() => act.mutate({ kind: "offer", text: offer })}>Save</Button></div>
        </div>
        <div className="space-y-2 border-t pt-3">
          <Input placeholder="Reason (required to approve or suspend)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-2">
            {s.status !== "approved" && <Button size="sm" disabled={!reason.trim()} onClick={() => act.mutate({ kind: "approve", reason }, { onSuccess: () => setReason("") })}>Approve</Button>}
            {s.status !== "suspended" && <Button size="sm" variant="destructive" disabled={!reason.trim()} onClick={() => act.mutate({ kind: "suspend", reason }, { onSuccess: () => setReason("") })}>Suspend</Button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function CommercialsPane({ s, act }: { s: any; act: any }) {
  const [c, setC] = useState(s.commission_pct == null ? "" : String(s.commission_pct));
  const [f, setF] = useState(String(s.instant_settlement_fee_pct ?? 1));
  const [g, setG] = useState(s.gstin ?? "");
  const [p, setP] = useState(s.pan ?? "");
  return (
    <div className="rounded-lg border bg-card p-4 grid sm:grid-cols-3 gap-4 max-w-2xl">
      <div><Label>Commission %</Label><Input type="number" placeholder="Default (Store Settings)" value={c} onChange={(e) => setC(e.target.value)} />
        <p className="text-[11px] text-muted-foreground mt-1">{c.trim() === "" ? "Not set — uses the Store Settings default." : "Set for this merchant."}</p></div>
      <div><Label>Instant settlement fee %</Label><Input type="number" value={f} onChange={(e) => setF(e.target.value)} /></div>
      <div><Label>GSTIN</Label><Input value={g} onChange={(e) => setG(e.target.value.toUpperCase())} maxLength={15} /></div>
      <div><Label>PAN</Label><Input value={p} onChange={(e) => setP(e.target.value.toUpperCase())} maxLength={10} /></div>
      <div className="sm:col-span-3 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Every change is saved in the audit log. Accept timeout is set per city in Settings.</p>
        <Button onClick={() => act.mutate({ kind: "commercials", commission_pct: c.trim() === "" ? null : Number(c), instant_settlement_fee_pct: Number(f), gstin: g, pan: p })}>Save</Button>
      </div>
    </div>
  );
}

function ProductsPane({ data, act, service, storeId }: { data: any; act: any; service: Svc; storeId: string }) {
  const L = useLabels(service);
  const [cats, setCats] = useState<any[]>(data.categories);
  const [prods, setProds] = useState<any[]>(data.products);
  const [edit, setEdit] = useState<any | null>(null);
  const [rec, setRec] = useState<string[]>(() =>
    data.products.filter((p: any) => p.is_recommended).sort((a: any, b: any) => (a.recommended_order ?? 0) - (b.recommended_order ?? 0)).map((p: any) => p.id));
  useEffect(() => { setCats(data.categories); setProds(data.products); }, [data]);
  const groups = useMemo(() => {
    const known = new Set(cats.map((c) => c.id));
    const g = cats.map((c) => ({ cat: c, items: prods.filter((p) => p.category_id === c.id) }));
    const none = prods.filter((p) => !p.category_id || !known.has(p.category_id));
    if (none.length) g.push({ cat: { id: null, name: "No category" }, items: none });
    return g;
  }, [cats, prods]);
  const moveProd = (catId: string | null, i: number, d: -1 | 1) => {
    const inCat = prods.filter((p) => (p.category_id ?? null) === catId || (catId === null && !cats.some((c) => c.id === p.category_id)));
    const moved = move(inCat, i, d);
    const others = prods.filter((p) => !inCat.includes(p));
    setProds([...others, ...moved]);
  };
  const pname = (id: string) => prods.find((p) => p.id === id)?.name ?? id;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setEdit({})}><Plus size={14} /> Add {L.product.toLowerCase()}</Button>
        <Button size="sm" variant="outline" onClick={() => act.mutate({ kind: "reorderCategories", ids: cats.map((c) => c.id) })}>Save category order</Button>
      </div>

      <div className="rounded-lg border bg-card p-3 space-y-2">
        <p className="text-sm font-semibold">Recommended ({rec.length}/6)</p>
        {rec.map((id, i) => (
          <div key={id} className="flex items-center justify-between text-sm"><span>{i + 1}. {pname(id)}</span>
            <span><Arrows onUp={() => setRec(move(rec, i, -1))} onDown={() => setRec(move(rec, i, 1))} />
              <Button size="sm" variant="ghost" onClick={() => setRec(rec.filter((x) => x !== id))}>Remove</Button></span></div>
        ))}
        <div className="flex gap-2">
          <select className="h-9 rounded-md border bg-background px-2 text-sm flex-1" value="" disabled={rec.length >= 6}
            onChange={(e) => e.target.value && setRec([...rec, e.target.value])}>
            <option value="">{rec.length >= 6 ? "Maximum 6 reached" : "Add item…"}</option>
            {prods.filter((p) => !rec.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <Button size="sm" onClick={() => act.mutate({ kind: "recommended", ids: rec })}>Save</Button>
        </div>
      </div>

      {groups.map((g, gi) => (
        <div key={g.cat.id ?? "none"} className="rounded-lg border bg-card">
          <div className="flex items-center justify-between p-2 border-b bg-muted/40">
            <p className="font-semibold text-sm">{g.cat.name}{g.cat.id && !g.cat.is_active ? " (inactive)" : ""}</p>
            <span className="flex items-center gap-1">
              {g.cat.id && <Arrows onUp={() => setCats(move(cats, gi, -1))} onDown={() => setCats(move(cats, gi, 1))} />}
              <Button size="sm" variant="outline" onClick={() => act.mutate({ kind: "reorderProducts", categoryId: g.cat.id, ids: g.items.map((p: any) => p.id) })}>Save item order</Button>
            </span>
          </div>
          {g.items.length === 0 && <p className="p-3 text-xs text-muted-foreground">No items.</p>}
          {g.items.map((p: any, i: number) => (
            <div key={p.id} className="p-2 flex items-center gap-3 border-b last:border-0">
              {imgUrl(p.image_path, p.image_url) ? <img src={imgUrl(p.image_path, p.image_url)!} alt="" className="h-10 w-10 rounded object-cover" /> : <div className="h-10 w-10 rounded bg-muted" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{p.name} {p.pending_changes && <Badge variant="outline" className="ml-1">changes pending</Badge>} {p.approval_status !== "approved" && <Badge variant="secondary" className="ml-1">{p.approval_status}</Badge>}</p>
                <p className="text-xs text-muted-foreground">{inr(p.price)}{p.variants.length ? ` · ${p.variants.length} variants` : ""}{p.addons.length ? ` · ${p.addons.length} add-ons` : ""}</p>
              </div>
              <Switch checked={p.is_available !== false} onCheckedChange={(v) => act.mutate({ kind: "availability", productId: p.id, value: v })} aria-label="Available" />
              <Arrows onUp={() => moveProd(g.cat.id, i, -1)} onDown={() => moveProd(g.cat.id, i, 1)} />
              <Button size="sm" variant="ghost" onClick={() => setEdit(p)}>Edit</Button>
            </div>
          ))}
        </div>
      ))}
      {edit && <ProductEditor product={edit} categories={data.categories.filter((c: any) => c.is_active)} storeId={storeId} label={L.product}
        onClose={() => setEdit(null)} onSave={(payload) => act.mutate({ kind: "upsertProduct", productId: edit.id ?? null, payload }, { onSuccess: () => setEdit(null) })} />}
    </div>
  );
}

type Line = { name: string; price: string; is_default?: boolean };

function ProductEditor({ product, categories, storeId, label, onClose, onSave }: {
  product: any; categories: any[]; storeId: string; label: string; onClose: () => void; onSave: (p: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState(product.name ?? "");
  const [desc, setDesc] = useState(product.description ?? "");
  const [price, setPrice] = useState(product.price != null ? String(product.price) : "");
  const [cat, setCat] = useState(product.category_id ?? "");
  const [img, setImg] = useState<string | null>(product.image_path ?? null);
  const [vars, setVars] = useState<Line[]>((product.variants ?? []).map((v: any) => ({ name: v.name, price: String(v.price), is_default: v.is_default })));
  const [adds, setAdds] = useState<Line[]>((product.addons ?? []).map((v: any) => ({ name: v.name, price: String(v.price) })));
  const [busy, setBusy] = useState(false);
  const lines = (arr: Line[], set: (x: Line[]) => void, title: string, withDefault?: boolean) => (
    <div className="space-y-1">
      <div className="flex justify-between items-center"><Label>{title}</Label><Button size="sm" variant="ghost" onClick={() => set([...arr, { name: "", price: "" }])}><Plus size={14} /> Add</Button></div>
      {arr.map((l, i) => (
        <div key={i} className="flex gap-2 items-center">
          <Input placeholder="Name" value={l.name} onChange={(e) => set(arr.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <Input className="w-28" type="number" placeholder="₹" value={l.price} onChange={(e) => set(arr.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
          {withDefault && <label className="text-xs flex items-center gap-1"><input type="radio" checked={!!l.is_default} onChange={() => set(arr.map((x, j) => ({ ...x, is_default: j === i })))} />Default</label>}
          <Button size="sm" variant="ghost" onClick={() => set(arr.filter((_, j) => j !== i))}>✕</Button>
        </div>
      ))}
    </div>
  );
  const submit = () => {
    if (!name.trim() || price === "") return toast.error("Name and price are required");
    onSave({
      name: name.trim(), description: desc.trim() || null, price: Number(price), category_id: cat || null, image_path: img,
      variants: vars.filter((v) => v.name.trim()).map((v) => ({ name: v.name.trim(), price: Number(v.price || 0), is_default: !!v.is_default })),
      addons: adds.filter((v) => v.name.trim()).map((v) => ({ name: v.name.trim(), price: Number(v.price || 0), is_active: true })),
    });
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{product.id ? `Edit ${label.toLowerCase()}` : `Add ${label.toLowerCase()}`}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>Short description</Label><Textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Price (₹)</Label><Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
            <div><Label>Category</Label>
              <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={cat} onChange={(e) => setCat(e.target.value)}>
                <option value="">No category</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
          </div>
          <div className="flex items-center gap-3">
            {imgUrl(img, product.image_url) ? <img src={imgUrl(img, product.image_url)!} alt="" className="h-14 w-14 rounded object-cover" /> : <div className="h-14 w-14 rounded bg-muted" />}
            <label className="inline-flex items-center gap-1 text-sm cursor-pointer text-primary"><Upload size={14} /> {busy ? "Uploading…" : "Upload photo"}
              <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                const f = e.target.files?.[0]; if (!f) return; setBusy(true);
                try { setImg(await uploadImage(f, storeId)); } catch (er) { toast.error(errMsg(er)); } finally { setBusy(false); }
              }} /></label>
            <SizeHint text="Square 800×800 px recommended" />
          </div>
          {lines(vars, setVars, "Variants (e.g. Half / Full)", true)}
          {lines(adds, setAdds, "Add-ons")}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button><Button disabled={busy} onClick={submit}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ================= Approvals ================= */

function ApprovalsTab({ service }: { service: Svc }) {
  const qc = useQueryClient();
  const fn = useServerFn(listProductApprovals);
  const rev = useServerFn(reviewProduct);
  const r = useQuery({ queryKey: ["svc", service, "approvals"], queryFn: () => fn({ data: { service } }) });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: (v: { productId: string; approve: boolean }) => rev({ data: { ...v, note: notes[v.productId] ?? null } }),
    onSuccess: () => { toast.success("Done"); qc.invalidateQueries({ queryKey: ["svc", service] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const catName = (id: string | null) => (r.data?.categories ?? []).find((c: any) => c.id === id)?.name ?? "—";
  const linesStr = (xs: any[]) => (xs ?? []).map((x) => `${x.name} ₹${x.price}`).join(", ") || "—";
  if (r.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (r.error) return <p className="text-sm text-destructive">{errMsg(r.error)}</p>;
  if (!r.data?.stores.length) return <p className="text-sm text-muted-foreground">Nothing waiting for approval.</p>;
  return (
    <div className="space-y-4">
      {r.data.stores.map((g: any) => (
        <div key={g.storeId} className="rounded-lg border bg-card">
          <p className="p-3 border-b font-semibold">{g.storeName} <Badge className="ml-1">{g.products.length}</Badge></p>
          {g.products.map((p: any) => {
            const n = p.pending_changes ?? null;
            const isNew = !n;
            const fields: [string, React.ReactNode, React.ReactNode][] = [
              ["Name", p.name, n?.name], ["Description", p.description || "—", n?.description || "—"],
              ["Price", inr(p.price), n ? inr(n.price) : null], ["Category", catName(p.category_id), n ? catName(n.category_id) : null],
              ["Photo", imgUrl(p.image_path, p.image_url) ? <img src={imgUrl(p.image_path, p.image_url)!} className="h-12 w-12 rounded object-cover" alt="" /> : "—",
                n ? (n.image_path ? <img src={imgUrl(n.image_path)!} className="h-12 w-12 rounded object-cover" alt="" /> : "—") : null],
              ["Variants", linesStr(p.variants), n ? linesStr(n.variants) : null], ["Add-ons", linesStr(p.addons), n ? linesStr(n.addons) : null],
            ];
            return (
              <div key={p.id} className="p-3 border-b last:border-0 space-y-2">
                <p className="text-xs text-muted-foreground">{isNew ? "New item" : "Change to live item"} · submitted {dt(p.pending_submitted_at)}</p>
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground"><tr><th className="text-left w-28"></th><th className="text-left">{isNew ? "Submitted" : "Current"}</th>{!isNew && <th className="text-left">New</th>}</tr></thead>
                  <tbody>{fields.map(([k, a, b]) => {
                    const changed = !isNew && String(typeof a === "string" ? a : "") !== String(typeof b === "string" ? b : "");
                    return <tr key={k}><td className="text-muted-foreground py-0.5">{k}</td><td>{a}</td>{!isNew && <td className={changed ? "font-semibold text-primary" : ""}>{b}</td>}</tr>;
                  })}</tbody>
                </table>
                <div className="flex gap-2">
                  <Input placeholder="Note (required to reject)" value={notes[p.id] ?? ""} onChange={(e) => setNotes({ ...notes, [p.id]: e.target.value })} />
                  <Button size="sm" onClick={() => m.mutate({ productId: p.id, approve: true })}>Approve</Button>
                  <Button size="sm" variant="destructive" onClick={() => m.mutate({ productId: p.id, approve: false })}>Reject</Button>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ================= Categories ================= */

function CategoriesTab({ service, role }: { service: Svc; role: string }) {
  const qc = useQueryClient();
  const fn = useServerFn(listCatalogCategories);
  const saveFn = useServerFn(saveCatalogCategory);
  const reFn = useServerFn(reorderCatalogCategories);
  const r = useQuery({ queryKey: ["svc", service, "cats"], queryFn: () => fn({ data: { service } }) });
  const [rows, setRows] = useState<any[]>([]);
  const [edit, setEdit] = useState<any | null>(null);
  useEffect(() => setRows(r.data ?? []), [r.data]);
  const canEdit = role === "super_admin";
  const inv = () => qc.invalidateQueries({ queryKey: ["svc", service] });
  const save = useMutation({ mutationFn: (v: any) => saveFn({ data: { service, ...v } }), onSuccess: () => { toast.success("Saved"); setEdit(null); inv(); }, onError: (e) => toast.error(errMsg(e)) });
  const reorder = useMutation({ mutationFn: () => reFn({ data: { service, ids: rows.map((x) => x.id) } }), onSuccess: () => { toast.success("Order saved"); inv(); }, onError: (e) => toast.error(errMsg(e)) });
  return (
    <div className="space-y-6">
    {service === "store" && <StoreTypesSection role={role} />}
    <div className="space-y-3">
      {service === "store" ? <>
        <h3 className="font-semibold">Product categories</h3>
        <p className="text-xs text-muted-foreground">Used only inside a store's product list — the merchant picks one from a dropdown.</p>
      </> : <>
        <h3 className="font-semibold">Food categories</h3>
        <p className="text-xs text-muted-foreground">Shown on the Food home row in this order, and used inside restaurant menus.</p>
      </>}
      {canEdit ? (
        <div className="flex gap-2"><Button size="sm" onClick={() => setEdit({ is_active: true })}><Plus size={14} /> New category</Button>
          <Button size="sm" variant="outline" onClick={() => reorder.mutate()}>Save</Button></div>
      ) : <p className="text-xs text-muted-foreground">Only super admin can change categories.</p>}
      <div className="rounded-lg border bg-card divide-y">
        {rows.map((c, i) => (
          <div key={c.id} className="p-2 flex items-center gap-3">
            {imgUrl(c.image_path) ? <img src={imgUrl(c.image_path)!} alt="" className="h-10 w-10 rounded object-cover" /> : <div className="h-10 w-10 rounded bg-muted" />}
            <p className={`flex-1 text-sm font-medium ${c.is_active ? "" : "text-muted-foreground"}`}>{c.name}</p>
            <span className="text-xs text-muted-foreground whitespace-nowrap">{c.store_count ?? 0} {service === "food" ? "restaurants" : "stores"}</span>
            {canEdit && <>
              <Switch checked={c.is_active} onCheckedChange={(v) => save.mutate({ id: c.id, name: c.name, image_path: c.image_path, is_active: v })} />
              <Arrows onUp={() => setRows(move(rows, i, -1))} onDown={() => setRows(move(rows, i, 1))} />
              <Button size="sm" variant="ghost" onClick={() => setEdit(c)}>Edit</Button></>}
          </div>
        ))}
        {r.data?.length === 0 && <p className="p-3 text-sm text-muted-foreground">No categories yet.</p>}
      </div>
      {edit && <CategoryEditor c={edit} service={service} onClose={() => setEdit(null)} onSave={(v) => save.mutate(v)} />}
    </div>
    </div>
  );
}

function StoreTypesSection({ role }: { role: string }) {
  const qc = useQueryClient();
  const fn = useServerFn(listStoreTypes);
  const saveFn = useServerFn(saveStoreType);
  const reFn = useServerFn(reorderStoreTypes);
  const r = useQuery({ queryKey: ["svc", "store", "types"], queryFn: () => fn() });
  const [rows, setRows] = useState<any[]>([]);
  const [edit, setEdit] = useState<any | null>(null);
  useEffect(() => setRows(r.data ?? []), [r.data]);
  const canEdit = role === "super_admin";
  const inv = () => qc.invalidateQueries({ queryKey: ["svc", "store"] });
  const save = useMutation({ mutationFn: (v: any) => saveFn({ data: v }), onSuccess: () => { toast.success("Saved"); setEdit(null); inv(); }, onError: (e) => toast.error(errMsg(e)) });
  const reorder = useMutation({ mutationFn: () => reFn({ data: { ids: rows.map((x) => x.id) } }), onSuccess: () => { toast.success("Order saved"); inv(); }, onError: (e) => toast.error(errMsg(e)) });
  const pic = (c: any) => imgUrl(c.image_path, c.icon_url && /^https?:/.test(c.icon_url) ? c.icon_url : null);
  return (
    <div className="space-y-3">
      <h3 className="font-semibold">Store types (home row)</h3>
      <p className="text-xs text-muted-foreground">Customers see these on the Store home row in this order. Tapping one shows stores of that type.</p>
      {canEdit ? (
        <div className="flex gap-2"><Button size="sm" onClick={() => setEdit({ is_active: true })}><Plus size={14} /> New store type</Button>
          <Button size="sm" variant="outline" onClick={() => reorder.mutate()}>Save order</Button></div>
      ) : <p className="text-xs text-muted-foreground">Only super admin can change store types.</p>}
      <div className="rounded-lg border bg-card divide-y">
        {r.isLoading && <p className="p-3 text-sm text-muted-foreground">Loading…</p>}
        {rows.map((c, i) => (
          <div key={c.id} className="p-2 flex items-center gap-3">
            {pic(c) ? <img src={pic(c)!} alt="" className="h-10 w-10 rounded object-cover" /> : <div className="h-10 w-10 rounded bg-muted" />}
            <p className={`flex-1 text-sm font-medium ${c.is_active ? "" : "text-muted-foreground line-through"}`}>{c.name}</p>
            {canEdit && <>
              <Switch checked={c.is_active} onCheckedChange={(v) => save.mutate({ id: c.id, name: c.name, image_path: c.image_path, is_active: v })} />
              <Arrows onUp={() => setRows(move(rows, i, -1))} onDown={() => setRows(move(rows, i, 1))} />
              <Button size="sm" variant="ghost" onClick={() => setEdit(c)}>Edit</Button></>}
          </div>
        ))}
        {r.data?.length === 0 && <p className="p-3 text-sm text-muted-foreground">No store types yet.</p>}
      </div>
      {edit && <CategoryEditor c={edit} service="store" folder="_store_types" onClose={() => setEdit(null)} onSave={(v) => save.mutate(v)} />}
    </div>
  );
}

function CategoryEditor({ c, service, folder, onClose, onSave }: { c: any; service: Svc; folder?: string; onClose: () => void; onSave: (v: any) => void }) {
  const [name, setName] = useState(c.name ?? "");
  const [img, setImg] = useState<string | null>(c.image_path ?? null);
  const [active, setActive] = useState(c.is_active !== false);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader><SheetTitle>{c.id ? "Edit category" : "New category"}</SheetTitle></SheetHeader>
        <div className="space-y-3 py-4">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="flex items-center gap-3">
            {imgUrl(img) ? <img src={imgUrl(img)!} alt="" className="h-14 w-14 rounded object-cover" /> : <div className="h-14 w-14 rounded bg-muted" />}
            <label className="inline-flex items-center gap-1 text-sm cursor-pointer text-primary"><Upload size={14} /> {busy ? "Uploading…" : "Upload image"}
              <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                const f = e.target.files?.[0]; if (!f) return; setBusy(true);
                try { setImg(await uploadImage(f, folder ?? `_categories/${service}`)); } catch (er) { toast.error(errMsg(er)); } finally { setBusy(false); }
              }} /></label>
            <SizeHint text="Square 512×512 px recommended" />
          </div>
          <div className="flex items-center justify-between"><Label>Active</Label><Switch checked={active} onCheckedChange={setActive} /></div>
        </div>
        <SheetFooter><Button variant="outline" onClick={onClose}>Close</Button><Button disabled={busy} onClick={() => onSave({ id: c.id ?? null, name, image_path: img, is_active: active })}>Save</Button></SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/* ================= Sponsored ================= */

function SponsoredTab({ service, role }: { service: Svc; role: string }) {
  const qc = useQueryClient();
  const catsFn = useServerFn(listCatalogCategories);
  const fn = useServerFn(listSponsored);
  const saveFn = useServerFn(saveSponsoredSlot);
  const delFn = useServerFn(deleteSponsoredSlot);
  const [cat, setCat] = useState<string>("");
  const typesFn = useServerFn(listStoreTypes);
  const cats = useQuery({
    queryKey: ["svc", service, service === "store" ? "types" : "cats"],
    queryFn: () => (service === "store" ? typesFn() : catsFn({ data: { service } })),
  });
  const r = useQuery({ queryKey: ["svc", service, "sponsored", cat], queryFn: () => fn({ data: { service, categoryId: cat || null } }) });
  const [edit, setEdit] = useState<any | null>(null);
  const canEdit = role === "super_admin";
  const inv = () => qc.invalidateQueries({ queryKey: ["svc", service, "sponsored"] });
  const save = useMutation({ mutationFn: (v: any) => saveFn({ data: { service, categoryId: cat || null, ...v } }), onSuccess: () => { toast.success("Saved"); setEdit(null); inv(); }, onError: (e) => toast.error(errMsg(e)) });
  const del = useMutation({ mutationFn: (id: string) => delFn({ data: { service, id } }), onSuccess: () => { toast.success("Removed"); inv(); }, onError: (e) => toast.error(errMsg(e)) });
  const now = Date.now();
  const storeName = (id: string) => (r.data?.stores ?? []).find((s: any) => s.id === id)?.store_name ?? "Store not approved / other";
  const d = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center overflow-x-auto pb-1">
        {[{ id: "", name: "Home" }, ...((cats.data ?? []) as any[]).filter((c) => c.is_active)].map((c: any) => (
          <button key={c.id || "home"} onClick={() => setCat(c.id)}
            className={`h-9 px-4 rounded-full text-sm font-semibold border whitespace-nowrap ${cat === c.id ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:text-foreground"}`}>{c.name}</button>
        ))}
        {!canEdit && <span className="text-xs text-muted-foreground whitespace-nowrap">Only super admin can change slots.</span>}
      </div>
      <div className="rounded-lg border bg-card divide-y">
        {[1, 2, 3, 4, 5, 6].map((pos) => {
          const slots = (r.data?.slots ?? []).filter((s: any) => s.position === pos);
          return (
            <div key={pos} className="p-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Slot {pos}</p>
                {canEdit && slots.length === 0 && <Button size="sm" variant="ghost" onClick={() => setEdit({ position: pos, isActive: true })}><Plus size={14} /> Add</Button>}
              </div>
              {slots.map((s: any) => {
                const expired = new Date(s.ends_at).getTime() < now;
                return (
                  <div key={s.id} className={`flex items-center justify-between text-sm py-1 ${expired || !s.is_active ? "opacity-50" : ""}`}>
                    <span>{storeName(s.store_id)} · {d(s.starts_at)} → {d(s.ends_at)} {expired && <Badge variant="secondary">expired</Badge>} {!s.is_active && <Badge variant="outline">off</Badge>}</span>
                    {canEdit && <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Slot actions"><MoreHorizontal size={14} /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEdit({ id: s.id, storeId: s.store_id, position: s.position, startsAt: d(s.starts_at), endsAt: d(s.ends_at), isActive: s.is_active })}>Edit</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => del.mutate(s.id)}>Remove</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {edit && (
        <Dialog open onOpenChange={(v) => !v && setEdit(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Sponsored slot</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Store</Label>
                <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={edit.storeId ?? ""} onChange={(e) => setEdit({ ...edit, storeId: e.target.value })}>
                  <option value="">Pick…</option>{(r.data?.stores ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.store_name}</option>)}
                </select></div>
              <div><Label>Position</Label>
                <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={edit.position} onChange={(e) => setEdit({ ...edit, position: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5, 6].map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Start</Label><Input type="date" value={edit.startsAt ?? ""} onChange={(e) => setEdit({ ...edit, startsAt: e.target.value })} /></div>
                <div><Label>End</Label><Input type="date" value={edit.endsAt ?? ""} onChange={(e) => setEdit({ ...edit, endsAt: e.target.value })} /></div>
              </div>
              <div className="flex items-center justify-between"><Label>Active</Label><Switch checked={!!edit.isActive} onCheckedChange={(v) => setEdit({ ...edit, isActive: v })} /></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setEdit(null)}>Close</Button><Button onClick={() => save.mutate(edit)}>Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/* ================= Settings ================= */

function SettingsTab({ service, role }: { service: Svc; role: string }) {
  const qc = useQueryClient();
  const fn = useServerFn(getServiceSettings);
  const saveFn = useServerFn(saveServiceSettings);
  const { cityId } = useCity();
  const r = useQuery({ queryKey: ["svc", service, "settings", cityId], queryFn: () => fn({ data: { service, cityId } }) });
  const [v, setV] = useState({ min: "", km: "", share: "", timeout: "" });
  useEffect(() => {
    const s: any = r.data?.settings; if (!s) return;
    setV({ min: String(s.delivery_min_fare ?? ""), km: String(s.delivery_per_km ?? ""), share: String(s.rider_share_pct ?? ""), timeout: String(s.default_accept_timeout_minutes ?? "") });
  }, [r.data]);
  const canEdit = role === "super_admin";
  const save = useMutation({
    mutationFn: () => saveFn({ data: { service, delivery_min_fare: Number(v.min), delivery_per_km: Number(v.km), rider_share_pct: Number(v.share), default_accept_timeout_minutes: Number(v.timeout), cityId } }),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["svc", service, "settings"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const n = r.data?.notify;
  const defFn = useServerFn(getStoreCommissionSettings);
  const def = useQuery({ queryKey: ["store", "commission-settings"], queryFn: () => defFn(), enabled: service === "food" });
  return (
    <div className="space-y-5 max-w-3xl">
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <p className="font-semibold">Delivery & orders</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><Label>Minimum fare (₹)</Label><Input type="number" disabled={!canEdit} value={v.min} onChange={(e) => setV({ ...v, min: e.target.value })} /></div>
          <div><Label>Per km (₹)</Label><Input type="number" disabled={!canEdit} value={v.km} onChange={(e) => setV({ ...v, km: e.target.value })} /></div>
          <div><Label>Rider share %</Label><Input type="number" disabled={!canEdit} value={v.share} onChange={(e) => setV({ ...v, share: e.target.value })} /></div>
          <div><Label>Accept timeout (min)</Label><Input type="number" disabled={!canEdit} value={v.timeout} onChange={(e) => setV({ ...v, timeout: e.target.value })} /></div>
        </div>
        {canEdit ? <Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button> : <p className="text-xs text-muted-foreground">Only super admin can change these.</p>}
      </div>
      {service === "store" && <StoreSettingsPage hideGst />}
      <ServiceHoursPanel serviceKey={service} title="Opening hours" />
      <div className="rounded-lg border bg-card p-4">
        <p className="font-semibold mb-2">Notify-me · last 7 days</p>
        {n?.error ? <p className="text-sm text-destructive">{n.error}</p> : (
          <div className="grid grid-cols-3 gap-2 text-center">
            {([["Tried", n?.tried], ["Notified", n?.notified], ["Converted", n?.converted]] as const).map(([k, x]) => (
              <div key={k} className="rounded-md bg-muted/50 p-3"><p className="text-2xl font-bold">{x ?? 0}</p><p className="text-xs text-muted-foreground">{k}</p></div>
            ))}
          </div>
        )}
      </div>
      {service === "food" && <p className="text-xs text-muted-foreground">Default commission {def.data?.defaultPct ?? 10}% — change in Store → Settings</p>}
    </div>
  );
}
