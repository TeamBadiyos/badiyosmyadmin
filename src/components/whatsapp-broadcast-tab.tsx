import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, CheckCheck, Copy, Download, ImagePlus, Plus, RotateCcw, Send, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { tableCls, StatusPill } from "@/components/section-chrome";
import {
  createWaBroadcast,
  getWaAccess,
  getWaRecipients,
  listWaBroadcasts,
  listWaWebhookEvents,
  processWaBroadcast,
  retryWaFailed,
  sendWaTest,
  type WaBroadcastRow,
  type WaRecipientRow,
} from "@/lib/wa-broadcast.functions";

const labelCls = "text-[11px] font-bold uppercase tracking-wide text-muted-foreground";
const inputCls = "w-full h-10 rounded-[12px] border border-border bg-background px-3 text-[13px]";
const primaryBtn = "h-10 px-4 rounded-[12px] bg-primary text-primary-foreground font-semibold text-[13px] inline-flex items-center gap-2 disabled:opacity-60";
const ghostBtn = "h-9 px-3 rounded-[12px] border border-border font-semibold text-[13px] inline-flex items-center gap-1 hover:bg-muted disabled:opacity-60";

function validCount(raw: string) {
  const s = new Set<string>();
  for (const p of raw.split(/[\s,;]+/)) {
    let d = p.replace(/\D/g, "");
    if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
    else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
    if (/^[6-9]\d{9}$/.test(d)) s.add(d);
  }
  return s.size;
}
const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");
const fmt = (t: string | null) => (t ? new Date(t).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "");

