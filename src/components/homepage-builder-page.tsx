import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Plus,
  X,
  Check,
  Pencil,
  Trash2,
  GripVertical,
  Search,
  Gift,
  Home,
  Sparkles,
  Tag,
} from "lucide-react";
import {
  listHomepageSections,
  upsertHomepageSection,
  setHomepageSectionActive,
  reorderHomepageSections,
  type HomepageSection,
  type JsonRecord,
} from "@/lib/homepage.functions";

type SectionType = "promo_banner" | "search_bar" | "nav_item" | "category_tab";

const SECTION_TYPES: { key: SectionType; label: string }[] = [
  { key: "promo_banner", label: "Promo banner" },
  { key: "search_bar", label: "Search bar" },
  { key: "nav_item", label: "Nav item" },
  { key: "category_tab", label: "Category tab" },
];

export function HomepageBuilderPage() {
  const fetchList = useServerFn(listHomepageSections);
  const { data = [], isLoading, isError, error } = useQuery({
    queryKey: ["homepage-sections", "list"],
    queryFn: () => fetchList(),
    staleTime: 15_000,
  });

  const [editing, setEditing] = useState<
    | { mode: "create"; sectionType: SectionType }
    | { mode: "edit"; section: HomepageSection }
    | null
  >(null);

  const groups = useMemo(() => {
    const map = new Map<string, HomepageSection[]>();
    for (const s of data) {
      const list = map.get(s.section_type) ?? [];
      list.push(s);
      map.set(s.section_type, list);
    }
    for (const [k, v] of map) {
      v.sort((a, b) => a.display_order - b.display_order);
      map.set(k, v);
    }
    return map;
  }, [data]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px] gap-6">
      <div className="space-y-6 min-w-0">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[14px] text-muted-foreground">
            Sections displayed on the Customer App home screen, grouped by type.
          </p>
          <div className="flex flex-wrap gap-2">
            {SECTION_TYPES.map((t) => (
              <button
                key={t.key}
                onClick={() => setEditing({ mode: "create", sectionType: t.key })}
                className="h-10 px-3 rounded-[12px] bg-primary text-white text-[13px] font-bold inline-flex items-center gap-1 hover:opacity-95"
              >
                <Plus size={14} />
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {isLoading && (
          <p className="text-[13px] text-muted-foreground text-center py-10">Loading…</p>
        )}
        {isError && (
          <p className="text-[13px] text-destructive text-center py-10">
            {(error as Error)?.message ?? "Failed to load sections."}
          </p>
        )}

        {SECTION_TYPES.map((t) => {
          const rows = groups.get(t.key) ?? [];
          return (
            <SectionGroup
              key={t.key}
              type={t.key}
              label={t.label}
              rows={rows}
              onEdit={(s) => setEditing({ mode: "edit", section: s })}
            />
          );
        })}

        {[...groups.keys()]
          .filter((k) => !SECTION_TYPES.some((t) => t.key === k))
          .map((k) => (
            <SectionGroup
              key={k}
              type={k}
              label={k}
              rows={groups.get(k) ?? []}
              onEdit={(s) => setEditing({ mode: "edit", section: s })}
            />
          ))}
      </div>

      <PreviewPane sections={data.filter((s) => s.is_active)} />

      {editing && (
        <SectionFormModal
          initial={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function SectionGroup({
  type,
  label,
  rows,
  onEdit,
}: {
  type: string;
  label: string;
  rows: HomepageSection[];
  onEdit: (s: HomepageSection) => void;
}) {
  const queryClient = useQueryClient();
  const toggle = useServerFn(setHomepageSectionActive);
  const reorder = useServerFn(reorderHomepageSections);

  const toggleMutation = useMutation({
    mutationFn: (payload: { id: string; active: boolean }) => toggle({ data: payload }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["homepage-sections"] }),
  });

  const reorderMutation = useMutation({
    mutationFn: (orders: Array<{ id: string; display_order: number }>) =>
      reorder({ data: { orders } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["homepage-sections"] }),
  });

  const [dragId, setDragId] = useState<string | null>(null);

  function handleDrop(overId: string) {
    if (!dragId || dragId === overId) return;
    const ids = rows.map((r) => r.section_id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(overId);
    if (from < 0 || to < 0) return;
    const next = ids.slice();
    next.splice(from, 1);
    next.splice(to, 0, dragId);
    const orders = next.map((id, i) => ({ id, display_order: i }));
    reorderMutation.mutate(orders);
    setDragId(null);
  }

  return (
    <section className="bg-card border border-border rounded-[18px] overflow-hidden">
      <header className="flex items-center justify-between px-5 py-3 border-b border-border">
        <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">
          {label}
        </h3>
        <span className="text-[12px] text-muted-foreground">
          {rows.length} {rows.length === 1 ? "row" : "rows"}
        </span>
      </header>
      {rows.length === 0 ? (
        <p className="text-[13px] text-muted-foreground text-center py-6">No rows.</p>
      ) : (
        <ul>
          {rows.map((r) => (
            <li
              key={r.section_id}
              draggable
              onDragStart={() => setDragId(r.section_id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(r.section_id)}
              className={`flex items-center gap-3 px-5 py-3 border-b border-border last:border-b-0 ${
                dragId === r.section_id ? "opacity-50" : ""
              }`}
            >
              <span className="text-muted-foreground cursor-grab active:cursor-grabbing" aria-hidden>
                <GripVertical size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-foreground truncate">
                  {summarizeSection(type, r.payload)}
                </p>
                <p className="text-[12px] text-muted-foreground truncate">
                  order {r.display_order}
                  {r.city_id ? ` · city ${r.city_id.slice(0, 6)}` : " · global"}
                </p>
              </div>
              <label className="inline-flex items-center gap-2 text-[12px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={r.is_active}
                  onChange={(e) =>
                    toggleMutation.mutate({ id: r.section_id, active: e.target.checked })
                  }
                  className="w-4 h-4 accent-primary"
                />
                Active
              </label>
              <button
                onClick={() => onEdit(r)}
                className="h-9 px-3 rounded-[12px] border border-border text-foreground font-semibold text-[13px] inline-flex items-center gap-1 hover:bg-muted"
              >
                <Pencil size={14} /> Edit
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function summarizeSection(type: string, payload: JsonRecord): string {
  if (type === "promo_banner") return String(payload.text ?? "Promo banner");
  if (type === "search_bar") return String(payload.placeholder ?? "Search bar");
  if (type === "nav_item") return String(payload.label ?? "Nav item");
  if (type === "category_tab") return String(payload.label ?? "Category tab");
  return type;
}

// ---------------------- Form modal ----------------------

function SectionFormModal({
  initial,
  onClose,
}: {
  initial:
    | { mode: "create"; sectionType: SectionType }
    | { mode: "edit"; section: HomepageSection };
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const save = useServerFn(upsertHomepageSection);

  const isEdit = initial.mode === "edit";
  const sectionType = (isEdit ? initial.section.section_type : initial.sectionType) as SectionType;
  const seed: JsonRecord = isEdit ? { ...initial.section.payload } : {};

  const [payload, setPayload] = useState<JsonRecord>(seed);
  const [isActive, setIsActive] = useState<boolean>(isEdit ? initial.section.is_active : true);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          id: isEdit ? initial.section.section_id : null,
          section_type: sectionType,
          is_active: isActive,
          payload,
          city_id: isEdit ? initial.section.city_id : null,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["homepage-sections"] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Save failed"),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-0 sm:p-6 bg-foreground/50"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-card w-full sm:max-w-[560px] max-h-[100vh] sm:max-h-[92vh] sm:rounded-[24px] overflow-hidden shadow-xl flex flex-col"
      >
        <header className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              {sectionType}
            </p>
            <h2 className="text-[18px] font-bold text-foreground">
              {isEdit ? "Edit section" : "Add section"}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted"
          >
            <X size={20} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
          <SectionFields sectionType={sectionType} payload={payload} onChange={setPayload} />

          <label className="flex items-center justify-between gap-3 p-3 rounded-[14px] border border-border">
            <div>
              <p className="text-[13px] font-semibold text-foreground">Active</p>
              <p className="text-[12px] text-muted-foreground">
                Only active sections show up in the app.
              </p>
            </div>
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="w-5 h-5 accent-primary"
            />
          </label>

          {error && <p className="text-[13px] text-destructive">{error}</p>}
        </div>

        <footer className="px-6 py-4 border-t border-border flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="h-11 px-4 rounded-[14px] border border-border text-foreground font-semibold text-[14px]"
          >
            Cancel
          </button>
          <button
            disabled={mutation.isPending}
            onClick={() => {
              setError(null);
              mutation.mutate();
            }}
            className="h-11 px-5 rounded-[14px] bg-primary text-white font-bold text-[14px] disabled:opacity-50 inline-flex items-center gap-2"
          >
            <Check size={16} />
            {mutation.isPending ? "Saving…" : isEdit ? "Save changes" : "Add section"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function SectionFields({
  sectionType,
  payload,
  onChange,
}: {
  sectionType: SectionType;
  payload: JsonRecord;
  onChange: (p: JsonRecord) => void;
}) {
  function set<K extends string>(key: K, value: string | boolean) {
    onChange({ ...payload, [key]: value });
  }

  if (sectionType === "promo_banner") {
    return (
      <>
        <TextField
          label="Text"
          value={String(payload.text ?? "")}
          onChange={(v) => set("text", v)}
          placeholder="Complete missions and win rewards"
        />
        <TextField
          label="Icon"
          value={String(payload.icon ?? "")}
          onChange={(v) => set("icon", v)}
          placeholder="gift"
        />
        <TextField
          label="CTA action"
          value={String(payload.cta_action ?? "")}
          onChange={(v) => set("cta_action", v)}
          placeholder="navigate:rewards"
        />
      </>
    );
  }
  if (sectionType === "search_bar") {
    return (
      <TextField
        label="Placeholder"
        value={String(payload.placeholder ?? "")}
        onChange={(v) => set("placeholder", v)}
        placeholder="Search for cleaning services"
      />
    );
  }
  if (sectionType === "nav_item") {
    return (
      <>
        <TextField label="Label" value={String(payload.label ?? "")} onChange={(v) => set("label", v)} placeholder="Home" />
        <TextField label="Icon" value={String(payload.icon ?? "")} onChange={(v) => set("icon", v)} placeholder="home" />
        <TextField
          label="Target screen"
          value={String(payload.target_screen ?? "")}
          onChange={(v) => set("target_screen", v)}
          placeholder="home"
        />
      </>
    );
  }
  // category_tab
  return (
    <>
      <TextField label="Label" value={String(payload.label ?? "")} onChange={(v) => set("label", v)} placeholder="Deep clean" />
      <TextField label="Icon" value={String(payload.icon ?? "")} onChange={(v) => set("icon", v)} placeholder="sparkles" />
      <label className="flex items-center justify-between gap-3 p-3 rounded-[14px] border border-border">
        <div>
          <p className="text-[13px] font-semibold text-foreground">Visible</p>
          <p className="text-[12px] text-muted-foreground">Show this category tab on the home screen.</p>
        </div>
        <input
          type="checkbox"
          checked={payload.is_visible !== false}
          onChange={(e) => set("is_visible", e.target.checked)}
          className="w-5 h-5 accent-primary"
        />
      </label>
    </>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-11 px-3 rounded-[14px] border border-border bg-card text-[14px]"
      />
    </div>
  );
}

// ---------------------- Live preview ----------------------

function PreviewPane({ sections }: { sections: HomepageSection[] }) {
  const grouped = useMemo(() => {
    const promo = sections
      .filter((s) => s.section_type === "promo_banner")
      .sort((a, b) => a.display_order - b.display_order);
    const search = sections
      .filter((s) => s.section_type === "search_bar")
      .sort((a, b) => a.display_order - b.display_order);
    const nav = sections
      .filter((s) => s.section_type === "nav_item")
      .sort((a, b) => a.display_order - b.display_order);
    const cats = sections
      .filter(
        (s) =>
          s.section_type === "category_tab" &&
          s.payload.is_visible !== false,
      )
      .sort((a, b) => a.display_order - b.display_order);
    return { promo, search, nav, cats };
  }, [sections]);

  return (
    <aside className="xl:sticky xl:top-6 h-max">
      <div className="bg-card border border-border rounded-[18px] p-4">
        <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground mb-3">
          Live preview
        </h3>
        <div className="mx-auto w-[320px] rounded-[28px] border border-border bg-background overflow-hidden shadow-inner">
          <div className="bg-foreground text-white text-[10px] text-center py-1">Customer App</div>
          <div className="p-4 space-y-3 min-h-[520px]">
            {grouped.search.map((s) => (
              <div
                key={s.section_id}
                className="flex items-center gap-2 h-11 px-3 rounded-full bg-white border border-border"
              >
                <Search size={14} className="text-muted-foreground" />
                <span className="text-[12px] text-muted-foreground truncate">
                  {String(s.payload.placeholder ?? "Search")}
                </span>
              </div>
            ))}

            {grouped.promo.map((s) => (
              <div
                key={s.section_id}
                className="flex items-center gap-2 rounded-[14px] bg-primary-tint text-primary px-3 py-2"
              >
                <PayloadIcon name={String(s.payload.icon ?? "")} />
                <span className="text-[12px] font-semibold truncate">
                  {String(s.payload.text ?? "Promo")}
                </span>
              </div>
            ))}

            {grouped.cats.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {grouped.cats.map((s) => (
                  <span
                    key={s.section_id}
                    className="shrink-0 inline-flex items-center gap-1 px-3 h-8 rounded-full bg-white border border-border text-[12px] text-foreground"
                  >
                    <PayloadIcon name={String(s.payload.icon ?? "")} />
                    {String(s.payload.label ?? "Tab")}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-4 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-16 rounded-[14px] bg-white border border-border" />
              ))}
            </div>
          </div>
          <nav className="border-t border-border bg-white flex items-center justify-around py-2">
            {grouped.nav.length === 0 ? (
              <span className="text-[10px] text-muted-foreground">No nav items</span>
            ) : (
              grouped.nav.map((s) => (
                <div key={s.section_id} className="flex flex-col items-center text-muted-foreground">
                  <PayloadIcon name={String(s.payload.icon ?? "")} size={16} />
                  <span className="text-[10px] mt-0.5">{String(s.payload.label ?? "Item")}</span>
                </div>
              ))
            )}
          </nav>
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">
          Only active sections are rendered. Reflect changes by saving them.
        </p>
      </div>
    </aside>
  );
}

function PayloadIcon({ name, size = 14 }: { name: string; size?: number }) {
  const n = name.toLowerCase();
  if (n === "home") return <Home size={size} />;
  if (n === "gift" || n === "rewards") return <Gift size={size} />;
  if (n === "search") return <Search size={size} />;
  if (n === "sparkles" || n === "deep-clean") return <Sparkles size={size} />;
  return <Tag size={size} />;
}

// Not exported placeholder to silence unused warnings if a helper is stripped
export const __homepageBuilderUnused = { Trash2 };
