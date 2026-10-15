import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, BellRing, Bike, CircleDot, Percent, Timer, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ServiceHoursEditor } from "@/components/courier/service-hours-section";
import { getCourierAccess } from "@/lib/courier.functions";
import { listServiceControl } from "@/lib/service-control.functions";
import { CommerceKanban } from "@/components/commerce-kanban";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SERVICE_LABEL: Record<string, string> = { clean: "Clean", store: "Store", food: "Food", courier: "Parcel", parcel: "Parcel" };

function hhmm(t: string | null | undefined) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/* -------- Live Ops: Store & Food live board -------- */
export function StoreFoodLiveBoard() {
  const [svc, setSvc] = useState<"all" | "store" | "food">("all");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(["all", "store", "food"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setSvc(k)}
            className={`rounded-[10px] px-3.5 py-2 text-[12px] font-semibold ${svc === k ? "bg-primary text-primary-foreground" : "border border-border text-foreground hover:bg-muted"}`}>
            {k === "all" ? "All" : k === "store" ? "Store" : "Food"}
          </button>
        ))}
      </div>
      <CommerceKanban key={svc} segmentId={null} service={svc === "all" ? null : svc} />
    </div>
  );
}

/* -------- Service hours (writes to the same service_flags / service_hours) -------- */
function useServiceControl() {
  const fetchAccess = useServerFn(getCourierAccess);
  const fetchControl = useServerFn(listServiceControl);
  const access = useQuery({ queryKey: ["services", "access"], queryFn: () => fetchAccess(), retry: false });
  const control = useQuery({ queryKey: ["services", "control"], queryFn: () => fetchControl() });
  return { access, control };
}

export function ServiceHoursPanel({ serviceKey, title }: { serviceKey: string; title?: string }) {
  const qc = useQueryClient();
  const { access, control } = useServiceControl();
  if (control.isLoading || access.isLoading) return <p className="text-[13px] text-muted-foreground">Loading hours…</p>;
  if (!control.data) return <p className="text-[13px] text-muted-foreground">You do not have access to service hours.</p>;
  const canWrite = Boolean(access.data?.canWrite && control.data.canWrite);
  const flags = control.data.flags.filter((f) => f.service_key === serviceKey);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["services"] });
    qc.invalidateQueries({ queryKey: ["courier"] });
  };
  if (!flags.length) return <p className="text-[13px] text-muted-foreground">No service status row exists for this service yet.</p>;
  return (
    <div className="space-y-4">
      {flags.map((flag) => (
        <section key={flag.id} className="rounded-[16px] border border-border bg-card p-4">
          <p className="mb-3 text-[15px] font-bold text-foreground">
            {title ?? "Opening hours"} <span className="ml-1 rounded-full bg-info/10 px-2 py-0.5 text-[11px] font-semibold text-info">{flag.city}</span>
          </p>
          {!canWrite ? <p className="mb-2 text-[12px] text-muted-foreground">Read-only — only a super admin can change hours.</p> : null}
          <ServiceHoursEditor flag={flag} hours={control.data!.hours} holidays={control.data!.holidays} canWrite={canWrite} onSaved={refresh} />
        </section>
      ))}
    </div>
  );
}

