import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Clock,
  CreditCard,
  UserCheck,
  Sparkles,
  BadgeCheck,
  ShieldCheck,
  Wallet,
  CalendarClock,
  Star,
  ChevronDown,
  MapPin,
  ArrowRight,
  Wrench,
  Zap,
  Wind,
  Bug,
  Hammer,
  Car,
  Shirt,
  ShoppingBasket,
  Apple,
  Store,
  Brush,
  type LucideIcon,
} from "lucide-react";
import { MarketingShell, ComingSoonAppButton } from "@/components/marketing/shell";
import { Reveal } from "@/components/marketing/reveal";
import {
  BusinessInterestDialog,
  CityInterestDialog,
} from "@/components/marketing/interest-dialogs";
import expertGreeting from "@/assets/expert-greeting.png.asset.json";
import badiyosWhiteLogo from "@/assets/badiyos-wordmark-white.png.asset.json";
import { OG_IMAGE, SITE_URL } from "@/lib/brand";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Badiyos — Trusted Home Services in Latur" },
      {
        name: "description",
        content:
          "Book a verified home expert in Latur in minutes. Home cleaning today, with plumbing, electrical, AC care and local shops coming soon on Badiyos.",
      },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "Badiyos — Trusted Home Services in Latur" },
      {
        property: "og:description",
        content:
          "Book a verified home expert in Latur in minutes. Home cleaning today, with more home services and local shops coming soon.",
      },
      { property: "og:url", content: SITE_URL },
      { property: "og:image", content: OG_IMAGE },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: OG_IMAGE },
    ],
    links: [{ rel: "canonical", href: SITE_URL }],
  }),
  component: HomePage,
});

function HomePage() {
  const [businessOpen, setBusinessOpen] = useState(false);
  const [cityOpen, setCityOpen] = useState(false);

  return (
    <MarketingShell>
      <Hero onCityInterest={() => setCityOpen(true)} />
      <Services onShowInterest={() => setBusinessOpen(true)} />
      <HowItWorks />
      <WhyBadiyos />
      <FAQ />
      <DownloadApp />
      <BusinessInterestDialog open={businessOpen} onClose={() => setBusinessOpen(false)} />
      <CityInterestDialog open={cityOpen} onClose={() => setCityOpen(false)} />
    </MarketingShell>
  );
}

/* ------------------------------- HERO ------------------------------- */

const TICKER_ITEMS = [
  "Home Cleaning",
  "Dishwashing",
  "Kitchen Deep Clean",
  "Bathroom Cleaning",
  "Verified Experts",
  "1, 2 & 4 hour slots",
  "Pay online",
  "Now in Latur",
];

