import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, Play } from "lucide-react";
import badiyoLogo from "@/assets/badiyo-green.png.asset.json";

export function MarketingShell({ children }: { children: ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="min-h-screen w-full bg-background flex flex-col">
      <header
        className={`sticky top-0 z-40 w-full bg-card/90 backdrop-blur border-b border-border transition-shadow ${
          scrolled ? "shadow-[0_4px_18px_-8px_rgba(0,0,0,0.12)]" : ""
        }`}
      >
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center shrink-0">
            <img src={badiyoLogo.url} alt="Badiyo" className="h-7 w-auto" />
          </Link>

          <nav className="hidden md:flex items-center gap-1 text-[14px] font-semibold">
            <div
              className="relative"
              onMouseEnter={() => setServicesOpen(true)}
              onMouseLeave={() => setServicesOpen(false)}
            >
              <button
                type="button"
                className="px-3 py-2 rounded-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors inline-flex items-center gap-1"
              >
                Services
                <ChevronDown size={14} />
              </button>
              {servicesOpen && (
                <div className="absolute left-0 top-full pt-2 w-[220px]">
                  <div className="bg-card border border-border rounded-[14px] shadow-lg p-2">
                    {["Cleaning", "Dishwashing", "Laundry", "Bathroom Cleaning"].map((s) => (
                      <a
                        key={s}
                        href="#services"
                        className="block px-3 py-2 rounded-[10px] text-[13px] text-foreground hover:bg-muted"
                      >
                        {s}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <a
              href="#why"
              className="px-3 py-2 rounded-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              About
            </a>
            <a
              href="#faq"
              className="px-3 py-2 rounded-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              FAQ
            </a>
          </nav>

          <a
            href="#download"
            className="inline-flex items-center gap-2 h-10 px-4 sm:px-5 rounded-full bg-primary text-white font-bold text-[13px] sm:text-[14px] hover:brightness-95 transition"
          >
            <Play size={16} />
            Get the App
          </a>
        </div>
      </header>
      <main className="flex-1 w-full">{children}</main>
      <MarketingFooter />
    </div>
  );
}

function MarketingFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border bg-card">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <img src={badiyoLogo.url} alt="Badiyo" className="h-7 w-auto mb-3" />
          <p className="text-[13px] text-muted-foreground max-w-[240px]">
            हर घर का अपना साथी.
          </p>
        </div>
        <FooterCol title="Company">
          <Link to="/support" className="hover:text-foreground">About & Support</Link>
        </FooterCol>
        <FooterCol title="Partner with us">
          <Link to="/join-area-partner" className="hover:text-foreground">Join as Area Partner</Link>
          <Link to="/join-expert" className="hover:text-foreground">Join as Expert</Link>
        </FooterCol>
        <FooterCol title="Help">
          <Link to="/support" className="hover:text-foreground">Contact support</Link>
        </FooterCol>
      </div>
      <div className="border-t border-border">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-4 text-[12px] text-muted-foreground text-center">
          © {year} Badiyo. All rights reserved.
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wider text-foreground mb-3">
        {title}
      </p>
      <div className="flex flex-col gap-2 text-[13px] text-muted-foreground">{children}</div>
    </div>
  );
}
