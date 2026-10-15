import { useEffect, useSyncExternalStore } from "react";

// Lets a page with its own in-page tabs tell the top bar which tab is active.
let current: string | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function usePageTabLabel(): string | null {
  return useSyncExternalStore(
    (f) => { subs.add(f); return () => subs.delete(f); },
    () => current,
    () => null,
  );
}

export function useReportPageTab(label: string | null) {
  useEffect(() => {
    current = label; emit();
    return () => { if (current === label) { current = null; emit(); } };
  }, [label]);
}
