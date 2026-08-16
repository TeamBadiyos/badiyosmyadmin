import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Pencil, Plus, Trash2, X, ListChecks } from "lucide-react";
import { toast } from "sonner";
import {
  listTaskTypes,
  upsertTaskType,
  deleteTaskType,
  type TaskType,
} from "@/lib/catalogue.functions";

const inputCls =
  "w-full h-10 px-3 rounded-[12px] border border-border bg-background text-[14px]";

export function TaskTypesPage() {
  const fetchTypes = useServerFn(listTaskTypes);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["task-types"],
    queryFn: () => fetchTypes(),
    staleTime: 15_000,
  });
  const [modal, setModal] = useState<{ type: TaskType | null } | null>(null);
  const queryClient = useQueryClient();
  const remove = useServerFn(deleteTaskType);
  const del = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      toast.success("Task type deleted");
      queryClient.invalidateQueries({ queryKey: ["task-types"] });
      queryClient.invalidateQueries({ queryKey: ["catalogue"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  const types = data ?? [];

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[14px] text-muted-foreground">
          Reusable task types with fixed inclusions/exclusions. Link them to items from
          the Service Catalogue.
        </p>
        <button
          onClick={() => setModal({ type: null })}
          className="h-9 px-3 rounded-[12px] bg-primary text-primary-foreground text-[13px] font-bold inline-flex items-center gap-1 shrink-0"
        >
          <Plus size={14} /> Task Type
        </button>
      </div>

      {isLoading && (
        <p className="text-[13px] text-muted-foreground text-center py-10">Loading…</p>
      )}
      {isError && (
        <p className="text-[13px] text-destructive text-center py-10">
          {(error as Error)?.message ?? "Failed to load task types."}
        </p>
      )}
      {!isLoading && types.length === 0 && (
        <p className="text-[13px] text-muted-foreground text-center py-10">
          No task types yet.
        </p>
      )}

      <div className="space-y-3">
        {types.map((t) => (
          <div
            key={t.id}
            className="bg-card border border-border rounded-[18px] p-4 space-y-2"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="inline-flex items-center gap-2 min-w-0">
                <ListChecks size={16} className="text-primary shrink-0" />
                <span className="text-[15px] font-bold text-foreground truncate">
                  {t.name}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                    t.is_active
                      ? "bg-primary-tint text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {t.is_active ? "active" : "inactive"}
                </span>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => setModal({ type: t })}
                  aria-label={`Edit ${t.name}`}
                  className="h-9 w-9 rounded-[10px] border border-border inline-flex items-center justify-center hover:bg-muted"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete "${t.name}"? It will be unlinked from all items.`))
                      del.mutate(t.id);
                  }}
                  aria-label={`Delete ${t.name}`}
                  className="h-9 w-9 rounded-[10px] border border-border text-destructive inline-flex items-center justify-center hover:bg-destructive/10"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            {t.description && (
              <p className="text-[13px] text-muted-foreground">{t.description}</p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase text-muted-foreground">
                  Inclusions ({t.inclusions.length})
                </p>
                <ul className="text-[12px] text-foreground list-disc pl-4">
                  {t.inclusions.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase text-muted-foreground">
                  Exclusions ({t.exclusions.length})
                </p>
                <ul className="text-[12px] text-foreground list-disc pl-4">
                  {t.exclusions.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ))}
      </div>

      {modal && <TaskTypeModal type={modal.type} onClose={() => setModal(null)} />}
    </div>
  );
}

function TaskTypeModal({
  type,
  onClose,
}: {
  type: TaskType | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const save = useServerFn(upsertTaskType);
  const [name, setName] = useState(type?.name ?? "");
  const [description, setDescription] = useState(type?.description ?? "");
  const [rank, setRank] = useState(String(type?.rank ?? 0));
  const [active, setActive] = useState(type?.is_active ?? true);
  const [inclusions, setInclusions] = useState<string[]>(type?.inclusions ?? []);
  const [exclusions, setExclusions] = useState<string[]>(type?.exclusions ?? []);

  const mutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          id: type?.id ?? null,
          name,
          description,
          image_url: type?.image_url ?? null,
          inclusions,
          exclusions,
          rank: Number(rank) || 0,
          is_active: active,
        },
      }),
    onSuccess: () => {
      toast.success(type ? "Task type updated" : "Task type created");
      queryClient.invalidateQueries({ queryKey: ["task-types"] });
      queryClient.invalidateQueries({ queryKey: ["catalogue"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-[18px] w-full max-w-lg max-h-[85vh] overflow-y-auto p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[16px] font-bold text-foreground">
            {type ? "Edit" : "New"} task type
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="h-9 w-9 rounded-[10px] border border-border inline-flex items-center justify-center hover:bg-muted"
          >
            <X size={14} />
          </button>
        </div>

        <label className="block space-y-1">
          <span className="text-[12px] font-semibold text-muted-foreground">Name</span>
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-[12px] font-semibold text-muted-foreground">
            Description (optional)
          </span>
          <textarea
            className="w-full min-h-20 p-3 rounded-[12px] border border-border bg-background text-[14px]"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-[12px] font-semibold text-muted-foreground">
            Display order
          </span>
          <input
            className={inputCls}
            value={rank}
            inputMode="numeric"
            onChange={(e) => setRank(e.target.value)}
          />
        </label>

        <RowsEditor label="Inclusions" items={inclusions} onChange={setInclusions} />
        <RowsEditor label="Exclusions" items={exclusions} onChange={setExclusions} />

        <label className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          Active
        </label>

        <button
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
          className="h-10 w-full rounded-[12px] bg-primary text-primary-foreground font-bold text-[14px] disabled:opacity-50"
        >
          {mutation.isPending ? "Saving…" : "Save task type"}
        </button>
      </div>
    </div>
  );
}

function RowsEditor({
  label,
  items,
  onChange,
}: {
  label: string;
  items: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      <span className="text-[12px] font-semibold text-muted-foreground">{label}</span>
      {items.map((t, i) => (
        <div key={i} className="flex gap-2">
          <input
            className={inputCls}
            value={t}
            placeholder={`${label.slice(0, -1)} ${i + 1}`}
            onChange={(e) => onChange(items.map((v, j) => (j === i ? e.target.value : v)))}
          />
          <button
            type="button"
            aria-label={`Remove ${label} row ${i + 1}`}
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="h-10 w-10 shrink-0 rounded-[12px] border border-border text-destructive inline-flex items-center justify-center hover:bg-destructive/10"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, ""])}
        className="h-9 px-3 rounded-[10px] border border-border text-[12px] font-semibold inline-flex items-center gap-1 hover:bg-muted"
      >
        <Plus size={12} /> Add {label.slice(0, -1).toLowerCase()}
      </button>
    </div>
  );
}
