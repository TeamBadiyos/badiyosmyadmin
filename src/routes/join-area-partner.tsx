import { createFileRoute } from "@tanstack/react-router";
import { OG_IMAGE, SITE_URL } from "@/lib/brand";
import { Building2, Trophy, Users } from "lucide-react";
import { MarketingShell } from "@/components/marketing/shell";
import { LeadForm } from "@/components/marketing/lead-form";

export const Route = createFileRoute("/join-area-partner")({
  head: () => ({
    meta: [
      { title: "Become a Badiyos Area Partner" },
      {
        name: "description",
        content:
          "Run the Badiyos franchise for your city. Exclusive per-area rights, one-time setup, and ongoing income from every home service in your zone.",
      },
      { property: "og:title", content: "Become a Badiyos Area Partner" },
      {
        property: "og:description",
        content: "Exclusive per-area franchise. Recruit and manage Home Experts, earn from every booking.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:url", content: `${SITE_URL}/join-area-partner` },
      { property: "og:image", content: OG_IMAGE },
      { name: "twitter:image", content: OG_IMAGE },
    ],
    links: [{ rel: "canonical", href: `${SITE_URL}/join-area-partner` }],
  }),
  component: JoinAreaPartnerPage,
});

function JoinAreaPartnerPage() {
  return (
    <MarketingShell>
      <section className="max-w-6xl mx-auto px-5 sm:px-8 pt-14 pb-8 sm:pt-20 sm:pb-12">
        <p className="text-[12px] font-bold uppercase tracking-widest text-primary">
          Area Partner Program
        </p>
        <h1 className="mt-2 text-[32px] sm:text-[48px] font-bold text-foreground tracking-tight max-w-2xl">
          Own your city. Grow with Badiyos.
        </h1>
        <p className="mt-4 text-[16px] text-muted-foreground max-w-2xl">
          Get exclusive rights to run Badiyos in your area. One-time setup, recruit
          your own Home Experts, and earn a share on every service delivered in your zone.
        </p>
      </section>

      <section className="max-w-6xl mx-auto px-5 sm:px-8 pb-16 grid gap-8 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-4">
          <Perk
            icon={Building2}
            title="Exclusive area rights"
            desc="One partner per zone — no competition inside your territory."
          />
          <Perk
            icon={Users}
            title="Build your team"
            desc="Recruit and manage Home Experts on the ground."
          />
          <Perk
            icon={Trophy}
            title="Recurring earnings"
            desc="Earn a commission on every booking completed in your zone."
          />
        </div>
        <div>
          <LeadForm kind="area_partner" />
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
