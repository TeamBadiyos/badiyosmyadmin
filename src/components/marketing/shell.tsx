import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import badiyoLogo from "@/assets/badiyo-green.png.asset.json";

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-background flex flex-col">
      <header className="w-full border-b border-border bg-card/80 backdrop-blur">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center">
            <img src={badiyoLogo.url} alt="Badiyo" className="h-7 w-auto" />
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2 text-[13px] sm:text-[14px] font-semibold">
            <NavLink to="/join-area-partner">Area Partner</NavLink>
            <NavLink to="/join-expert">Join as Expert</NavLink>
            <NavLink to="/support">Support</NavLink>
          </nav>
        </div>
      </header>
      <main className="flex-1 w-full">{children}</main>
      <MarketingFooter />
    </div>
  );
}

function NavLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="px-3 py-2 rounded-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      activeProps={{ className: "px-3 py-2 rounded-[10px] text-foreground bg-primary-tint" }}
    >
      {children}
    </Link>
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
            हर घर का अपना साथी. Home services, done right.
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
