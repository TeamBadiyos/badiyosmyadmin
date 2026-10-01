import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Check, Search, X } from "lucide-react";

export type SortFilterColumn<T> = {
  /** unique key for the column */
  key: string;
  /** header label */
  label: string;
  /** value used for sorting + filtering */
  value: (row: T) => string | number | null | undefined;
  /** label shown in the filter checklist (defaults to value) */
  display?: (row: T) => string;
  type?: "text" | "number";
  align?: "left" | "right" | "center";
  /** disable the value checklist (sort only) */
  filterable?: boolean;
  sortable?: boolean;
};

type SortState = { key: string; dir: "asc" | "desc" } | null;

export type SortFilterApi<T> = {
  rows: T[];
  sort: SortState;
  filters: Record<string, string[]>;
  activeCount: number;
  reset: () => void;
  headerProps: (key: string) => {
    column: SortFilterColumn<T>;
    sort: SortState;
    setSort: (s: SortState) => void;
    options: string[];
    selected: string[] | null;
    setSelected: (vals: string[] | null) => void;
  };
};

function toText(v: string | number | null | undefined) {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

export function useSortFilter<T>(rows: T[], columns: SortFilterColumn<T>[]): SortFilterApi<T> {
  const [sort, setSort] = useState<SortState>(null);
  const [filters, setFilters] = useState<Record<string, string[] | null>>({});

  const colMap = useMemo(() => {
    const m = new Map<string, SortFilterColumn<T>>();
    columns.forEach((c) => m.set(c.key, c));
    return m;
  }, [columns]);

  const optionsByKey = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const col of columns) {
      if (col.filterable === false) continue;
      const set = new Set<string>();
      for (const r of rows) set.add(col.display ? col.display(r) : toText(col.value(r)));
      out[col.key] = Array.from(set).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
      );
    }
    return out;
  }, [rows, columns]);

  const filtered = useMemo(() => {
    let out = rows;
    for (const [key, selected] of Object.entries(filters)) {
      if (!selected) continue;
      const col = colMap.get(key);
      if (!col) continue;
      const set = new Set(selected);
      out = out.filter((r) => set.has(col.display ? col.display(r) : toText(col.value(r))));
    }
    if (sort) {
      const col = colMap.get(sort.key);
      if (col) {
        const dir = sort.dir === "asc" ? 1 : -1;
        out = [...out].sort((a, b) => {
          const av = col.value(a);
          const bv = col.value(b);
          if (col.type === "number") {
            const an = typeof av === "number" ? av : Number(av ?? 0) || 0;
            const bn = typeof bv === "number" ? bv : Number(bv ?? 0) || 0;
            return (an - bn) * dir;
          }
          return (
            toText(av).localeCompare(toText(bv), undefined, {
              numeric: true,
              sensitivity: "base",
            }) * dir
          );
        });
      }
    }
    return out;
  }, [rows, filters, sort, colMap]);

  const activeCount =
    Object.values(filters).filter((v) => v && v.length > 0).length + (sort ? 1 : 0);

  return {
    rows: filtered,
    sort,
    filters: Object.fromEntries(
      Object.entries(filters).filter(([, v]) => !!v) as [string, string[]][],
    ),
    activeCount,
    reset: () => {
      setSort(null);
      setFilters({});
    },
    headerProps: (key: string) => ({
      column: colMap.get(key)!,
      sort,
      setSort,
      options: optionsByKey[key] ?? [],
      selected: filters[key] ?? null,
      setSelected: (vals: string[] | null) =>
        setFilters((f) => ({ ...f, [key]: vals && vals.length ? vals : null })),
    }),
  };
}

