import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, Store, MapPin } from "lucide-react";
import { getInterestLeads } from "@/lib/interest-leads.functions";

type StaffRole = "super_admin" | "ops_manager" | "area_partner";

function fmt(ts: string) {
  return new Date(ts).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function InterestLeadsPage({ role }: { role: StaffRole | null }) {
  const canView = role === null || role === "super_admin" || role === "ops_manager";
  const [tab, setTab] = useState<"business" | "city">("business");
  const fetchLeads = useServerFn(getInterestLeads);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["interest-leads"],
    queryFn: () => fetchLeads(),
    staleTime: 30_000,
    enabled: canView,
  });

  if (!canView) {
    return (
      <p className="text-[14px] text-muted-foreground">
        You do not have access to interest leads.
      </p>
    );
  }

  const business = data?.business ?? [];
  const city = data?.city ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <p className="text-[14px] text-muted-foreground max-w-[560px]">
          Interest submitted from the badiyos.com website — shops and service providers
          who want to join, and customers asking us to launch in their city.
        </p>
        <button
          onClick={() => refetch()}
          className="h-10 px-4 rounded-[12px] border border-border bg-card text-[13px] font-semibold inline-flex items-center gap-2 hover:bg-muted"
        >
          <RefreshCw size={15} className={isFetching ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      <div className="flex gap-2">
        <TabBtn active={tab === "business"} onClick={() => setTab("business")} icon={Store}>
          Business Interest ({business.length})
        </TabBtn>
        <TabBtn active={tab === "city"} onClick={() => setTab("city")} icon={MapPin}>
          City Requests ({city.length})
        </TabBtn>
      </div>

      {isLoading ? (
        <p className="text-[14px] text-muted-foreground">Loading…</p>
      ) : isError ? (
        <p className="text-[14px] text-destructive">Could not load interest leads.</p>
      ) : tab === "business" ? (
        <Table
          head={["Business", "Owner", "Phone", "Interested in", "City", "Received"]}
          rows={business.map((l) => [
            l.business_name || "—",
            l.owner_name,
            l.phone,
            l.category_interested,
            l.city,
            fmt(l.created_at),
          ])}
          empty="No business interest submissions yet."
        />
      ) : (
        <Table
          head={["Name", "Phone", "City", "Received"]}
          rows={city.map((l) => [l.name, l.phone, l.city, fmt(l.created_at)])}
          empty="No city requests yet."
        />
      )}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Store;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-10 px-4 rounded-[12px] text-[13px] font-semibold inline-flex items-center gap-2 border transition ${
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-card border-border hover:bg-muted"
      }`}
    >
      <Icon size={15} />
      {children}
    </button>
  );
}

function Table({
  head,
  rows,
  empty,
}: {
  head: string[];
  rows: string[][];
  empty: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-[16px] border border-border bg-card p-8 text-center text-[14px] text-muted-foreground">
        {empty}
      </div>
    );
  }
  return (
    <div className="rounded-[16px] border border-border bg-card overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border">
            {head.map((h) => (
              <th
                key={h}
                className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-muted-foreground whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/50">
              {r.map((c, j) => (
                <td key={j} className="px-4 py-3 whitespace-nowrap">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
