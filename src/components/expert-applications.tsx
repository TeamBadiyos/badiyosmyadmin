import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AgreementText } from "@/components/agreements";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const err = (e: unknown) => (e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e));
const dt = (s?: string | null) => (s ? new Date(s).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—");

const WORK: Record<string, string> = { maid: "Maid", washer: "Washer", rider: "Rider" };
const STATUS: Record<string, [string, string]> = {
  submitted: ["Submitted", "bg-primary/10 text-primary"], query_raised: ["Query raised", "bg-destructive/10 text-destructive"],
  approved: ["Approved", "bg-primary/10 text-primary"], rejected: ["Rejected", "bg-muted text-muted-foreground"],
  training: ["Training", "bg-muted text-foreground"], live: ["Live", "bg-primary text-primary-foreground"],
};
const QUERY_REASONS = ["Aadhaar photo not clear", "PAN photo not clear", "Profile photo not clear", "Bank details don't match the name", "Driving licence missing or unclear", "Vehicle RC missing or unclear", "Address incomplete"];
const DOCS: [string, string, boolean][] = [["aadhaar", "Aadhaar", false], ["pan", "PAN", false], ["driving_licence", "Driving licence", true], ["vehicle_rc", "Vehicle RC", true]];

type App = {
  id: string; name: string | null; phone: string | null; photo_path: string | null; address: string | null; zone_name: string | null;
  work_types: string[]; documents: Record<string, string>; bank_account_number: string | null; bank_ifsc: string | null; bank_account_holder_name: string | null; upi_id: string | null;
  status: string; query_reason: string | null; query_note: string | null; reject_reason: string | null; submitted_at: string | null; created_at: string;
  missing: string[]; live: boolean | null; expert_id: string | null;
  agreements: { id: string; template_type: string; status: string; title: string; body: string; accepted_at: string | null; template_version: number; accepted_phone: string | null }[];
};
const viewStatus = (a: App) => (a.status === "approved" ? (a.live ? "live" : a.work_types.includes("maid") ? "training" : "live") : a.status);

export function useApplicationsCount() {
  return useQuery({ queryKey: ["expert-apps", "count"], queryFn: async () => { const { data } = await db.rpc("staff_list_expert_applications", { _status: "submitted" }); return (data ?? []).length as number; }, refetchInterval: 120_000 });
}

export function ExpertApplicationsPanel() {
  const [status, setStatus] = useState("submitted");
  const q = useQuery({ queryKey: ["expert-apps", status], queryFn: async () => { const { data, error } = await db.rpc("staff_list_expert_applications", { _status: status || null }); if (error) throw error; return data as App[]; } });
  const [open, setOpen] = useState<App | null>(null);
  return (
    <div className="space-y-3">
      <select className="h-9 rounded-[10px] border border-border bg-background px-2 text-[13px]" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="submitted">Submitted</option><option value="query_raised">Query raised</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="">All (except drafts)</option>
      </select>
      {q.isError && <p className="text-sm text-destructive">{err(q.error)}</p>}
      <div className="rounded-[14px] border border-border bg-card overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead><tr className="text-left text-muted-foreground border-b border-border"><th className="p-3">Applicant</th><th className="p-3">Work type</th><th className="p-3">Submitted</th><th className="p-3">Documents</th><th className="p-3">Status</th></tr></thead>
          <tbody>
            {q.isLoading && <tr><td colSpan={5} className="p-4 text-muted-foreground">Loading…</td></tr>}
            {!q.isLoading && (q.data ?? []).length === 0 && <tr><td colSpan={5} className="p-4 text-muted-foreground">No applications.</td></tr>}
            {(q.data ?? []).map((a) => {
              const [l, c] = STATUS[viewStatus(a)] ?? [a.status, "bg-muted"];
              return (
                <tr key={a.id} className="border-b border-border last:border-0 cursor-pointer hover:bg-muted/50" onClick={() => setOpen(a)}>
                  <td className="p-3 font-semibold">{a.name || "—"}<div className="text-[11px] font-normal text-muted-foreground">{a.phone} · {a.zone_name ?? "No zone"}</div></td>
                  <td className="p-3">{a.work_types.map((w) => WORK[w]).join(", ")}</td>
                  <td className="p-3">{dt(a.submitted_at)}</td>
                  <td className="p-3"><Checklist a={a} /></td>
                  <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${c}`}>{l}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {open && <AppDetail a={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Checklist({ a }: { a: App }) {
  const rider = a.work_types.includes("rider");
  const items: [string, boolean][] = [
    ["Photo", !!a.photo_path], ...DOCS.filter(([, , r]) => !r || rider).map(([k, l]) => [l, !!a.documents?.[k]] as [string, boolean]),
    ["Bank/UPI", !a.missing.includes("bank_or_upi")], ["Agreement", a.agreements.length > 0 && a.agreements.every((g) => g.status === "accepted")],
  ];
  return <div className="flex flex-wrap gap-1">{items.map(([l, ok]) => <span key={l} className={`rounded px-1.5 py-0.5 text-[11px] ${ok ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}>{ok ? "✓" : "✗"} {l}</span>)}</div>;
}

function DocPreview({ label, path }: { label: string; path: string | null | undefined }) {
  const q = useQuery({ queryKey: ["app-doc", path], enabled: !!path, queryFn: async () => { const { data, error } = await supabase.storage.from("expert-applications").createSignedUrl(path!, 600); if (error) throw error; return data.signedUrl; } });
  const isPdf = path?.toLowerCase().endsWith(".pdf");
  return (
    <div className="rounded-lg border border-border p-2">
      <div className="text-[11px] font-bold uppercase text-muted-foreground mb-1">{label}</div>
      {!path ? <div className="h-28 grid place-items-center text-[12px] text-destructive">Missing</div>
        : q.data ? (isPdf ? <a href={q.data} target="_blank" rel="noreferrer" className="h-28 grid place-items-center text-primary text-[12px]">Open PDF</a>
          : <a href={q.data} target="_blank" rel="noreferrer"><img src={q.data} alt={label} className="h-28 w-full object-cover rounded" /></a>)
        : <div className="h-28 grid place-items-center text-[12px] text-muted-foreground">{q.isError ? err(q.error) : "Loading…"}</div>}
    </div>
  );
}

function AppDetail({ a, onClose }: { a: App; onClose: () => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"" | "query" | "reject">("");
  const [reason, setReason] = useState(QUERY_REASONS[0]);
  const [note, setNote] = useState("");
  const [ag, setAg] = useState<App["agreements"][number] | null>(null);
  const act = useMutation({
    mutationFn: async (action: "approve" | "query" | "reject") => {
      const r = action === "reject" ? note : reason;
      const { error } = await db.rpc("staff_review_expert_application", { _id: a.id, _action: action, _reason: r, _note: action === "query" ? note : null });
      if (error) throw error;
    },
    onSuccess: (_d, action) => { toast.success(action === "approve" ? "Approved — Expert created with skills and zone" : action === "query" ? "Query sent to applicant" : "Application rejected"); qc.invalidateQueries({ queryKey: ["expert-apps"] }); qc.invalidateQueries({ queryKey: ["experts"] }); onClose(); },
    onError: (e) => toast.error(err(e)),
  });
  const rider = a.work_types.includes("rider");
  const canAct = a.status === "submitted" || a.status === "query_raised";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{a.name || "Applicant"} · {a.work_types.map((w) => WORK[w]).join(", ")}</DialogTitle></DialogHeader>
        <div className="grid sm:grid-cols-2 gap-3 text-[13px]">
          <div className="space-y-1">
            <div><b>Phone:</b> {a.phone}</div><div><b>Zone:</b> {a.zone_name ?? "—"}</div><div><b>Address:</b> {a.address ?? "—"}</div>
            <div><b>Submitted:</b> {dt(a.submitted_at)}</div>
            {a.query_reason && <div className="text-destructive"><b>Query:</b> {a.query_reason}{a.query_note ? ` — ${a.query_note}` : ""}</div>}
            {a.reject_reason && <div className="text-destructive"><b>Rejected:</b> {a.reject_reason}</div>}
          </div>
          <div className="space-y-1">
            <div><b>Bank:</b> {a.bank_account_holder_name ?? "—"} · {a.bank_account_number ?? "—"} · {a.bank_ifsc ?? "—"}</div>
            <div><b>UPI:</b> {a.upi_id ?? "—"}</div>
            <div><b>Missing:</b> {a.missing.length ? a.missing.join(", ") : "Nothing"}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
          <DocPreview label="Photo" path={a.photo_path} />
          {DOCS.filter(([, , r]) => !r || rider).map(([k, l]) => <DocPreview key={k} label={l} path={a.documents?.[k]} />)}
          {a.documents?.bank_proof && <DocPreview label="Bank proof" path={a.documents.bank_proof} />}
        </div>
        <div className="mt-2 space-y-1 text-[13px]">
          <b>Agreements</b>
          {a.agreements.length === 0 && <p className="text-muted-foreground">Not accepted yet.</p>}
          {a.agreements.map((g) => (
            <div key={g.id} className="flex items-center gap-2">
              <span>{g.title} · v{g.template_version}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] ${g.status === "accepted" ? "bg-primary/10 text-primary" : "bg-muted"}`}>{g.status === "accepted" ? `Accepted ${dt(g.accepted_at)}` : "Not accepted"}</span>
              <button className="text-primary text-[12px]" onClick={() => setAg(g)}>View</button>
            </div>
          ))}
        </div>
        {canAct && (
          <div className="mt-3 border-t border-border pt-3 space-y-2">
            {mode === "" && (
              <div className="flex flex-wrap gap-2">
                <Button disabled={act.isPending || a.missing.length > 0} onClick={() => act.mutate("approve")}>Approve</Button>
                <Button variant="outline" onClick={() => setMode("query")}>Raise query</Button>
                <Button variant="outline" className="text-destructive" onClick={() => { setMode("reject"); setNote(""); }}>Reject</Button>
                {a.missing.length > 0 && <span className="text-[12px] text-muted-foreground self-center">Approve needs every item complete.</span>}
              </div>
            )}
            {mode === "query" && (
              <div className="space-y-2">
                <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={reason} onChange={(e) => setReason(e.target.value)}>{QUERY_REASONS.map((r) => <option key={r}>{r}</option>)}</select>
                <input className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" placeholder="Extra note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="flex gap-2"><Button disabled={act.isPending} onClick={() => act.mutate("query")}>Send query</Button><Button variant="ghost" onClick={() => setMode("")}>Cancel</Button></div>
              </div>
            )}
            {mode === "reject" && (
              <div className="space-y-2">
                <input className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" placeholder="Reason (required)" value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="flex gap-2"><Button variant="destructive" disabled={act.isPending || !note.trim()} onClick={() => act.mutate("reject")}>Reject</Button><Button variant="ghost" onClick={() => setMode("")}>Cancel</Button></div>
              </div>
            )}
          </div>
        )}
        <Dialog open={!!ag} onOpenChange={(o) => !o && setAg(null)}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>{ag?.title}</DialogTitle></DialogHeader>{ag && <AgreementText body={ag.body} />}</DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
