import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Check, CheckCheck, LifeBuoy, ImagePlus, MessageSquareText, Phone, Search, Send, StickyNote, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  addTicketNote,
  assignSupportTicket,
  getTicketContact,
  listSupportMeta,
  listSupportTickets,
  listTicketMessages,
  markTicketSeenByStaff,
  sendTicketMessage,
  sendTicketAttachment,
  updateSupportTicket,
  type SupportTicket,
  type TicketStatus,
} from "@/lib/support.functions";

type StaffRole = "super_admin" | "ops_manager" | "area_partner" | "finance";

function time(ts: string) {
  return new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
}
function fmt(ts: string) {
  return new Date(ts).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
}
function dayLabel(ts: string) {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  if (same(d, yest)) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Kolkata" });
}
function listTime(ts: string) {
  const l = dayLabel(ts);
  return l === "Today" ? time(ts) : l;
}
function money(n: number) {
  return `₹${Number(n || 0).toLocaleString("en-IN")}`;
}
const APP_LABEL: Record<string, string> = { customer: "Customer", partner: "Expert", merchant: "Merchant" };

function Ticks({ seen }: { seen: boolean }) {
  return seen ? <CheckCheck size={14} className="inline text-sky-500" /> : <Check size={14} className="inline opacity-70" />;
}

