import { useState } from "react";
import { Ticket, Gift, CalendarDays, Award } from "lucide-react";
import { SectionTabs } from "@/components/section-chrome";
import { useReportPageTab } from "@/lib/page-tab";
import { CouponsTab, useOffersAccess } from "@/components/offers-page";
import { LuckyDrawPage } from "@/components/lucky-draw-page";
import { EventOffersPage } from "@/components/event-offers-page";
import { RewardsPage } from "@/components/rewards-page";
import { SpinWinPage } from "@/components/spin-win-page";

export type RewardsTab = "coupons" | "lucky" | "events" | "programs";
const LABELS: Record<RewardsTab, string> = {
  coupons: "Coupons",
  lucky: "Lucky Draw",
  events: "Events",
  programs: "Programs",
};

const ICONS = { coupons: Ticket, lucky: Gift, events: CalendarDays, programs: Award } as const;

/** Rewards: Coupons · Lucky Draw · Events · Programs. */
export function RewardsHub({ role, initialTab = "coupons" }: { role: string | null; initialTab?: RewardsTab }) {
  const access = useOffersAccess();
  const isSuper = role === "super_admin";
  const tabs: RewardsTab[] = isSuper ? ["coupons", "lucky", "events", "programs"] : ["coupons"];
  const [tab, setTab] = useState<RewardsTab>(tabs.includes(initialTab) ? initialTab : "coupons");
  useReportPageTab(LABELS[tab]);

  return (
    <div className="space-y-6">
      <SectionTabs items={tabs.map((t) => ({ key: t, label: LABELS[t], icon: ICONS[t] }))} active={tab} onChange={setTab} />
      {tab === "coupons" && <CouponsTab canWrite={access?.canWrite ?? false} />}
      {tab === "lucky" && <LuckyDrawPage />}
      {tab === "events" && <EventsSection />}
      {tab === "programs" && <RewardsPage />}
    </div>
  );
}

function EventsSection() {
  const [kind, setKind] = useState<"offers" | "spin">("offers");
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-md border p-1">
        {(["offers", "spin"] as const).map((k) => (
          <button key={k} onClick={() => setKind(k)}
            className={`rounded px-3 py-1 text-sm ${kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
            {k === "offers" ? "Counter offers" : "Spin & Win"}
          </button>
        ))}
      </div>
      {kind === "offers" ? <EventOffersPage /> : <SpinWinPage />}
    </div>
  );
}
