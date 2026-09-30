import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, Store, MapPin, Handshake, UserPlus, Phone, MessageCircle, Mail } from "lucide-react";
import {
  getInterestLeads,
  setLeadStatus,
  type ContactLead,
  type LeadStatus,
} from "@/lib/interest-leads.functions";

type StaffRole = "super_admin" | "ops_manager" | "area_partner";

const STATUSES: { key: LeadStatus; label: string; cls: string }[] = [
  { key: "new", label: "New", cls: "bg-primary-tint text-primary" },
  { key: "contacted", label: "Contacted", cls: "bg-amber-50 text-amber-700" },
  { key: "converted", label: "Converted", cls: "bg-emerald-50 text-emerald-700" },
  { key: "rejected", label: "Not interested", cls: "bg-muted text-muted-foreground" },
];

function fmt(ts: string) {
  return new Date(ts).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function digits(phone: string) {
  return phone.replace(/\D/g, "").slice(-10);
}

export function InterestLeadsPage({ role }: { role: StaffRole | null }) {
  const canView = role === null || role === "super_admin" || role === "ops_manager";
  const canEdit = canView;
  const [tab, setTab] = useState<"partner" | "expert" | "business" | "city">("partner");
  const fetchLeads = useServerFn(getInterestLeads);
  const statusFn = useServerFn(setLeadStatus);
  const queryClient = useQueryClient();

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["interest-leads"],
    queryFn: () => fetchLeads(),
    staleTime: 30_000,
    enabled: canView,
  });

  const updateStatus = useMutation({
    mutationFn: (vars: { kind: "area_partner" | "expert"; id: string; status: LeadStatus }) =>
      statusFn({ data: vars }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["interest-leads"] }),
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
  const partner = data?.partner ?? [];
  const expert = data?.expert ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <p className="text-[14px] text-muted-foreground max-w-[620px]">
          Everything submitted from the badiyos.com website — area partner and Home Expert
          applications, shops who want to join, and customers asking us to launch in their city.
        </p>
        <button
          onClick={() => refetch()}
          className="h-10 px-4 rounded-[12px] border border-border bg-card text-[13px] font-semibold inline-flex items-center gap-2 hover:bg-muted"
        >
          <RefreshCw size={15} className={isFetching ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      <div className="flex gap-2 flex-wrap">
        <TabBtn active={tab === "partner"} onClick={() => setTab("partner")} icon={Handshake}>
          Area Partner Leads ({partner.length})
        </TabBtn>
        <TabBtn active={tab === "expert"} onClick={() => setTab("expert")} icon={UserPlus}>
          Expert Leads ({expert.length})
        </TabBtn>
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
      ) : tab === "partner" || tab === "expert" ? (
        <ContactLeadList
          leads={tab === "partner" ? partner : expert}
          kind={tab === "partner" ? "area_partner" : "expert"}
          source={tab === "partner" ? "/join-area-partner" : "/join-expert"}
          canEdit={canEdit}
          onStatus={(vars) => updateStatus.mutate(vars)}
          pending={updateStatus.isPending}
          empty={
            tab === "partner"
              ? "No area partner applications yet."
              : "No Home Expert applications yet."
          }
        />
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

function ContactLeadList({
  leads,
  kind,
  source,
  canEdit,
  onStatus,
  pending,
  empty,
}: {
  leads: ContactLead[];
  kind: "area_partner" | "expert";
  source: string;
  canEdit: boolean;
  onStatus: (vars: { kind: "area_partner" | "expert"; id: string; status: LeadStatus }) => void;
  pending: boolean;
  empty: string;
}) {
  if (leads.length === 0) {
    return (
      <div className="rounded-[16px] border border-border bg-card p-8 text-center text-[14px] text-muted-foreground">
        {empty}
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {leads.map((l) => {
        const badge = STATUSES.find((s) => s.key === l.status) ?? STATUSES[0];
        const ph = digits(l.phone);
        return (
          <div key={l.id} className="rounded-[16px] border border-border bg-card p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[15px] font-bold text-foreground truncate">{l.name}</p>
                <p className="text-[13px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                  <MapPin size={13} /> {l.area || "—"}
                </p>
              </div>
              <span
                className={`px-2.5 py-1 rounded-full text-[11px] font-bold shrink-0 ${badge.cls}`}
              >
                {badge.label}
              </span>
            </div>

            <div className="space-y-1 text-[13px] text-muted-foreground">
              <p className="flex items-center gap-1.5">
                <Phone size={13} /> {l.phone}
              </p>
              {l.email && (
                <p className="flex items-center gap-1.5 truncate">
                  <Mail size={13} /> {l.email}
                </p>
              )}
              <p className="text-[12px]">Received {fmt(l.created_at)}</p>
              <p className="text-[12px]">From website page {source}</p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <a
                href={`tel:+91${ph}`}
                className="h-9 px-3 rounded-[10px] border border-border text-[12px] font-semibold inline-flex items-center gap-1.5 hover:bg-muted"
              >
                <Phone size={13} /> Call
              </a>
              <a
                href={`https://wa.me/91${ph}`}
                target="_blank"
                rel="noreferrer"
                className="h-9 px-3 rounded-[10px] border border-border text-[12px] font-semibold inline-flex items-center gap-1.5 hover:bg-muted"
              >
                <MessageCircle size={13} /> WhatsApp
              </a>
              {l.email && (
                <a
                  href={`mailto:${l.email}`}
                  className="h-9 px-3 rounded-[10px] border border-border text-[12px] font-semibold inline-flex items-center gap-1.5 hover:bg-muted"
                >
                  <Mail size={13} /> Email
                </a>
              )}
            </div>

            {canEdit && (
              <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-border">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mt-2 mr-1">
                  Mark as
                </span>
                {STATUSES.map((s) => (
                  <button
                    key={s.key}
                    disabled={pending || s.key === l.status}
                    onClick={() => onStatus({ kind, id: l.id, status: s.key })}
                    className={`mt-2 px-2.5 py-1 rounded-full text-[11px] font-semibold transition disabled:opacity-40 ${
                      s.key === l.status ? s.cls : "border border-border hover:bg-muted"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
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