export function SortFilterHeader<T>({
  column,
  sort,
  setSort,
  options,
  selected,
  setSelected,
}: ReturnType<SortFilterApi<T>["headerProps"]>) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!column) return null;

  const isNum = column.type === "number";
  const active = sort?.key === column.key;
  const hasFilter = !!selected && selected.length > 0;
  const canFilter = column.filterable !== false && options.length > 1;
  const canSort = column.sortable !== false;
  const shown = q
    ? options.filter((o) => o.toLowerCase().includes(q.trim().toLowerCase()))
    : options;
  const current = selected ?? options;

  const toggle = (val: string) => {
    const next = current.includes(val)
      ? current.filter((v) => v !== val)
      : [...current, val];
    setSelected(next.length === options.length ? null : next);
  };

  return (
    <div
      ref={ref}
      className={`relative flex items-center gap-1 min-w-0 ${
        column.align === "right"
          ? "justify-end"
          : column.align === "center"
            ? "justify-center"
            : ""
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1 min-w-0 rounded-md px-1 -mx-1 py-0.5 transition-colors hover:text-foreground ${
          active || hasFilter ? "text-primary" : ""
        }`}
        title="Sort & filter"
      >
        <span className="truncate">{column.label}</span>
        {active ? (
          sort?.dir === "asc" ? (
            <ArrowUp size={12} className="shrink-0" />
          ) : (
            <ArrowDown size={12} className="shrink-0" />
          )
        ) : (
          <ChevronsUpDown size={12} className="shrink-0 opacity-50" />
        )}
        {hasFilter && (
          <span className="shrink-0 rounded-full bg-primary text-white text-[9px] leading-none px-1.5 py-0.5">
            {selected!.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-2 left-0 w-60 rounded-[14px] border border-border bg-card shadow-xl p-2 normal-case tracking-normal font-normal">
          {canSort && (
            <div className="space-y-0.5">
              <MenuItem
                onClick={() => {
                  setSort({ key: column.key, dir: "asc" });
                  setOpen(false);
                }}
                icon={<ArrowUp size={13} />}
                label={isNum ? "Sort low → high" : "Sort A → Z"}
                active={active && sort?.dir === "asc"}
              />
              <MenuItem
                onClick={() => {
                  setSort({ key: column.key, dir: "desc" });
                  setOpen(false);
                }}
                icon={<ArrowDown size={13} />}
                label={isNum ? "Sort high → low" : "Sort Z → A"}
                active={active && sort?.dir === "desc"}
              />
              {active && (
                <MenuItem
                  onClick={() => {
                    setSort(null);
                    setOpen(false);
                  }}
                  icon={<X size={13} />}
                  label="Clear sort"
                />
              )}
            </div>
          )}

          {canFilter && (
            <>
              <div className="my-2 h-px bg-border" />
              <div className="relative mb-2">
                <Search
                  size={13}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search values"
                  className="w-full h-8 pl-7 pr-2 rounded-[10px] border border-border bg-background text-[12px]"
                />
              </div>
              <div className="flex items-center justify-between px-1 pb-1 text-[11px] font-semibold">
                <button
                  type="button"
                  className="text-primary"
                  onClick={() => setSelected(null)}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="text-muted-foreground"
                  onClick={() => setSelected(["\u0000none"])}
                >
                  Clear
                </button>
              </div>
              <div className="max-h-52 overflow-auto space-y-0.5">
                {shown.map((opt) => {
                  const checked = current.includes(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => toggle(opt)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[8px] text-left text-[12px] hover:bg-muted/60"
                    >
                      <span
                        className={`h-4 w-4 shrink-0 rounded-[4px] border flex items-center justify-center ${
                          checked ? "bg-primary border-primary text-white" : "border-border"
                        }`}
                      >
                        {checked && <Check size={11} />}
                      </span>
                      <span className="truncate">{opt}</span>
                    </button>
                  );
                })}
                {shown.length === 0 && (
                  <p className="text-[12px] text-muted-foreground px-2 py-3 text-center">
                    No values.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  onClick,
  icon,
  label,
  active,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-[8px] text-left text-[12px] hover:bg-muted/60 ${
        active ? "text-primary font-semibold" : ""
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export function SortFilterReset({ api }: { api: { activeCount: number; reset: () => void } }) {
  if (api.activeCount === 0) return null;
  return (
    <button
      type="button"
      onClick={api.reset}
      className="h-8 px-3 rounded-[10px] border border-border bg-card text-[12px] font-semibold text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
    >
      <X size={13} /> Reset sort &amp; filters
    </button>
  );
}
