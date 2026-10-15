import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";

/**
 * Shared Command Center page chrome (tab strip, filter bar, table styles).
 * Every section uses these so headers, tabs and filters look identical to Clean.
 */

export type TabItem<K extends string = string> = {
  key: K;
  label: string;
  icon?: LucideIcon;
  badge?: number;
};

export const SECTION_TABS_SLOT_ID = "section-tabs-slot";

/** The full-width white tab strip shown directly under the top bar. */
export function TabStrip<K extends string>({
  items,
  active,
  onChange,
}: {
  items: TabItem<K>[];
  active: K;
  onChange: (k: K) => void;
}) {
  return (
    <div className="bg-card border-b border-border px-2 sm:px-8">
      <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = item.key === active;
          return (
            <button
              key={item.key}
              onClick={() => onChange(item.key)}
              className={`shrink-0 flex items-center gap-2 px-3 py-3 text-[13px] font-semibold whitespace-nowrap border-b-2 transition-colors ${
                isActive ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {Icon && <Icon size={15} strokeWidth={isActive ? 2.25 : 2} />}
              {item.label}
              {!!item.badge && item.badge > 0 && (
                <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                  {item.badge > 99 ? "99+" : item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Page-owned tabs: rendered into the shared slot under the top bar (same place as Clean's tabs). */
export function SectionTabs<K extends string>(props: { items: TabItem<K>[]; active: K; onChange: (k: K) => void }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSlot(document.getElementById(SECTION_TABS_SLOT_ID));
  }, []);
  if (props.items.length < 2 || !slot) return null;
  return createPortal(<TabStrip {...props} />, slot);
}

/** White filter card, identical to Clean → Bookings. */
export function FilterBar({ children, count }: { children: ReactNode; count?: ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-[18px] p-4 flex flex-wrap items-end gap-3">
      {children}
      {count != null && <div className="ml-auto text-[12px] text-muted-foreground self-center">{count}</div>}
    </div>
  );
}

export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

export const filterInputCls = "h-10 px-3 rounded-[12px] border border-border bg-card text-[13px]";
export const filterSelectCls = "h-10 px-3 rounded-[12px] border border-border bg-card text-[13px] min-w-[160px]";

/** Table classes matching Clean → Bookings. */
export const tableCls = {
  wrap: "bg-card border border-border rounded-[18px] overflow-hidden",
  scroll: "overflow-x-auto",
  table: "w-full text-[13px]",
  thead: "bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground",
  th: "text-left px-4 py-3",
  tr: "border-t border-border hover:bg-muted/30 cursor-pointer",
  td: "px-4 py-3",
};

export const countLabel = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
