import { createFileRoute, Link } from "@tanstack/react-router";
import { Clock, CreditCard, UserCheck, Sparkles, Play } from "lucide-react";
import { MarketingShell } from "@/components/marketing/shell";
import expertGreeting from "@/assets/expert-greeting.png.asset.json";
import houseHelpBanner from "@/assets/house-help-banner.png.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Badiyo — हर घर का अपना साथी" },
      {
        name: "description",
        content:
          "Badiyo brings trusted home services to your doorstep. Book a home expert in minutes — cleaning, care and more, delivered by verified professionals.",
      },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "Badiyo — हर घर का अपना साथी" },
      {
        property: "og:description",
        content: "Trusted home services, delivered by verified experts. Book in minutes on the Badiyo app.",
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
      <ServiceBanner />
      <HowItWorks />
      <DownloadApp />
    </MarketingShell>
  );
}

function Hero() {
  return (
    <section className="w-full bg-background">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 pt-16 sm:pt-24 pb-20 sm:pb-28">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left */}
          <div className="text-center lg:text-left">
            <p className="text-[15px] font-semibold text-primary mb-4 tracking-wide">
              हर घर का अपना साथी
            </p>
            <h1 className="text-[40px] sm:text-[56px] lg:text-[64px] leading-[1.02] font-bold text-foreground tracking-tight">
              Trusted home services, done right.
            </h1>
            <p className="mt-6 text-[16px] sm:text-[18px] text-muted-foreground max-w-xl mx-auto lg:mx-0">
              Book verified home experts in minutes. Pay online, relax while the pros handle the rest.
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center lg:justify-start gap-3">
              <a
                href="#download"
                className="h-[52px] px-6 inline-flex items-center justify-center rounded-[14px] bg-primary text-white font-bold text-[15px] hover:brightness-95 transition"
              >
                Download the app
              </a>
              <Link
                to="/support"
                className="h-[52px] px-6 inline-flex items-center justify-center rounded-[14px] border border-border bg-card text-foreground font-semibold text-[15px] hover:bg-muted transition"
              >
                Talk to us
              </Link>
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
                alt="A Badiyo home expert in uniform greeting with a namaste"
                className="w-full h-auto rounded-[24px] shadow-[0_20px_60px_-20px_rgba(0,185,122,0.35)] object-cover"
                loading="eager"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ServiceBanner() {
  return (
    <section className="w-full bg-card">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-24">
        <img
          src={houseHelpBanner.url}
          alt="Badiyo House Help in 30 minutes"
          className="w-full h-auto rounded-[18px] object-cover"
          loading="lazy"
        />
        <p className="mt-6 text-center text-[15px] sm:text-[17px] text-muted-foreground max-w-2xl mx-auto">
          Quick, verified help for everyday home tasks — cleaning, cooking, care and more.
        </p>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { icon: Clock, title: "Select Time Slot", desc: "Pick a slot that suits your day." },
    { icon: CreditCard, title: "Pay Online", desc: "Secure payment, no cash hassle." },
    { icon: UserCheck, title: "Expert Assigned", desc: "A verified pro heads your way." },
    { icon: Sparkles, title: "Service Done", desc: "Sit back and enjoy the results." },
  ];
  return (
    <section className="w-full bg-background">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-24">
        <div className="text-center max-w-2xl mx-auto">
          <p className="text-[12px] font-bold uppercase tracking-widest text-primary">How it works</p>
          <h2 className="mt-2 text-[28px] sm:text-[36px] font-bold text-foreground">
            Four simple steps
          </h2>
        </div>
        <div className="mt-14 relative">
          {/* Dashed connector — desktop only */}
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

function DownloadApp() {
  return (
    <section id="download" className="w-full bg-card">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-28">
        <div className="bg-foreground rounded-[24px] p-8 sm:p-14 text-center text-white">
          <h2 className="text-[28px] sm:text-[36px] font-bold tracking-tight">
            Get the Badiyo app
          </h2>
          <p className="mt-3 text-[15px] sm:text-[16px] text-white/70 max-w-xl mx-auto">
            Book, pay, and track your home services — all in one place.
          </p>
          <div className="mt-8 flex items-center justify-center">
            <PlayStoreButton href="#" />
          </div>
          <p className="mt-4 text-[12px] text-white/50">Available on Android.</p>
        </div>
      </div>
    </section>
  );
}

function PlayStoreButton({ href }: { href: string }) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-3 h-[56px] px-6 rounded-[14px] bg-white/10 hover:bg-white/15 border border-white/15 transition"
    >
      <span className="text-white">
        <Play size={22} />
      </span>
      <span className="text-left leading-tight">
        <span className="block text-[10px] uppercase tracking-widest text-white/70">Get it on</span>
        <span className="block text-[15px] font-bold text-white">Google Play</span>
      </span>
    </a>
  );
}
