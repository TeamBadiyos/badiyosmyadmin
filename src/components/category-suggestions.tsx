import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  listCategories, listCategorySuggestions, resolveCategorySuggestion, rejectCategorySuggestion, applyLabelMapping,
  type CatKind, type CatSuggestion,
} from "@/lib/categories.functions";

const err = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
const fmt = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const selCls = "h-9 rounded-md border border-input bg-background px-2 text-sm";

export function CategorySuggestionsChip({ kind, canAct, upload }: { kind: "store_product" | "food"; canAct: boolean; upload: (f: File, k: CatKind) => Promise<string> }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listCategorySuggestions);
  const catsFn = useServerFn(listCategories);
  const resolveFn = useServerFn(resolveCategorySuggestion);
  const rejectFn = useServerFn(rejectCategorySuggestion);
  const applyFn = useServerFn(applyLabelMapping);
  const q = useQuery({ queryKey: ["cat-suggestions", kind], queryFn: () => listFn({ data: { kind } }) });
  const cats = useQuery({ queryKey: ["categories", kind, "default-for-suggest"], queryFn: () => catsFn({ data: { kind, cityId: null } }) });
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"new" | "old">("new");
  const [pick, setPick] = useState<Record<string, string>>({});
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [create, setCreate] = useState<CatSuggestion | null>(null);
  const [reject, setReject] = useState<CatSuggestion | null>(null);
  const all = q.data ?? [];
  const rows = all.filter((r) => (tab === "old" ? r.legacy : !r.legacy));
  const catList = (cats.data?.rows ?? []) as any[];
  useEffect(() => {
    setPick((p) => { const n = { ...p }; for (const r of all) if (!n[r.id] && r.guess_id) n[r.id] = r.guess_id; return n; });
  }, [q.data]);
  const inv = () => { qc.invalidateQueries({ queryKey: ["cat-suggestions", kind] }); qc.invalidateQueries({ queryKey: ["categories", kind] }); };
  const map = useMutation({
    mutationFn: (r: CatSuggestion) => resolveFn({ data: { id: r.id, mode: "map", targetId: pick[r.id] } }),
    onSuccess: (d) => { toast.success(`Moved ${d.moved} item(s)`); inv(); }, onError: (e) => toast.error(err(e)),
  });
  const apply = useMutation({
    mutationFn: () => applyFn({ data: { rows: rows.filter((r) => ticked[r.id] && pick[r.id]).map((r) => ({ id: r.id, target_id: pick[r.id] })) } }),
    onSuccess: (d) => { toast.success(`Applied ${d.suggestions} · moved ${d.moved} item(s)`); setTicked({}); inv(); }, onError: (e) => toast.error(err(e)),
  });
  const nNew = all.filter((r) => !r.legacy).length, nOld = all.filter((r) => r.legacy).length;
  const tickedCount = useMemo(() => rows.filter((r) => ticked[r.id]).length, [rows, ticked]);

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Suggestions ({all.length})</Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
          <SheetHeader><SheetTitle>Category suggestions</SheetTitle></SheetHeader>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant={tab === "new" ? "default" : "outline"} onClick={() => setTab("new")}>From merchants ({nNew})</Button>
            <Button size="sm" variant={tab === "old" ? "default" : "outline"} onClick={() => setTab("old")}>Review old categories ({nOld})</Button>
          </div>
          {tab === "old" && <p className="mt-2 text-xs text-muted-foreground">Old free-text categories on items with no category. Check the suggested category, tick rows and press Apply selected. Nothing moves until you apply.</p>}
          <div className="mt-3 rounded-lg border divide-y">
            {q.isLoading && <p className="p-3 text-sm text-muted-foreground">Loading…</p>}
            {!q.isLoading && rows.length === 0 && <p className="p-3 text-sm text-muted-foreground">Nothing to review.</p>}
            {rows.map((r) => (
              <div key={r.id} className="p-3 flex flex-wrap items-center gap-3">
                {tab === "old" && canAct && <input type="checkbox" checked={!!ticked[r.id]} onChange={(e) => setTicked({ ...ticked, [r.id]: e.target.checked })} />}
                <div className="min-w-[200px] flex-1">
                  <p className="font-semibold text-sm">"{r.label}"</p>
                  <p className="text-xs text-muted-foreground">{r.merchant ?? "—"} · {r.items} item(s) · {fmt(r.latest_at)}</p>
                </div>
                <select className={selCls} disabled={!canAct} value={pick[r.id] ?? ""} onChange={(e) => setPick({ ...pick, [r.id]: e.target.value })}>
                  <option value="">Pick category…</option>
                  {catList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {canAct && tab === "new" && (
                  <div className="flex gap-1.5">
                    <Button size="sm" disabled={!pick[r.id] || map.isPending} onClick={() => map.mutate(r)}>Map</Button>
                    <Button size="sm" variant="outline" onClick={() => setCreate(r)}>Create new</Button>
                    <Button size="sm" variant="ghost" onClick={() => setReject(r)}>Reject</Button>
                  </div>
                )}
                {canAct && tab === "old" && <Button size="sm" variant="outline" onClick={() => setCreate(r)}>Create new</Button>}
              </div>
            ))}
          </div>
          {canAct && tab === "old" && (
            <SheetFooter className="mt-3"><Button disabled={!tickedCount || apply.isPending} onClick={() => apply.mutate()}>Apply selected ({tickedCount})</Button></SheetFooter>
          )}
        </SheetContent>
      </Sheet>
      {create && <CreateSheet kind={kind} s={create} upload={upload} onClose={() => setCreate(null)}
        onSave={async (v) => { try { const d = await resolveFn({ data: { id: create.id, mode: "create", ...v } }); toast.success(`Created · moved ${d.moved} item(s)`); setCreate(null); inv(); } catch (e) { toast.error(err(e)); } }} />}
      {reject && <RejectSheet s={reject} onClose={() => setReject(null)}
        onSave={async (reason) => { try { await rejectFn({ data: { id: reject.id, reason } }); toast.success("Rejected"); setReject(null); inv(); } catch (e) { toast.error(err(e)); } }} />}
    </>
  );
}

