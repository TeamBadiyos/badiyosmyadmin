import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Clock,
  CreditCard,
  UserCheck,
  Sparkles,
  Apple,
  Play,
} from "lucide-react";
import badiyoLogo from "@/assets/badiyo-green.png.asset.json";
import { MarketingShell } from "@/components/marketing/shell";

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
      <HowItWorks />
      <DownloadApp />
    </MarketingShell>
  );
}

function Hero() {
  return (
    <section className="w-full">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 pt-16 sm:pt-24 pb-16 sm:pb-20 text-center">
        <img src={badiyoLogo.url} alt="Badiyo" className="h-12 sm:h-14 w-auto mx-auto mb-8" />
        <p className="text-[15px] font-semibold text-primary mb-4 tracking-wide">
          हर घर का अपना साथी
        </p>
        <h1 className="text-[36px] sm:text-[56px] leading-[1.05] font-bold text-foreground tracking-tight max-w-3xl mx-auto">
          Trusted home services, done right.
        </h1>
        <p className="mt-6 text-[16px] sm:text-[18px] text-muted-foreground max-w-xl mx-auto">
          Book verified home experts in minutes. Pay online, relax while the pros handle the rest.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
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
    <section className="w-full bg-card border-y border-border">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-20">
        <div className="text-center max-w-2xl mx-auto">
          <p className="text-[12px] font-bold uppercase tracking-widest text-primary">How it works</p>
          <h2 className="mt-2 text-[28px] sm:text-[36px] font-bold text-foreground">
            Four simple steps
          </h2>
        </div>
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {steps.map((s, i) => (
            <div
              key={s.title}
              className="bg-background rounded-[18px] border border-border p-6 text-center"
            >
              <div className="w-14 h-14 rounded-full bg-primary-tint text-primary flex items-center justify-center mx-auto mb-4">
                <s.icon size={26} strokeWidth={2.25} />
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
    </section>
  );
}

function DownloadApp() {
  return (
    <section id="download" className="w-full">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-24">
        <div className="bg-foreground rounded-[24px] p-8 sm:p-14 text-center text-white">
          <h2 className="text-[28px] sm:text-[36px] font-bold tracking-tight">
            Get the Badiyo app
          </h2>
          <p className="mt-3 text-[15px] sm:text-[16px] text-white/70 max-w-xl mx-auto">
            Book, pay, and track your home services — all in one place.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <StoreBadge
              icon={<Apple size={22} />}
              label="Download on the"
              store="App Store"
              href="#"
            />
            <StoreBadge
              icon={<Play size={22} />}
              label="Get it on"
              store="Google Play"
              href="#"
            />
          </div>
          <p className="mt-4 text-[12px] text-white/50">Coming soon to iOS and Android.</p>
        </div>
      </div>
    </section>
  );
}

function StoreBadge({
  icon,
  label,
  store,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  store: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-3 h-[56px] px-5 rounded-[14px] bg-white/10 hover:bg-white/15 border border-white/15 transition"
    >
      <span className="text-white">{icon}</span>
      <span className="text-left leading-tight">
        <span className="block text-[10px] uppercase tracking-widest text-white/70">
          {label}
        </span>
        <span className="block text-[15px] font-bold text-white">{store}</span>
      </span>
    </a>
  );
}
