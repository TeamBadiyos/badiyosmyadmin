import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Plus,
  X,
  Check,
  Pencil,
  GripVertical,
  Search,
  Gift,
  Sparkles,
  Tag,
  Store,
  LayoutGrid,
} from "lucide-react";
import {
  listHomepageSections,
  upsertHomepageSection,
  setHomepageSectionActive,
  reorderHomepageSections,
  type HomepageSection,
  type JsonRecord,
} from "@/lib/homepage.functions";
import {
  listSegments,
  listSegmentCategories,
  upsertSegment,
  setSegmentActive,
  reorderSegments,
  DISPLAY_TEMPLATES,
  VERTICAL_TYPES,
  type Segment,
  type SegmentCategory,
} from "@/lib/segments.functions";

/**
 * Generic UI section types only. Segment-driven navigation (previously
 * `category_tab` / `nav_item`) is now read from the `segments` table.
 */
const GENERIC_SECTION_TYPES: { key: string; label: string }[] = [
  { key: "promo_banner", label: "Promo banner" },
  { key: "search_bar", label: "Search bar" },
];

export function HomepageBuilderPage() {
  const fetchSections = useServerFn(listHomepageSections);
  const fetchSegments = useServerFn(listSegments);
  const fetchCategories = useServerFn(listSegmentCategories);

  const sectionsQuery = useQuery({
    queryKey: ["homepage-sections", "list"],
    queryFn: () => fetchSections(),
    staleTime: 15_000,
  });
  const segmentsQuery = useQuery({
    queryKey: ["segments", "list"],
    queryFn: () => fetchSegments(),
    staleTime: 15_000,
  });
  const categoriesQuery = useQuery({
    queryKey: ["segments", "categories"],
    queryFn: () => fetchCategories(),
    staleTime: 15_000,
  });

  const sections = sectionsQuery.data ?? [];
  const segments = segmentsQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];

  const [editingSection, setEditingSection] = useState<
    | { mode: "create"; sectionType: string }
    | { mode: "edit"; section: HomepageSection }
    | null
  >(null);
  const [editingSegment, setEditingSegment] = useState<
    { mode: "create" } | { mode: "edit"; segment: Segment } | null
  >(null);

  const groups = useMemo(() => {
    const map = new Map<string, HomepageSection[]>();
    for (const s of sections) {
      if (!GENERIC_SECTION_TYPES.some((t) => t.key === s.section_type)) continue;
      const list = map.get(s.section_type) ?? [];
      list.push(s);
      map.set(s.section_type, list);
    }
    for (const [k, v] of map) {
      v.sort((a, b) => a.display_order - b.display_order);
      map.set(k, v);
    }
    return map;
  }, [sections]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px] gap-6">
      <div className="space-y-6 min-w-0">
        <p className="text-[14px] text-muted-foreground">
          Segments drive the customer app segment bar and home feed. Generic UI
          elements below are independent of segments.
        </p>

        <SegmentsPanel
          segments={segments}
          isLoading={segmentsQuery.isLoading}
          error={segmentsQuery.error as Error | null}
          onCreate={() => setEditingSegment({ mode: "create" })}
          onEdit={(segment) => setEditingSegment({ mode: "edit", segment })}
        />

        <div className="flex items-center justify-between gap-3 flex-wrap pt-2">
          <h2 className="text-[15px] font-bold text-foreground">
            Generic home sections
          </h2>
          <div className="flex flex-wrap gap-2">
            {GENERIC_SECTION_TYPES.map((t) => (
              <button
                key={t.key}
                onClick={() =>
                  setEditingSection({ mode: "create", sectionType: t.key })
                }
                className="h-10 px-3 rounded-[12px] bg-primary text-white text-[13px] font-bold inline-flex items-center gap-1 hover:opacity-95"
              >
                <Plus size={14} />
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {sectionsQuery.isLoading && (
          <p className="text-[13px] text-muted-foreground text-center py-10">
            Loading…
          </p>
        )}
        {sectionsQuery.isError && (
          <p className="text-[13px] text-destructive text-center py-10">
            {(sectionsQuery.error as Error)?.message ?? "Failed to load sections."}
          </p>
        )}

        {GENERIC_SECTION_TYPES.map((t) => (
          <SectionGroup
            key={t.key}
            type={t.key}
            label={t.label}
            rows={groups.get(t.key) ?? []}
            onEdit={(s) => setEditingSection({ mode: "edit", section: s })}
          />
        ))}
      </div>

      <PreviewPane
        sections={sections.filter((s) => s.is_active)}
        segments={segments.filter((s) => s.is_active)}
        categories={categories.filter((c) => c.is_active)}
      />

      {editingSection && (
        <SectionFormModal
          initial={editingSection}
          onClose={() => setEditingSection(null)}
        />
      )}
      {editingSegment && (
        <SegmentFormModal
          initial={editingSegment}
          onClose={() => setEditingSegment(null)}
        />
      )}
    </div>
  );
}

// ---------------------- Segments ----------------------

function SegmentsPanel({
  segments,
  isLoading,
  error,
  onCreate,
  onEdit,
}: {
  segments: Segment[];
  isLoading: boolean;
  error: Error | null;
  onCreate: () => void;
  onEdit: (s: Segment) => void;
}) {
  const queryClient = useQueryClient();
  const toggle = useServerFn(setSegmentActive);
  const reorder = useServerFn(reorderSegments);
  const [dragId, setDragId] = useState<string | null>(null);

  const toggleMutation = useMutation({
    mutationFn: (payload: { id: string; active: boolean }) =>
      toggle({ data: payload }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["segments"] }),
  });
  const reorderMutation = useMutation({
    mutationFn: (orders: Array<{ id: string; rank: number }>) =>
      reorder({ data: { orders } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["segments"] }),
  });

  function handleDrop(overId: string) {
    if (!dragId || dragId === overId) return;
    const ids = segments.map((s) => s.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(overId);
    if (from < 0 || to < 0) return;
    const next = ids.slice();
    next.splice(from, 1);
    next.splice(to, 0, dragId);
    reorderMutation.mutate(next.map((id, i) => ({ id, rank: i })));
    setDragId(null);
  }

  return (
    <section className="bg-card border border-border rounded-[18px] overflow-hidden">
      <header className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border">
        <div>
          <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">
            Segments
          </h3>
          <p className="text-[12px] text-muted-foreground">
            Drag to reorder · order is saved to the segment rank
          </p>
        </div>
        <button
          onClick={onCreate}
          className="h-10 px-3 rounded-[12px] bg-primary text-white text-[13px] font-bold inline-flex items-center gap-1 hover:opacity-95"
        >
          <Plus size={14} /> Segment
        </button>
      </header>

      {isLoading && (
        <p className="text-[13px] text-muted-foreground text-center py-6">
          Loading…
        </p>
      )}
      {error && (
        <p className="text-[13px] text-destructive text-center py-6">
          {error.message}
        </p>
      )}
      {!isLoading && !error && segments.length === 0 && (
        <p className="text-[13px] text-muted-foreground text-center py-6">
          No segments yet.
        </p>
      )}

      <ul>
        {segments.map((s) => (
          <li
            key={s.id}
            draggable
            onDragStart={() => setDragId(s.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(s.id)}
            className={`flex items-center gap-3 px-5 py-3 border-b border-border last:border-b-0 ${
              dragId === s.id ? "opacity-50" : ""
            }`}
          >
            <span
              className="text-muted-foreground cursor-grab active:cursor-grabbing"
              aria-hidden
            >
              <GripVertical size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold text-foreground truncate">
                {s.name}
              </p>
              <p className="text-[12px] text-muted-foreground truncate">
                {s.slug} · {s.vertical_type} · {s.display_template} · rank{" "}
                {s.rank}
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-[12px] text-muted-foreground">
              <input
                type="checkbox"
                checked={s.is_active}
                onChange={(e) =>
                  toggleMutation.mutate({ id: s.id, active: e.target.checked })
                }
                className="w-4 h-4 accent-primary"
              />
              Active
            </label>
            <button
              onClick={() => onEdit(s)}
              className="h-9 px-3 rounded-[12px] border border-border text-foreground font-semibold text-[13px] inline-flex items-center gap-1 hover:bg-muted"
            >
              <Pencil size={14} /> Edit
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SegmentFormModal({
  initial,
  onClose,
}: {
  initial: { mode: "create" } | { mode: "edit"; segment: Segment };
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const save = useServerFn(upsertSegment);
  const isEdit = initial.mode === "edit";
  const seed = isEdit ? initial.segment : null;

  const [name, setName] = useState(seed?.name ?? "");
  const [slug, setSlug] = useState(seed?.slug ?? "");
  const [verticalType, setVerticalType] = useState(
    seed?.vertical_type ?? "SERVICE",
  );
  const [displayTemplate, setDisplayTemplate] = useState(
    seed?.display_template ?? "CATEGORY_FIRST",
  );
  const [iconUrl, setIconUrl] = useState(seed?.icon_url ?? "");
  const [isActive, setIsActive] = useState(seed?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          id: isEdit ? initial.segment.id : null,
          name,
          slug,
          vertical_type: verticalType,
          display_template: displayTemplate,
          icon_url: iconUrl,
          is_active: isActive,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["segments"] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Save failed"),
  });

  return (
    <ModalShell
      eyebrow="Segment"
      title={isEdit ? "Edit segment" : "Add segment"}
      onClose={onClose}
      footer={
        <>
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
            {mutation.isPending ? "Saving…" : isEdit ? "Save changes" : "Add segment"}
          </button>
        </>
      }
    >
      <TextField
        label="Name"
        value={name}
        onChange={(v) => {
          setName(v);
          if (!isEdit)
            setSlug(
              v
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, ""),
            );
        }}
        placeholder="Grocery"
      />
      <TextField label="Slug" value={slug} onChange={setSlug} placeholder="grocery" />
      <SelectField
        label="Vertical type"
        value={verticalType}
        options={VERTICAL_TYPES as readonly string[]}
        onChange={setVerticalType}
      />
      <SelectField
        label="Display template"
        value={displayTemplate}
        options={DISPLAY_TEMPLATES as readonly string[]}
        onChange={setDisplayTemplate}
      />
      <TextField
        label="Icon URL"
        value={iconUrl}
        onChange={setIconUrl}
        placeholder="https://…"
      />
      <label className="flex items-center justify-between gap-3 p-3 rounded-[14px] border border-border">
        <div>
          <p className="text-[13px] font-semibold text-foreground">Active</p>
          <p className="text-[12px] text-muted-foreground">
            Only active segments show up in the app.
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
    </ModalShell>
  );
}

// ---------------------- Generic sections ----------------------

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
  return type;
}

function SectionFormModal({
  initial,
  onClose,
}: {
  initial:
    | { mode: "create"; sectionType: string }
    | { mode: "edit"; section: HomepageSection };
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const save = useServerFn(upsertHomepageSection);

  const isEdit = initial.mode === "edit";
  const sectionType = isEdit ? initial.section.section_type : initial.sectionType;
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
    <ModalShell
      eyebrow={sectionType}
      title={isEdit ? "Edit section" : "Add section"}
      onClose={onClose}
      footer={
        <>
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
        </>
      }
    >
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
    </ModalShell>
  );
}

function SectionFields({
  sectionType,
  payload,
  onChange,
}: {
  sectionType: string;
  payload: JsonRecord;
  onChange: (p: JsonRecord) => void;
}) {
  function set(key: string, value: string | boolean) {
    onChange({ ...payload, [key]: value });
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

// ---------------------- Shared inputs ----------------------

function ModalShell({
  eyebrow,
  title,
  onClose,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
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
              {eyebrow}
            </p>
            <h2 className="text-[18px] font-bold text-foreground">{title}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted"
          >
            <X size={20} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">{children}</div>
        <footer className="px-6 py-4 border-t border-border flex items-center justify-end gap-3">
          {footer}
        </footer>
      </div>
    </div>
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

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 px-3 rounded-[14px] border border-border bg-card text-[14px]"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------------------- Live preview ----------------------

function PreviewPane({
  sections,
  segments,
  categories,
}: {
  sections: HomepageSection[];
  segments: Segment[];
  categories: SegmentCategory[];
}) {
  const promo = sections
    .filter((s) => s.section_type === "promo_banner")
    .sort((a, b) => a.display_order - b.display_order);
  const search = sections
    .filter((s) => s.section_type === "search_bar")
    .sort((a, b) => a.display_order - b.display_order);

  const ordered = useMemo(
    () => [...segments].sort((a, b) => a.rank - b.rank),
    [segments],
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const active =
    ordered.find((s) => s.id === activeId) ?? ordered[0] ?? null;

  const segmentCategories = active
    ? categories
        .filter(
          (c) =>
            c.segment_id === active.id &&
            c.kind === (active.vertical_type === "CATALOG" ? "store" : "service"),
        )
        .sort((a, b) => a.rank - b.rank)
    : [];

  return (
    <aside className="xl:sticky xl:top-6 h-max">
      <div className="bg-card border border-border rounded-[18px] p-4">
        <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground mb-3">
          Live preview
        </h3>
        <div className="mx-auto w-[320px] rounded-[28px] border border-border bg-background overflow-hidden shadow-inner">
          <div className="bg-foreground text-white text-[10px] text-center py-1">
            Customer App
          </div>
          <div className="p-4 space-y-3 min-h-[520px]">
            {ordered.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {ordered.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setActiveId(s.id)}
                    className={`shrink-0 inline-flex items-center gap-1 px-3 h-8 rounded-full border text-[12px] ${
                      active?.id === s.id
                        ? "bg-primary text-white border-primary"
                        : "bg-white text-foreground border-border"
                    }`}
                  >
                    <SegmentIcon vertical={s.vertical_type} />
                    {s.name}
                  </button>
                ))}
              </div>
            )}

            {search.map((s) => (
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

            {promo.map((s) => (
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

            {active ? (
              <TemplateRenderer segment={active} categories={segmentCategories} />
            ) : (
              <p className="text-[11px] text-muted-foreground text-center py-6">
                No active segments.
              </p>
            )}
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">
          Segment bar and feed come from the segments table. Only active rows render.
        </p>
      </div>
    </aside>
  );
}

/** Exactly 3 display templates exist, by design. */
function TemplateRenderer({
  segment,
  categories,
}: {
  segment: Segment;
  categories: SegmentCategory[];
}) {
  const labels =
    categories.length > 0
      ? categories.map((c) => c.name)
      : ["Category 1", "Category 2", "Category 3"];

  switch (segment.display_template) {
    case "STORE_FIRST":
      return (
        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Stores near you
          </p>
          <div className="grid grid-cols-2 gap-2">
            {labels.slice(0, 4).map((l) => (
              <div
                key={l}
                className="h-20 rounded-[14px] bg-white border border-border p-2 flex flex-col justify-end"
              >
                <Store size={14} className="text-muted-foreground" />
                <span className="text-[11px] text-foreground truncate">{l}</span>
              </div>
            ))}
          </div>
        </div>
      );
    case "SEARCH_FIRST":
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2 h-11 px-3 rounded-[14px] bg-white border border-border">
            <Search size={14} className="text-muted-foreground" />
            <span className="text-[12px] text-muted-foreground truncate">
              Search in {segment.name}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {labels.map((l) => (
              <span
                key={l}
                className="px-3 h-7 inline-flex items-center rounded-full bg-white border border-border text-[11px]"
              >
                {l}
              </span>
            ))}
          </div>
        </div>
      );
    case "CATEGORY_FIRST":
    default:
      return (
        <div className="space-y-2">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {labels.map((l) => (
              <span
                key={l}
                className="shrink-0 inline-flex items-center gap-1 px-3 h-8 rounded-full bg-white border border-border text-[12px] text-foreground"
              >
                <LayoutGrid size={12} />
                {l}
              </span>
            ))}
          </div>
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-16 rounded-[14px] bg-white border border-border"
              />
            ))}
          </div>
        </div>
      );
  }
}

function SegmentIcon({ vertical }: { vertical: string }) {
  return vertical === "CATALOG" ? <Store size={12} /> : <Sparkles size={12} />;
}

function PayloadIcon({ name, size = 14 }: { name: string; size?: number }) {
  const n = name.toLowerCase();
  if (n === "gift" || n === "rewards") return <Gift size={size} />;
  if (n === "search") return <Search size={size} />;
  if (n === "sparkles" || n === "deep-clean") return <Sparkles size={size} />;
  return <Tag size={size} />;
}
