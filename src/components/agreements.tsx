import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { downloadAgreementPdf, type AgreementDoc } from "@/lib/agreement-pdf";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const err = (e: unknown) => (e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e));
const dt = (s?: string | null) => (s ? new Date(s).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—");

export const AGREEMENT_TYPES: [string, string][] = [
  ["store", "Store merchant"], ["restaurant", "Restaurant"], ["maid", "Maid"], ["washer", "Washer"], ["rider", "Rider"], ["area_partner", "Area Partner"],
];
const TYPE_LABEL = Object.fromEntries(AGREEMENT_TYPES);
const PLACEHOLDERS = ["name", "business_name", "city", "zone", "commission_pct", "fee_amount", "deposit_amount", "start_date", "end_date", "date"];
const SAMPLE: Record<string, string> = {
  name: "Ramesh Patil", business_name: "Patil General Store", city: "Latur", zone: "Shivaji Nagar", commission_pct: "10",
  fee_amount: "50000", deposit_amount: "25000", start_date: "01 Nov 2026", end_date: "31 Oct 2027", date: new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
};
const fill = (b: string, v: Record<string, string>) => b.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in v ? v[k] : m));

/** Very small markdown renderer: #, ##, - bullets, **bold**. */
export function AgreementText({ body }: { body: string }) {
  return (
    <div className="space-y-1.5 text-[13px] leading-relaxed text-foreground">
      {body.split("\n").map((l, i) => {
        const inl = (t: string) => t.split(/(\*\*[^*]+\*\*)/g).map((p, j) => (p.startsWith("**") ? <b key={j}>{p.slice(2, -2)}</b> : <span key={j}>{p}</span>));
        if (l.startsWith("# ")) return <h2 key={i} className="text-[18px] font-bold pt-1">{inl(l.slice(2))}</h2>;
        if (l.startsWith("## ")) return <h3 key={i} className="text-[14px] font-bold pt-2">{inl(l.slice(3))}</h3>;
        if (/^[-*] /.test(l)) return <div key={i} className="pl-4">• {inl(l.slice(2))}</div>;
        if (!l.trim()) return <div key={i} className="h-1" />;
        return <p key={i}>{inl(l)}</p>;
      })}
    </div>
  );
}

type Tpl = { id: string; type: string; version: number; title: string; body: string; reacceptance_required: boolean; created_at: string };

export function AgreementsSettingsPage({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const [view, setView] = useState<"templates" | "unsigned">("templates");
  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        {([["templates", "Templates"], ["unsigned", "Not yet signed"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setView(k)} className={`h-8 px-3 rounded-full text-[12px] font-semibold border ${view === k ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border"}`}>{l}</button>
        ))}
      </div>
      {view === "templates" ? <Templates isSuperAdmin={isSuperAdmin} /> : <Unsigned />}
    </div>
  );
}