export function SupportTicketsPage({ role }: { role: StaffRole | null }) {
  const canManage = role === "super_admin" || role === "ops_manager";
  const queryClient = useQueryClient();
  const fetchTickets = useServerFn(listSupportTickets);

  const [chip, setChip] = useState<"open" | "resolved" | "all">("open");
  const [source, setSource] = useState("");
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  const { data: tickets = [], isLoading, isError } = useQuery({
    queryKey: ["support-tickets", source],
    queryFn: () => fetchTickets({ data: { source: source || null } }),
    staleTime: 10_000,
    enabled: canManage,
  });

  useEffect(() => {
    const channel = supabase
      .channel("support-tickets-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "support_tickets" }, () => {
        toast.info("New support chat");
        queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "support_tickets" }, () =>
        queryClient.invalidateQueries({ queryKey: ["support-tickets"] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "support_ticket_messages" }, () => {
        queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
        queryClient.invalidateQueries({ queryKey: ["ticket-messages"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const openCount = tickets.filter((t) => t.status !== "resolved").length;
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter((t) => {
      if (chip === "open" && t.status === "resolved") return false;
      if (chip === "resolved" && t.status !== "resolved") return false;
      if (!q) return true;
      return [t.userName, t.userPhone, t.subject, t.message, t.lastMessagePreview]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [tickets, search, chip]);

  if (!canManage) {
    return <p className="text-[14px] text-muted-foreground">You do not have access to support chats.</p>;
  }

  const active = tickets.find((t) => t.id === activeId) ?? null;
  const chipCls = (on: boolean) =>
    `h-8 px-3 rounded-full text-[12px] font-bold border ${on ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:bg-muted/40"}`;

  return (
    <div className={`grid grid-cols-1 ${active ? "lg:grid-cols-[340px_minmax(0,1fr)_280px]" : "lg:grid-cols-[340px_minmax(0,1fr)]"} gap-4 lg:h-[calc(100vh-150px)] lg:min-h-[560px]`}>
      {/* LEFT — chat list */}
      <div className={`bg-card border border-border rounded-[18px] flex-col overflow-hidden ${active ? "hidden lg:flex" : "flex"} max-h-[calc(100vh-150px)]`}>
        <div className="p-3 space-y-2 border-b border-border">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, phone, message"
              className="w-full h-10 pl-9 pr-3 rounded-[12px] border border-border bg-card text-[13px]"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <button className={chipCls(chip === "open")} onClick={() => setChip("open")}>Open ({openCount})</button>
            <button className={chipCls(chip === "resolved")} onClick={() => setChip("resolved")}>Resolved</button>
            <button className={chipCls(chip === "all")} onClick={() => setChip("all")}>All</button>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="ml-auto h-8 px-2 rounded-[10px] border border-border bg-card text-[12px]"
            >
              <option value="">All apps</option>
              <option value="customer">Customer</option>
              <option value="partner">Expert</option>
              <option value="merchant">Merchant</option>
            </select>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading && <p className="text-[13px] text-muted-foreground py-10 text-center">Loading…</p>}
          {isError && <p className="text-[13px] text-destructive py-10 text-center">Failed to load chats.</p>}
          {!isLoading && !isError && filtered.length === 0 && (
            <div className="py-16 text-center">
              <LifeBuoy size={26} className="mx-auto text-muted-foreground mb-2" />
              <p className="text-[13px] text-muted-foreground">No chats.</p>
            </div>
          )}
          {filtered.map((t) => {
            const unread = t.unread > 0;
            const initial = (t.userName ?? "?").trim().charAt(0).toUpperCase();
            return (
              <button
                key={t.id}
                onClick={() => setActiveId(t.id)}
                className={`w-full text-left px-3 py-3 border-b border-border hover:bg-muted/40 flex gap-3 ${t.id === activeId ? "bg-muted/60" : ""}`}
              >
                <span className="w-10 h-10 shrink-0 rounded-full bg-primary-tint text-primary font-bold flex items-center justify-center">{initial}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className={`text-[14px] truncate ${unread ? "font-extrabold" : "font-semibold"} text-foreground`}>{t.userName ?? "Unknown user"}</span>
                    <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase bg-muted text-muted-foreground shrink-0">{APP_LABEL[t.source] ?? t.source}</span>
                    <span className={`ml-auto text-[11px] shrink-0 ${unread ? "text-primary font-bold" : "text-muted-foreground"}`}>
                      {t.lastMessageAt ? listTime(t.lastMessageAt) : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 mt-0.5">
                    <span className={`text-[12px] truncate flex-1 ${unread ? "text-foreground font-semibold" : "text-muted-foreground"}`}>
                      {t.lastMessageFrom === "staff" && (<><Ticks seen={t.lastMessageSeen} /> You: </>)}
                      {t.lastMessagePreview}
                    </span>
                    {unread && (
                      <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[11px] font-bold flex items-center justify-center">{t.unread}</span>
                    )}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {active ? (
        <>
          <ChatWindow key={active.id} ticket={active} onClose={() => setActiveId(null)} />
          <div className="hidden lg:block min-h-0"><ContactPanel ticket={active} /></div>
        </>
      ) : (
        <div className="hidden lg:flex bg-card border border-border rounded-[18px] items-center justify-center text-center">
          <div>
            <MessageSquareText size={30} className="mx-auto text-muted-foreground mb-2" />
            <p className="text-[13px] text-muted-foreground">Select a chat to start replying.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function ChatWindow({ ticket, onClose }: { ticket: SupportTicket; onClose: () => void }) {
  const queryClient = useQueryClient();
  const fetchMessages = useServerFn(listTicketMessages);
  const sendFn = useServerFn(sendTicketMessage);
  const attachFn = useServerFn(sendTicketAttachment);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const uploadImage = async (file: File) => {
    if (!["image/jpeg", "image/png"].includes(file.type)) { toast.error("Only JPG or PNG images"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("Image must be 5 MB or smaller"); return; }
    setUploading(true);
    try {
      const ext = file.type === "image/png" ? "png" : "jpg";
      const path = `${ticket.id}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("support-attachments").upload(path, file, { contentType: file.type });
      if (error) throw error;
      await attachFn({ data: { ticketId: ticket.id, path, body: draft.trim() } });
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["ticket-messages", ticket.id] });
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const noteFn = useServerFn(addTicketNote);
  const updateFn = useServerFn(updateSupportTicket);
  const seenFn = useServerFn(markTicketSeenByStaff);
  const assignFn = useServerFn(assignSupportTicket);
  const metaFn = useServerFn(listSupportMeta);
  const [draft, setDraft] = useState("");
  const [noteMode, setNoteMode] = useState(false);
  const [showReplies, setShowReplies] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const { data: messages = [] } = useQuery({
    queryKey: ["ticket-messages", ticket.id],
    queryFn: () => fetchMessages({ data: { ticketId: ticket.id } }),
    staleTime: 5_000,
  });
  const { data: meta } = useQuery({ queryKey: ["support-meta"], queryFn: () => metaFn(), staleTime: 300_000 });

  const unseen = messages.some((m) => m.senderType !== "staff" && !m.seenAt);
  useEffect(() => {
    if (!unseen && ticket.unread === 0) return;
    seenFn({ data: { ticketId: ticket.id } })
      .then(() => queryClient.invalidateQueries({ queryKey: ["support-tickets"] }))
      .catch(() => undefined);
  }, [ticket.id, unseen, ticket.unread, seenFn, queryClient]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, ticket.id]);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [draft]);

  const resolved = ticket.status === "resolved";

  const send = useMutation({
    mutationFn: (body: string) =>
      noteMode ? noteFn({ data: { ticketId: ticket.id, body } }) : sendFn({ data: { ticketId: ticket.id, body } }),
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["ticket-messages", ticket.id] });
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not send"),
  });

  const setStatus = useMutation({
    mutationFn: (status: TicketStatus) =>
      updateFn({ data: { ticketId: ticket.id, status, resolutionOutcome: status === "resolved" ? "no_fault" : null } }),
    onSuccess: (_d, status) => {
      toast.success(status === "resolved" ? "Chat resolved" : "Chat reopened");
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const assign = useMutation({
    mutationFn: (staffId: string | null) => assignFn({ data: { ticketId: ticket.id, staffId } }),
    onSuccess: () => {
      toast.success("Assigned");
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const thread = useMemo(() => {
    const first = messages[0];
    const hasOriginal = first && first.body.trim() === ticket.message.trim();
    const base = hasOriginal
      ? []
      : [{ id: `origin-${ticket.id}`, senderType: "customer" as const, body: ticket.message, createdAt: ticket.createdAt, isInternal: false, seenAt: ticket.createdAt, attachmentUrl: null }];
    return [...base, ...messages];
  }, [messages, ticket]);

  const submit = () => {
    if (draft.trim() && !send.isPending) send.mutate(draft.trim());
  };

  return (
    <div className="bg-card border border-border rounded-[18px] flex flex-col overflow-hidden min-h-[520px] lg:min-h-0">
      <div className="px-4 py-3 border-b border-border flex items-center gap-3 flex-wrap">
        <button onClick={onClose} aria-label="Back to chats" className="lg:hidden h-9 w-9 rounded-full hover:bg-muted/40 flex items-center justify-center">
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold text-foreground truncate flex items-center gap-2">
            {ticket.userName ?? "Unknown user"}
            <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase bg-muted text-muted-foreground">{APP_LABEL[ticket.source] ?? ticket.source}</span>
            {ticket.bookingId && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-primary-tint text-primary">{ticket.bookingNumber ?? `#${ticket.bookingId.slice(0, 8)}`}</span>
            )}
          </p>
          <p className="text-[12px] text-muted-foreground truncate">{ticket.subject ?? "Support request"} · {fmt(ticket.createdAt)}</p>
        </div>
        {ticket.userPhone && (
          <a href={`tel:${ticket.userPhone}`} title={`Call ${ticket.userPhone}`} className="h-9 w-9 rounded-full border border-border inline-flex items-center justify-center hover:bg-muted/40">
            <Phone size={15} />
          </a>
        )}
        <select
          value={ticket.assignedStaffId ?? ""}
          onChange={(e) => assign.mutate(e.target.value || null)}
          className="h-9 px-2 rounded-[10px] border border-border bg-card text-[12px] max-w-[140px]"
          title="Assigned to"
        >
          <option value="">Unassigned</option>
          {(meta?.staff ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <select
          value={resolved ? "resolved" : "open"}
          disabled={setStatus.isPending}
          onChange={(e) => setStatus.mutate(e.target.value as TicketStatus)}
          className={`h-9 px-2 rounded-[10px] border text-[12px] font-bold ${resolved ? "border-border bg-muted text-muted-foreground" : "border-primary/40 bg-primary-tint text-primary"}`}
        >
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
        </select>
        <button onClick={onClose} aria-label="Close chat" className="hidden lg:inline-flex h-9 w-9 rounded-full border border-border items-center justify-center hover:bg-muted/40">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2 bg-muted/20">
        {thread.map((m, i) => {
          const prev = thread[i - 1];
          const showDay = !prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt);
          const mine = m.senderType === "staff";
          return (
            <div key={m.id}>
              {showDay && (
                <div className="flex justify-center my-3">
                  <span className="px-3 py-1 rounded-full bg-card border border-border text-[11px] font-bold text-muted-foreground">{dayLabel(m.createdAt)}</span>
                </div>
              )}
              {m.isInternal ? (
                <div className="flex justify-center">
                  <div className="max-w-[80%] px-3.5 py-2 rounded-[12px] bg-warning/15 border border-warning/40 text-foreground">
                    <p className="text-[10px] font-bold uppercase text-warning-foreground/80 flex items-center gap-1"><StickyNote size={11} /> Internal note · only staff see this</p>
                    <p className="text-[13px] whitespace-pre-wrap break-words">{m.body}</p>
                    <p className="text-[10px] mt-1 text-right text-muted-foreground">{time(m.createdAt)}</p>
                  </div>
                </div>
              ) : (
                <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[76%] px-3.5 py-2 rounded-[16px] ${mine ? "bg-primary text-primary-foreground rounded-br-[4px]" : "bg-card border border-border text-foreground rounded-bl-[4px]"}`}>
                    {m.attachmentUrl && (
                      <a href={m.attachmentUrl} target="_blank" rel="noreferrer"><img src={m.attachmentUrl} alt="Attachment" className="rounded-[10px] mb-1 max-h-60" /></a>
                    )}
                    <p className="text-[14px] whitespace-pre-wrap break-words">{m.body}</p>
                    <p className={`text-[10px] mt-1 text-right ${mine ? "text-primary-foreground/75" : "text-muted-foreground"}`}>
                      {time(m.createdAt)} {mine && <Ticks seen={!!m.seenAt} />}
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {resolved ? (
        <div className="px-5 py-4 border-t border-border bg-muted/40 text-center">
          <p className="text-[13px] text-muted-foreground">Resolved{ticket.resolvedAt ? ` — ${fmt(ticket.resolvedAt)}` : ""}. Set status to Open to reply.</p>
        </div>
      ) : (
        <div className="border-t border-border relative">
          {showReplies && (
            <div className="absolute bottom-full left-3 mb-2 w-[320px] max-h-64 overflow-y-auto bg-card border border-border rounded-[14px] shadow-lg z-10">
              {(meta?.replies ?? []).map((r) => (
                <button
                  key={r.id}
                  onClick={() => { setDraft(r.body); setNoteMode(false); setShowReplies(false); taRef.current?.focus(); }}
                  className="w-full text-left px-3 py-2 hover:bg-muted/40 border-b border-border last:border-0"
                >
                  <p className="text-[12px] font-bold text-foreground">{r.title}</p>
                  <p className="text-[12px] text-muted-foreground line-clamp-2">{r.body}</p>
                </button>
              ))}
              {(meta?.replies ?? []).length === 0 && <p className="p-3 text-[12px] text-muted-foreground">No quick replies.</p>}
            </div>
          )}
          <form
            onSubmit={(e) => { e.preventDefault(); submit(); }}
            className={`px-3 py-3 flex items-end gap-2 ${noteMode ? "bg-warning/10" : ""}`}
          >
            <button type="button" title="Quick replies" onClick={() => setShowReplies((v) => !v)} className="h-[42px] w-[42px] rounded-full hover:bg-muted/50 flex items-center justify-center text-muted-foreground">
              <MessageSquareText size={18} />
            </button>
            <button
              type="button"
              title={noteMode ? "Writing internal note" : "Write internal note"}
              onClick={() => setNoteMode((v) => !v)}
              className={`h-[42px] w-[42px] rounded-full flex items-center justify-center ${noteMode ? "bg-warning/30 text-foreground" : "hover:bg-muted/50 text-muted-foreground"}`}
            >
              <StickyNote size={18} />
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f); }} />
            <button type="button" title="Send photo (JPG/PNG, max 5 MB)" disabled={uploading || noteMode}
              onClick={() => fileRef.current?.click()}
              className="h-[42px] w-[42px] rounded-full hover:bg-muted/50 flex items-center justify-center text-muted-foreground disabled:opacity-40">
              <ImagePlus size={18} />
            </button>
            <textarea
              ref={taRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
              }}
              rows={1}
              placeholder={noteMode ? "Internal note — only staff see this" : "Type a message"}
              className="flex-1 px-4 py-2.5 rounded-[20px] border border-border bg-card text-[14px] resize-none"
            />
            <button type="submit" disabled={!draft.trim() || send.isPending} className="h-[42px] w-[42px] rounded-full bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40">
              <Send size={17} />
            </button>
          </form>
        </div>
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
              value={data.joinedAt ? new Date(data.joinedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Kolkata" }) : null}
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
                    {b.createdAt ? new Date(b.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Kolkata" }) : ""} ·{" "}
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