function Hero({ onCityInterest }: { onCityInterest: () => void }) {
  return (
    <section className="w-full bg-background overflow-hidden">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 pt-12 sm:pt-20 pb-16 sm:pb-20">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left */}
          <div className="text-center lg:text-left">
            <div
              className="hero-rise flex flex-col sm:flex-row items-center lg:items-start gap-2 sm:gap-3 justify-center lg:justify-start"
              style={{ animationDelay: "40ms" }}
            >
              <span className="inline-flex items-center gap-2 h-8 px-3 rounded-full bg-primary-tint text-primary text-[12px] font-bold">
                <span className="relative flex h-2 w-2">
                  <span className="hero-pulse absolute inline-flex h-full w-full rounded-full bg-primary" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                </span>
                <MapPin size={13} />
                Now in Latur
              </span>
              <button
                type="button"
                onClick={onCityInterest}
                className="text-[12px] font-semibold text-muted-foreground underline underline-offset-4 decoration-dotted hover:text-primary transition-colors"
              >
                Not in Latur? Get notified when we launch in your city
              </button>
            </div>

            <h1
              className="hero-rise mt-5 text-[40px] sm:text-[60px] lg:text-[68px] leading-[0.98] font-bold text-foreground tracking-tight"
              style={{ animationDelay: "120ms" }}
            >
              Trusted home services,{" "}
              <span className="relative inline-block text-primary">
                done right
                <span
                  aria-hidden
                  className="absolute left-0 right-0 -bottom-1 h-[6px] rounded-full bg-primary/20"
                />
              </span>
              .
            </h1>

            <p
              className="hero-rise mt-6 text-[16px] sm:text-[18px] text-muted-foreground max-w-xl mx-auto lg:mx-0"
              style={{ animationDelay: "220ms" }}
            >
              Book verified home experts in minutes. Pick a time slot, pay online,
              and relax while the pros handle the rest.
            </p>

            <div
              className="hero-rise mt-6 flex flex-wrap justify-center lg:justify-start gap-2"
              style={{ animationDelay: "300ms" }}
            >
              {["Verified Experts", "Time-Slot Booking", "Fair Pricing"].map((p) => (
                <span
                  key={p}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-primary/30 text-primary text-[12px] font-semibold bg-card"
                >
                  <BadgeCheck size={13} />
                  {p}
                </span>
              ))}
            </div>

            <div
              className="hero-rise mt-8 flex flex-wrap items-center justify-center lg:justify-start gap-3"
              style={{ animationDelay: "380ms" }}
            >
              <a
                href="#services"
                className="inline-flex items-center gap-2 h-[52px] px-6 rounded-[14px] bg-primary text-primary-foreground font-bold text-[15px] hover:brightness-95 hover:-translate-y-0.5 transition"
              >
                See what we do
                <ArrowRight size={18} />
              </a>
              <ComingSoonAppButton />
            </div>
          </div>

          {/* Right */}
          <div className="relative flex justify-center lg:justify-end">
            <div
              aria-hidden
              className="absolute inset-0 -z-0 flex items-center justify-center pointer-events-none"
            >
              <div
                className="hero-pulse w-[85%] aspect-square rounded-full blur-3xl"
                style={{
                  background:
                    "radial-gradient(circle at 50% 50%, rgba(0,185,122,0.35), rgba(0,185,122,0) 65%)",
                }}
              />
            </div>
            <div className="relative w-full max-w-[520px] hero-float">
              {/* TODO(brand): replace this hero photo — the uniform in the current
                  shot shows inconsistent wordmarks ("badiyo" vs "badiyos"). */}
              <img
                src={expertGreeting.url}
                alt="A Badiyos home expert in uniform greeting with a namaste"
                className="w-full h-auto rounded-[24px] shadow-[0_20px_60px_-20px_rgba(0,185,122,0.35)] object-cover"
                loading="eager"
                fetchPriority="high"
              />
              <div className="absolute -bottom-5 -left-4 sm:left-6 bg-card rounded-[18px] shadow-[0_18px_40px_-16px_rgba(0,0,0,0.25)] border border-border p-4 flex items-center gap-3 max-w-[260px]">
                <div className="w-10 h-10 rounded-full bg-primary-tint text-primary flex items-center justify-center shrink-0">
                  <UserCheck size={20} strokeWidth={2.25} />
                </div>
                <div className="text-left">
                  <p className="text-[13px] font-bold text-foreground leading-tight">
                    Expert on the way
                  </p>
                  <p className="text-[12px] text-muted-foreground leading-tight mt-0.5">
                    You'll get a live update in the app
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Marquee strip */}
      <div className="border-y border-border bg-card overflow-hidden">
        <div className="flex w-max ticker-track">
          {[0, 1].map((dup) => (
            <div key={dup} className="flex items-center gap-8 px-4 py-3" aria-hidden={dup === 1}>
              {TICKER_ITEMS.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-2 text-[13px] font-bold text-muted-foreground whitespace-nowrap"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                  {t}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ----------------------------- SERVICES ----------------------------- */

type ServiceItem = { name: string; icon: LucideIcon };

const GROUP_LIVE: ServiceItem[] = [{ name: "Maid / Home Cleaning", icon: Brush }];

const GROUP_HOME: ServiceItem[] = [
  { name: "Plumber", icon: Wrench },
  { name: "Electrician", icon: Zap },
  { name: "AC Cleaning & Repair", icon: Wind },
  { name: "Pest Control", icon: Bug },
  { name: "Carpenter", icon: Hammer },
  { name: "Car & Bike Wash", icon: Car },
  { name: "Laundry", icon: Shirt },
];

const GROUP_SHOP: ServiceItem[] = [
  { name: "Grocery", icon: ShoppingBasket },
  { name: "Vegetables & Fruits", icon: Apple },
  { name: "Local Businesses", icon: Store },
];

function Services({ onShowInterest }: { onShowInterest: () => void }) {
  return (
    <section id="services" className="w-full bg-card">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-24 space-y-16">
        <Reveal>
          <p className="text-[12px] font-bold uppercase tracking-widest text-primary">
            Services
          </p>
          <h2 className="mt-2 text-[28px] sm:text-[38px] font-bold text-foreground max-w-2xl leading-tight">
            Everything your home needs — one app at a time.
          </h2>
          <p className="mt-3 text-[15px] text-muted-foreground max-w-2xl">
            We're starting with home cleaning in Latur and adding more as we grow.
          </p>
        </Reveal>

        <ServiceGroup
          eyebrow="Live today"
          title="On-Demand Home Cleaning"
          desc="Book a trained, verified Home Expert for cleaning work around the house."
          items={GROUP_LIVE}
          soon={false}
        />

        <div>
          <ServiceGroup
            eyebrow="Group 2"
            title="Home Services"
            desc="The everyday fixes and chores, handled by verified local professionals."
            items={GROUP_HOME}
            soon
          />
        </div>

        <div>
          <ServiceGroup
            eyebrow="Group 3"
            title="Shop Local"
            desc="Order from the shops around your neighbourhood, delivered to your door."
            items={GROUP_SHOP}
            soon
          />

          <Reveal delay={80}>
            <div className="mt-8 rounded-[24px] border border-primary/25 bg-primary-tint p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5 justify-between">
              <div>
                <h4 className="text-[18px] sm:text-[20px] font-bold text-foreground">
                  Don't see your service or shop yet?
                </h4>
                <p className="mt-1.5 text-[14px] text-muted-foreground max-w-xl">
                  We're expanding soon — show your interest and we'll notify you first.
                </p>
              </div>
              <button
                type="button"
                onClick={onShowInterest}
                className="shrink-0 inline-flex items-center gap-2 h-[52px] px-6 rounded-[14px] bg-primary text-primary-foreground font-bold text-[15px] hover:brightness-95 hover:-translate-y-0.5 transition"
              >
                Apply / Show Interest
                <ArrowRight size={18} />
              </button>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function ServiceGroup({
  eyebrow,
  title,
  desc,
  items,
  soon,
}: {
  eyebrow: string;
  title: string;
  desc: string;
  items: ServiceItem[];
  soon: boolean;
}) {
  return (
    <div>
      <Reveal>
        <div className="flex items-center gap-3 flex-wrap">
          <h3 className="text-[22px] sm:text-[26px] font-bold text-foreground">{title}</h3>
          {!soon && (
            <span className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full bg-primary text-primary-foreground text-[11px] font-bold uppercase tracking-wide">
              <BadgeCheck size={13} />
              {eyebrow}
            </span>
          )}
        </div>
        <p className="mt-2 text-[14px] text-muted-foreground max-w-2xl">{desc}</p>
      </Reveal>

      <div className="mt-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
        {items.map((item, i) => (
          <Reveal key={item.name} delay={Math.min(i, 6) * 55}>
            <div className="group relative h-full rounded-[18px] border border-border bg-background p-5 sm:p-6 overflow-hidden transition-all duration-200 hover:-translate-y-1 hover:border-primary/40 hover:shadow-[0_16px_32px_-18px_rgba(0,185,122,0.55)]">
              {soon && (
                <span className="absolute top-3 right-3 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-muted text-muted-foreground">
                  Coming Soon
                </span>
              )}
              <div className="w-12 h-12 rounded-[14px] bg-primary-tint text-primary flex items-center justify-center transition-transform duration-200 group-hover:scale-110">
                <item.icon size={24} strokeWidth={2.1} />
              </div>
              <p className="mt-4 text-[15px] font-bold text-foreground leading-snug">
                {item.name}
              </p>
              {item.name === "Local Businesses" && (
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Mobile, bakery, cloth shops and more
                </p>
              )}
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

/* --------------------------- HOW IT WORKS --------------------------- */

function HowItWorks() {
  const steps = [
    { icon: Clock, title: "Select Time Slot", desc: "Pick a 1, 2 or 4 hour slot that suits your day." },
    { icon: CreditCard, title: "Pay Online", desc: "Secure payment, no cash hassle." },
    { icon: UserCheck, title: "Expert Assigned", desc: "A verified pro heads your way." },
    { icon: Sparkles, title: "Service Done", desc: "Sit back and enjoy the results." },
  ];
  return (
    <section className="w-full bg-background">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-24">
        <Reveal>
          <div className="text-center max-w-2xl mx-auto">
            <p className="text-[12px] font-bold uppercase tracking-widest text-primary">How it works</p>
            <h2 className="mt-2 text-[28px] sm:text-[38px] font-bold text-foreground">
              Four simple steps
            </h2>
          </div>
        </Reveal>
        <div className="mt-14 relative">
          <div
            aria-hidden
            className="hidden lg:block absolute top-[44px] left-[12.5%] right-[12.5%] border-t-2 border-dashed border-primary/25 -z-0"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 relative">
            {steps.map((s, i) => (
              <Reveal key={s.title} delay={i * 90}>
                <div className="h-full bg-card rounded-[18px] border border-border p-6 text-center shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:shadow-[0_12px_28px_-12px_rgba(0,185,122,0.35)] hover:-translate-y-0.5 transition-all duration-200">
                  <div className="w-20 h-20 rounded-full bg-primary-tint text-primary flex items-center justify-center mx-auto mb-5 ring-4 ring-card">
                    <s.icon size={32} strokeWidth={2.25} />
                  </div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                    Step {i + 1}
                  </p>
                  <h3 className="mt-1 text-[17px] font-bold text-foreground">{s.title}</h3>
                  <p className="mt-2 text-[13px] text-muted-foreground">{s.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------- WHY BADIYOS --------------------------- */

function WhyBadiyos() {
  const smallCards = [
    {
      icon: ShieldCheck,
      title: "Verified KYC",
      desc: "Every expert completes Aadhaar & PAN verification before joining.",
    },
    {
      icon: Wallet,
      title: "Transparent Pricing",
      desc: "See the price up front. No hidden charges, no surprises.",
    },
    {
      icon: CalendarClock,
      title: "Time-Slot Flexibility",
      desc: "Choose 1, 2 or 4 hour slots that fit your day.",
    },
    {
      icon: Star,
      title: "Rate Every Visit",
      desc: "Share feedback after each service so quality keeps improving.",
    },
  ];
  return (
    <section id="why" className="w-full bg-card">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-24">
        <Reveal>
          <div className="text-center max-w-2xl mx-auto mb-12">
            <p className="text-[12px] font-bold uppercase tracking-widest text-primary">Why badiyos</p>
            <h2 className="mt-2 text-[28px] sm:text-[38px] font-bold text-foreground">
              Why Choose badiyos
            </h2>
          </div>
        </Reveal>

        <div className="grid lg:grid-cols-2 gap-6">
          <Reveal>
            <div className="h-full rounded-[24px] bg-primary text-white p-8 sm:p-10 flex flex-col justify-between min-h-[360px] relative overflow-hidden">
              <div
                aria-hidden
                className="absolute -right-16 -bottom-16 w-72 h-72 rounded-full bg-white/10 blur-2xl"
              />
              <div className="relative">
                <div className="w-14 h-14 rounded-full bg-white/15 flex items-center justify-center mb-6">
                  <ShieldCheck size={28} />
                </div>
                <h3 className="text-[26px] sm:text-[30px] font-bold leading-tight max-w-md">
                  Trusted, Verified Experts
                </h3>
                <p className="mt-4 text-white/85 text-[15px] max-w-md">
                  Every Home Expert on Badiyos goes through Aadhaar &amp; PAN KYC
                  and bank account verification before their first booking. Only
                  approved experts appear in your app.
                </p>
              </div>
              <p className="relative mt-8 text-[11px] uppercase tracking-widest text-white/60">
                [ Stats to be added post-launch ]
              </p>
            </div>
          </Reveal>

          <div className="grid sm:grid-cols-2 gap-4">
            {smallCards.map((c, i) => (
              <Reveal key={c.title} delay={i * 70}>
                <div className="h-full rounded-[18px] border border-border bg-background p-6 hover:-translate-y-1 hover:shadow-[0_12px_28px_-12px_rgba(0,185,122,0.35)] transition-all">
                  <div className="w-11 h-11 rounded-full bg-primary-tint text-primary flex items-center justify-center mb-4">
                    <c.icon size={22} strokeWidth={2.25} />
                  </div>
                  <h4 className="text-[15px] font-bold text-foreground">{c.title}</h4>
                  <p className="mt-1.5 text-[13px] text-muted-foreground leading-relaxed">
                    {c.desc}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------- FAQ ------------------------------- */

const FAQ_ITEMS: Array<{ q: string; a: string }> = [
  {
    q: "What is badiyos?",
    a: "Badiyos is a home-services app that connects you with verified Home Experts for everyday tasks like cleaning, dishwashing, laundry and bathroom cleaning. Book in the app, pay online, and a nearby expert is assigned to you.",
  },
  {
    q: "How do I book a service?",
    a: "The Badiyos app is launching shortly. Once it's live, you'll choose the service you need, pick a time slot that works for you, and complete the payment online. You'll get a confirmation as soon as an expert is assigned.",
  },
  {
    q: "What's included in a time slot?",
    a: "Badiyos offers 1 hour, 2 hour and 4 hour time slots. The expert works on your selected tasks for the duration you book — you can choose the slot length that best matches the size of the job.",
  },
  {
    q: "How are Home Experts verified?",
    a: "Every expert completes Aadhaar and PAN KYC and bank-account verification before onboarding. Only approved experts can accept bookings on the platform.",
  },
  {
    q: "Can I cancel or reschedule?",
    a: "Yes. You can cancel or reschedule a booking from the app before the expert has started. Cancellation rules and any applicable charges are shown at the time of cancellation.",
  },
  {
    q: "Which areas do you currently serve?",
    a: "We're just getting started in Latur. More cities and neighbourhoods will be added as we grow — leave your city with us and we'll tell you the day we reach you.",
  },
];

function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="w-full bg-background">
      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-20 sm:py-24">
        <Reveal>
          <div className="text-center mb-10">
            <p className="text-[12px] font-bold uppercase tracking-widest text-primary">FAQ</p>
            <h2 className="mt-2 text-[28px] sm:text-[38px] font-bold text-foreground">
              Frequently Asked Questions
            </h2>
            <p className="mt-3 text-[15px] text-muted-foreground">
              Everything you need to know about booking a Home Expert on Badiyos.
            </p>
          </div>
        </Reveal>

        <div className="space-y-3">
          {FAQ_ITEMS.map((item, i) => {
            const isOpen = open === i;
            return (
              <div
                key={item.q}
                className="rounded-[18px] border border-border bg-card overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="w-full flex items-center justify-between gap-4 text-left px-5 sm:px-6 py-4 sm:py-5"
                >
                  <span className="text-[15px] sm:text-[16px] font-bold text-foreground">
                    {item.q}
                  </span>
                  <ChevronDown
                    size={20}
                    className={`text-muted-foreground shrink-0 transition-transform ${
                      isOpen ? "rotate-180 text-primary" : ""
                    }`}
                  />
                </button>
                {isOpen && (
                  <div className="px-5 sm:px-6 pb-5 sm:pb-6 -mt-1 text-[14px] text-muted-foreground leading-relaxed">
                    {item.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="text-center mt-8">
          <a
            href="/support"
            className="inline-flex items-center gap-1 text-[13px] font-bold text-primary hover:underline"
          >
            View all FAQs <ArrowRight size={14} />
          </a>
        </div>
      </div>
    </section>
  );
}

/* ----------------------------- DOWNLOAD ----------------------------- */

function DownloadApp() {
  return (
    <section id="download" className="w-full bg-card">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-28">
        <Reveal>
          <div className="bg-foreground rounded-[24px] p-8 sm:p-14 text-center text-white">
            <img
              src={badiyosWhiteLogo.url}
              alt="Badiyos"
              className="h-8 w-auto mx-auto mb-5"
              loading="lazy"
            />
            <h2 className="text-[28px] sm:text-[36px] font-bold tracking-tight">
              The Badiyos app is on its way
            </h2>
            <p className="mt-3 text-[15px] sm:text-[16px] text-white/70 max-w-xl mx-auto">
              Book, pay, and track your home services — all in one place. We're putting
              the finishing touches on the Android app.
            </p>
            <div className="mt-8 flex items-center justify-center">
              <ComingSoonAppButton dark />
            </div>
            <p className="mt-4 text-[12px] text-white/50">
              Coming soon on Android. Chat with us on WhatsApp in the meantime.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
