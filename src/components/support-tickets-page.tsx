import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, LifeBuoy, RefreshCw, RotateCcw, Search, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  getTicketContact,
  listSupportTickets,
  listTicketMessages,
  sendTicketMessage,
  updateSupportTicket,
  type SupportTicket,
  type TicketStatus,
} from "@/lib/support.functions";

type StaffRole = "super_admin" | "ops_manager" | "area_partner";

const STATUS_STYLES: Record<TicketStatus, string> = {
  open: "bg-amber-50 text-amber-700",
  in_progress: "bg-indigo-50 text-indigo-700",
  answered: "bg-sky-50 text-sky-700",
  resolved: "bg-emerald-50 text-emerald-700",
};

function time(ts: string) {
  return new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function fmt(ts: string) {
  return new Date(ts).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dayLabel(ts: string) {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  if (same(d, yest)) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function money(n: number) {
  return `₹${Number(n || 0).toLocaleString("en-IN")}`;
}

export function SupportTicketsPage({ role }: { role: StaffRole | null }) {
  const canManage = role === "super_admin" || role === "ops_manager";
  const queryClient = useQueryClient();
  const fetchTickets = useServerFn(listSupportTickets);

  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  const filters = useMemo(
    () => ({ status: status || null, source: source || null }),
    [status, source],
  );

  const {
    data: tickets = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["support-tickets", filters],
    queryFn: () => fetchTickets({ data: filters }),
    staleTime: 10_000,
    enabled: canManage,
  });

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
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "support_ticket_messages" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
          queryClient.invalidateQueries({ queryKey: ["ticket-messages"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tickets;
    return tickets.filter((t) =>
      [t.userName, t.userPhone, t.subject, t.message, t.lastMessagePreview]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [tickets, search]);

  useEffect(() => {
    if (!activeId && filtered.length) setActiveId(filtered[0]!.id);
  }, [filtered, activeId]);

  if (!canManage) {
    return (
      <p className="text-[14px] text-muted-foreground">
        You do not have access to support tickets.
      </p>
    );
  }

  const active = tickets.find((t) => t.id === activeId) ?? null;
  const openCount = tickets.filter((t) => t.status !== "resolved").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-[14px] text-muted-foreground">
          Chat with customers, partners and merchants. {openCount} open.
        </p>
        <button
          onClick={() => refetch()}
          className="h-[40px] px-4 rounded-[14px] border border-border text-[13px] font-bold inline-flex items-center gap-2 hover:bg-muted/40"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)_300px] gap-4 h-[calc(100vh-190px)] min-h-[560px]">
        {/* LEFT — ticket list */}
        <div className="bg-card border border-border rounded-[18px] flex flex-col overflow-hidden">
          <div className="p-3 space-y-2 border-b border-border">
            <div className="relative">
              <Search
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, phone, message"
                className="w-full h-10 pl-9 pr-3 rounded-[12px] border border-border bg-card text-[13px]"
              />
            </div>
            <div className="flex gap-2">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="h-9 px-2 rounded-[10px] border border-border bg-card text-[12px] flex-1"
              >
                <option value="">All statuses</option>
                <option value="open">Open</option>
                <option value="in_progress">In progress</option>
                <option value="answered">Answered</option>
                <option value="resolved">Resolved</option>
              </select>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="h-9 px-2 rounded-[10px] border border-border bg-card text-[12px] flex-1"
              >
                <option value="">All apps</option>
                <option value="customer">Customer</option>
                <option value="partner">Partner</option>
                <option value="merchant">Merchant</option>
              </select>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading && (
              <p className="text-[13px] text-muted-foreground py-10 text-center">Loading…</p>
            )}
            {isError && (
              <p className="text-[13px] text-destructive py-10 text-center">
                Failed to load tickets.
              </p>
            )}
            {!isLoading && !isError && filtered.length === 0 && (
              <div className="py-16 text-center">
                <LifeBuoy size={26} className="mx-auto text-muted-foreground mb-2" />
                <p className="text-[13px] text-muted-foreground">No tickets.</p>
              </div>
            )}
            {filtered.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveId(t.id)}
                className={`w-full text-left px-4 py-3 border-b border-border hover:bg-muted/40 transition ${
                  t.id === activeId ? "bg-muted/60" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[14px] font-bold text-foreground truncate">
                    {t.userName ?? "Unknown user"}
                  </p>
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    {t.lastMessageAt ? time(t.lastMessageAt) : ""}
                  </span>
                </div>
                <p className="text-[12px] text-muted-foreground truncate">
                  {t.lastMessageFrom === "staff" ? "You: " : ""}
                  {t.lastMessagePreview}
                </p>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${STATUS_STYLES[t.status]}`}
                  >
                    {t.status.replace(/_/g, " ")}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-muted text-muted-foreground">
                    {t.source}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* MIDDLE — chat */}
        {active ? (
          <ChatWindow key={active.id} ticket={active} />
        ) : (
          <div className="bg-card border border-border rounded-[18px] flex items-center justify-center">
            <p className="text-[14px] text-muted-foreground">Select a conversation</p>
          </div>
        )}

        {/* RIGHT — contact */}
        {active ? (
          <ContactPanel ticket={active} />
        ) : (
          <div className="bg-card border border-border rounded-[18px] hidden lg:block" />
        )}
      </div>
    </div>
  );
}

