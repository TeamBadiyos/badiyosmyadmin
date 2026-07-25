import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  LayoutDashboard,
  CalendarCheck,
  Map,
  UserCog,
  Handshake,
  BookOpen,
  LayoutTemplate,
  Wallet,
  Gift,
  ShieldCheck,
  BarChart3,
  ScrollText,
  LogOut,
  Menu,
  X,

} from "lucide-react";
import badiyoLogo from "@/assets/badiyo-green.png.asset.json";

export const Route = createFileRoute("/")({
  component: Index,
});

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "bookings", label: "Bookings", icon: CalendarCheck },
  { key: "zones", label: "Zones", icon: Map },
  { key: "experts", label: "Experts", icon: UserCog },
  { key: "partners", label: "Area Partners", icon: Handshake },
  { key: "catalogue", label: "Service Catalogue", icon: BookOpen },
  { key: "homepage", label: "Homepage Builder", icon: LayoutTemplate },
  { key: "wallets", label: "Wallets & Payouts", icon: Wallet },
  { key: "referrals", label: "Referrals", icon: Gift },
  { key: "roles", label: "Roles & Permissions", icon: ShieldCheck },
  { key: "reports", label: "Reports", icon: BarChart3 },
  { key: "audit", label: "Audit Logs", icon: ScrollText },
] as const;

type NavKey = (typeof NAV_ITEMS)[number]["key"];

function Index() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [active, setActive] = useState<NavKey>("dashboard");

  if (!loggedIn) return <Login onSubmit={() => setLoggedIn(true)} />;
  return <Shell active={active} setActive={setActive} onLogout={() => setLoggedIn(false)} />;
}

function Login({ onSubmit }: { onSubmit: () => void }) {
  return (
    <main className="min-h-screen w-full bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-[420px] bg-card rounded-[18px] border border-border p-8 sm:p-10">
        <div className="flex justify-center mb-8">
          <img src={badiyoLogo.url} alt="Badiyo" className="h-10 w-auto" />
        </div>
        <h1 className="text-[22px] font-bold text-foreground text-center">Welcome back</h1>
        <p className="text-sm text-muted-foreground text-center mt-1">Sign in to the Command Center</p>

        <form
          className="mt-8 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <Field label="Email" type="email" placeholder="you@badiyo.com" />
          <Field label="Password" type="password" placeholder="••••••••" />

          <button
            type="submit"
            className="w-full h-[52px] rounded-[14px] bg-primary text-primary-foreground font-bold text-[15px] transition-opacity hover:opacity-90"
          >
            Log In
          </button>

          <p className="hidden text-sm text-destructive text-center" role="alert">
            Invalid email or password
          </p>
        </form>
      </div>
    </main>
  );
}

function Field({
  label,
  type,
  placeholder,
}: {
  label: string;
  type: string;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="block text-[13px] font-semibold text-foreground mb-2">{label}</span>
      <input
        type={type}
        placeholder={placeholder}
        className="w-full h-[52px] px-4 rounded-[14px] border border-border bg-card text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
      />
    </label>
  );
}

function Shell({
  active,
  setActive,
  onLogout,
}: {
  active: NavKey;
  setActive: (k: NavKey) => void;
  onLogout: () => void;
}) {
  const activeItem = NAV_ITEMS.find((n) => n.key === active)!;
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen w-full bg-background lg:pl-[240px]">
      {/* Sidebar — fixed on desktop, off-canvas drawer on mobile */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[240px] bg-card border-r border-border flex flex-col transition-transform duration-200 lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="h-16 flex items-center justify-between px-6 border-b border-border">
          <img src={badiyoLogo.url} alt="Badiyo" className="h-7 w-auto" />
          <button
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
            className="lg:hidden text-muted-foreground hover:text-foreground"
          >
            <X size={20} />
          </button>
        </div>
        <nav className="flex-1 py-4 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = item.key === active;
            return (
              <button
                key={item.key}
                onClick={() => {
                  setActive(item.key);
                  setMobileOpen(false);
                }}
                className={`w-full flex items-center gap-3 pl-5 pr-4 py-2.5 text-[14px] font-medium transition-colors border-l-[3px] ${
                  isActive
                    ? "border-primary bg-primary-tint text-foreground font-semibold"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <Icon
                  size={18}
                  strokeWidth={isActive ? 2.25 : 2}
                  className={isActive ? "text-primary" : ""}
                />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <button
          aria-label="Close menu backdrop"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 bg-foreground/40 lg:hidden"
        />
      )}

      {/* Top bar — full width next to sidebar */}
      <header className="sticky top-0 z-20 h-16 bg-card border-b border-border grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="lg:hidden text-muted-foreground hover:text-foreground shrink-0"
          >
            <Menu size={22} />
          </button>
          <h1 className="truncate text-[18px] font-bold text-foreground">
            {activeItem.label}
          </h1>
        </div>
        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center font-bold text-sm shrink-0">
              AD
            </div>
            <span className="hidden sm:inline text-sm font-semibold text-foreground">
              Admin User
            </span>
          </div>
          <button
            onClick={onLogout}
            aria-label="Log out"
            className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* Content — full remaining width */}
      <main className="min-h-[calc(100vh-4rem)] w-full p-6 sm:p-8">
        <div className="flex min-h-[60vh] items-center justify-center">
          <p className="text-[15px] text-muted-foreground">Coming soon</p>
        </div>
      </main>
    </div>
  );
}

