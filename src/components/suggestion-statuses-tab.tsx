import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowDown, ArrowUp, GripVertical, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  listSuggestionStatuses,
  reorderSuggestionStatuses,
  setSuggestionStatusActive,
  upsertSuggestionStatus,
  type StatusInput,
  type SuggestionStatus,
} from "@/lib/suggestions.functions";

const SWATCHES = ["#3B82F6", "#F59E0B", "#8B5CF6", "#06B6D4", "#10B981", "#EF4444", "#EC4899", "#6B7280"];

export function SuggestionStatusesTab() {
  const qc = useQueryClient();
  const fetchStatuses = useServerFn(listSuggestionStatuses);
  const reorder = useServerFn(reorderSuggestionStatuses);
  const setActive = useServerFn(setSuggestionStatusActive);
  const q = useQuery({ queryKey: ["suggestions", "statuses"], queryFn: () => fetchStatuses() });
  const [order, setOrder] = useState<SuggestionStatus[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [editing, setEditing] = useState<SuggestionStatus | "new" | null>(null);

  useEffect(() => {
    if (q.data) setOrder(q.data.statuses);
  }, [q.data]);

  const canEdit = !!q.data?.canEdit;
  const refresh = () => qc.invalidateQueries({ queryKey: ["suggestions"] });

  const saveOrder = async (next: SuggestionStatus[]) => {
    setOrder(next);
    try {
      await reorder({ data: { ids: next.map((s) => s.id) } });
      toast.success("Order saved");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
      refresh();
    }
  };

  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[idx], next[j]] = [next[j], next[idx]];
    void saveOrder(next);
  };

  const onDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const next = [...order];
    const from = next.findIndex((s) => s.id === dragId);
    const to = next.findIndex((s) => s.id === targetId);
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setDragId(null);
    void saveOrder(next);
  };

  const toggle = async (s: SuggestionStatus, active: boolean) => {
    try {
      await setActive({ data: { id: s.id, active } });
      toast.success(active ? "Status activated" : "Status deactivated");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (q.isLoading) return <p className="text-[14px] text-muted-foreground">Loading statuses…</p>;
  if (q.isError) return <p className="text-[14px] text-destructive">{(q.error as Error).message}</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <p className="text-[13px] text-muted-foreground max-w-[560px]">
          Board columns follow this order. A status in use can't be removed — move its suggestions first, then
          deactivate it. Final statuses count as "closed".
        </p>
        {canEdit && (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> Add status
          </Button>
        )}
      </div>
      <div className="rounded-xl border border-border bg-card divide-y divide-border">
        {order.map((s, i) => (
          <div
            key={s.id}
            draggable={canEdit}
            onDragStart={() => setDragId(s.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(s.id)}
            className={`flex items-center gap-3 px-3 py-3 ${s.active ? "" : "opacity-60"} ${dragId === s.id ? "bg-muted" : ""}`}
          >
            {canEdit && <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab shrink-0" />}
            <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[14px] font-medium text-foreground">{s.label}</span>
                {s.is_final && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Final</span>}
                {s.notify_customer && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">Notifies customer</span>}
                {!s.active && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Inactive</span>}
              </div>
              <p className="text-[12px] text-muted-foreground truncate">
                Customer sees: {s.customer_label_en}
                {s.customer_label_mr ? ` · ${s.customer_label_mr}` : ""} · {s.usage_count} in use
              </p>
            </div>
            {canEdit && (
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="icon" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label="Move down" disabled={i === order.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label="Edit" onClick={() => setEditing(s)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Switch
                  checked={s.active}
                  aria-label="Active"
                  disabled={s.active && s.usage_count > 0}
                  title={s.active && s.usage_count > 0 ? "In use — move suggestions first" : undefined}
                  onCheckedChange={(v) => void toggle(s, v)}
                />
              </div>
            )}
          </div>
        ))}
      </div>
      {editing && (
        <StatusDialog
          status={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function StatusDialog({
  status,
  onClose,
  onSaved,
}: {
  status: SuggestionStatus | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const save = useServerFn(upsertSuggestionStatus);
  const [form, setForm] = useState<StatusInput>({
    id: status?.id ?? null,
    label: status?.label ?? "",
    customer_label_en: status?.customer_label_en ?? "",
    customer_label_mr: status?.customer_label_mr ?? "",
    color: status?.color ?? SWATCHES[0],
    is_final: status?.is_final ?? false,
    notify_customer: status?.notify_customer ?? false,
    notify_message: status?.notify_message ?? "",
  });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof StatusInput>(k: K, v: StatusInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setBusy(true);
    try {
      await save({ data: form });
      toast.success("Status saved");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{status ? "Edit status" : "Add status"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Staff label">
            <Input value={form.label} maxLength={80} onChange={(e) => set("label", e.target.value)} />
          </Field>
          <Field label="Customer label (English)">
            <Input value={form.customer_label_en} maxLength={80} onChange={(e) => set("customer_label_en", e.target.value)} />
          </Field>
          <Field label="Customer label (Marathi)">
            <Input value={form.customer_label_mr} maxLength={80} onChange={(e) => set("customer_label_mr", e.target.value)} />
          </Field>
          <Field label="Color">
            <div className="flex items-center gap-2 flex-wrap">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  onClick={() => set("color", c)}
                  className={`h-7 w-7 rounded-full border-2 ${form.color === c ? "border-foreground" : "border-transparent"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input type="color" value={form.color} onChange={(e) => set("color", e.target.value.toUpperCase())} className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent" />
            </div>
          </Field>
          <label className="flex items-center justify-between gap-3 text-[14px]">
            <span>Final status (closes the suggestion)</span>
            <Switch checked={form.is_final} onCheckedChange={(v) => set("is_final", v)} />
          </label>
          <label className="flex items-center justify-between gap-3 text-[14px]">
            <span>Notify customer (app suggestions only)</span>
            <Switch checked={form.notify_customer} onCheckedChange={(v) => set("notify_customer", v)} />
          </label>
          {form.notify_customer && (
            <Field label="Notification message">
              <Textarea rows={2} maxLength={300} value={form.notify_message ?? ""} onChange={(e) => set("notify_message", e.target.value)} />
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[12px] font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
