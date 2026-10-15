import { DateInput } from "@/components/date-input";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronRight, ChevronLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  listAuditLogs,
  listAuditFilterOptions,
  type AuditLogRow,
} from "@/lib/audit-logs.functions";

export function AuditLogsPage() {
  const fetchLogs = useServerFn(listAuditLogs);
  const fetchOptions = useServerFn(listAuditFilterOptions);

  const [actorId, setActorId] = useState<string>("");
  const [action, setAction] = useState<string>("");
  const [targetTable, setTargetTable] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const { data: options } = useQuery({
    queryKey: ["audit-logs", "options"],
    queryFn: () => fetchOptions(),
    staleTime: 60_000,
  });

  const filters = useMemo(
    () => ({
      page,
      pageSize,
      actorId: actorId || null,
      action: action || null,
      targetTable: targetTable || null,
      from: from ? new Date(from).toISOString() : null,
      to: to ? new Date(new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1).toISOString() : null,
    }),
    [page, actorId, action, targetTable, from, to],
  );

  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["audit-logs", "list", filters],
    queryFn: () => fetchLogs({ data: filters }),
    staleTime: 10_000,
  });

  // Realtime: new audit log rows invalidate the list.
  useEffect(() => {
    const channel = supabase
      .channel("audit-logs-list")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "audit_logs" },
        () => queryClient.invalidateQueries({ queryKey: ["audit-logs", "list"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-[18px] p-4 grid grid-cols-1 md:grid-cols-5 gap-3">
        <FilterField label="Actor">
          <select
            value={actorId}
            onChange={(e) => {
              setPage(1);
              setActorId(e.target.value);
            }}
            className="w-full h-[42px] px-3 rounded-[14px] border border-border bg-background text-[13px]"
          >
            <option value="">All actors</option>
            {options?.actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Action">
          <select
            value={action}
            onChange={(e) => {
              setPage(1);
              setAction(e.target.value);
            }}
            className="w-full h-[42px] px-3 rounded-[14px] border border-border bg-background text-[13px]"
          >
            <option value="">All actions</option>
            {options?.actions.map((a) => (
              <option key={a} value={a}>
                {verbOf(a)} ({a})
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Area">
          <select
            value={targetTable}
            onChange={(e) => {
              setPage(1);
              setTargetTable(e.target.value);
            }}
            className="w-full h-[42px] px-3 rounded-[14px] border border-border bg-background text-[13px]"
          >
            <option value="">All areas</option>
            {options?.tables.map((t) => (
              <option key={t} value={t}>
                {areaName(t)}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="From">
          <DateInput
            
            value={from}
            onChange={(e) => {
              setPage(1);
              setFrom(e.target.value);
            }}
            className="w-full h-[42px] px-3 rounded-[14px] border border-border bg-background text-[13px]"
          />
        </FilterField>
        <FilterField label="To">
          <DateInput
            
            value={to}
            onChange={(e) => {
              setPage(1);
              setTo(e.target.value);
            }}
            className="w-full h-[42px] px-3 rounded-[14px] border border-border bg-background text-[13px]"
          />
        </FilterField>
      </div>

      <div className="bg-card border border-border rounded-[18px] overflow-hidden">
        <div className="grid grid-cols-[32px_minmax(0,1fr)_minmax(0,3fr)_180px] gap-4 px-6 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <span></span>
          <span>Actor</span>
          <span>What</span>
          <span>When</span>
        </div>

        {isLoading && (
          <p className="text-[13px] text-muted-foreground text-center py-10">Loading…</p>
        )}
        {isError && (
          <p className="text-[13px] text-destructive text-center py-10">Failed to load.</p>
        )}
        {!isLoading && !isError && rows.length === 0 && (
          <p className="text-[13px] text-muted-foreground text-center py-10">No entries.</p>
        )}

        {groupRows(rows).map((g) => (
          <AuditRow key={g[0].id} group={g} />
        ))}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted-foreground">
          {total.toLocaleString()} entries · Page {page} of {totalPages}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="h-9 px-3 rounded-[10px] border border-border text-[13px] font-semibold inline-flex items-center gap-1 disabled:opacity-40 hover:bg-muted"
          >
            <ChevronLeft size={14} /> Prev
          </button>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="h-9 px-3 rounded-[10px] border border-border text-[13px] font-semibold inline-flex items-center gap-1 disabled:opacity-40 hover:bg-muted"
          >
            Next <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

const AREA: Record<string, string> = {
  service_flags: "service", service_hours: "hours", merchants: "merchant", experts: "Expert", users: "customer",
  coupons: "coupon", tax_settings: "tax setting", fee_rules: "fee", zones: "zone", staff_users: "staff member",
  bookings: "booking", merchant_orders: "order", courier_orders: "parcel order", merchant_settlements: "settlement",
  segments: "service", support_tickets: "support chat", reward_programs: "reward program", products: "product",
};
function areaName(t: string | null) {
  if (!t) return "record";
  return AREA[t] ?? t.replace(/_/g, " ").replace(/s$/, "");
}
function verbOf(action: string) {
  const a = action.toLowerCase();
  const pick = [
    ["delete", "deleted"], ["remove", "removed"], ["reject", "rejected"], ["approve", "approved"],
    ["suspend", "suspended"], ["create", "created"], ["insert", "added"], ["add", "added"],
    ["assign", "assigned"], ["refund", "refunded"], ["paid", "marked paid"], ["pay", "paid"],
    ["toggle", "switched"], ["status", "changed status of"], ["hours", "changed hours of"],
    ["update", "changed"], ["set", "changed"], ["edit", "edited"],
  ] as const;
  for (const [k, v] of pick) if (a.includes(k)) return v;
  return a.replace(/[_.]/g, " ");
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function nameOf(row: AuditLogRow): string | null {
  const st = (row.afterState ?? row.beforeState ?? {}) as Record<string, unknown>;
  for (const k of ["name", "business_name", "store_name", "label", "title", "full_name", "code", "key", "service_key"]) {
    const v = st[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}
function describe(g: AuditLogRow[]) {
  const r = g[0];
  const actor = r.actorName ?? "System";
  const n = nameOf(r);
  const area = areaName(r.targetTable);
  const verb = verbOf(r.action);
  if (g.length > 1) {
    const plural = area.endsWith("s") ? area : area + "s";
    return `${actor} ${verb} ${g.length} ${plural}${n ? ` (incl. ${n})` : ""}`;
  }
  return `${actor} ${verb} ${area}${n ? ` ${n}` : ""}`;
}
function groupRows(rows: AuditLogRow[]): AuditLogRow[][] {
  const out: AuditLogRow[][] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    const head = last?.[0];
    if (
      head && head.actorId === r.actorId && head.action === r.action && head.targetTable === r.targetTable &&
      Math.abs(new Date(last[last.length - 1].createdAt).getTime() - new Date(r.createdAt).getTime()) <= 60_000
    ) last.push(r);
    else out.push([r]);
  }
  return out;
}

function AuditRow({ group }: { group: AuditLogRow[] }) {
  const [open, setOpen] = useState(false);
  const row = group[0];
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full grid grid-cols-[32px_minmax(0,1fr)_minmax(0,3fr)_180px] gap-4 items-center px-6 py-3 text-[14px] text-left hover:bg-muted/40 transition-colors"
      >
        <span className="text-muted-foreground">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
        <span className="font-semibold text-foreground truncate">
          {row.actorName ?? <span className="text-muted-foreground font-normal">System</span>}
        </span>
        <span className="text-foreground truncate">{describe(group)}</span>
        <span className="text-muted-foreground text-[13px]">
          {new Date(row.createdAt).toLocaleString()}
        </span>
      </button>
      {open && (
        <div className="px-6 pb-4 pt-1 space-y-4">
          {group.map((r) => (
            <div key={r.id} className="space-y-2">
              <div className="text-[12px] text-muted-foreground font-mono break-all">
                {r.action} · {r.targetTable ?? "—"} · {r.targetId ?? "—"} · {new Date(r.createdAt).toLocaleTimeString()}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <JsonPanel title="Before" value={r.beforeState} />
                <JsonPanel title="After" value={r.afterState} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function JsonPanel({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="border border-border rounded-[14px] overflow-hidden">
      <div className="px-3 py-2 bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <pre className="p-3 text-[12px] font-mono text-foreground overflow-x-auto max-h-[320px] whitespace-pre-wrap break-words">
        {value == null ? "—" : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