function ChatWindow({ ticket }: { ticket: SupportTicket }) {
  const queryClient = useQueryClient();
  const fetchMessages = useServerFn(listTicketMessages);
  const sendFn = useServerFn(sendTicketMessage);
  const updateFn = useServerFn(updateSupportTicket);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState(ticket.internalNote ?? "");
  const [showNote, setShowNote] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: messages = [] } = useQuery({
    queryKey: ["ticket-messages", ticket.id],
    queryFn: () => fetchMessages({ data: { ticketId: ticket.id } }),
    staleTime: 5_000,
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, ticket.id]);

  const resolved = ticket.status === "resolved";
  const [outcome, setOutcome] = useState<string>("no_fault");

  const send = useMutation({
    mutationFn: (body: string) => sendFn({ data: { ticketId: ticket.id, body } }),
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["ticket-messages", ticket.id] });
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not send"),
  });

  const setStatus = useMutation({
    mutationFn: (status: TicketStatus) =>
      updateFn({
        data: {
          ticketId: ticket.id,
          status,
          note: note || null,
          resolution: status === "resolved" ? note || null : null,
          resolutionOutcome: status === "resolved" ? outcome : null,
        },
      }),
    onSuccess: (_d, status) => {
      toast.success(status === "resolved" ? "Ticket resolved and chat closed" : "Ticket updated");
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // Merge the original ticket message as the first bubble when it isn't already a message row
  const thread = useMemo(() => {
    const first = messages[0];
    const hasOriginal = first && first.body.trim() === ticket.message.trim();
    const base = hasOriginal
      ? []
      : [
          {
            id: `origin-${ticket.id}`,
            senderType: "customer" as const,
            body: ticket.message,
            createdAt: ticket.createdAt,
          },
        ];
    return [...base, ...messages];
  }, [messages, ticket]);

  return (
    <div className="bg-card border border-border rounded-[18px] flex flex-col overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-[15px] font-bold text-foreground truncate">
            {ticket.userName ?? "Unknown user"}
            {ticket.userPhone && (
              <span className="ml-2 font-mono text-[12px] text-muted-foreground">
                {ticket.userPhone}
              </span>
            )}
          </p>
          <p className="text-[12px] text-muted-foreground truncate">
            {ticket.subject ?? "Support request"} · {fmt(ticket.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowNote((v) => !v)}
            className="h-9 px-3 rounded-[12px] border border-border text-[12px] font-bold hover:bg-muted/40"
          >
            Internal note
          </button>
          {!resolved ? (
            <>
              <button
                disabled={setStatus.isPending || ticket.status === "in_progress"}
                onClick={() => setStatus.mutate("in_progress")}
                className="h-9 px-3 rounded-[12px] border border-border text-[12px] font-bold disabled:opacity-40 hover:bg-muted/40"
              >
                In progress
              </button>
              <select
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
                title="Outcome recorded when you resolve this ticket"
                className="h-9 px-2 rounded-[12px] border border-border bg-card text-[12px] font-semibold"
              >
                <option value="no_fault">No one at fault</option>
                <option value="expert_fault">Expert at fault</option>
                <option value="customer_fault">Customer at fault</option>
                <option value="platform_issue">Platform issue</option>
                <option value="other">Other</option>
              </select>
              <button
                disabled={setStatus.isPending}
                onClick={() => setStatus.mutate("resolved")}
                className="h-9 px-3 rounded-[12px] bg-primary text-white text-[12px] font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <CheckCircle2 size={15} />
                Mark resolved
              </button>
            </>
          ) : (
            <button
              disabled={setStatus.isPending}
              onClick={() => setStatus.mutate("open")}
              className="h-9 px-3 rounded-[12px] border border-border text-[12px] font-bold inline-flex items-center gap-1.5 disabled:opacity-40 hover:bg-muted/40"
            >
              <RotateCcw size={15} />
              Reopen
            </button>
          )}
        </div>
      </div>

      {showNote && (
        <div className="px-5 py-3 border-b border-border bg-muted/30">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Internal note — customer ko nahi dikhta"
            className="w-full px-3 py-2 rounded-[12px] border border-border bg-card text-[13px]"
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2 bg-muted/20">
        {thread.map((m, i) => {
          const prev = thread[i - 1];
          const showDay = !prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt);
          const mine = m.senderType === "staff";
          return (
            <div key={m.id}>
              {showDay && (
                <div className="flex justify-center my-3">
                  <span className="px-3 py-1 rounded-full bg-card border border-border text-[11px] font-bold text-muted-foreground">
                    {dayLabel(m.createdAt)}
                  </span>
                </div>
              )}
              <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[76%] px-3.5 py-2 rounded-[16px] ${
                    mine
                      ? "bg-primary text-white rounded-br-[4px]"
                      : "bg-card border border-border text-foreground rounded-bl-[4px]"
                  }`}
                >
                  <p className="text-[14px] whitespace-pre-wrap break-words">{m.body}</p>
                  <p
                    className={`text-[10px] mt-1 text-right ${mine ? "text-white/70" : "text-muted-foreground"}`}
                  >
                    {time(m.createdAt)}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {resolved ? (
        <div className="px-5 py-4 border-t border-border bg-muted/40 text-center">
          <p className="text-[13px] text-muted-foreground">
            Ticket resolved{ticket.resolvedAt ? ` — ${fmt(ticket.resolvedAt)}` : ""}. Chat closed.
          </p>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim() && !send.isPending) send.mutate(draft.trim());
          }}
          className="px-4 py-3 border-t border-border flex items-end gap-2"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (draft.trim() && !send.isPending) send.mutate(draft.trim());
              }
            }}
            rows={1}
            placeholder="Type a reply…  (Enter to send)"
            className="flex-1 px-4 py-3 rounded-[14px] border border-border bg-card text-[14px] resize-none max-h-32"
          />
          <button
            type="submit"
            disabled={!draft.trim() || send.isPending}
            className="h-[46px] w-[46px] rounded-full bg-primary text-white flex items-center justify-center disabled:opacity-40"
          >
            <Send size={18} />
          </button>
        </form>
      )}
    </div>
  );
}

function ContactPanel({ ticket }: { ticket: SupportTicket }) {
  const fetchContact = useServerFn(getTicketContact);
  const { data, isLoading } = useQuery({
    queryKey: ["ticket-contact", ticket.userId],
    queryFn: () => fetchContact({ data: { userId: ticket.userId! } }),
    enabled: !!ticket.userId,
    staleTime: 60_000,
  });

  return (
    <div className="bg-card border border-border rounded-[18px] overflow-y-auto p-4 space-y-4">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          Contact
        </p>
        {isLoading && <p className="text-[13px] text-muted-foreground mt-2">Loading…</p>}
        {data && (
          <div className="mt-2 space-y-1">
            <p className="text-[15px] font-bold text-foreground">{data.name ?? "Unknown"}</p>
            <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-muted text-muted-foreground">
              {data.role}
            </span>
            {data.deletedAt && (
              <span className="ml-1 inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-red-50 text-red-600">
                Deleted
              </span>
            )}
            <Row label="Phone" value={data.phone} mono />
            <Row label="Email" value={data.email} />
            <Row
              label="Joined"
              value={data.joinedAt ? new Date(data.joinedAt).toLocaleDateString("en-IN") : null}
            />
            <Row label="Language" value={data.language} />
            <Row label="Address" value={data.address} />
          </div>
        )}
      </div>

      {data && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Bookings" value={String(data.stats.bookings)} />
            <Stat label="Completed" value={String(data.stats.completed)} />
            <Stat label="Spend" value={money(data.stats.spend)} />
            <Stat label="Coins" value={String(Math.round(data.coinBalance))} />
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
              Recent bookings
            </p>
            {data.bookings.length === 0 && (
              <p className="text-[12px] text-muted-foreground">No bookings yet.</p>
            )}
            <div className="space-y-2">
              {data.bookings.slice(0, 10).map((b) => (
                <div key={b.id} className="border border-border rounded-[12px] p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] font-semibold text-foreground truncate">
                      {b.serviceLabel ?? "Service"}
                    </p>
                    <span className="text-[12px] font-bold">{money(b.price)}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {b.createdAt ? new Date(b.createdAt).toLocaleDateString("en-IN") : ""} ·{" "}
                    {String(b.status).replace(/_/g, " ")}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <p className="text-[12px] text-muted-foreground">
      {label}: <span className={`text-foreground ${mono ? "font-mono" : ""}`}>{value}</span>
    </p>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border rounded-[12px] p-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-[15px] font-bold text-foreground">{value}</p>
    </div>
  );
}
