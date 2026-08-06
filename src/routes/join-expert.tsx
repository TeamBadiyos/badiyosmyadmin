import { createFileRoute } from "@tanstack/react-router";
import { CalendarClock, Gem, ShieldCheck } from "lucide-react";
import { MarketingShell } from "@/components/marketing/shell";
import { LeadForm } from "@/components/marketing/lead-form";

export const Route = createFileRoute("/join-expert")({
  head: () => ({
    meta: [
      { title: "Join Badiyos as a Home Expert" },
      {
        name: "description",
        content:
          "Earn weekly, level up from Bronze to Diamond, and enjoy a minimum earnings guarantee — join Badiyos as a Home Expert today.",
      },
      { property: "og:title", content: "Join Badiyos as a Home Expert" },
      {
        property: "og:description",
        content: "Weekly payouts, Bronze to Diamond levels, minimum earnings guarantee.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: JoinExpertPage,
});

function JoinExpertPage() {
  return (
    <MarketingShell>
      <section className="max-w-6xl mx-auto px-5 sm:px-8 pt-14 pb-8 sm:pt-20 sm:pb-12">
        <p className="text-[12px] font-bold uppercase tracking-widest text-primary">
          Home Expert Program
        </p>
        <h1 className="mt-2 text-[32px] sm:text-[48px] font-bold text-foreground tracking-tight max-w-2xl">
          Do what you love. Earn every week.
        </h1>
        <p className="mt-4 text-[16px] text-muted-foreground max-w-2xl">
          Join Badiyos's network of trusted Home Experts. Weekly payouts, a clear
          level system, and a guaranteed minimum so you're never left short.
        </p>
      </section>

      <section className="max-w-6xl mx-auto px-5 sm:px-8 pb-16 grid gap-8 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-4">
          <Perk
            icon={CalendarClock}
            title="Weekly payouts"
            desc="Money in your account every week — no waiting a month."
          />
          <Perk
            icon={Gem}
            title="Bronze to Diamond"
            desc="Level up as you deliver great service. Higher levels, better perks."
          />
          <Perk
            icon={ShieldCheck}
            title="Minimum earnings guarantee"
            desc="A safety net so a slow week doesn't hurt your income."
          />
        </div>
        <div>
          <LeadForm kind="expert" />
        </div>
      </section>
    </MarketingShell>
  );
}

function Perk({
  icon: Icon,
  title,
  desc,
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  title: string;
  desc: string;
}) {
  return (
    <div className="bg-card rounded-[18px] border border-border p-6 flex gap-4">
      <div className="w-12 h-12 rounded-[14px] bg-primary-tint text-primary flex items-center justify-center shrink-0">
        <Icon size={22} strokeWidth={2.25} />
      </div>
      <div>
        <h3 className="text-[17px] font-bold text-foreground">{title}</h3>
        <p className="mt-1 text-[14px] text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}
