import { DateInput } from "@/components/date-input";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Archive, LayoutGrid, List, Phone, Plus, RefreshCw, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SuggestionStatusesTab } from "@/components/suggestion-statuses-tab";
import {
  SUGGESTION_CATEGORIES,
  SUGGESTION_PRIORITIES,
  SUGGESTION_SOURCES,
  changeSuggestionStatus,
  createManualSuggestion,
  getSuggestionDetail,
  listSuggestionStatuses,
  listSuggestions,
  updateSuggestionMeta,
  type ManualSuggestionInput,
  type Suggestion,
  type SuggestionStatus,
} from "@/lib/suggestions.functions";

const SOURCE_LABEL: Record<string, string> = {
  customer_app: "Customer app",
  whatsapp: "WhatsApp",
  call: "Call",
  expert: "Expert",
  merchant: "Merchant",
  internal: "Internal",
};
const CATEGORY_LABEL: Record<string, string> = {
  app: "App",
  service_quality: "Service quality",
  new_service: "New service",
  price: "Price",
  other: "Other",
};
const PRIORITY_CLS: Record<string, string> = {
  high: "bg-destructive/15 text-destructive",
  medium: "bg-warning/20 text-foreground",
  low: "bg-muted text-muted-foreground",
};

const selectCls =
  "h-9 rounded-lg border border-border bg-background px-2 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

function fmt(d: string) {
  return new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
}

