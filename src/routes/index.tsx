import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Clock,
  CreditCard,
  UserCheck,
  Sparkles,
  Play,
  BadgeCheck,
  ShieldCheck,
  Wallet,
  CalendarClock,
  Star,
  ChevronDown,
  MapPin,
  ArrowRight,
} from "lucide-react";
import { MarketingShell } from "@/components/marketing/shell";
import expertGreeting from "@/assets/expert-greeting.png.asset.json";
import badiyosWhiteLogo from "@/assets/badiyos-wordmark-white.png.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Badiyos — हर घर का अपना साथी" },
      {
        name: "description",
        content:
          "Badiyos brings trusted home services to your doorstep. Book a verified home expert in minutes — cleaning, dishwashing, laundry and more.",
      },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "Badiyos — हर घर का अपना साथी" },
      {
        property: "og:description",
        content:
          "Badiyos brings trusted home services to your doorstep. Book a verified home expert in minutes — cleaning, dishwashing, laundry and more.",
      },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  return (
    <MarketingShell>
      <Hero />
      <Services />
      <HowItWorks />
      <WhyBadiyos />
      <FAQ />
      <DownloadApp />
    </MarketingShell>
  );
}

function Hero() {
  return (
    <section className="w-full bg-background">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 pt-14 sm:pt-20 pb-20 sm:pb-24">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left */}
          <div className="text-center lg:text-left">
            <span className="inline-flex items-center gap-2 h-8 px-3 rounded-full bg-primary-tint text-primary text-[12px] font-bold">
              <MapPin size={13} />
              Now in Latur
            </span>
            <h1 className="mt-5 text-[42px] sm:text-[60px] lg:text-[68px] leading-[0.98] font-bold text-foreground tracking-tight">
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
            <p className="mt-6 text-[16px] sm:text-[18px] text-muted-foreground max-w-xl mx-auto lg:mx-0">
              Book verified home experts in minutes. Pick a time slot, pay online,
              and relax while the pros handle the rest.
            </p>

            <div className="mt-6 flex flex-wrap justify-center lg:justify-start gap-2">
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

            <div className="mt-8 flex justify-center lg:justify-start">
              <PlayStoreButton href="#" variant="light" />
            </div>
          </div>

          {/* Right */}
          <div className="relative flex justify-center lg:justify-end">
            <div
              aria-hidden
              className="absolute inset-0 -z-0 flex items-center justify-center pointer-events-none"
            >
              <div
                className="w-[85%] aspect-square rounded-full blur-3xl"
                style={{
                  background:
                    "radial-gradient(circle at 50% 50%, rgba(0,185,122,0.35), rgba(0,185,122,0) 65%)",
                }}
              />
            </div>
            <div className="relative w-full max-w-[520px]">
              <img
                src={expertGreeting.url}
                alt="A Badiyos home expert in uniform greeting with a namaste"
                className="w-full h-auto rounded-[24px] shadow-[0_20px_60px_-20px_rgba(0,185,122,0.35)] object-cover"
                loading="eager"
              />
              {/* Floating card */}
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
    </section>
  );
}

const SERVICES = [
  "Dishwashing",
  "Kitchen Cleaning",
  "Fan Cleaning",
  "Window Cleaning",
  "Laundry Help",
  "Bathroom Cleaning",
];

