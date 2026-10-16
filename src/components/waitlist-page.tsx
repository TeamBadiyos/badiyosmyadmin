import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MapPin, BellRing, Download, ChevronDown, ChevronRight } from "lucide-react";
import { FilterBar, FilterField, filterSelectCls, countLabel } from "@/components/section-chrome";
import { toast } from "sonner";
import { getWaitlistOverview, notifyWaitlistArea, DEMAND_LABEL, type DemandRow } from "@/lib/waitlist.functions";

type StaffRole = "super_admin" | "ops_manager" | "area_partner" | "finance";
const SOURCE_LABEL: Record<string, string> = { "outside-city": "Outside city", "coming-soon": "Coming soon tab", website: "Website" };
const fmt = (s: string) =>
  new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

function csv(rows: DemandRow[]) {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["City", "Area", "Services", "Phone", "Source", "Latitude", "Longitude", "Status", "Submitted (IST)"];
  const body = rows.map((r) =>
    [r.city, r.area, r.services.map((s) => DEMAND_LABEL[s] ?? s).join("; "), r.phone, SOURCE_LABEL[r.source] ?? r.source,
      r.latitude, r.longitude, r.notified ? "Notified" : "Waiting", fmt(r.createdAt)].map(esc).join(","),
  );
  const blob = new Blob([[head.join(","), ...body].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `demand-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function WaitlistPage({ role }: { role: StaffRole | null }) {
  const canView = role === null || role === "super_admin" || role === "ops_manager";
  const [service, setService] = useState("");
  const [source, setSource] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [notifying, setNotifying] = useState<string | null>(null);
  const fetchOverview = useServerFn(getWaitlistOverview);
  const notifyArea = useServerFn(notifyWaitlistArea);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["waitlist", "demand"],
    queryFn: () => fetchOverview(),
    refetchInterval: 30_000,
    enabled: canView,
  });

  const cities = useMemo(() => {
    return (data?.cities ?? [])
      .map((c) => {
        const rows = c.rows.filter((r) => (!service || r.services.includes(service)) && (!source || r.source === source));
        const services: Record<string, number> = {};
        for (const r of rows) for (const s of r.services) services[s] = (services[s] ?? 0) + 1;
        return { ...c, rows, services, total: rows.length, waiting: rows.filter((r) => !r.notified).length, notified: rows.filter((r) => r.notified).length };
      })
      .filter((c) => c.total > 0);
  }, [data, service, source]);
  const allRows = cities.flatMap((c) => c.rows);

  if (!canView) return <p className="text-[14px] text-muted-foreground">You do not have access to Demand.</p>;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-3">
        {[
          { l: "Total", v: allRows.length },
          { l: "Waiting", v: allRows.filter((r) => !r.notified).length },
          { l: "Notified", v: allRows.filter((r) => r.notified).length },
        ].map((c) => (
          <div key={c.l} className="rounded-[14px] border border-border bg-card px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{c.l}</p>
            <p className="text-[22px] font-bold leading-tight">{c.v}</p>
          </div>
        ))}
      </div>

      <FilterBar count={<span className="text-[13px] text-muted-foreground">{countLabel(cities.length, "city")}</span>}>
        <FilterField label="Service">
          <select value={service} onChange={(e) => setService(e.target.value)} className={filterSelectCls}>
            <option value="">All services</option>
            {["maid", "clean_auto", "grocery", "food", "parcel", "website"].map((s) => <option key={s} value={s}>{DEMAND_LABEL[s]}</option>)}
          </select>
        </FilterField>
        <FilterField label="Source">
          <select value={source} onChange={(e) => setSource(e.target.value)} className={filterSelectCls}>
            <option value="">All sources</option>
            {Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </FilterField>
        <button
          onClick={() => csv(allRows)}
          disabled={!allRows.length}
          className="self-end inline-flex items-center gap-1.5 h-9 rounded-[10px] border border-border bg-card px-3 text-[13px] font-semibold hover:bg-muted disabled:opacity-50"
        >
          <Download size={14} /> Export CSV
        </button>
      </FilterBar>

      {isLoading ? (
        <p className="text-[14px] text-muted-foreground">Loading demand…</p>
      ) : isError ? (
        <p className="text-[14px] text-destructive">Could not load demand requests.</p>
      ) : cities.length === 0 ? (
        <p className="text-[14px] text-muted-foreground">No demand requests yet.</p>
      ) : (
        <div className="space-y-3">
          {cities.map((c) => {
            const isOpen = open === c.city;
            return (
              <div key={c.city} className="rounded-[16px] border border-border bg-card">
                <div className="flex flex-wrap items-center gap-3 px-5 py-4">
                  <button onClick={() => setOpen(isOpen ? null : c.city)} className="flex items-center gap-2 min-w-[180px] text-left">
                    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <MapPin size={15} className="text-primary" />
                    <span className="font-bold text-[15px]">{c.city}</span>
                  </button>
                  <div className="flex flex-wrap gap-1.5 flex-1">
                    {Object.entries(c.services).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
                      <span key={s} className="px-2 py-0.5 rounded-full bg-primary-tint text-[11px] font-semibold whitespace-nowrap">
                        {DEMAND_LABEL[s] ?? s} · {n}
                      </span>
                    ))}
                  </div>
                  <div className="text-right text-[13px]">
                    <p><span className="font-bold text-[15px]">{c.total}</span> <span className="text-muted-foreground">requests · {c.waiting} waiting</span></p>
                    <p className="text-[12px] text-muted-foreground">Latest {fmt(c.latestAt)}</p>
                  </div>
                  <button
                    disabled={c.rows.every((r) => r.notified || r.source === "website") || notifying === c.city}
                    onClick={async () => {
                      setNotifying(c.city);
                      try {
                        const res = await notifyArea({ data: { city: c.city === "Unknown city" ? null : c.city } });
                        toast.success(res.notified > 0 ? `Notified ${res.notified} waiting customer${res.notified === 1 ? "" : "s"}` : "No waiting customers to notify");
                        refetch();
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Could not notify");
                      } finally {
                        setNotifying(null);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-[10px] border border-border px-3 py-1.5 text-[12px] font-semibold hover:bg-muted disabled:opacity-50"
                  >
                    <BellRing size={13} /> {notifying === c.city ? "Notifying…" : "Notify"}
                  </button>
                </div>
                {isOpen && (
                  <div className="border-t border-border overflow-x-auto">
                    <table className="w-full min-w-[760px] text-[13px]">
                      <thead className="bg-muted">
                        <tr className="text-left text-muted-foreground">
                          <th className="px-5 py-2 font-semibold">Submitted</th>
                          <th className="px-5 py-2 font-semibold">Area</th>
                          <th className="px-5 py-2 font-semibold">Services</th>
                          <th className="px-5 py-2 font-semibold">Phone</th>
                          <th className="px-5 py-2 font-semibold">Source</th>
                          <th className="px-5 py-2 font-semibold">Location</th>
                          <th className="px-5 py-2 font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.rows.map((r) => (
                          <tr key={r.id} className="border-t border-border">
                            <td className="px-5 py-2 whitespace-nowrap">{fmt(r.createdAt)}</td>
                            <td className="px-5 py-2 max-w-[240px] truncate">{r.area ?? "—"}</td>
                            <td className="px-5 py-2">{r.services.map((s) => DEMAND_LABEL[s] ?? s).join(", ") || "—"}</td>
                            <td className="px-5 py-2 whitespace-nowrap">{r.phone ?? "—"}</td>
                            <td className="px-5 py-2 whitespace-nowrap">{SOURCE_LABEL[r.source] ?? r.source}</td>
                            <td className="px-5 py-2 whitespace-nowrap">
                              {r.latitude != null && r.longitude != null ? (
                                <a className="text-primary underline" target="_blank" rel="noreferrer" href={`https://maps.google.com/?q=${r.latitude},${r.longitude}`}>Map</a>
                              ) : "—"}
                            </td>
                            <td className="px-5 py-2">{r.notified ? "Notified" : "Waiting"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