function Templates({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const qc = useQueryClient();
  const [type, setType] = useState("store");
  const q = useQuery({
    queryKey: ["agreement-templates"],
    queryFn: async () => { const { data, error } = await db.from("agreement_templates").select("*").order("version", { ascending: false }); if (error) throw error; return data as Tpl[]; },
  });
  const versions = useMemo(() => (q.data ?? []).filter((t) => t.type === type), [q.data, type]);
  const current = versions[0];
  const [draft, setDraft] = useState<{ type: string; title: string; body: string } | null>(null);
  const [viewV, setViewV] = useState<Tpl | null>(null);
  const [reaccept, setReaccept] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const editing = draft?.type === type ? draft : null;
  const body = editing?.body ?? current?.body ?? "";
  const title = editing?.title ?? current?.title ?? "";
  const set = (patch: Partial<{ title: string; body: string }>) => setDraft({ type, title, body, ...patch });
  const insert = (txt: string, wrap = false) => {
    const el = ta.current; if (!el) return;
    const s = el.selectionStart, e = el.selectionEnd, sel = body.slice(s, e);
    const next = wrap ? body.slice(0, s) + txt + (sel || "text") + txt + body.slice(e) : body.slice(0, s) + txt + body.slice(e);
    set({ body: next }); requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = s + txt.length + (wrap ? (sel || "text").length + txt.length : 0); });
  };
  const save = useMutation({
    mutationFn: async () => { const { data, error } = await db.rpc("staff_save_agreement_template", { _type: type, _title: title, _body: body, _reaccept: reaccept }); if (error) throw error; return data; },
    onSuccess: (d: { version: number; resent: number }) => { toast.success(`Saved as version ${d.version}${d.resent ? ` · re-sent to ${d.resent}` : ""}`); setDraft(null); setReaccept(false); qc.invalidateQueries({ queryKey: ["agreement-templates"] }); qc.invalidateQueries({ queryKey: ["agreements"] }); },
    onError: (e) => toast.error(err(e)),
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1 border-b border-border">
        {AGREEMENT_TYPES.map(([k, l]) => (
          <button key={k} onClick={() => setType(k)} className={`px-3 py-2 text-[13px] border-b-2 ${type === k ? "border-primary text-primary font-semibold" : "border-transparent text-muted-foreground"}`}>{l}</button>
        ))}
      </div>
      {!isSuperAdmin && <p className="text-[12px] text-muted-foreground">Only super admins can edit agreements.</p>}
      {(type === "store" || type === "restaurant") && <MerchantGoLiveSetting isSuperAdmin={isSuperAdmin} />}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-card border border-border rounded-[14px] p-3 space-y-2">
          <input className="h-9 w-full rounded-[10px] border border-border bg-background px-3 text-[14px] font-semibold" value={title} disabled={!isSuperAdmin} onChange={(e) => set({ title: e.target.value })} placeholder="Agreement title" />
          {isSuperAdmin && (
            <div className="flex flex-wrap gap-1">
              <button className="h-7 px-2 rounded border border-border text-[12px] font-bold" onClick={() => insert("**", true)}>B</button>
              <button className="h-7 px-2 rounded border border-border text-[12px]" onClick={() => insert("\n## ")}>Heading</button>
              <button className="h-7 px-2 rounded border border-border text-[12px]" onClick={() => insert("\n- ")}>• List</button>
              <span className="w-px bg-border mx-1" />
              {PLACEHOLDERS.map((p) => <button key={p} className="h-7 px-2 rounded-full bg-muted text-[11px]" onClick={() => insert(`{{${p}}}`)}>{`{{${p}}}`}</button>)}
            </div>
          )}
          <textarea ref={ta} className="w-full min-h-[420px] rounded-[10px] border border-border bg-background p-3 font-mono text-[12px]" value={body} disabled={!isSuperAdmin} onChange={(e) => set({ body: e.target.value })} />
          {isSuperAdmin && (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-[12px]"><Switch checked={reaccept} onCheckedChange={setReaccept} /> Re-acceptance required (re-send to everyone who accepted)</label>
              <Button className="ml-auto" disabled={!editing || save.isPending || !body.trim()} onClick={() => save.mutate()}>Save as version {(current?.version ?? 0) + 1}</Button>
            </div>
          )}
        </div>
        <div className="space-y-3">
          <div className="bg-card border border-border rounded-[14px] p-4">
            <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">Live preview · sample values</div>
            <AgreementText body={fill(body, SAMPLE)} />
          </div>
          <div className="bg-card border border-border rounded-[14px] p-3">
            <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">Versions</div>
            {versions.map((v, i) => (
              <button key={v.id} onClick={() => setViewV(v)} className="w-full flex justify-between py-1.5 text-[13px] hover:text-primary">
                <span>Version {v.version}{i === 0 && " · current"}{v.reacceptance_required && " · re-acceptance"}</span><span className="text-muted-foreground">{dt(v.created_at)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <Dialog open={!!viewV} onOpenChange={(o) => !o && setViewV(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{viewV?.title} · version {viewV?.version} (read-only)</DialogTitle></DialogHeader>
          {viewV && <AgreementText body={viewV.body} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

type Unsigned = { party_type: string; party_id: string; name: string; phone: string; template_type: string; last_status: string | null; last_sent: string | null };
const PARTY_LABEL: Record<string, string> = { merchant: "Merchant", expert: "Expert", partner: "Partner" };

function Unsigned() {
  const qc = useQueryClient();
  const [kind, setKind] = useState("");
  const q = useQuery({ queryKey: ["agreements", "unsigned"], queryFn: async () => { const { data, error } = await db.rpc("staff_list_unsigned_agreements"); if (error) throw error; return data as Unsigned[]; } });
  const send = useMutation({
    mutationFn: async (r: Unsigned) => { const { error } = await db.rpc("staff_send_agreement", { _party_type: r.party_type, _party_id: r.party_id, _type: r.template_type }); if (error) throw error; },
    onSuccess: () => { toast.success("Agreement sent"); qc.invalidateQueries({ queryKey: ["agreements"] }); },
    onError: (e) => toast.error(err(e)),
  });
  const rows = (q.data ?? []).filter((r) => !kind || r.party_type === kind);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <select className="h-9 rounded-[10px] border border-border bg-background px-2 text-[13px]" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Everyone</option><option value="merchant">Merchants</option><option value="expert">Experts</option><option value="partner">Partners</option>
        </select>
        <span className="text-[12px] text-muted-foreground">{rows.length} not yet signed</span>
      </div>
      {q.isError && <p className="text-sm text-destructive">{err(q.error)}</p>}
      <div className="rounded-[14px] border border-border bg-card overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead><tr className="text-left text-muted-foreground border-b border-border"><th className="p-3">Name</th><th className="p-3">Who</th><th className="p-3">Agreement</th><th className="p-3">Status</th><th className="p-3" /></tr></thead>
          <tbody>
            {q.isLoading && <tr><td colSpan={5} className="p-4 text-muted-foreground">Loading…</td></tr>}
            {!q.isLoading && rows.length === 0 && <tr><td colSpan={5} className="p-4 text-muted-foreground">Everyone has signed.</td></tr>}
            {rows.map((r) => (
              <tr key={r.party_id + r.template_type} className="border-b border-border last:border-0">
                <td className="p-3 font-semibold">{r.name}<div className="text-[11px] text-muted-foreground font-normal">{r.phone}</div></td>
                <td className="p-3">{PARTY_LABEL[r.party_type]}</td>
                <td className="p-3">{TYPE_LABEL[r.template_type]}</td>
                <td className="p-3"><StatusTag s={r.last_status} />{r.last_sent && <div className="text-[11px] text-muted-foreground">Sent {dt(r.last_sent)}</div>}</td>
                <td className="p-3 text-right"><Button size="sm" variant="outline" disabled={send.isPending} onClick={() => send.mutate(r)}>{r.last_status ? "Send again" : "Send agreement"}</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusTag({ s, paper }: { s: string | null; paper?: boolean }) {
  const map: Record<string, [string, string]> = {
    accepted: [paper ? "Signed on paper" : "Accepted", "bg-primary/10 text-primary"],
    sent: ["Sent", "bg-muted text-foreground"],
    pending_reacceptance: ["Pending re-acceptance", "bg-destructive/10 text-destructive"],
    expired: ["Expired", "bg-muted text-muted-foreground"],
  };
  const [l, c] = map[s ?? ""] ?? ["Not sent", "bg-muted text-muted-foreground"];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${c}`}>{l}</span>;
}

type Ag = AgreementDoc & { is_reacceptance: boolean; paper_path: string | null };

/** Agreement card for Store/Restaurant, Expert and Partner detail screens. */
export function PartyAgreementCard({ partyType, partyId, canManage = true }: { partyType: "merchant" | "expert" | "partner"; partyId: string; canManage?: boolean }) {
  const qc = useQueryClient();
  const key = ["agreements", partyType, partyId];
  const q = useQuery({ queryKey: key, queryFn: async () => { const { data, error } = await db.rpc("staff_party_agreements", { _party_type: partyType, _party_id: partyId }); if (error) throw error; return (data ?? []) as Ag[]; } });
  const [view, setView] = useState<Ag | null>(null);
  const [histOpen, setHistOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [paperFor, setPaperFor] = useState<Ag | null>(null);
  const inv = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["agreements", "unsigned"] }); };
  const send = useMutation({
    mutationFn: async () => { const { error } = await db.rpc("staff_send_agreement", { _party_type: partyType, _party_id: partyId }); if (error) throw error; },
    onSuccess: () => { toast.success("Agreement sent"); inv(); }, onError: (e) => toast.error(err(e)),
  });
  const paper = useMutation({
    mutationFn: async ({ a, f }: { a: Ag; f: File }) => {
      if (f.size > 10 * 1024 * 1024) throw new Error("File is larger than 10 MB");
      const path = `${partyType}/${partyId}/${a.id}-${Date.now()}.${(f.name.split(".").pop() || "pdf").toLowerCase()}`;
      const up = await supabase.storage.from("agreements").upload(path, f, { contentType: f.type });
      if (up.error) throw up.error;
      const { error } = await db.rpc("staff_mark_agreement_paper", { _agreement_id: a.id, _path: path }); if (error) throw error;
    },
    onSuccess: () => { toast.success("Marked as signed on paper"); inv(); }, onError: (e) => toast.error(err(e)),
  });
  const openPaper = async (p: string) => { const { data, error } = await supabase.storage.from("agreements").createSignedUrl(p, 300); if (error) return toast.error(err(error)); window.open(data.signedUrl, "_blank"); };
  const list = q.data ?? [];
  const latestByType = new Map<string, Ag>();
  for (const a of list) if (!latestByType.has(a.template_type) && a.status !== "expired") latestByType.set(a.template_type, a);
  const st = (a: Ag) => (a.status === "sent" && a.is_reacceptance ? "pending_reacceptance" : a.status);
  return (
    <div className="bg-background border border-border rounded-[18px] p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Agreement</h3>
        {canManage && <Button size="sm" variant="outline" disabled={send.isPending} onClick={() => send.mutate()}>{list.length ? "Send again" : "Send agreement"}</Button>}
      </div>
      {q.isError && <p className="text-sm text-destructive">{err(q.error)}</p>}
      {!q.isLoading && latestByType.size === 0 && <p className="text-[13px] text-muted-foreground">No agreement yet.</p>}
      {[...latestByType.values()].map((a) => (
        <div key={a.id} className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="font-semibold">{TYPE_LABEL[a.template_type]} · v{a.template_version}</span>
          <StatusTag s={st(a)} paper={a.signed_method === "paper"} />
          {a.accepted_at && <span className="text-[11px] text-muted-foreground">{dt(a.accepted_at)}{a.accepted_phone ? ` · ${a.accepted_phone}` : ""}</span>}
          <span className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setView(a)}>View</Button>
            <Button size="sm" variant="ghost" onClick={() => downloadAgreementPdf(a).catch((e) => toast.error(err(e)))}>PDF</Button>
            {a.paper_path && <Button size="sm" variant="ghost" onClick={() => openPaper(a.paper_path!)}>Paper copy</Button>}
            {canManage && a.status === "sent" && <Button size="sm" variant="ghost" disabled={paper.isPending} onClick={() => { setPaperFor(a); fileRef.current?.click(); }}>Upload signed paper</Button>}
          </span>
        </div>
      ))}
      <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f && paperFor) paper.mutate({ a: paperFor, f }); e.target.value = ""; }} />
      {list.length > 0 && <button className="text-[12px] text-primary" onClick={() => setHistOpen((v) => !v)}>{histOpen ? "Hide history" : `History (${list.length})`}</button>}
      {histOpen && (
        <div className="divide-y divide-border text-[12px]">
          {list.map((a) => (
            <button key={a.id} onClick={() => setView(a)} className="w-full flex justify-between py-1.5 hover:text-primary">
              <span>{TYPE_LABEL[a.template_type]} v{a.template_version} · <StatusTag s={st(a)} paper={a.signed_method === "paper"} /></span><span className="text-muted-foreground">{dt(a.created_at)}</span>
            </button>
          ))}
        </div>
      )}
      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{view?.title} · v{view?.template_version}</DialogTitle></DialogHeader>
          {view && <>
            <AgreementText body={view.rendered_body} />
            <div className="mt-3 rounded-lg bg-muted p-3 text-[12px] space-y-0.5">
              <div><StatusTag s={st(view)} paper={view.signed_method === "paper"} /></div>
              <div>Issued {dt(view.created_at)} · Accepted {dt(view.accepted_at)}</div>
              <div>Phone {view.accepted_phone ?? "—"} · IP {view.accepted_ip ?? "—"}</div>
              <div className="break-all">Device {view.accepted_device ?? "—"}</div>
            </div>
          </>}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MerchantGoLiveSetting({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["merchant-onboarding-settings"], queryFn: async () => {
    const { data, error } = await db.from("merchant_onboarding_settings").select("require_signed_agreement").maybeSingle();
    if (error) throw error; return (data?.require_signed_agreement ?? true) as boolean;
  } });
  const m = useMutation({
    mutationFn: async (v: boolean) => { const { error } = await db.rpc("staff_set_merchant_agreement_setting", { _require: v }); if (error) throw error; },
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["merchant-onboarding-settings"] }); },
    onError: (e) => toast.error(err(e)),
  });
  return (
    <div className="bg-card border border-border rounded-[14px] p-3 flex items-center justify-between gap-3">
      <div>
        <p className="text-[14px] font-semibold">Signed agreement required to go live</p>
        <p className="text-[12px] text-muted-foreground">Flow: merchant registers → you approve (commission, fee, deposit) → agreement sent → merchant signs → store shows in customer app. Turn off to show stores right after approval.</p>
      </div>
      <Switch checked={q.data ?? true} disabled={!isSuperAdmin || m.isPending || q.isLoading} onCheckedChange={(v) => m.mutate(v)} />
    </div>
  );
}
