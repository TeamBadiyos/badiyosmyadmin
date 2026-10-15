import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";

/** Shared list-table helpers (pagination, sortable header, debounce, empty state). */

export const PAGE_SIZES = [25, 50, 100] as const;

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function SortHeader({
  label,
  dir,
  onClick,
  align = "left",
}: {
  label: string;
  dir: "asc" | "desc" | null;
  onClick: () => void;
  align?: "left" | "right";
}) {
  const Icon = dir === "asc" ? ArrowUp : dir === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 uppercase tracking-wider font-bold hover:text-foreground ${align === "right" ? "justify-end w-full" : ""} ${dir ? "text-foreground" : ""}`}
    >
      {label}
      <Icon size={12} className={dir ? "" : "opacity-40"} />
    </button>
  );
}

function pageList(page: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const s = Math.max(2, page - 1);
  const e = Math.min(total - 1, page + 1);
  if (s > 2) out.push("…");
  for (let i = s; i <= e; i++) out.push(i);
  if (e < total - 1) out.push("…");
  out.push(total);
  return out;
}

export function DataTablePagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const btn = "h-8 min-w-8 px-2 inline-flex items-center justify-center rounded-[10px] border border-border text-[12px] disabled:opacity-40 hover:bg-muted";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-border text-[12px] text-muted-foreground">
      <div className="flex items-center gap-3">
        <span>{from}–{to} of {total}</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          className="h-8 px-2 rounded-[10px] border border-border bg-card text-[12px]"
          aria-label="Rows per page"
        >
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} / page</option>)}
        </select>
      </div>
      <div className="flex items-center gap-1">
        <button className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft size={14} /></button>
        {pageList(page, pages).map((p, i) =>
          p === "…" ? <span key={`e${i}`} className="px-1">…</span> : (
            <button key={p} onClick={() => onPage(p)} className={`${btn} ${p === page ? "bg-primary text-primary-foreground border-primary hover:bg-primary" : ""}`}>{p}</button>
          ),
        )}
        <button className={btn} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight size={14} /></button>
      </div>
    </div>
  );
}

export function EmptyState({ text, onClear }: { text: string; onClear?: () => void }) {
  return (
    <div className="text-center py-10 text-[13px] text-muted-foreground">
      {text}
      {onClear && (
        <button onClick={onClear} className="ml-2 font-semibold text-primary hover:underline">Clear filters</button>
      )}
    </div>
  );
}

export const maskEmail = (e: string | null | undefined) =>
  !e || /@badiyos\.phone\.local$/i.test(e) ? "—" : e;

/** useState that mirrors its value into the page URL (?key=value), surviving reload and Back/Forward. */
export function useUrlState<T extends string | number>(key: string, initial: T): [T, (v: T) => void] {
  const read = (): T => {
    if (typeof window === "undefined") return initial;
    const raw = new URLSearchParams(window.location.search).get(key);
    if (raw == null) return initial;
    return (typeof initial === "number" ? (Number(raw) as T) : (raw as T));
  };
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    setV(read());
    const onPop = () => setV(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = (next: T) => {
    setV(next);
    const url = new URL(window.location.href);
    if (next === initial || next === "") url.searchParams.delete(key);
    else url.searchParams.set(key, String(next));
    window.history.pushState(window.history.state, "", url.toString());
  };
  return [v, set];
}
