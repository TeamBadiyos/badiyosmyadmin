import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { GripVertical, Plus, Trash2, X, ArrowUp, ArrowDown, Pencil } from "lucide-react";
import { listSegments } from "@/lib/segments.functions";
import {
  listTaskDetails,
  saveTaskDetail,
  deleteTaskDetail,
  reorderTaskDetails,
  type TaskDetail,
} from "@/lib/task-details.functions";

type StaffRole = "super_admin" | "ops_manager" | "area_partner";

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const inputCls =
  "w-full h-10 px-3 rounded-[10px] border border-border bg-background text-[14px] text-foreground";

function ItemListEditor({
  label,
  items,
  onChange,
  disabled,
}: {
  label: string;
  items: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  function set(i: number, v: string) {
    const next = [...items];
    next[i] = v;
    onChange(next);
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-muted-foreground">{label}</span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange([...items, ""])}
          className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary disabled:opacity-50"
        >
          <Plus size={13} /> Add
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">No items yet.</p>
      ) : (
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                value={it}
                disabled={disabled}
                onChange={(e) => set(i, e.target.value)}
                placeholder="Bullet point"
                className={inputCls}
              />
              <button
                type="button"
                disabled={disabled || i === 0}
                onClick={() => move(i, -1)}
                aria-label="Move up"
                className="h-9 w-9 grid place-items-center rounded-[8px] border border-border text-muted-foreground disabled:opacity-30"
              >
                <ArrowUp size={14} />
              </button>
              <button
                type="button"
                disabled={disabled || i === items.length - 1}
                onClick={() => move(i, 1)}
                aria-label="Move down"
                className="h-9 w-9 grid place-items-center rounded-[8px] border border-border text-muted-foreground disabled:opacity-30"
              >
                <ArrowDown size={14} />
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(items.filter((_, k) => k !== i))}
                aria-label="Remove item"
                className="h-9 w-9 grid place-items-center rounded-[8px] border border-border text-destructive disabled:opacity-30"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TaskDetailsPage({ role }: { role: StaffRole | null }) {
  const canEdit = role === "super_admin" || role === "ops_manager";
  const qc = useQueryClient();
  const segmentsFn = useServerFn(listSegments);
  const listFn = useServerFn(listTaskDetails);
  const saveFn = useServerFn(saveTaskDetail);
  const deleteFn = useServerFn(deleteTaskDetail);
  const reorderFn = useServerFn(reorderTaskDetails);

  const [segmentId, setSegmentId] = useState<string | null>(null);
  const [editing, setEditing] = useState<TaskDetail | "new" | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [order, setOrder] = useState<TaskDetail[] | null>(null);

  const { data: segments } = useQuery({
    queryKey: ["segments"],
    queryFn: () => segmentsFn(),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!segmentId && segments?.length) {
      const clean = segments.find((s) => s.slug === "clean");
      setSegmentId((clean ?? segments[0]!).id);
    }
  }, [segments, segmentId]);

  const { data: tasks, isLoading } = useQuery({
    queryKey: ["task-details", segmentId],
    queryFn: () => listFn({ data: { segment_id: segmentId! } }),
    enabled: !!segmentId,
  });

  useEffect(() => {
    setOrder(tasks ?? null);
  }, [tasks]);

  const rows = order ?? [];

  async function persistOrder(next: TaskDetail[]) {
    setOrder(next);
    try {
      await reorderFn({ data: { orders: next.map((t, i) => ({ id: t.id, rank: i + 1 })) } });
      await qc.invalidateQueries({ queryKey: ["task-details", segmentId] });
      toast.success("Order saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reorder");
      setOrder(tasks ?? null);
    }
  }

  function handleDrop(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const next = [...rows];
    const from = next.findIndex((t) => t.id === dragId);
    const to = next.findIndex((t) => t.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    setDragId(null);
    void persistOrder(next);
  }

  async function handleDelete(t: TaskDetail) {
    if (!canEdit) return;
    if (!window.confirm(`Delete "${t.task_name}"? This cannot be undone.`)) return;
    try {
      await deleteFn({ data: { id: t.id } });
      await qc.invalidateQueries({ queryKey: ["task-details", segmentId] });
      toast.success("Task deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete");
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="block">
          <span className="block text-[12px] font-semibold text-muted-foreground mb-1">Segment</span>
          <select
            value={segmentId ?? ""}
            onChange={(e) => setSegmentId(e.target.value)}
            className="h-10 px-3 rounded-[10px] border border-border bg-background text-[14px] text-foreground min-w-[220px]"
          >
            {(segments ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => setEditing("new")}
          disabled={!canEdit || !segmentId}
          className="inline-flex items-center gap-1.5 h-10 px-4 rounded-[10px] bg-primary text-white text-[13px] font-semibold disabled:opacity-50"
        >
          <Plus size={15} /> New task
        </button>
      </div>

      {isLoading ? (
        <p className="text-[14px] text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-[14px] text-muted-foreground">No tasks for this segment yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((t) => (
            <div
              key={t.id}
              draggable={canEdit}
              onDragStart={() => setDragId(t.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(t.id)}
              className={`bg-card border border-border rounded-[14px] p-4 flex items-start gap-3 ${
                dragId === t.id ? "opacity-50" : ""
              }`}
            >
              <GripVertical size={16} className="mt-1 text-muted-foreground cursor-grab shrink-0" />
              {t.icon_url ? (
                <img src={t.icon_url} alt="" className="h-9 w-9 rounded-[8px] object-cover" />
              ) : null}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[14px] font-bold text-foreground">{t.task_name}</span>
                  <span className="text-[11px] text-muted-foreground font-mono">{t.task_slug}</span>
                  {!t.is_active && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      Inactive
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-muted-foreground mt-1">
                  {t.included_items.length} included · {t.excluded_items.length} excluded · rank {t.rank}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setEditing(t)}
                  disabled={!canEdit}
                  aria-label="Edit task"
                  className="h-9 w-9 grid place-items-center rounded-[8px] border border-border text-muted-foreground disabled:opacity-30"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => handleDelete(t)}
                  disabled={!canEdit}
                  aria-label="Delete task"
                  className="h-9 w-9 grid place-items-center rounded-[8px] border border-border text-destructive disabled:opacity-30"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && segmentId && (
        <TaskFormModal
          segmentId={segmentId}
          task={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await qc.invalidateQueries({ queryKey: ["task-details", segmentId] });
          }}
          save={saveFn}
        />
      )}
    </div>
  );
}

function TaskFormModal({
  segmentId,
  task,
  onClose,
  onSaved,
  save,
}: {
  segmentId: string;
  task: TaskDetail | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  save: ReturnType<typeof useServerFn<typeof saveTaskDetail>>;
}) {
  const [name, setName] = useState(task?.task_name ?? "");
  const [slug, setSlug] = useState(task?.task_slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!task);
  const [iconUrl, setIconUrl] = useState(task?.icon_url ?? "");
  const [included, setIncluded] = useState<string[]>(task?.included_items ?? []);
  const [excluded, setExcluded] = useState<string[]>(task?.excluded_items ?? []);
  const [isActive, setIsActive] = useState(task?.is_active ?? true);
  const [saving, setSaving] = useState(false);

  const effectiveSlug = useMemo(
    () => (slugTouched ? slug : slugify(name)),
    [slug, slugTouched, name],
  );

  async function submit() {
    setSaving(true);
    try {
      await save({
        data: {
          id: task?.id ?? null,
          segment_id: segmentId,
          task_name: name.trim(),
          task_slug: effectiveSlug.trim(),
          icon_url: iconUrl.trim() || null,
          included_items: included.map((s) => s.trim()).filter(Boolean),
          excluded_items: excluded.map((s) => s.trim()).filter(Boolean),
          is_active: isActive,
        },
      });
      toast.success(task ? "Task updated" : "Task created");
      await onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-card border border-border rounded-[18px] w-full max-w-2xl my-8 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-foreground">
            {task ? "Edit task" : "New task"}
          </h2>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground">
            <X size={18} />
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="block text-[12px] font-semibold text-muted-foreground mb-1">
              Task name
            </span>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className="block text-[12px] font-semibold text-muted-foreground mb-1">Slug</span>
            <input
              value={effectiveSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
              className={inputCls}
            />
          </label>
        </div>

        <label className="block">
          <span className="block text-[12px] font-semibold text-muted-foreground mb-1">
            Icon URL (optional)
          </span>
          <input
            value={iconUrl}
            onChange={(e) => setIconUrl(e.target.value)}
            placeholder="https://…"
            className={inputCls}
          />
        </label>

        <div className="grid gap-5 md:grid-cols-2">
          <ItemListEditor label="Included items" items={included} onChange={setIncluded} />
          <ItemListEditor label="Excluded items" items={excluded} onChange={setExcluded} />
        </div>

        <label className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4"
          />
          Active
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="h-10 px-4 rounded-[10px] border border-border text-[13px] font-semibold text-muted-foreground"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving || !name.trim() || !effectiveSlug.trim()}
            className="h-10 px-5 rounded-[10px] bg-primary text-white text-[13px] font-semibold disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save task"}
          </button>
        </div>
      </div>
    </div>
  );
}
