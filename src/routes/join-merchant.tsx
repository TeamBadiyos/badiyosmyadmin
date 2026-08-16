import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  BarChart3,
  Boxes,
  ReceiptText,
  Smartphone,
  Store,
  Users,
} from "lucide-react";
import { MarketingShell } from "@/components/marketing/shell";
import { Reveal } from "@/components/marketing/reveal";
import { MERCHANT_PORTAL_URL, OG_IMAGE, SITE_URL } from "@/lib/brand";

export const Route = createFileRoute("/join-merchant")({
  head: () => ({
    meta: [
      { title: "Join Badiyos as a Merchant — Sell Online & Offline" },
      {
        name: "description",
        content:
          "Run your shop online and offline with one app — POS billing, GST invoices, stock tracking and new customers from Latur. Register your shop on Badiyos.",
      },
      { property: "og:title", content: "Join Badiyos as a Merchant" },
      {
        property: "og:description",
        content:
          "One app for your shop: POS billing, inventory, GST invoices and online orders from nearby customers.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SITE_URL}/join-merchant` },
      { property: "og:image", content: OG_IMAGE },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: OG_IMAGE },
    ],
    links: [{ rel: "canonical", href: `${SITE_URL}/join-merchant` }],
  }),
  component: JoinMerchantPage,
});

const PERKS = [
  {
    icon: ReceiptText,
    title: "Billing that just works",
    desc: "Ring up walk-in customers in seconds. GST-ready invoices with an automatic invoice number for every sale.",
  },
  {
    icon: Boxes,
    title: "Stock you can trust",
    desc: "Add your products once. Stock updates on every sale, and you get a nudge when an item is running low.",
  },
  {
    icon: Users,
    title: "New customers nearby",
    desc: "Your shop shows up for Badiyos customers around you — they order, you accept, we handle the rest.",
  },
  {
    icon: BarChart3,
    title: "Know your numbers",
    desc: "Daily sales, top-selling items and pending payments, all in one simple dashboard.",
  },
  {
    icon: Smartphone,
    title: "One app, both counters",
    desc: "Offline counter sales and online orders live in the same place. No juggling registers and apps.",
  },
  {
    icon: Store,
    title: "Simple monthly plan",
    desc: "A flat, transparent monthly fee. No confusing slabs, no surprise deductions.",
  },
];

const STEPS = [
  "Register your shop with your phone number",
  "Add your GST/PAN details and shop photo",
  "Our team verifies and approves you",
  "Add products and start billing the same day",
];

function JoinMerchantPage() {
  return (
    <MarketingShell>
      <section className="max-w-6xl mx-auto px-5 sm:px-8 pt-14 pb-8 sm:pt-20 sm:pb-12">
        <Reveal>
          <p className="text-[12px] font-bold uppercase tracking-widest text-primary">
            Merchant Program
          </p>
          <h1 className="mt-2 text-[32px] sm:text-[48px] font-bold text-foreground tracking-tight max-w-3xl leading-[1.05]">
            Run your shop online <span className="text-primary">and</span> offline — with one app.
          </h1>
          <p className="mt-4 text-[16px] text-muted-foreground max-w-2xl">
            Badiyos gives local shops a billing counter, a stock register and an online
            storefront in a single app. Keep serving your walk-in customers, and start
            taking orders from people nearby.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={MERCHANT_PORTAL_URL}
              className="inline-flex items-center gap-2 h-[52px] px-6 rounded-[14px] bg-primary text-primary-foreground font-bold text-[15px] hover:brightness-95 transition"
            >
              Register your shop
              <ArrowRight size={18} />
            </a>
            <a
              href="/support"
              className="inline-flex items-center h-[52px] px-6 rounded-[14px] border border-border bg-card font-bold text-[15px] text-foreground hover:bg-muted transition"
            >
              Talk to our team
            </a>
          </div>
        </Reveal>
      </section>

      <section className="w-full bg-card border-y border-border">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-20">
          <Reveal>
            <h2 className="text-[26px] sm:text-[34px] font-bold text-foreground">
              What you get
            </h2>
          </Reveal>
          <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {PERKS.map((p, i) => (
              <Reveal key={p.title} delay={i * 60}>
                <div className="h-full rounded-[18px] border border-border bg-background p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_16px_32px_-16px_rgba(0,185,122,0.4)]">
                  <div className="w-11 h-11 rounded-full bg-primary-tint text-primary flex items-center justify-center mb-4">
                    <p.icon size={22} strokeWidth={2.25} />
                  </div>
                  <h3 className="text-[16px] font-bold text-foreground">{p.title}</h3>
                  <p className="mt-1.5 text-[13px] text-muted-foreground leading-relaxed">
                    {p.desc}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-20">
        <Reveal>
          <h2 className="text-[26px] sm:text-[34px] font-bold text-foreground">
            Getting started takes a day
          </h2>
        </Reveal>
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {STEPS.map((s, i) => (
            <Reveal key={s} delay={i * 70}>
              <div className="h-full rounded-[18px] border border-border bg-card p-6">
                <span className="inline-flex w-9 h-9 rounded-full bg-primary text-primary-foreground items-center justify-center font-bold text-[14px]">
                  {i + 1}
                </span>
                <p className="mt-4 text-[14px] font-semibold text-foreground leading-snug">{s}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-5 sm:px-8 pb-20">
        <Reveal>
          <div className="rounded-[24px] bg-foreground text-white p-8 sm:p-12 text-center">
            <h2 className="text-[26px] sm:text-[34px] font-bold">Ready when you are</h2>
            <p className="mt-3 text-[15px] text-white/70 max-w-xl mx-auto">
              Register your shop on the Badiyos Merchant portal. It takes a few minutes,
              and our team will guide you through verification.
            </p>
            <a
              href={MERCHANT_PORTAL_URL}
              className="mt-8 inline-flex items-center gap-2 h-[52px] px-7 rounded-[14px] bg-primary text-primary-foreground font-bold text-[15px] hover:brightness-95 transition"
            >
              Go to merchant.badiyos.com
              <ArrowRight size={18} />
            </a>
          </div>
        </Reveal>
      </section>
    </MarketingShell>
  );
}
