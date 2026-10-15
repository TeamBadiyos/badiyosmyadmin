import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MapPin, BellRing } from "lucide-react";
import { FilterBar, FilterField, filterSelectCls, countLabel } from "@/components/section-chrome";
import { getInterestLeads } from "@/lib/interest-leads.functions";
import { toast } from "sonner";
import { getWaitlistOverview, notifyWaitlistArea } from "@/lib/waitlist.functions";

type StaffRole = "super_admin" | "ops_manager" | "area_partner";

export function WaitlistPage({ role }: { role: StaffRole | null }) {
  const canView = role === null || role === "super_admin" || role === "ops_manager";
  const [segmentId, setSegmentId] = useState("");
  const [notifyingKey, setNotifyingKey] = useState<string | null>(null);
  const fetchOverview = useServerFn(getWaitlistOverview);
  const notifyArea = useServerFn(notifyWaitlistArea);

  const fetchLeads = useServerFn(getInterestLeads);
  const { data: raw, isLoading, isError, refetch } = useQuery({
    queryKey: ["waitlist", "overview", segmentId],
    queryFn: () => fetchOverview({ data: { segmentId: segmentId || null } }),
    staleTime: 15_000,
    refetchInterval: 30_000,
    enabled: canView,
  });
  const { data: leads } = useQuery({
    queryKey: ["interest-leads"],
    queryFn: () => fetchLeads(),
    refetchInterval: 30_000,
    enabled: canView && !segmentId,
  });

  // Merge website "City requests" into the same city list.
  const data = (() => {
    if (!raw) return raw;
    const cityLeads = segmentId ? [] : (leads?.city ?? []);
    if (!cityLeads.length) return raw;
    const groups = raw.groups.map((g) => ({ ...g, segments: [...g.segments] }));
    const byCity = new Map<string, { n: number; latest: string }>();
    for (const l of cityLeads) {
      const k = (l.city || "Unknown city").trim();
      const cur = byCity.get(k.toLowerCase());
      byCity.set(k.toLowerCase(), {
        n: (cur?.n ?? 0) + 1,
        latest: !cur || l.created_at > cur.latest ? l.created_at : cur.latest,
      });
      if (!cur) byCity.set(`__name_${k.toLowerCase()}`, { n: 0, latest: k });
    }
    for (const [k, v] of byCity) {
      if (k.startsWith("__name_")) continue;
      const name = byCity.get(`__name_${k}`)!.latest;
      const g = groups.find((x) => x.city.toLowerCase() === k);
      const seg = { id: "__city_request", name: "Website city request", count: v.n };
      if (g) {
        g.segments.push(seg);
        g.count += v.n;
        g.waiting += v.n;
        if (v.latest > g.latestAt) g.latestAt = v.latest;
      } else {
        groups.push({ key: `city-${k}`, city: name, area: "Website request", segments: [seg], count: v.n, waiting: v.n, notified: 0, latestAt: v.latest, websiteOnly: true } as typeof groups[number]);
      }
    }
    groups.sort((x, y) => y.count - x.count);
    return { ...raw, groups, total: raw.total + cityLeads.length };
  })();

  if (!canView) {
    return (
      <p className="text-[14px] text-muted-foreground">
        You do not have access to the waitlist.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-3">
        {[
          { l: "Total", v: data?.total ?? 0 },
          { l: "Waiting", v: (data?.total ?? 0) - (data?.totalNotified ?? 0) },
          { l: "Notified", v: data?.totalNotified ?? 0 },
        ].map((c) => (
          <div key={c.l} className="rounded-[14px] border border-border bg-card px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{c.l}</p>
            <p className="text-[22px] font-bold leading-tight">{c.v}</p>
          </div>
        ))}
      </div>

      <FilterBar count={<span className="text-[13px] text-muted-foreground">{countLabel(data?.groups.length ?? 0, "area")}</span>}>
        <FilterField label="Service">
          <select value={segmentId} onChange={(e) => setSegmentId(e.target.value)} className={filterSelectCls}>
            <option value="">All services</option>
            {(raw?.segments ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </FilterField>
        <p className="text-[12px] text-muted-foreground self-end pb-2">Waiting customers are notified automatically when an Expert is free nearby.</p>
      </FilterBar>

      {isLoading ? (
        <p className="text-[14px] text-muted-foreground">Loading waitlist…</p>
      ) : isError ? (
        <p className="text-[14px] text-red-600">Could not load waitlist requests.</p>
      ) : (data?.groups.length ?? 0) === 0 ? (
        <p className="text-[14px] text-muted-foreground">No demand requests yet.</p>
      ) : (
        <div className="rounded-[16px] border border-border bg-card overflow-x-auto">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead className="bg-muted">
              <tr className="text-left text-muted-foreground">
                <th className="px-5 py-3 font-semibold">City / Area</th>
                <th className="px-5 py-3 font-semibold">Service</th>
                <th className="px-5 py-3 font-semibold text-right">Requests</th>
                <th className="px-5 py-3 font-semibold text-right">Waiting / Notified</th>
                <th className="px-5 py-3 font-semibold text-right">Latest</th>
                <th className="px-5 py-3 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {data!.groups.map((g) => (
                <tr key={g.key} className="border-t border-border align-top">
                  <td className="px-5 py-3">
                    <div className="flex items-start gap-2">
                      <MapPin size={15} className="mt-0.5 text-primary shrink-0" />
                      <div className="min-w-[200px] max-w-[280px]">
                        <p className="font-semibold text-foreground">{g.city}</p>
                        <p className="text-muted-foreground line-clamp-2">{g.area}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {g.segments.map((s) => (
                        <span
                          key={s.id}
                          className="px-2 py-0.5 rounded-full bg-primary-tint text-[11px] font-semibold whitespace-nowrap"
                        >
                          {s.name} · {s.count}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right font-bold text-[15px]">{g.count}</td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <span className="font-semibold">{g.waiting}</span>
                    <span className="text-muted-foreground"> / {g.notified}</span>
                  </td>
                  <td className="px-5 py-3 text-right text-muted-foreground whitespace-nowrap">
                    {new Date(g.latestAt).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Kolkata" })}
                  </td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <button
                      disabled={g.waiting === 0 || notifyingKey === g.key || (g as { websiteOnly?: boolean }).websiteOnly}
                      onClick={async () => {
                        setNotifyingKey(g.key);
                        try {
                          const res = await notifyArea({
                            data: {
                              city: g.city === "Unknown city" ? null : g.city,
                              segmentId: segmentId || null,
                            },
                          });
                          toast.success(
                            res.notified > 0
                              ? `Notified ${res.notified} waiting customer${res.notified === 1 ? "" : "s"}`
                              : "No waiting customers to notify",
                          );
                          refetch();
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Could not notify");
                        } finally {
                          setNotifyingKey(null);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-[10px] border border-border px-3 py-1.5 text-[12px] font-semibold hover:bg-muted disabled:opacity-50"
                    >
                      <BellRing size={13} />
                      {notifyingKey === g.key ? "Notifying…" : "Notify"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