export function SuggestionsPage() {
  const qc = useQueryClient();
  const fetchList = useServerFn(listSuggestions);
  const fetchStatuses = useServerFn(listSuggestionStatuses);
  const [view, setView] = useState<"board" | "list" | "statuses">("board");
  const [showArchived, setShowArchived] = useState(false);
  const [f, setF] = useState({ status: "", category: "", source: "", priority: "", from: "", to: "", q: "" });
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const listQ = useQuery({
    queryKey: ["suggestions", "list", showArchived],
    queryFn: () => fetchList({ data: { includeArchived: showArchived } }),
    refetchInterval: 60_000,
  });
  const statusQ = useQuery({ queryKey: ["suggestions", "statuses"], queryFn: () => fetchStatuses() });

  const statuses = statusQ.data?.statuses ?? [];
  const statusById = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses]);
  const staffById = useMemo(() => new Map((listQ.data?.staff ?? []).map((s) => [s.id, s.name])), [listQ.data]);
  const canEdit = !!listQ.data?.canEdit;

  const rows = useMemo(() => {
    const term = f.q.trim().toLowerCase();
    return (listQ.data?.suggestions ?? []).filter((s) => {
      if (f.status && s.status_id !== f.status) return false;
      if (f.category && s.category !== f.category) return false;
      if (f.source && s.source !== f.source) return false;
      if (f.priority && s.priority !== f.priority) return false;
      if (f.from && new Date(s.created_at) < new Date(f.from)) return false;
      if (f.to && new Date(s.created_at) > new Date(f.to + "T23:59:59")) return false;
      if (term && ![s.text, s.name, s.phone].some((v) => v?.toLowerCase().includes(term))) return false;
      return true;
    });
  }, [listQ.data, f]);

  const activeStatuses = statuses.filter((s) => s.active);
  const counts = listQ.data?.counts;
  const filtersOn = Object.values(f).some(Boolean);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat label="New" value={counts?.new} />
        <Stat label="Pending (not closed)" value={counts?.pending} />
        <Stat label="Closed this month" value={counts?.finalThisMonth} />
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex rounded-lg border border-border p-0.5 bg-card">
          {(
            [
              ["board", "Board", LayoutGrid],
              ["list", "List", List],
              ["statuses", "Statuses", Settings2],
            ] as const
          ).map(([k, label, Icon]) => (
            <button
              key={k}
              type="button"
              onClick={() => setView(k)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] ${view === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void qc.invalidateQueries({ queryKey: ["suggestions"] })}>
            <RefreshCw className={`h-4 w-4 ${listQ.isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
          {canEdit && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> Add suggestion
            </Button>
          )}
        </div>
      </div>

      {view === "statuses" ? (
        <SuggestionStatusesTab />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Input placeholder="Search text, name, phone" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} className="h-9 w-56" />
            <select className={selectCls} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              <option value="">All statuses</option>
              {statuses.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <select className={selectCls} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              <option value="">All categories</option>
              {SUGGESTION_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
            <select className={selectCls} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
              <option value="">All sources</option>
              {SUGGESTION_SOURCES.map((c) => <option key={c} value={c}>{SOURCE_LABEL[c]}</option>)}
            </select>
            <select className={selectCls} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
              <option value="">All priorities</option>
              {SUGGESTION_PRIORITIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <DateInput  className={selectCls} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="From date" />
            <DateInput  className={selectCls} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="To date" />
            <label className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
            </label>
            {filtersOn && (
              <Button variant="ghost" size="sm" onClick={() => setF({ status: "", category: "", source: "", priority: "", from: "", to: "", q: "" })}>
                Reset
              </Button>
            )}
          </div>

          {listQ.isLoading ? (
            <p className="text-[14px] text-muted-foreground">Loading suggestions…</p>
          ) : listQ.isError ? (
            <p className="text-[14px] text-destructive">{(listQ.error as Error).message}</p>
          ) : view === "board" ? (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {activeStatuses.map((st) => {
                const items = rows.filter((r) => r.status_id === st.id);
                return (
                  <div key={st.id} className="w-72 shrink-0 rounded-xl border border-border bg-muted/40">
                    <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: st.color }} />
                      <span className="text-[13px] font-semibold text-foreground">{st.label}</span>
                      <span className="ml-auto text-[12px] text-muted-foreground">{items.length}</span>
                    </div>
                    <div className="p-2 space-y-2 max-h-[65vh] overflow-y-auto">
                      {items.length === 0 && <p className="px-1 py-4 text-center text-[12px] text-muted-foreground">Nothing here</p>}
                      {items.map((s) => (
                        <Card key={s.id} s={s} staff={staffById} onOpen={() => setOpenId(s.id)} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full text-[13px]">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    {["Date", "Suggestion", "Category", "Source", "Customer", "Status", "Priority", "Assignee"].map((h) => (
                      <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.length === 0 && (
                    <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No suggestions match</td></tr>
                  )}
                  {rows.map((s) => {
                    const st = s.status_id ? statusById.get(s.status_id) : undefined;
                    return (
                      <tr key={s.id} onClick={() => setOpenId(s.id)} className={`cursor-pointer hover:bg-muted/40 ${s.archived ? "opacity-60" : ""}`}>
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{fmt(s.created_at)}</td>
                        <td className="px-3 py-2 max-w-[320px] truncate">{s.text}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{CATEGORY_LABEL[s.category]}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{SOURCE_LABEL[s.source]}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{s.name || s.phone || "—"}</td>
                        <td className="px-3 py-2 whitespace-nowrap"><StatusPill st={st} /></td>
                        <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] capitalize ${PRIORITY_CLS[s.priority]}`}>{s.priority}</span></td>
                        <td className="px-3 py-2 whitespace-nowrap">{s.assigned_to ? staffById.get(s.assigned_to) ?? "—" : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {adding && <AddDialog staff={listQ.data?.staff ?? []} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void qc.invalidateQueries({ queryKey: ["suggestions"] }); }} />}
      {openId && (
        <DetailSheet
          id={openId}
          canEdit={canEdit}
          statuses={statuses}
          staff={listQ.data?.staff ?? []}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="text-[12px] text-muted-foreground">{label}</div>
      <div className="text-[24px] font-semibold text-foreground">{value ?? "—"}</div>
    </div>
  );
}

function StatusPill({ st }: { st: SuggestionStatus | undefined }) {
  if (!st) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px]">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: st.color }} /> {st.label}
    </span>
  );
}

