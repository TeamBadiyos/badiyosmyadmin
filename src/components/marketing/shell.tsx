import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, MessageCircle } from "lucide-react";
import badiyoLogo from "@/assets/badiyos-wordmark-green.png.asset.json";
import { LEGAL_ENTITY_NAME, whatsappLink } from "@/lib/brand";

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
            <img src={badiyoLogo.url} alt="Badiyos" className="h-7 w-auto" />
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
                <div className="absolute left-0 top-full pt-2 w-[240px]">
                  <div className="bg-card border border-border rounded-[14px] shadow-lg p-2">
                    {[
                      { label: "Home Cleaning", soon: false },
                      { label: "Home Services", soon: true },
                      { label: "Shop Local", soon: true },
                    ].map((s) => (
                      <a
                        key={s.label}
                        href="#services"
                        className="flex items-center justify-between gap-2 px-3 py-2 rounded-[10px] text-[13px] text-foreground hover:bg-muted"
                      >
                        {s.label}
                        {s.soon && (
                          <span className="text-[10px] font-bold uppercase tracking-wide text-primary">
                            Soon
                          </span>
                        )}
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
            <Link
              to="/join-merchant"
              className="px-3 py-2 rounded-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              For Business
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            <a
              href={whatsappLink()}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Chat with Badiyos on WhatsApp"
              className="hidden sm:inline-flex items-center justify-center h-10 w-10 rounded-full border border-border text-primary hover:bg-primary-tint transition"
            >
              <MessageCircle size={18} />
            </a>
            <ComingSoonAppButton />
          </div>
        </div>
      </header>
      <main className="flex-1 w-full">{children}</main>
      <MarketingFooter />
      <WhatsAppFab />
    </div>
  );
}

export function ComingSoonAppButton({ dark = false }: { dark?: boolean }) {
  return (
    <span
      aria-disabled="true"
      title="The Badiyos app is not on the Play Store yet"
      className={`inline-flex items-center gap-2 h-10 px-4 sm:px-5 rounded-full font-bold text-[13px] sm:text-[14px] cursor-not-allowed select-none ${
        dark
          ? "bg-white/10 text-white/60 border border-white/15"
          : "bg-muted text-muted-foreground border border-border"
      }`}
    >
      App — Coming Soon
    </span>
  );
}

function WhatsAppFab() {
  return (
    <a
      href={whatsappLink()}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with Badiyos on WhatsApp"
      className="fixed bottom-5 right-5 z-50 inline-flex items-center gap-2 px-4 py-3 rounded-full bg-primary text-primary-foreground shadow-[0_12px_28px_-10px_rgba(0,185,122,0.7)] hover:brightness-95 hover:-translate-y-0.5 transition"
    >
      <MessageCircle size={20} />
      <span className="hidden sm:inline text-[14px] font-bold">Chat with us</span>
    </a>
  );
}

function MarketingFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border bg-card">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <img src={badiyoLogo.url} alt="Badiyos" className="h-7 w-auto mb-3" />
          <p className="text-[13px] text-muted-foreground max-w-[240px]">
            हर घर का अपना साथी.
          </p>
          <p className="mt-3 text-[12px] text-muted-foreground max-w-[240px]">
            {LEGAL_ENTITY_NAME}
            {/* TODO: add CIN (company registration number) here once available. */}
          </p>
        </div>
        <FooterCol title="Company">
          <Link to="/support" className="hover:text-foreground">About & Support</Link>
        </FooterCol>
        <FooterCol title="Partner with us">
          <Link to="/join-area-partner" className="hover:text-foreground">Join as Area Partner</Link>
          <Link to="/join-expert" className="hover:text-foreground">Join as Expert</Link>
          <Link to="/join-merchant" className="hover:text-foreground">Join as Merchant</Link>
        </FooterCol>
        <FooterCol title="Help">
          <Link to="/support" className="hover:text-foreground">Contact support</Link>
          <a href={whatsappLink()} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
            WhatsApp us
          </a>
        </FooterCol>
        <FooterCol title="Legal">
          <Link to="/privacy-policy" className="hover:text-foreground">Privacy Policy</Link>
          <Link to="/terms" className="hover:text-foreground">Terms &amp; Conditions</Link>
          <Link to="/refund-policy" className="hover:text-foreground">Refund &amp; Cancellation Policy</Link>
          <Link to="/shipping-policy" className="hover:text-foreground">Shipping &amp; Delivery Policy</Link>
        </FooterCol>
      </div>
      <div className="border-t border-border">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-4 text-[12px] text-muted-foreground text-center">
          © {year} {LEGAL_ENTITY_NAME}. All rights reserved.
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