function Services() {
  return (
    <section id="services" className="w-full bg-card">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-24">
        <div className="flex items-end justify-between gap-6 mb-10">
          <div>
            <p className="text-[12px] font-bold uppercase tracking-widest text-primary">
              Services
            </p>
            <h2 className="mt-2 text-[28px] sm:text-[38px] font-bold text-foreground max-w-xl leading-tight">
              What can your Home Expert do?
            </h2>
          </div>
          <a
            href="#download"
            className="hidden sm:inline-flex items-center gap-1 text-[13px] font-bold text-primary hover:underline"
          >
            View all <ArrowRight size={14} />
          </a>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 sm:gap-5">
          {SERVICES.map((name) => (
            <div
              key={name}
              className="relative aspect-square rounded-[18px] overflow-hidden bg-primary"
            >
              {/* Placeholder */}
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
                <span className="text-white/80 text-[11px] font-semibold uppercase tracking-wider">
                  Image placeholder
                </span>
                <span className="text-white/60 text-[11px] mt-1">400 × 400px</span>
              </div>
              {/* Bottom gradient + label */}
              <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent" />
              <p className="absolute left-4 bottom-4 right-4 text-white text-[15px] sm:text-[17px] font-bold">
                {name}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

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
        <div className="text-center max-w-2xl mx-auto">
          <p className="text-[12px] font-bold uppercase tracking-widest text-primary">How it works</p>
          <h2 className="mt-2 text-[28px] sm:text-[38px] font-bold text-foreground">
            Four simple steps
          </h2>
        </div>
        <div className="mt-14 relative">
          <div
            aria-hidden
            className="hidden lg:block absolute top-[44px] left-[12.5%] right-[12.5%] border-t-2 border-dashed border-primary/25 -z-0"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 relative">
            {steps.map((s, i) => (
              <div
                key={s.title}
                className="bg-card rounded-[18px] border border-border p-6 text-center shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:shadow-[0_12px_28px_-12px_rgba(0,185,122,0.35)] hover:-translate-y-0.5 transition-all duration-200"
              >
                <div className="w-20 h-20 rounded-full bg-primary-tint text-primary flex items-center justify-center mx-auto mb-5 ring-4 ring-card">
                  <s.icon size={32} strokeWidth={2.25} />
                </div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  Step {i + 1}
                </p>
                <h3 className="mt-1 text-[17px] font-bold text-foreground">{s.title}</h3>
                <p className="mt-2 text-[13px] text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

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
        <div className="text-center max-w-2xl mx-auto mb-12">
          <p className="text-[12px] font-bold uppercase tracking-widest text-primary">Why badiyos</p>
          <h2 className="mt-2 text-[28px] sm:text-[38px] font-bold text-foreground">
            Why Choose badiyos
          </h2>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Large feature card */}
          <div className="rounded-[24px] bg-primary text-white p-8 sm:p-10 flex flex-col justify-between min-h-[360px] relative overflow-hidden">
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

          {/* Small cards */}
          <div className="grid sm:grid-cols-2 gap-4">
            {smallCards.map((c) => (
              <div
                key={c.title}
                className="rounded-[18px] border border-border bg-background p-6 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-12px_rgba(0,185,122,0.35)] transition-all"
              >
                <div className="w-11 h-11 rounded-full bg-primary-tint text-primary flex items-center justify-center mb-4">
                  <c.icon size={22} strokeWidth={2.25} />
                </div>
                <h4 className="text-[15px] font-bold text-foreground">{c.title}</h4>
                <p className="mt-1.5 text-[13px] text-muted-foreground leading-relaxed">
                  {c.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

const FAQ_ITEMS: Array<{ q: string; a: string }> = [
  {
    q: "What is badiyos?",
    a: "Badiyos is a home-services app that connects you with verified Home Experts for everyday tasks like cleaning, dishwashing, laundry and bathroom cleaning. Book in the app, pay online, and a nearby expert is assigned to you.",
  },
  {
    q: "How do I book a service?",
    a: "Download the Badiyos Android app, choose the service you need, pick a time slot that works for you, and complete the payment online. You'll get a confirmation once an expert is assigned.",
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
    a: "We're just getting started in Latur. More cities and neighbourhoods will be added as we grow — turn on notifications in the app to know when Badiyos launches near you.",
  },
];

function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="w-full bg-background">
      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-20 sm:py-24">
        <div className="text-center mb-10">
          <p className="text-[12px] font-bold uppercase tracking-widest text-primary">FAQ</p>
          <h2 className="mt-2 text-[28px] sm:text-[38px] font-bold text-foreground">
            Frequently Asked Questions
          </h2>
          <p className="mt-3 text-[15px] text-muted-foreground">
            Everything you need to know about booking a Home Expert on Badiyos.
          </p>
        </div>

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

function DownloadApp() {
  return (
    <section id="download" className="w-full bg-card">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-28">
        <div className="bg-foreground rounded-[24px] p-8 sm:p-14 text-center text-white">
          <img
            src={badiyosWhiteLogo.url}
            alt="Badiyos"
            className="h-8 w-auto mx-auto mb-5"
          />
          <h2 className="text-[28px] sm:text-[36px] font-bold tracking-tight">
            Get the Badiyos app
          </h2>
          <p className="mt-3 text-[15px] sm:text-[16px] text-white/70 max-w-xl mx-auto">
            Book, pay, and track your home services — all in one place.
          </p>
          <div className="mt-8 flex items-center justify-center">
            <PlayStoreButton href="#" variant="dark" />
          </div>
          <p className="mt-4 text-[12px] text-white/50">Available on Android.</p>
        </div>
      </div>
    </section>
  );
}

function PlayStoreButton({
  href,
  variant = "dark",
}: {
  href: string;
  variant?: "dark" | "light";
}) {
  const styles =
    variant === "dark"
      ? "bg-white/10 hover:bg-white/15 border-white/15 text-white"
      : "bg-foreground hover:brightness-110 border-foreground text-white";
  return (
    <a
      href={href}
      className={`inline-flex items-center gap-3 h-[56px] px-6 rounded-[14px] border transition ${styles}`}
    >
      <Play size={22} />
      <span className="text-left leading-tight">
        <span className="block text-[10px] uppercase tracking-widest opacity-70">Get it on</span>
        <span className="block text-[15px] font-bold">Google Play</span>
      </span>
    </a>
  );
}
