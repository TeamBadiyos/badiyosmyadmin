import { exportPhone, knownRole } from "@/lib/export-guard";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download } from "lucide-react";
import { FilterBar, FilterField, filterSelectCls, countLabel } from "@/components/section-chrome";
import { getDemandTopNames, DEMAND_LABEL, type TopName } from "@/lib/waitlist.functions";

const fmt = (s: string) =>
  new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

function exportCsv(rows: TopName[]) {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["City", "Service", "Name", "Customers", "Latest", "Spellings", "Phones"];
  const body = rows.map((r) => [r.city, DEMAND_LABEL[r.service] ?? r.service, r.name, r.customers, fmt(r.latest_at), r.spellings.join("; "), r.phones.map((p) => exportPhone(p, knownRole())).join("; ")].map(esc).join(","));
  const blob = new Blob([[head.join(","), ...body].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `most-requested-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function DemandTopNames() {
  const fn = useServerFn(getDemandTopNames);
  const { data, isLoading, isError } = useQuery({ queryKey: ["waitlist", "top-names"], queryFn: () => fn() });
  const [city, setCity] = useState("");
  const [service, setService] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const all = data ?? [];
  const cities = useMemo(() => [...new Set(all.map((r) => r.city))].sort(), [all]);
  const services = useMemo(() => [...new Set(all.map((r) => r.service))].sort(), [all]);
  const rows = all.filter((r) => (!city || r.city === city) && (!service || r.service === service));

  return (
    <div className="space-y-4">
      <FilterBar count={<span className="text-[13px] text-muted-foreground">{countLabel(rows.length, "name")}</span>}>
        <FilterField label="City">
          <select value={city} onChange={(e) => setCity(e.target.value)} className={filterSelectCls}>
            <option value="">All cities</option>
            {cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </FilterField>
        <FilterField label="Service">
          <select value={service} onChange={(e) => setService(e.target.value)} className={filterSelectCls}>
            <option value="">All services</option>
            {services.map((s) => <option key={s} value={s}>{DEMAND_LABEL[s] ?? s}</option>)}
          </select>
        </FilterField>
        <button onClick={() => exportCsv(rows)} disabled={!rows.length}
          className="self-end inline-flex items-center gap-1.5 h-9 rounded-[10px] border border-border bg-card px-3 text-[13px] font-semibold hover:bg-muted disabled:opacity-50">
          <Download size={14} /> Export CSV
        </button>
      </FilterBar>
      {isLoading ? <p className="text-[14px] text-muted-foreground">Loading…</p>
        : isError ? <p className="text-[14px] text-destructive">Could not load names.</p>
        : rows.length === 0 ? <p className="text-[14px] text-muted-foreground">No hotel/shop names requested yet.</p>
        : (
          <div className="rounded-[16px] border border-border bg-card overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead className="bg-muted"><tr className="text-left text-muted-foreground">
                {["Name", "City", "Service", "Customers", "Latest", "Phones"].map((h) => <th key={h} className="px-5 py-2 font-semibold">{h}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const k = `${r.city}|${r.service}|${r.name}`;
                  const isOpen = open === k;
                  return (
                    <tr key={k} className="border-t border-border align-top">
                      <td className="px-5 py-2"><p className="font-semibold">{r.name}</p>
                        {r.spellings.length > 1 && <p className="text-[11px] text-muted-foreground">Also: {r.spellings.filter((s) => s !== r.name).join(", ")}</p>}</td>
                      <td className="px-5 py-2">{r.city}</td>
                      <td className="px-5 py-2">{DEMAND_LABEL[r.service] ?? r.service}</td>
                      <td className="px-5 py-2 font-bold">{r.customers}</td>
                      <td className="px-5 py-2 whitespace-nowrap">{fmt(r.latest_at)}</td>
                      <td className="px-5 py-2">
                        {r.phones.length === 0 ? "—" : (
                          <button onClick={() => setOpen(isOpen ? null : k)} className="text-primary underline text-left">
                            {isOpen ? r.phones.join(", ") : `${r.phones.length} phone${r.phones.length === 1 ? "" : "s"}`}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}
