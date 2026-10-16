import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDashboardOverview, getDashboardTeam, getDashboardMoney, getDashboardDrill } from "@/lib/finance.functions";
import { Info, Phone } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PipelineKanban, SERVICE_META, type BoardService } from "@/components/pipeline-kanban";
import type { StaffRole } from "@/lib/staff.functions";
import { listExpertsWithoutDevice } from "@/lib/booking-settings.functions";

type Range = "today" | "yesterday" | "7d" | "30d";
const ist = (d: Date) => new Date(d.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
function rangeDates(r: Range) {
  const now = new Date(); const day = 86400000;
  const today = ist(now);
  if (r === "today") return { from: today, to: today };
  if (r === "yesterday") { const y = ist(new Date(now.getTime() - day)); return { from: y, to: y }; }
  return { from: ist(new Date(now.getTime() - (r === "7d" ? 6 : 29) * day)), to: today };
}
const inr = (n: unknown) => "₹" + Math.round(Number(n || 0)).toLocaleString("en-IN");

const ROWS: { key: BoardService; nav: string; live: boolean }[] = [
  { key: "maid", nav: "maid-bookings", live: false },
  { key: "wash", nav: "wash-bookings", live: false },
  { key: "store", nav: "store-orders", live: true },
  { key: "food", nav: "food-orders", live: true },
  { key: "parcel", nav: "courier-orders", live: true },
];

type TeamKey = "maid" | "washer" | "rider";
const TEAM: { key: TeamKey; label: string }[] = [
  { key: "maid", label: "maids" }, { key: "washer", label: "washers" }, { key: "rider", label: "riders" },
];
const ago = (iso: string | null) => {
  if (!iso) return "—";
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${Math.floor(m / 1440)} d`;
};

const TIPS: Record<string, string> = {
  Orders: "Orders paid on these dates (counted when paid, any status).",
  Cancelled: "Cancelled + rejected orders.",
  Gross: "Money received from customers on these dates (counted when paid), without GST.",
  Discount: "Coupons and offers given.",
  Refunds: "Money returned to customers on these dates, without GST.",
  "Net revenue": "Gross − Discount − Refunds, without GST.",
  "badiyos earning": "Our share (commission + delivery share + platform fee, without GST) of orders paid on these dates, minus our share of refunds made on these dates.",
};

type MKey = "orders" | "cancelled" | "gross" | "discount" | "refund" | "net" | "earning";
const METRICS: [MKey, string][] = [["orders", "Orders"], ["cancelled", "Cancelled"], ["gross", "Gross"], ["discount", "Discount"], ["refund", "Refunds"], ["net", "Net revenue"], ["earning", "Badiyos earning"]];
function NumCell({ v, money, ready, onOpen }: { v: number; money: boolean; ready: boolean; onOpen: (val: string) => void }) {
  const txt = money ? inr(v) : ready ? String(v) : "—";
  const live = ready && Math.round(Number(v || 0)) !== 0;
  return (
    <td className="px-4 py-3 text-right whitespace-nowrap">
      {live ? <button type="button" onClick={() => onOpen(txt)} className="hover:underline hover:text-primary font-[inherit]">{txt}</button> : txt}
    </td>
  );
}

function Th({ label, right = true }: { label: string; right?: boolean }) {
  return (
    <th className={`px-4 py-2.5 font-semibold whitespace-nowrap ${right ? "text-right" : ""}`}>
      <span className="inline-flex items-center gap-1" title={TIPS[label]}>
        {label}{TIPS[label] && <Info size={11} className="opacity-60" />}
      </span>
    </th>
  );
}

export function DashboardOverview({ role, onNavigate }: { role: StaffRole | null; onNavigate: (key: string) => void }) {
  const [range, setRange] = useState<Range>("today");
  const [panel, setPanel] = useState<{ group: TeamKey; busy: boolean } | null>(null);
  const [drill, setDrill] = useState<{ service: string; metric: string; title: string; value: string } | null>(null);
  const { from, to } = useMemo(() => rangeDates(range), [range]);
  const fetch = useServerFn(getDashboardOverview);
  const fetchTeam = useServerFn(getDashboardTeam);
  const fetchMoney = useServerFn(getDashboardMoney);
  const fetchDrill = useServerFn(getDashboardDrill);
  const drillQ = useQuery({ queryKey: ["dash-drill", drill?.service, drill?.metric, from, to], enabled: !!drill,
    queryFn: () => fetchDrill({ data: { service: drill!.service, metric: drill!.metric, from, to } }) });
  const q = useQuery({ queryKey: ["dash-overview", from, to], queryFn: () => fetch({ data: { from, to } }), refetchInterval: 60_000 });
  const money = useQuery({ queryKey: ["dash-money", from, to], queryFn: () => fetchMoney({ data: { from, to } }), refetchInterval: 60_000 }).data;
  const team = useQuery({ queryKey: ["dash-team"], queryFn: () => fetchTeam(), refetchInterval: 30_000 }).data;

  const noDevFn = useServerFn(listExpertsWithoutDevice);
  const noDev = useQuery({ queryKey: ["experts-no-device"], queryFn: () => noDevFn(), refetchInterval: 60_000 }).data ?? [];
  const fssaiFn = useServerFn(getFssaiAlerts);
  const fssai = useQuery({ queryKey: ["fssai-alerts"], queryFn: () => fssaiFn(), refetchInterval: 300_000 }).data ?? [];
  const d = q.data as { services?: Record<string, Record<string, number | null>>; alerts?: Record<string, number> } | undefined;
  const a = d?.alerts ?? {};
  const approvals = Number(a.pending_products_store ?? 0) + Number(a.pending_products_food ?? 0);
  const alerts = [
    { n: approvals, label: "Approvals pending", nav: Number(a.pending_products_store ?? 0) > 0 ? "store-orders" : "food-orders" },
    { n: Number(a.refunds_failed ?? 0), label: "Refunds failed", nav: "fin-refunds" },
    { n: Number(a.instant_to_pay ?? 0), label: "Instant pay today", nav: "fin-instant" },
    { n: Number(a.carry_forward_merchants ?? 0), label: "Carry-forward merchants", nav: "fin-settlements" },
    { n: fssai.length, label: "Restaurant FSSAI expiring/expired", nav: "food-orders" },
    { n: noDev.length, label: `Experts not receiving job alerts${noDev.some((x) => x.online) ? ` (${noDev.filter((x) => x.online).length} online)` : ""}`, nav: "clean-experts" },
  ].filter((x) => x.n > 0);

  const count = (g: TeamKey, busy: boolean) => (team ? team.filter((t) => t.group === g && t.busy === busy).length : null);
  const panelRows = panel && team ? team.filter((t) => t.group === panel.group && t.busy === panel.busy) : [];

  const rows = ROWS.map((r) => {
    const v = d?.services?.[r.key] ?? {};
    const m = money?.[r.key];
    return { r, orders: Number(m?.orders ?? 0), cancelled: Number(v.cancelled ?? 0), gross: m?.gross ?? 0, discount: m?.discount ?? 0, refund: m?.refund ?? 0, net: m?.net ?? 0, earning: Number(m?.earning ?? 0) };
  });
  const tot = rows.reduce((t, x) => ({ orders: t.orders + x.orders, cancelled: t.cancelled + x.cancelled, gross: t.gross + x.gross, discount: t.discount + x.discount, refund: t.refund + x.refund, net: t.net + x.net, earning: t.earning + x.earning }),
    { orders: 0, cancelled: 0, gross: 0, discount: 0, refund: 0, net: 0, earning: 0 });
  const ready = !!q.data && !!money;
  const cell = "px-4 py-3 text-right whitespace-nowrap";

  return (
    <div className="space-y-8 bg-background">
      <PipelineKanban role={role} unified />

      <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
        {TEAM.flatMap((t) => [false, true].map((busy) => (
          <button key={t.key + busy} type="button" onClick={() => setPanel({ group: t.key, busy })}
            className="rounded-[14px] border border-border bg-card px-4 py-3 text-left hover:border-primary/60">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">{busy ? "Busy" : "Free"} {t.label}</p>
            <p className={`text-[22px] font-bold ${busy ? "text-foreground" : "text-primary"}`}>{count(t.key, busy) ?? "—"}</p>
          </button>
        )))}
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[15px] font-bold">Summary</p>
          <div className="inline-flex rounded-full border border-border p-0.5 text-[12px] font-bold">
            {([["today", "Today"], ["yesterday", "Yesterday"], ["7d", "7 days"], ["30d", "30 days"]] as [Range, string][]).map(([k, l]) => (
              <button key={k} onClick={() => setRange(k)} className={`px-3 h-7 rounded-full ${range === k ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{l}</button>
            ))}
          </div>
        </div>
        {q.isError && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}
        <div className="overflow-x-auto rounded-[14px] border border-border bg-card">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
                <Th label="Service" right={false} /><Th label="Orders" /><Th label="Cancelled" /><Th label="Gross" /><Th label="Discount" /><Th label="Refunds" /><Th label="Net revenue" /><Th label="badiyos earning" />
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.r.key} className="border-b border-border hover:bg-muted/40">
                  <td className="px-4 py-3 font-semibold whitespace-nowrap cursor-pointer hover:underline" onClick={() => onNavigate(x.r.nav)}>
                    <span className="inline-flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${SERVICE_META[x.r.key].dot}`} />{SERVICE_META[x.r.key].label}</span>
                  </td>
                  {METRICS.map(([k, l]) => <NumCell key={k} v={x[k]} money={k !== "orders" && k !== "cancelled"} ready={ready}
                    onOpen={(val) => setDrill({ service: x.r.key, metric: k, title: `${SERVICE_META[x.r.key].label} · ${l}`, value: val })} />)}
                </tr>
              ))}
              <tr className="bg-muted/40 font-bold">
                <td className="px-4 py-3">Total</td>
                {METRICS.map(([k, l]) => <NumCell key={k} v={tot[k]} money={k !== "orders" && k !== "cancelled"} ready={ready}
                  onOpen={(val) => setDrill({ service: "all", metric: k, title: `All services · ${l}`, value: val })} />)}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
          {alerts.map((x) => (
            <button key={x.label} onClick={() => onNavigate(x.nav)} className="text-destructive font-semibold hover:underline">
              {x.label} {x.n}
            </button>
          ))}
        </div>
      )}

      <Sheet open={!!drill} onOpenChange={(o) => !o && setDrill(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{drill?.title} · {drill?.value}</SheetTitle>
            <p className="text-[12px] text-muted-foreground">{from === to ? from : `${from} → ${to}`} · {drillQ.data?.length ?? 0} {drill?.metric === "refund" ? "refunds" : "orders"}</p>
          </SheetHeader>
          <div className="mt-4 divide-y divide-border">
            {drillQ.isLoading && <p className="py-6 text-[13px] text-muted-foreground">Loading…</p>}
            {drillQ.isError && <p className="py-6 text-[13px] text-destructive">{(drillQ.error as Error).message}</p>}
            {drillQ.data?.length === 0 && <p className="py-6 text-[13px] text-muted-foreground">No orders.</p>}
            {drillQ.data?.map((o) => (
              <button key={o.kind + o.id + o.at} type="button" onClick={() => { setDrill(null); onNavigate(ROWS.find((r) => r.key === o.svc)?.nav ?? "maid-bookings"); }}
                className="w-full py-3 flex items-start justify-between gap-3 text-left hover:bg-muted/40 px-1 rounded">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-[14px] font-semibold text-foreground truncate">
                    <span className={`inline-block h-2 w-2 rounded-full mr-2 ${SERVICE_META[o.svc as BoardService]?.dot ?? ""}`} />{o.num}
                    <span className="ml-2 text-[11px] font-medium uppercase text-muted-foreground">{o.status?.replace(/_/g, " ")}</span>
                  </p>
                  <p className="text-[12px] text-muted-foreground truncate">{[o.name, o.phone, o.label].filter(Boolean).join(" · ") || "—"}</p>
                  <p className="text-[11px] text-muted-foreground">{o.at ? new Date(o.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : ""}</p>
                </div>
                <p className={`text-[14px] font-bold whitespace-nowrap ${drill?.metric === "refund" ? "text-destructive" : "text-foreground"}`}>{drill?.metric === "refund" ? "−" : ""}{inr(o.amount)}</p>
              </button>
            ))}
          </div>
          {drill && drill.metric !== "orders" && drill.metric !== "cancelled" && (
            <p className="mt-4 text-[11px] text-muted-foreground">{drill.metric === "refund" ? "Amounts shown are what was actually refunded to the customer (with GST)." : "Amounts shown are what the customer paid (with GST). The Summary figure is without GST."}</p>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={!!panel} onOpenChange={(o) => !o && setPanel(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{panel ? `${panel.busy ? "Busy" : "Free"} ${TEAM.find((t) => t.key === panel.group)?.label}` : ""} · {panelRows.length}</SheetTitle>
          </SheetHeader>
          <div className="mt-4 divide-y divide-border">
            {panelRows.length === 0 && <p className="py-6 text-[13px] text-muted-foreground">Nobody right now.</p>}
            {panelRows.map((p) => (
              <div key={p.id} className="py-3 flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-[14px] font-semibold text-foreground truncate">{p.name}</p>
                  <p className="text-[12px] text-muted-foreground truncate">{[p.zone, p.vehicle].filter(Boolean).join(" · ") || "—"}</p>
                  {p.busy ? (
                    <p className="text-[12px] text-foreground truncate">{p.job ? `${p.job.label} · ${p.job.status.replace(/_/g, " ").toLowerCase()}${p.job.area ? ` · ${p.job.area}` : ""}` : "Busy"}</p>
                  ) : (
                    <p className="text-[12px] text-muted-foreground truncate">Free for {ago(p.free_since)} · seen {ago(p.last_seen)} ago</p>
                  )}
                </div>
                {p.phone && (
                  <a href={`tel:${p.phone}`} className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-full border border-border text-primary" aria-label={`Call ${p.name}`}>
                    <Phone size={15} />
                  </a>
                )}
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