export function WhatsAppBroadcastTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const accessFn = useServerFn(getWaAccess);
  const listFn = useServerFn(listWaBroadcasts);
  const createFn = useServerFn(createWaBroadcast);
  const testFn = useServerFn(sendWaTest);
  const processFn = useServerFn(processWaBroadcast);
  const retryFn = useServerFn(retryWaFailed);

  const { data: access } = useQuery({ queryKey: ["wa", "access"], queryFn: () => accessFn(), staleTime: 60_000 });
  const { data: rows = [] } = useQuery({
    queryKey: ["wa", "list"],
    queryFn: () => listFn(),
    refetchInterval: (q) => ((q.state.data as WaBroadcastRow[] | undefined)?.some((r) => r.status === "sending") ? 5000 : false),
  });

  const [campaign, setCampaign] = useState("");
  const [media, setMedia] = useState<{ url: string; filename: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [params, setParams] = useState<string[]>([]);
  const [linkCode, setLinkCode] = useState("");
  const [allCustomers, setAllCustomers] = useState(false);
  const [extra, setExtra] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [detail, setDetail] = useState<WaBroadcastRow | null>(null);
  const [showLog, setShowLog] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const extraValid = useMemo(() => validCount(extra), [extra]);
  const totalEstimate = (allCustomers ? access?.customerCount ?? 0 : 0) + extraValid;
  const code = linkCode.trim().toLowerCase();
  const linkUrl = code ? `badiyos.com/go/${code}` : "";

  // Keep sending batches while a broadcast is in progress and this page is open.
  const busy = useRef(false);
  useEffect(() => {
    const s = rows.find((r) => r.status === "sending" && !r.is_test);
    if (!s || busy.current || !canWrite) return;
    busy.current = true;
    processFn({ data: { id: s.id } })
      .catch(() => undefined)
      .finally(() => {
        busy.current = false;
        void qc.invalidateQueries({ queryKey: ["wa", "list"] });
      });
  }, [rows, canWrite, processFn, qc]);

  const payload = () => ({
    campaign_name: campaign.trim(),
    media_url: media?.url ?? null,
    media_filename: media?.filename ?? null,
    params: params.map((p) => p.trim()).filter(Boolean),
  });

  const send = useMutation({
    mutationFn: () =>
      createFn({ data: { ...payload(), include_all_customers: allCustomers, extra_numbers: extra, link_code: code || null } }),
    onSuccess: (r) => {
      toast.success(r.pending ? `Sending to ${r.total} numbers…` : `Sent to ${r.total} numbers`);
      setConfirmOpen(false);
      setExtra("");
      void qc.invalidateQueries({ queryKey: ["wa", "list"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const test = useMutation({
    mutationFn: () => testFn({ data: { ...payload(), phone: testPhone } }),
    onSuccess: (r) => {
      if (r.ok) toast.success("Test sent"); else toast.error(r.error ?? "Test failed");
      void qc.invalidateQueries({ queryKey: ["wa", "list"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const retry = useMutation({
    mutationFn: (id: string) => retryFn({ data: { id } }),
    onSuccess: () => { toast.success("Retrying failed numbers"); void qc.invalidateQueries({ queryKey: ["wa"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  async function upload(f: File) {
    if (!/^image\/(jpeg|png)$/.test(f.type)) return toast.error("Use a JPG or PNG image");
    if (f.size > 5 * 1024 * 1024) return toast.error("Image must be under 5 MB");
    setUploading(true);
    const ext = f.type === "image/png" ? "png" : "jpg";
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from("broadcast-media").upload(path, f, { contentType: f.type });
    setUploading(false);
    if (error) return toast.error(error.message);
    const { data } = supabase.storage.from("broadcast-media").getPublicUrl(path);
    setMedia({ url: data.publicUrl, filename: f.name.slice(0, 100) || `image.${ext}` });
  }

  const canSend = canWrite && campaign.trim().length > 0 && totalEstimate > 0;

  return (
    <div className="space-y-6">
      {canWrite && (
        <div className="rounded-[16px] border border-border bg-card p-5 space-y-4 max-w-[760px]">
          <div className="space-y-1">
            <div className={labelCls}>Campaign Name</div>
            <input className={inputCls} value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="e.g. dhanteras_offer" />
            <p className="text-[11px] text-muted-foreground">AiSensy API campaign name — must be Live</p>
          </div>

          <div className="space-y-1">
            <div className={labelCls}>Image (optional)</div>
            {media ? (
              <div className="flex items-start gap-3">
                <img src={media.url} alt="" className="h-24 rounded-[10px] border border-border object-cover" />
                <button className={ghostBtn} onClick={() => setMedia(null)}><X className="h-4 w-4" /> Remove</button>
              </div>
            ) : (
              <button className={ghostBtn} disabled={uploading} onClick={() => fileRef.current?.click()}>
                <ImagePlus className="h-4 w-4" /> {uploading ? "Uploading…" : "Upload image"}
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/jpeg,image/png" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
          </div>

          <div className="space-y-1">
            <div className={labelCls}>Params (optional)</div>
            {params.map((p, i) => (
              <div key={i} className="flex gap-2">
                <input className={inputCls} value={p} placeholder={`Param ${i + 1}`}
                  onChange={(e) => setParams(params.map((x, j) => (j === i ? e.target.value : x)))} />
                <button className={ghostBtn} onClick={() => setParams(params.filter((_, j) => j !== i))}><X className="h-4 w-4" /></button>
              </div>
            ))}
            <button className={ghostBtn} onClick={() => setParams([...params, ""])}><Plus className="h-4 w-4" /> Add param</button>
            <p className="text-[11px] text-muted-foreground">Use {"{name}"} for customer name</p>
          </div>

          <div className="space-y-1">
            <div className={labelCls}>Link Code (optional)</div>
            <input className={inputCls} value={linkCode} onChange={(e) => setLinkCode(e.target.value.replace(/[^a-zA-Z0-9-]/g, ""))} placeholder="e.g. dhanteras26" />
            {linkUrl && (
              <div className="flex items-center gap-2 text-[12px]">
                <span className="font-mono">{linkUrl}</span>
                <button className="text-primary" onClick={() => { void navigator.clipboard.writeText(`https://${linkUrl}`); toast.success("Copied"); }}>
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <span className="text-muted-foreground">Use this URL in the template button</span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className={labelCls}>Audience</div>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={allCustomers} onChange={(e) => setAllCustomers(e.target.checked)} />
              All Customers ({access?.customerCount ?? "…"})
            </label>
            <textarea className="w-full min-h-[90px] rounded-[12px] border border-border bg-background p-3 text-[13px]"
              value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Extra numbers — one per line or comma separated" />
            <p className="text-[11px] text-muted-foreground">{extraValid} valid numbers</p>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <input className={`${inputCls} max-w-[200px]`} value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="Test number" />
            <button className={ghostBtn} disabled={!campaign.trim() || !testPhone || test.isPending} onClick={() => test.mutate()}>
              {test.isPending ? "Sending…" : "Test Send"}
            </button>
            <button className={primaryBtn} disabled={!canSend || send.isPending} onClick={() => setConfirmOpen(true)}>
              <Send className="h-4 w-4" /> Send
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-bold">History</h3>
        {access?.role === "super_admin" && (
          <button className="text-[12px] text-primary underline" onClick={() => setShowLog(true)}>Webhook Log</button>
        )}
      </div>
      <div className={tableCls.wrap}>
        <div className={tableCls.scroll}>
          <table className={`${tableCls.table} min-w-[900px]`}>
            <thead className={tableCls.thead}>
              <tr>
                <th className={tableCls.th}>Date</th>
                <th className={tableCls.th}>Campaign</th>
                <th className={`${tableCls.th} text-right`}>Sent</th>
                <th className={`${tableCls.th} text-right`}>Delivered</th>
                <th className={`${tableCls.th} text-right`}>Read</th>
                <th className={`${tableCls.th} text-right`}>Replied</th>
                <th className={`${tableCls.th} text-right`}>Clicks</th>
                <th className={`${tableCls.th} text-right`}>Booked</th>
                <th className={tableCls.th}>Status</th>
                <th className={tableCls.th}></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={10} className={`${tableCls.td} text-center text-muted-foreground`}>No broadcasts yet</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className={tableCls.tr} onClick={() => setDetail(r)}>
                  <td className={tableCls.td}>{fmt(r.created_at)}</td>
                  <td className={tableCls.td}>
                    <span className="font-semibold">{r.campaign_name}</span>
                    {r.is_test && <span className="ml-2 text-[11px] text-muted-foreground">Test</span>}
                  </td>
                  <td className={`${tableCls.td} text-right`}>{r.sent}/{r.total}</td>
                  <td className={`${tableCls.td} text-right`}>{pct(r.delivered, r.sent)}</td>
                  <td className={`${tableCls.td} text-right`}>{pct(r.read, r.sent)}</td>
                  <td className={`${tableCls.td} text-right`}>{r.replied}</td>
                  <td className={`${tableCls.td} text-right`}>{r.link_code ? r.clicks : "—"}</td>
                  <td className={`${tableCls.td} text-right`}>{r.booked}</td>
                  <td className={tableCls.td}>
                    <StatusPill status={r.status === "done" ? "completed" : "confirmed"} label={r.status === "done" ? "Done" : r.status === "sending" ? "Sending" : "Queued"} />
                  </td>
                  <td className={tableCls.td} onClick={(e) => e.stopPropagation()}>
                    {canWrite && r.failed > 0 && r.status === "done" && (
                      <button className={ghostBtn} disabled={retry.isPending} onClick={() => retry.mutate(r.id)}>
                        <RotateCcw className="h-3.5 w-3.5" /> Retry Failed ({r.failed})
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {confirmOpen && (
        <Modal onClose={() => setConfirmOpen(false)}>
          <p className="text-[15px] font-bold">Send to {totalEstimate} numbers?</p>
          <p className="text-[13px] text-muted-foreground">Marketing messages are charged per message.</p>
          <div className="flex justify-end gap-2 pt-2">
            <button className={ghostBtn} onClick={() => setConfirmOpen(false)}>Cancel</button>
            <button className={primaryBtn} disabled={send.isPending} onClick={() => send.mutate()}>
              {send.isPending ? "Sending…" : "Send"}
            </button>
          </div>
        </Modal>
      )}
      {detail && <DetailDrawer row={rows.find((r) => r.id === detail.id) ?? detail} onClose={() => setDetail(null)} />}
      {showLog && <WebhookLog onClose={() => setShowLog(false)} />}
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4" onClick={onClose}>
      <div className="w-full max-w-[420px] rounded-[16px] bg-card p-5 space-y-2" onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

type Filter = "all" | "failed" | "delivered" | "read" | "replied" | "booked" | "read_not_booked";
const FILTERS: [Filter, string][] = [
  ["all", "All"], ["failed", "Failed"], ["delivered", "Delivered"], ["read", "Read"],
  ["replied", "Replied"], ["booked", "Booked"], ["read_not_booked", "Read, not booked"],
];
const isDelivered = (r: WaRecipientRow) => !!r.delivered_at || !!r.read_at || r.status === "delivered" || r.status === "read";
const isRead = (r: WaRecipientRow) => !!r.read_at || r.status === "read";

function Tick({ r }: { r: WaRecipientRow }) {
  if (r.status === "failed") return <X className="h-4 w-4 text-destructive" />;
  if (isRead(r)) return <CheckCheck className="h-4 w-4 text-primary" />;
  if (isDelivered(r)) return <CheckCheck className="h-4 w-4 text-muted-foreground" />;
  if (r.status === "sent") return <Check className="h-4 w-4 text-muted-foreground" />;
  return <span className="text-[11px] text-muted-foreground">…</span>;
}

function DetailDrawer({ row, onClose }: { row: WaBroadcastRow; onClose: () => void }) {
  const fn = useServerFn(getWaRecipients);
  const { data } = useQuery({
    queryKey: ["wa", "recipients", row.id],
    queryFn: () => fn({ data: { id: row.id } }),
    refetchInterval: row.status === "sending" ? 5000 : false,
  });
  const [filter, setFilter] = useState<Filter>("all");
  const all = data?.rows ?? [];
  const list = all.filter((r) => {
    switch (filter) {
      case "failed": return r.status === "failed";
      case "delivered": return isDelivered(r);
      case "read": return isRead(r);
      case "replied": return !!r.replied_at;
      case "booked": return !!r.booked_at;
      case "read_not_booked": return isRead(r) && !r.booked_at;
      default: return true;
    }
  });
  const buttons = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of all) if (r.button_text) m.set(r.button_text, (m.get(r.button_text) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [all]);
  const funnel: [string, number][] = [
    ["Sent", row.sent], ["Delivered", row.delivered], ["Read", row.read],
    ["Replied", row.replied], ["Clicked", row.clicks], ["Booked", row.booked],
  ];
  const max = Math.max(1, row.sent);

  function exportCsv() {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [["Name", "Phone", "Status", "Sent", "Delivered", "Read", "Replied", "Reply", "Button", "Booked", "Error"].join(",")];
    for (const r of list) {
      lines.push([r.name ?? "", r.phone, r.status, fmt(r.sent_at), fmt(r.delivered_at), fmt(r.read_at), fmt(r.replied_at),
        r.reply_text ?? "", r.button_text ?? "", fmt(r.booked_at), r.error ?? ""].map(esc).join(","));
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = `whatsapp-${row.campaign_name}-${filter}.csv`;
    a.click();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-foreground/40" onClick={onClose}>
      <div className="h-full w-full max-w-[720px] overflow-y-auto bg-card p-5 space-y-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[16px] font-bold">{row.campaign_name}</p>
            <p className="text-[12px] text-muted-foreground">{fmt(row.created_at)} · {row.total} numbers</p>
          </div>
          <button className={ghostBtn} onClick={onClose}><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-1.5">
          {funnel.map(([label, n]) => (
            <div key={label} className="flex items-center gap-3 text-[12px]">
              <span className="w-[70px] text-muted-foreground">{label}</span>
              <div className="h-5 flex-1 rounded-[6px] bg-muted overflow-hidden">
                <div className="h-full bg-primary" style={{ width: `${Math.min(100, (n / max) * 100)}%` }} />
              </div>
              <span className="w-[50px] text-right font-semibold">{n}</span>
            </div>
          ))}
        </div>

        {buttons.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {buttons.map(([t, n]) => (
              <span key={t} className="rounded-full border border-border px-3 py-1 text-[12px]">{t} — {n}</span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)}
              className={`h-8 px-3 rounded-full text-[12px] font-semibold border ${filter === k ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"}`}>
              {l}
            </button>
          ))}
          <button className={`${ghostBtn} ml-auto`} onClick={exportCsv}><Download className="h-4 w-4" /> Export CSV</button>
        </div>

        <div className="divide-y divide-border rounded-[12px] border border-border">
          {!data && <p className="p-4 text-[13px] text-muted-foreground">Loading…</p>}
          {data && list.length === 0 && <p className="p-4 text-[13px] text-muted-foreground">No numbers</p>}
          {list.map((r) => (
            <div key={r.id} className="flex items-start gap-3 p-3 text-[13px]">
              <Tick r={r} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold">{r.name || "—"} <span className="font-normal text-muted-foreground">{r.phone}</span></div>
                {(r.button_text || r.reply_text) && (
                  <div className="text-[12px]">{r.button_text ? `Button: ${r.button_text}` : r.reply_text}</div>
                )}
                {r.error && <div className="text-[12px] text-destructive break-words">{r.error}</div>}
                <div className="text-[11px] text-muted-foreground">
                  {[r.sent_at && `Sent ${fmt(r.sent_at)}`, r.read_at && `Read ${fmt(r.read_at)}`, r.replied_at && `Replied ${fmt(r.replied_at)}`, r.booked_at && `Booked ${fmt(r.booked_at)}`].filter(Boolean).join(" · ")}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function WebhookLog({ onClose }: { onClose: () => void }) {
  const fn = useServerFn(listWaWebhookEvents);
  const { data, error } = useQuery({ queryKey: ["wa", "webhook"], queryFn: () => fn() });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-foreground/40" onClick={onClose}>
      <div className="h-full w-full max-w-[720px] overflow-y-auto bg-card p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-[16px] font-bold">Webhook Log</p>
          <button className={ghostBtn} onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        {error && <p className="text-[13px] text-destructive">{(error as Error).message}</p>}
        {data?.length === 0 && <p className="text-[13px] text-muted-foreground">No events yet</p>}
        {data?.map((e) => (
          <div key={e.id} className="rounded-[12px] border border-border">
            <button className="flex w-full items-center gap-3 p-3 text-left text-[12px]" onClick={() => setOpen(open === e.id ? null : e.id)}>
              <span className={e.signature_valid ? "text-primary" : "text-destructive"}>{e.signature_valid ? "✓" : "✗"}</span>
              <span className="flex-1">{fmt(e.received_at)} · {e.event_type ?? "—"}</span>
              <span className="text-muted-foreground">{e.matched_recipient_id ? "matched" : ""}</span>
            </button>
            {open === e.id && (
              <pre className="max-h-[320px] overflow-auto border-t border-border bg-muted p-3 text-[11px]">{e.raw}</pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
