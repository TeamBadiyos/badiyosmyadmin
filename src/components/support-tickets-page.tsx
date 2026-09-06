import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { LifeBuoy, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  listSupportTickets,
  updateSupportTicket,
  type SupportTicket,
  type TicketStatus,
} from "@/lib/support.functions";

type StaffRole = "super_admin" | "ops_manager" | "area_partner";

const STATUS_STYLES: Record<TicketStatus, string> = {
  open: "bg-amber-50 text-amber-700",
  in_progress: "bg-indigo-50 text-indigo-700",
  resolved: "bg-emerald-50 text-emerald-700",
};

function fmt(ts: string) {
  return new Date(ts).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SupportTicketsPage({ role }: { role: StaffRole | null }) {
  const canManage = role === "super_admin" || role === "ops_manager";
  const queryClient = useQueryClient();
  const fetchTickets = useServerFn(listSupportTickets);

  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");

  const filters = useMemo(
    () => ({ status: status || null, source: source || null }),
    [status, source],
  );

  const { data: tickets = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["support-tickets", filters],
    queryFn: () => fetchTickets({ data: filters }),
    staleTime: 10_000,
  });

  // Realtime: alert staff when a new ticket arrives
  useEffect(() => {
    const channel = supabase
      .channel("support-tickets-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "support_tickets" },
        () => {
          toast.info("New support ticket received");
          queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "support_tickets" },
        () => queryClient.invalidateQueries({ queryKey: ["support-tickets"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  if (!canManage) {
    return (
      <p className="text-[14px] text-muted-foreground">
        You do not have access to support tickets.
      </p>
    );
  }

  const openCount = tickets.filter((t) => t.status === "open").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-[14px] text-muted-foreground">
          Messages from the Customer and Partner apps. {openCount} open.
        </p>
        <button
          onClick={() => refetch()}
          className="h-[44px] px-4 rounded-[14px] border border-border text-[13px] font-bold inline-flex items-center gap-2 hover:bg-muted/40"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      <div className="bg-card border border-border rounded-[18px] p-4 flex flex-wrap items-end gap-3">
        <Filter label="Status" value={status} onChange={setStatus}>
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In progress</option>
          <option value="resolved">Resolved</option>
        </Filter>
        <Filter label="Source" value={source} onChange={setSource}>
          <option value="">All apps</option>
          <option value="customer">Customer app</option>
          <option value="partner">Partner app</option>
          <option value="merchant">Merchant app</option>
        </Filter>
      </div>

      {isLoading && <p className="text-[13px] text-muted-foreground py-10 text-center">Loading…</p>}
      {isError && (
        <p className="text-[13px] text-destructive py-10 text-center">Failed to load tickets.</p>
      )}
      {!isLoading && !isError && tickets.length === 0 && (
        <div className="bg-card border border-border rounded-[18px] py-16 text-center">
          <LifeBuoy size={28} className="mx-auto text-muted-foreground mb-3" />
          <p className="text-[14px] text-muted-foreground">No tickets yet.</p>
        </div>
      )}

      <div className="space-y-3">
        {tickets.map((t) => (
          <TicketCard key={t.id} ticket={t} />
        ))}
      </div>
    </div>
  );
}

function TicketCard({ ticket }: { ticket: SupportTicket }) {
  const queryClient = useQueryClient();
  const updateFn = useServerFn(updateSupportTicket);
  const [note, setNote] = useState(ticket.internalNote ?? "");

  const mut = useMutation({
    mutationFn: (status: TicketStatus) =>
      updateFn({ data: { ticketId: ticket.id, status, note } }),
    onSuccess: () => {
      toast.success("Ticket updated");
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="bg-card border border-border rounded-[18px] p-5 space-y-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="text-[15px] font-bold text-foreground">
            {ticket.userName ?? "Unknown user"}
            {ticket.userPhone && (
              <span className="ml-2 font-mono text-[13px] text-muted-foreground">
                {ticket.userPhone}
              </span>
            )}
          </p>
          <p className="text-[12px] text-muted-foreground">{fmt(ticket.createdAt)}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide bg-muted text-muted-foreground">
            {ticket.source}
          </span>
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide ${STATUS_STYLES[ticket.status]}`}
          >
            {ticket.status.replace(/_/g, " ")}
          </span>
        </div>
      </div>

      <p className="text-[14px] text-foreground whitespace-pre-wrap">{ticket.message}</p>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Internal note (staff only)…"
        rows={2}
        className="w-full px-3 py-2 rounded-[12px] border border-border bg-card text-[13px]"
      />

      <div className="flex items-center gap-2 flex-wrap">
        {(["open", "in_progress", "resolved"] as TicketStatus[]).map((s) => (
          <button
            key={s}
            disabled={mut.isPending || ticket.status === s}
            onClick={() => mut.mutate(s)}
            className="h-9 px-4 rounded-[12px] border border-border text-[12px] font-bold disabled:opacity-40 hover:bg-muted/40"
          >
            {s === "resolved" ? "Mark resolved" : s === "open" ? "Reopen" : "In progress"}
          </button>
        ))}
      </div>
    </div>
  );
}

function Filter({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 px-3 rounded-[12px] border border-border bg-card text-[13px] min-w-[160px]"
      >
        {children}
      </select>
    </div>
  );
}