/** Read-only weekly hours for every service, with a link to where each is edited. */
export function WeeklyHoursSummary({ onEdit }: { onEdit: (serviceKey: string) => void }) {
  const { control } = useServiceControl();
  if (!control.data) return null;
  const { flags, hours } = control.data;
  return (
    <section className="overflow-x-auto rounded-[16px] border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-[15px] font-bold text-foreground">Weekly hours (read-only)</h3>
        <p className="text-[12px] text-muted-foreground">Hours are edited in each service's own Settings tab.</p>
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="p-3">Service</th>
            {WEEKDAYS.map((d) => <th key={d} className="p-3">{d}</th>)}
            <th className="p-3"></th>
          </tr>
        </thead>
        <tbody>
          {flags.map((f) => {
            const rows = hours.filter((h) => h.service_flag_id === f.id);
            return (
              <tr key={f.id} className="border-b border-border last:border-0">
                <td className="p-3 font-semibold text-foreground whitespace-nowrap">{f.label ?? f.service_key} · {f.city}{!f.hours_enabled ? <span className="ml-1 text-muted-foreground">(hours off)</span> : null}</td>
                {WEEKDAYS.map((_, i) => {
                  const r = rows.find((x) => x.weekday === i);
                  return (
                    <td key={i} className="p-3 whitespace-nowrap text-foreground">
                      {!r ? "—" : r.is_closed ? <span className="text-destructive">Closed</span> : `${hhmm(r.open_time)}–${hhmm(r.close_time)}`}
                    </td>
                  );
                })}
                <td className="p-3">
                  <button type="button" onClick={() => onEdit(f.service_key)} className="whitespace-nowrap rounded-[10px] border border-border px-3 py-1.5 font-semibold text-primary hover:bg-muted">
                    Edit in {SERVICE_LABEL[f.service_key] ?? f.service_key}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/* -------- Notify-Me stats (last 7 days) -------- */
export function NotifyStatsCard({ services, reason, title }: { services: string[]; reason: string; title: string }) {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const q = useQuery({
    queryKey: ["notify-stats", services.join(","), reason],
    queryFn: async () => {
      const { data, error } = await db
        .from("notify_requests")
        .select("service_type, notified_at, converted_order_id, status")
        .in("service_type", services)
        .eq("reason", reason)
        .gte("created_at", since)
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as Array<{ service_type: string; notified_at: string | null; converted_order_id: string | null; status: string }>;
    },
    refetchInterval: 60_000,
  });
  const rows = q.data ?? [];
  const stat = (svc: string) => {
    const r = rows.filter((x) => x.service_type === svc);
    return {
      attempted: r.length,
      notified: r.filter((x) => x.notified_at || x.status === "notified" || x.status === "converted").length,
      converted: r.filter((x) => x.converted_order_id || x.status === "converted").length,
    };
  };
  return (
    <section className="rounded-[16px] border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <BellRing size={16} className="text-primary" />
        <h3 className="text-[15px] font-bold text-foreground">{title}</h3>
      </div>
      <p className="mt-0.5 text-[12px] text-muted-foreground">Last 7 days · reason "{reason}"</p>
      {q.isError ? <p className="mt-2 text-[12px] text-destructive">Could not load (only super admin can read notify-me records).</p> : null}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead><tr className="text-left text-muted-foreground"><th className="py-1.5 pr-3">Service</th><th className="py-1.5 pr-3">Attempted</th><th className="py-1.5 pr-3">Notified</th><th className="py-1.5">Converted</th></tr></thead>
          <tbody>
            {services.map((s) => {
              const st = stat(s);
              return (
                <tr key={s} className="border-t border-border">
                  <td className="py-2 pr-3 font-semibold text-foreground">{SERVICE_LABEL[s] ?? s}</td>
                  <td className="py-2 pr-3">{q.isLoading ? "—" : st.attempted}</td>
                  <td className="py-2 pr-3">{q.isLoading ? "—" : st.notified}</td>
                  <td className="py-2">{q.isLoading ? "—" : st.converted}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* -------- Parcel: Riders & Capacity -------- */
export function RidersCapacityPanel() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["riders", "capacity"],
    queryFn: async () => {
      const { data, error } = await db.from("experts").select("id, is_online, is_busy").eq("is_online", true).limit(5000);
      if (error) throw error;
      const rows = (data ?? []) as Array<{ is_online: boolean; is_busy: boolean }>;
      const online = rows.length;
      const busy = rows.filter((r) => r.is_busy).length;
      return { online, busy, free: online - busy };
    },
    refetchInterval: 30_000,
  });
  useEffect(() => {
    const ch = supabase
      .channel("riders-capacity")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "experts" }, () => qc.invalidateQueries({ queryKey: ["riders", "capacity"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);
  const d = q.data;
  const util = d && d.online > 0 ? Math.round((d.busy / d.online) * 100) : 0;
  const allBusy = !!d && d.free <= 0;
  const cards = [
    { label: "Online riders", value: d?.online, icon: Users },
    { label: "Busy riders", value: d?.busy, icon: Bike },
    { label: "Free riders", value: d?.free, icon: CircleDot },
    { label: "Fleet utilization", value: d ? `${util}%` : undefined, icon: Percent },
  ];
  return (
    <div className="space-y-4">
      {allBusy ? (
        <div className="flex items-center gap-2 rounded-[12px] border border-destructive/40 bg-destructive/10 px-4 py-3 text-[13px] font-semibold text-foreground">
          <AlertTriangle size={16} className="shrink-0 text-destructive" />
          All riders busy — customers now see the "Notify me" option in the app.
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="rounded-[18px] border border-border bg-card p-4">
              <div className="flex items-start justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{c.label}</p>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-tint text-primary"><Icon size={16} /></div>
              </div>
              <p className="mt-3 text-[24px] font-bold leading-none text-foreground">{q.isLoading ? "—" : c.value ?? "—"}</p>
            </div>
          );
        })}
      </div>
      <p className="text-[12px] text-muted-foreground">Rider pool is shared with all online Experts (same rule the app uses: online and not busy = free).</p>
      <NotifyStatsCard services={["store", "food", "parcel"]} reason="riders_busy" title="Notify-Me (riders busy)" />
    </div>
  );
}

/* -------- Clean: tax callout -------- */
export function CleanTaxCallout({ onOpenTax }: { onOpenTax: () => void }) {
  const q = useQuery({
    queryKey: ["platform", "tax", "clean"],
    queryFn: async () => {
      const { data, error } = await db.from("tax_settings").select("key, rate_pct, is_active").in("key", ["maid_gst", "wash_gst"]);
      if (error) throw error;
      return (data ?? []) as Array<{ key: string; rate_pct: number; is_active: boolean }>;
    },
  });
  const get = (k: string) => q.data?.find((t) => t.key === k);
  const maid = get("maid_gst");
  const wash = get("wash_gst");
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-border bg-muted px-4 py-3 text-[13px]">
      <div className="space-y-0.5 text-foreground">
        <p><span className="font-semibold">Maid GST:</span> {maid ? (maid.is_active ? `${maid.rate_pct}% on` : "off (awaiting CA)") : "—"}</p>
        <p><span className="font-semibold">Wash GST:</span> {wash ? (wash.is_active ? `${wash.rate_pct}% on` : "off") : "—"}</p>
      </div>
      <button type="button" onClick={onOpenTax} className="rounded-[10px] border border-border bg-card px-3 py-1.5 text-[12px] font-semibold text-primary hover:bg-muted">
        Open Tax Settings
      </button>
    </section>
  );
}

export function ParcelGstNote() {
  const q = useQuery({
    queryKey: ["platform", "tax", "parcel"],
    queryFn: async () => {
      const { data, error } = await db.from("tax_settings").select("rate_pct, is_active").eq("key", "parcel_delivery_gst").maybeSingle();
      if (error) throw error;
      return data as { rate_pct: number; is_active: boolean } | null;
    },
  });
  return (
    <div className="space-y-1 rounded-[12px] border border-info/30 bg-info/10 px-4 py-3 text-[12px] text-foreground">
      <p className="font-semibold">Store delivery uses these rates; Food has its own rates in Food → Settings.</p>
      <p className="flex items-center gap-1.5"><Timer size={13} className="text-info" />
        Parcel delivery GST: {q.data ? `${q.data.rate_pct}%${q.data.is_active ? "" : " (off)"}` : "—"} on top of the base fare (read-only, change in Platform Settings → Tax Settings).
      </p>
    </div>
  );
}