function Card({ s, staff, onOpen }: { s: Suggestion; staff: Map<string, string>; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="w-full text-left rounded-lg border border-border bg-card p-3 hover:border-primary/50 transition-colors">
      <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{CATEGORY_LABEL[s.category]}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{SOURCE_LABEL[s.source]}</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] capitalize ${PRIORITY_CLS[s.priority]}`}>{s.priority}</span>
        {s.archived && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">Archived</span>}
      </div>
      <p className="text-[13px] text-foreground line-clamp-3">{s.text}</p>
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">{s.name || s.phone || "Anonymous"}</span>
        <span className="shrink-0">{fmt(s.created_at)}</span>
      </div>
      {s.assigned_to && <div className="mt-1 text-[11px] text-muted-foreground">→ {staff.get(s.assigned_to) ?? "Staff"}</div>}
    </button>
  );
}

function AddDialog({ staff, onClose, onSaved }: { staff: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const create = useServerFn(createManualSuggestion);
  const [form, setForm] = useState<ManualSuggestionInput>({
    source: "whatsapp",
    category: "other",
    text: "",
    name: "",
    phone: "",
    priority: "medium",
    assigned_to: null,
  });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await create({ data: form });
      toast.success("Suggestion added");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Add suggestion</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Lbl label="Source">
            <select className={selectCls + " w-full"} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value as ManualSuggestionInput["source"] })}>
              {SUGGESTION_SOURCES.map((c) => <option key={c} value={c}>{SOURCE_LABEL[c]}</option>)}
            </select>
          </Lbl>
          <Lbl label="Category">
            <select className={selectCls + " w-full"} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ManualSuggestionInput["category"] })}>
              {SUGGESTION_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
          </Lbl>
          <div className="col-span-2">
            <Lbl label="Suggestion">
              <Textarea rows={4} maxLength={4000} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} />
            </Lbl>
          </div>
          <Lbl label="Customer name (optional)">
            <Input maxLength={120} value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Lbl>
          <Lbl label="Phone (optional)">
            <Input maxLength={15} inputMode="tel" value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Lbl>
          <Lbl label="Priority">
            <select className={selectCls + " w-full"} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as ManualSuggestionInput["priority"] })}>
              {SUGGESTION_PRIORITIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Lbl>
          <Lbl label="Assign to">
            <select className={selectCls + " w-full"} value={form.assigned_to ?? ""} onChange={(e) => setForm({ ...form, assigned_to: e.target.value || null })}>
              <option value="">Unassigned</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Lbl>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy}>{busy ? "Saving…" : "Add"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailSheet({
  id,
  canEdit,
  statuses,
  staff,
  onClose,
}: {
  id: string;
  canEdit: boolean;
  statuses: SuggestionStatus[];
  staff: { id: string; name: string }[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const fetchDetail = useServerFn(getSuggestionDetail);
  const changeStatus = useServerFn(changeSuggestionStatus);
  const updateMeta = useServerFn(updateSuggestionMeta);
  const q = useQuery({ queryKey: ["suggestions", "detail", id], queryFn: () => fetchDetail({ data: { id } }) });
  const [nextStatus, setNextStatus] = useState("");
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);
  const statusById = new Map(statuses.map((s) => [s.id, s]));
  const s = q.data?.suggestion;
  const refresh = () => qc.invalidateQueries({ queryKey: ["suggestions"] });

  const submitStatus = async () => {
    if (!s) return;
    if (!remark.trim()) return toast.error("Remark is required");
    setBusy(true);
    try {
      const res = await changeStatus({ data: { id: s.id, status_id: nextStatus || s.status_id || "", remark } });
      toast.success(res.notified ? "Saved — customer notified" : "Saved");
      setRemark("");
      setNextStatus("");
      void refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const meta = async (patch: { priority?: Suggestion["priority"]; assigned_to?: string | null; archived?: boolean }) => {
    if (!s) return;
    try {
      await updateMeta({ data: { id: s.id, ...patch } });
      toast.success("Updated");
      void refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader><SheetTitle>Suggestion</SheetTitle></SheetHeader>
        {q.isLoading || !s ? (
          <p className="mt-6 text-[14px] text-muted-foreground">{q.isError ? (q.error as Error).message : "Loading…"}</p>
        ) : (
          <div className="mt-4 space-y-5">
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusPill st={s.status_id ? statusById.get(s.status_id) : undefined} />
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">{CATEGORY_LABEL[s.category]}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">{SOURCE_LABEL[s.source]}</span>
              <span className="text-[12px] text-muted-foreground ml-auto">{fmt(s.created_at)}</span>
            </div>
            <p className="whitespace-pre-wrap text-[14px] text-foreground">{s.text}</p>
            {q.data?.photoUrl && (
              <a href={q.data.photoUrl} target="_blank" rel="noreferrer">
                <img src={q.data.photoUrl} alt="Suggestion attachment" className="max-h-72 rounded-lg border border-border object-contain" />
              </a>
            )}
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <div className="min-w-0">
                <div className="text-[14px] font-medium text-foreground truncate">{s.name || "Unknown customer"}</div>
                <div className="text-[12px] text-muted-foreground">{s.phone || "No phone"}</div>
              </div>
              {s.phone && (
                <Button asChild size="sm" variant="outline">
                  <a href={`tel:${s.phone}`}><Phone className="h-4 w-4" /> Call</a>
                </Button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Lbl label="Priority">
                <select className={selectCls + " w-full"} disabled={!canEdit} value={s.priority} onChange={(e) => void meta({ priority: e.target.value as Suggestion["priority"] })}>
                  {SUGGESTION_PRIORITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Lbl>
              <Lbl label="Assignee">
                <select className={selectCls + " w-full"} disabled={!canEdit} value={s.assigned_to ?? ""} onChange={(e) => void meta({ assigned_to: e.target.value || null })}>
                  <option value="">Unassigned</option>
                  {staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </Lbl>
            </div>

            {canEdit && (
              <div className="space-y-2 rounded-lg border border-border p-3">
                <div className="text-[13px] font-medium text-foreground">Change status / add remark</div>
                <select className={selectCls + " w-full"} value={nextStatus || s.status_id || ""} onChange={(e) => setNextStatus(e.target.value)}>
                  {statuses.filter((x) => x.active || x.id === s.status_id).map((x) => (
                    <option key={x.id} value={x.id}>{x.label}{x.notify_customer && s.source === "customer_app" ? " (notifies customer)" : ""}</option>
                  ))}
                </select>
                <Textarea rows={2} maxLength={1000} placeholder="Remark (required)" value={remark} onChange={(e) => setRemark(e.target.value)} />
                <div className="flex justify-between gap-2">
                  <Button variant="ghost" size="sm" onClick={() => void meta({ archived: !s.archived })}>
                    <Archive className="h-4 w-4" /> {s.archived ? "Restore" : "Archive"}
                  </Button>
                  <Button size="sm" disabled={busy || !remark.trim()} onClick={() => void submitStatus()}>{busy ? "Saving…" : "Save"}</Button>
                </div>
              </div>
            )}

            <div>
              <div className="text-[13px] font-medium text-foreground mb-2">Timeline</div>
              {(q.data?.remarks ?? []).length === 0 && <p className="text-[12px] text-muted-foreground">No remarks yet</p>}
              <ol className="space-y-3 border-l border-border pl-4">
                {(q.data?.remarks ?? []).map((r) => (
                  <li key={r.id} className="text-[13px]">
                    <div className="text-[11px] text-muted-foreground">{fmt(r.created_at)} · {r.staff_name ?? "Staff"}</div>
                    {r.new_status_id && (
                      <div className="text-[12px] text-muted-foreground">
                        {r.old_status_id ? statusById.get(r.old_status_id)?.label ?? "—" : "—"} → {statusById.get(r.new_status_id)?.label ?? "—"}
                      </div>
                    )}
                    <div className="text-foreground">{r.remark}</div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Lbl({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[12px] font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
