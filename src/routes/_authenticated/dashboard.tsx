import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { getDashboardStats } from "@/lib/dashboard.functions";
import { LiveOrdersPanel } from "@/components/live-orders-panel";
import { ZonesPage } from "@/components/zones-page";
import { BookingsPage } from "@/components/bookings-page";
import { ExpertsPage } from "@/components/experts-page";
import { AreaPartnersPage } from "@/components/area-partners-page";
import { BookingDetailsModal } from "@/components/booking-details-modal";

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
  IndianRupee,
  Activity,
  CheckCircle2,
  Clock,
  Users,
  type LucideIcon,
} from "lucide-react";
import badiyoLogo from "@/assets/badiyo-green.png.asset.json";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Badiyo Command Center" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Shell,
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

type StaffRole = "super_admin" | "ops_manager" | "area_partner";

const ROLE_ALLOWED: Record<StaffRole, ReadonlyArray<NavKey>> = {
  super_admin: NAV_ITEMS.map((n) => n.key),
  ops_manager: NAV_ITEMS.map((n) => n.key).filter(
    (k) => k !== "roles" && k !== "catalogue",
  ),
  area_partner: ["dashboard", "bookings", "experts"],
};

function Shell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [active, setActive] = useState<NavKey>("dashboard");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const activeItem = NAV_ITEMS.find((n) => n.key === active)!;

  const { data: staff } = useQuery({
    queryKey: ["me", "staff"],
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return null;
      const { data } = await supabase
        .from("staff_users")
        .select("name, role")
        .eq("auth_user_id", userData.user.id)
        .maybeSingle();
      return data;
    },
    staleTime: 60_000,
  });

  const role = (staff?.role as StaffRole | undefined) ?? null;
  const allowedKeys = role ? ROLE_ALLOWED[role] : NAV_ITEMS.map((n) => n.key);
  const visibleItems = NAV_ITEMS.filter((n) => allowedKeys.includes(n.key));

  useEffect(() => {
    if (role && !allowedKeys.includes(active)) {
      setActive("dashboard");
    }
  }, [role, active, allowedKeys]);

  const name = staff?.name ?? "";
  const initials =
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]!.toUpperCase())
      .join("") || "•";

  async function handleLogout() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen w-full bg-background lg:pl-[240px]">
      {/* Sidebar */}
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
          {visibleItems.map((item) => {
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

      {mobileOpen && (
        <button
          aria-label="Close menu backdrop"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 bg-foreground/40 lg:hidden"
        />
      )}

      {/* Top bar */}
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
              {initials}
            </div>
            <span className="hidden sm:inline text-sm font-semibold text-foreground truncate max-w-[160px]">
              {name || "…"}
            </span>
          </div>
          <button
            onClick={handleLogout}
            aria-label="Log out"
            className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="min-h-[calc(100vh-4rem)] w-full p-6 sm:p-8">
        {active === "dashboard" ? (
          <DashboardHome />
        ) : active === "zones" ? (
          <ZonesPage role={role} />
        ) : active === "bookings" ? (
          <BookingsPage role={role} onSelect={(id) => setSelectedBookingId(id)} />
        ) : (
          <div className="flex min-h-[60vh] items-center justify-center">
            <p className="text-[15px] text-muted-foreground">Coming soon</p>
          </div>
        )}

      </main>

      {selectedBookingId && (
        <BookingDetailsModal
          bookingId={selectedBookingId}
          role={role}
          onClose={() => setSelectedBookingId(null)}
        />
      )}
    </div>
  );
}

function DashboardHome() {
  const fetchStats = useServerFn(getDashboardStats);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard", "stats"],
    queryFn: () => fetchStats(),
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });

  const inr = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });

  const cards: Array<{ label: string; value: string; icon: LucideIcon }> = [
    { label: "Today's Bookings", value: String(data?.todayBookings ?? 0), icon: CalendarCheck },
    { label: "Today's Revenue", value: inr.format(data?.todayRevenue ?? 0), icon: IndianRupee },
    { label: "Active Bookings", value: String(data?.activeBookings ?? 0), icon: Activity },
    { label: "Completed Today", value: String(data?.completedToday ?? 0), icon: CheckCircle2 },
    { label: "Pending Assignment", value: String(data?.pendingAssignment ?? 0), icon: Clock },
    { label: "Online Experts", value: String(data?.onlineExperts ?? 0), icon: Users },
  ];

  return (
    <div className="flex flex-col lg:flex-row gap-6 items-start">
      <div className="flex-1 min-w-0 space-y-6 w-full">
        {isError && (
          <p className="text-[14px] text-destructive">Failed to load stats. Retrying…</p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.label}
                className="bg-card border border-border rounded-[18px] p-6 flex items-start justify-between gap-4"
              >
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {card.label}
                  </p>
                  <p className="mt-3 text-[32px] leading-none font-bold text-foreground truncate">
                    {isLoading && !data ? "—" : card.value}
                  </p>
                </div>
                <div className="w-10 h-10 rounded-full bg-primary-tint text-primary flex items-center justify-center shrink-0">
                  <Icon size={20} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <LiveOrdersPanel />
    </div>
  );
}
