import { useState } from "react";
import { useReportPageTab } from "@/lib/page-tab";
import { CouponsTab, useOffersAccess } from "@/components/offers-page";
import { LuckyDrawPage } from "@/components/lucky-draw-page";
import { EventOffersPage } from "@/components/event-offers-page";
import { RewardsPage } from "@/components/rewards-page";

export type RewardsTab = "coupons" | "lucky" | "events" | "programs";
const LABELS: Record<RewardsTab, string> = {
  coupons: "Coupons",
  lucky: "Lucky Draw",
  events: "Events",
  programs: "Programs",
};

/** Rewards: Coupons · Lucky Draw · Events · Programs. */
export function RewardsHub({ role, initialTab = "coupons" }: { role: string | null; initialTab?: RewardsTab }) {
  const access = useOffersAccess();
  const isSuper = role === "super_admin";
  const tabs: RewardsTab[] = isSuper ? ["coupons", "lucky", "events", "programs"] : ["coupons"];
  const [tab, setTab] = useState<RewardsTab>(tabs.includes(initialTab) ? initialTab : "coupons");
  useReportPageTab(LABELS[tab]);

  return (
    <div className="space-y-5">
      {tabs.length > 1 && (
        <div className="flex gap-1 border-b border-border">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-4 py-2.5 text-[14px] font-semibold transition-colors ${
                tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {LABELS[t]}
            </button>
          ))}
        </div>
      )}
      {tab === "coupons" && <CouponsTab canWrite={access?.canWrite ?? false} />}
      {tab === "lucky" && <LuckyDrawPage />}
      {tab === "events" && <EventOffersPage />}
      {tab === "programs" && <RewardsPage />}
    </div>
  );
}