function CreateSheet({ kind, s, upload, onClose, onSave }: { kind: CatKind; s: CatSuggestion; upload: (f: File, k: CatKind) => Promise<string>; onClose: () => void; onSave: (v: { nameEn: string; nameMr: string; imagePath: string | null }) => void }) {
  const [en, setEn] = useState(s.label);
  const [mr, setMr] = useState("");
  const [img, setImg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader><SheetTitle>Create category</SheetTitle></SheetHeader>
        <div className="mt-4 space-y-3">
          <div><Label>Name (English)</Label><Input value={en} maxLength={60} onChange={(e) => setEn(e.target.value)} /></div>
          <div><Label>नाव (मराठी)</Label><Input value={mr} maxLength={60} onChange={(e) => setMr(e.target.value)} /></div>
          <div><Label>Icon (square)</Label>
            <Input type="file" accept="image/*" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setBusy(true); try { setImg(await upload(f, kind)); } catch (er) { toast.error(err(er)); } finally { setBusy(false); } }} />
            {img && <p className="mt-1 text-xs text-muted-foreground">Icon uploaded.</p>}</div>
          <p className="text-xs text-muted-foreground">{s.items} item(s) from {s.merchant ?? "this merchant"} will move into it.</p>
        </div>
        <SheetFooter className="mt-4"><Button disabled={busy || !en.trim() || !mr.trim()} onClick={() => onSave({ nameEn: en.trim(), nameMr: mr.trim(), imagePath: img })}>Create & move items</Button></SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function RejectSheet({ s, onClose, onSave }: { s: CatSuggestion; onClose: () => void; onSave: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader><SheetTitle>Reject "{s.label}"</SheetTitle></SheetHeader>
        <div className="mt-4 space-y-2"><Label>Reason (sent to the merchant)</Label><Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          <p className="text-xs text-muted-foreground">Items stay in Other.</p></div>
        <SheetFooter className="mt-4"><Button disabled={!reason.trim()} onClick={() => onSave(reason.trim())}>Reject</Button></SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
