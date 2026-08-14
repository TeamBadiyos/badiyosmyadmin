import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, MapPin } from "lucide-react";
import { getWaitlistOverview } from "@/lib/waitlist.functions";

type StaffRole = "super_admin" | "ops_manager" | "area_partner";

export function WaitlistPage({ role }: { role: StaffRole | null }) {
  const canView = role === null || role === "super_admin" || role === "ops_manager";
  const [segmentId, setSegmentId] = useState("");
  const fetchOverview = useServerFn(getWaitlistOverview);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["waitlist", "overview", segmentId],
    queryFn: () => fetchOverview({ data: { segmentId: segmentId || null } }),
    staleTime: 30_000,
    enabled: canView,
  });

  if (!canView) {
    return (
      <p className="text-[14px] text-muted-foreground">
        You do not have access to the waitlist.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <p className="text-[14px] text-muted-foreground max-w-[520px]">
          Demand signals from customers in areas we don&apos;t serve yet. Use this to
          prioritise which zone to launch next.
        </p>
        <div className="flex items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Segment
            </label>
            <select
              value={segmentId}
              onChange={(e) => setSegmentId(e.target.value)}
              className="h-10 px-3 rounded-[12px] border border-border bg-card text-[13px] min-w-[180px]"
            >
              <option value="">All segments</option>
              {(data?.segments ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => refetch()}
            className="h-10 px-4 rounded-[12px] border border-border bg-card text-[13px] font-semibold inline-flex items-center gap-2 hover:bg-muted"
          >
            <RefreshCw size={15} className={isFetching ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      <div className="rounded-[16px] border border-border bg-card p-5">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          Total requests
        </p>
        <p className="text-[28px] font-bold leading-tight">{data?.total ?? 0}</p>
      </div>

      {isLoading ? (
        <p className="text-[14px] text-muted-foreground">Loading waitlist…</p>
      ) : isError ? (
        <p className="text-[14px] text-red-600">Could not load waitlist requests.</p>
      ) : (data?.groups.length ?? 0) === 0 ? (
        <p className="text-[14px] text-muted-foreground">No waitlist requests yet.</p>
      ) : (
        <div className="rounded-[16px] border border-border bg-card overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-muted">
              <tr className="text-left text-muted-foreground">
                <th className="px-5 py-3 font-semibold">City / Area</th>
                <th className="px-5 py-3 font-semibold">Segments</th>
                <th className="px-5 py-3 font-semibold text-right">Requests</th>
                <th className="px-5 py-3 font-semibold text-right">Latest</th>
              </tr>
            </thead>
            <tbody>
              {data!.groups.map((g) => (
                <tr key={g.key} className="border-t border-border align-top">
                  <td className="px-5 py-3">
                    <div className="flex items-start gap-2">
                      <MapPin size={15} className="mt-0.5 text-primary shrink-0" />
                      <div>
                        <p className="font-semibold text-foreground">{g.city}</p>
                        <p className="text-muted-foreground">{g.area}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {g.segments.map((s) => (
                        <span
                          key={s.id}
                          className="px-2 py-0.5 rounded-full bg-primary-tint text-[11px] font-semibold"
                        >
                          {s.name} · {s.count}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right font-bold text-[15px]">{g.count}</td>
                  <td className="px-5 py-3 text-right text-muted-foreground whitespace-nowrap">
                    {new Date(g.latestAt).toLocaleDateString()}
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
