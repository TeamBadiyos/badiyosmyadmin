import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { getDashboardStats } from "@/lib/dashboard.functions";
import { PipelineKanban } from "@/components/pipeline-kanban";
import { CommerceKanban } from "@/components/commerce-kanban";

import { ZonesPage } from "@/components/zones-page";
import { BookingsPage } from "@/components/bookings-page";
import { ExpertsPage } from "@/components/experts-page";
import { AreaPartnersPage } from "@/components/area-partners-page";
import { BookingDetailsModal } from "@/components/booking-details-modal";
import { ServiceCataloguePage } from "@/components/service-catalogue-page";
import { HomepageBuilderPage } from "@/components/homepage-builder-page";
import { WalletsPage } from "@/components/wallets-page";
import { ReferralsPage } from "@/components/referrals-page";
import { RolesPage } from "@/components/roles-page";
import { AuditLogsPage } from "@/components/audit-logs-page";
import { ReportsPage } from "@/components/reports-page";
import { EmergencyAlertsPage } from "@/components/emergency-alerts-page";
import { SkillApprovalsPage } from "@/components/skill-approvals-page";
import { InterestLeadsPage } from "@/components/interest-leads-page";
import { WaitlistPage } from "@/components/waitlist-page";
import { MerchantApprovalsPage } from "@/components/merchant-approvals-page";
import { MerchantBillingPage } from "@/components/merchant-billing-page";
import { LegalPagesPage } from "@/components/legal-pages-page";
import { TaskDetailsPage } from "@/components/task-details-page";
import { NotificationSoundsPage } from "@/components/notification-sounds-page";


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
  Siren,
  BadgeCheck,
  ListChecks,
  Store,
  Receipt,
  Scale,
  Settings,
  ChevronDown,
  LogOut,
  Menu,
  X,
  IndianRupee,
  Activity,
  CheckCircle2,
  Clock,
  Users,
  Sprout,
  Volume2,
  TrendingUp,
  Boxes,
  Landmark,
  type LucideIcon,
} from "lucide-react";
import badiyoLogo from "@/assets/badiyos-wordmark-green.png.asset.json";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Badiyos Command Center" },
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
  { key: "skills", label: "Skill Approvals", icon: BadgeCheck },
  { key: "merchants", label: "Merchant Approvals", icon: Store },
  { key: "merchant-billing", label: "Merchant Billing", icon: Receipt },
  { key: "waitlist", label: "Waitlist", icon: ListChecks },
  { key: "interest-leads", label: "Business Interest", icon: Sprout },

  { key: "emergency", label: "Emergency Alerts", icon: Siren },
  { key: "catalogue", label: "Service Catalogue", icon: BookOpen },
  { key: "homepage", label: "Homepage Builder", icon: LayoutTemplate },
  { key: "wallets", label: "Wallets & Payouts", icon: Wallet },
  { key: "referrals", label: "Referrals", icon: Gift },
  { key: "roles", label: "Roles & Permissions", icon: ShieldCheck },
  { key: "reports", label: "Reports", icon: BarChart3 },
  { key: "legal", label: "Legal", icon: Scale },
  { key: "task-details", label: "Task Details", icon: ListChecks },
  { key: "notification-sounds", label: "Notification Sounds", icon: Volume2 },
  { key: "audit", label: "Audit Logs", icon: ScrollText },
] as const;

type NavKey = (typeof NAV_ITEMS)[number]["key"];

const NAV_GROUPS = [
  {
    id: "partners",
    label: "Partners & Merchants",
    icon: Users,
    keys: ["experts", "partners", "skills", "merchants", "merchant-billing"],
  },
  {
    id: "growth",
    label: "Growth",
    icon: TrendingUp,
    keys: ["waitlist", "interest-leads", "referrals"],
  },
  {
    id: "catalog",
    label: "Catalog",
    icon: Boxes,
    keys: ["zones", "catalogue", "homepage"],
  },
  {
    id: "finance",
    label: "Finance & Reports",
    icon: Landmark,
    keys: ["wallets", "reports"],
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    keys: ["roles", "legal", "task-details", "notification-sounds", "audit"],
  },
] as const;

const GROUPED_KEYS: ReadonlyArray<string> = NAV_GROUPS.flatMap((g) => g.keys as ReadonlyArray<string>);

type StaffRole = "super_admin" | "ops_manager" | "area_partner";

const ROLE_ALLOWED: Record<StaffRole, ReadonlyArray<NavKey>> = {
  super_admin: NAV_ITEMS.map((n) => n.key),
  ops_manager: NAV_ITEMS.map((n) => n.key).filter(
    (k) => k !== "roles" && k !== "catalogue" && k !== "referrals",
  ),
  area_partner: ["dashboard", "bookings", "experts", "reports"],
};

function Shell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [active, setActive] = useState<NavKey>("dashboard");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [bookingsInitial, setBookingsInitial] = useState<
    { status?: string; from?: string; to?: string } | null
  >(null);
  const [expertsOnlineOnly, setExpertsOnlineOnly] = useState(false);
  const [navNonce, setNavNonce] = useState(0);
  const activeItem = NAV_ITEMS.find((n) => n.key === active)!;

  function gotoBookings(preset: { status?: string; from?: string; to?: string } | null) {
    setBookingsInitial(preset);
    setActive("bookings");
    setNavNonce((n) => n + 1);
    setMobileOpen(false);
  }
  function gotoExperts(onlineOnly: boolean) {
    setExpertsOnlineOnly(onlineOnly);
    setActive("experts");
    setNavNonce((n) => n + 1);
    setMobileOpen(false);
  }

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
  const topLevelItems = visibleItems.filter((n) => !GROUPED_KEYS.includes(n.key));
  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: visibleItems.filter((n) => (g.keys as ReadonlyArray<string>).includes(n.key)),
    isActive: (g.keys as ReadonlyArray<string>).includes(active),
  })).filter((g) => g.items.length > 0);

  useEffect(() => {
    const g = NAV_GROUPS.find((grp) => (grp.keys as ReadonlyArray<string>).includes(active));
    if (g) setOpenGroups((prev) => (prev[g.id] ? prev : { ...prev, [g.id]: true }));
  }, [active]);


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
          <img src={badiyoLogo.url} alt="Badiyos" className="h-7 w-auto" />
          <button
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
            className="lg:hidden text-muted-foreground hover:text-foreground"
          >
            <X size={20} />
          </button>
        </div>
        <nav className="flex-1 py-4 overflow-y-auto">
          {topLevelItems.map((item) => {
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

          {groups.map((group) => {
            const GroupIcon = group.icon;
            const open = !!openGroups[group.id];
            return (
              <div key={group.id}>
                <button
                  onClick={() => setOpenGroups((p) => ({ ...p, [group.id]: !p[group.id] }))}
                  aria-expanded={open}
                  className={`w-full flex items-center gap-3 pl-5 pr-4 py-2.5 text-[14px] font-medium transition-colors border-l-[3px] ${
                    group.isActive && !open
                      ? "border-primary bg-primary-tint text-foreground font-semibold"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  <GroupIcon
                    size={18}
                    strokeWidth={group.isActive ? 2.25 : 2}
                    className={group.isActive ? "text-primary" : ""}
                  />
                  <span className="flex-1 text-left">{group.label}</span>
                  <ChevronDown
                    size={16}
                    className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                  />
                </button>

                {open &&
                  group.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = item.key === active;
                    return (
                      <button
                        key={item.key}
                        onClick={() => {
                          setActive(item.key);
                          setMobileOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 pl-11 pr-4 py-2 text-[13px] font-medium transition-colors border-l-[3px] ${
                          isActive
                            ? "border-primary bg-primary-tint text-foreground font-semibold"
                            : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted"
                        }`}
                      >
                        <Icon
                          size={16}
                          strokeWidth={isActive ? 2.25 : 2}
                          className={isActive ? "text-primary" : ""}
                        />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
              </div>
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
          <DashboardHome
            role={role}
            onGoBookings={gotoBookings}
            onGoExperts={gotoExperts}
          />
        ) : active === "zones" ? (
          <ZonesPage role={role} />
        ) : active === "bookings" ? (
          <BookingsPage
            key={`bookings-${navNonce}`}
            role={role}
            onSelect={(id) => setSelectedBookingId(id)}
            initialFilters={bookingsInitial ?? undefined}
          />
        ) : active === "experts" ? (
          <ExpertsPage
            key={`experts-${navNonce}`}
            role={role}
            initialOnlineOnly={expertsOnlineOnly}
          />
        ) : active === "partners" ? (
          <AreaPartnersPage role={role} />
        ) : active === "skills" ? (
          <SkillApprovalsPage role={role} />
        ) : active === "merchants" ? (
          <MerchantApprovalsPage role={role} />
        ) : active === "merchant-billing" ? (
          <MerchantBillingPage role={role} />
        ) : active === "waitlist" ? (
          <WaitlistPage role={role} />
        ) : active === "interest-leads" ? (
          <InterestLeadsPage role={role} />

        ) : active === "emergency" ? (
          <EmergencyAlertsPage role={role} />
        ) : active === "catalogue" ? (
          <ServiceCataloguePage />
        ) : active === "homepage" ? (
          <HomepageBuilderPage />
        ) : active === "wallets" ? (
          <WalletsPage role={role} />
        ) : active === "referrals" ? (
          <ReferralsPage />
        ) : active === "roles" ? (
          <RolesPage />
        ) : active === "legal" ? (
          <LegalPagesPage role={role} />
        ) : active === "task-details" ? (
          <TaskDetailsPage role={role} />
        ) : active === "notification-sounds" ? (
          <NotificationSoundsPage role={role} />
        ) : active === "audit" ? (
          <AuditLogsPage />
        ) : active === "reports" ? (
          <ReportsPage role={role} />
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

function DashboardHome({
  role,
  onGoBookings,
  onGoExperts,
}: {
  role: StaffRole | null;
  onGoBookings: (preset: { status?: string; from?: string; to?: string } | null) => void;
  onGoExperts: (onlineOnly: boolean) => void;
}) {
  const fetchStats = useServerFn(getDashboardStats);
  const queryClient = useQueryClient();
  const [segmentId, setSegmentId] = useState<string | null>(null);

  const segmentsQuery = useQuery({
    queryKey: ["segments", "filter"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("segments")
        .select("id, name")
        .eq("is_active", true)
        .order("rank", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard", "stats", segmentId],
    queryFn: () => fetchStats({ data: { segmentId } }),
    refetchInterval: 60_000, // safety-net poll; realtime below drives normal refreshes
    refetchOnWindowFocus: false,
  });

  // Realtime: any change to bookings, experts, merchant orders or POS sales
  // invalidates the unified stats.
  useEffect(() => {
    const invalidate = () =>
      queryClient.invalidateQueries({ queryKey: ["dashboard", "stats"] });
    const channel = supabase
      .channel("dashboard-stats")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "experts" }, invalidate)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "merchant_orders" },
        invalidate,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "offline_sales" },
        invalidate,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const inr = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });

  const today = new Date().toISOString().slice(0, 10);
  const showCommerce = role === "super_admin" || role === "ops_manager";
  const cards: Array<{
    label: string;
    value: string;
    hint?: string;
    icon: LucideIcon;
    onClick?: () => void;
  }> = [
    {
      label: "Today's Revenue",
      value: inr.format(data?.todayRevenue ?? 0),
      hint: "Bookings + online orders + POS",
      icon: IndianRupee,
      onClick: () => onGoBookings({ from: today, to: today, status: "completed" }),
    },
    {
      label: "Today's Transactions",
      value: String(data?.todayTransactions ?? 0),
      hint: `${data?.todayBookings ?? 0} bookings · ${data?.todayOrders ?? 0} orders`,
      icon: CalendarCheck,
      onClick: () => onGoBookings({ from: today, to: today }),
    },
    {
      label: "Active Right Now",
      value: String(data?.activeNow ?? 0),
      hint: "In progress + being prepared",
      icon: Activity,
      onClick: () => onGoBookings({ status: "active" }),
    },
    {
      label: "Completed Today",
      value: String(data?.completedToday ?? 0),
      hint: "Bookings + orders",
      icon: CheckCircle2,
      onClick: () => onGoBookings({ from: today, to: today, status: "completed" }),
    },
    {
      label: "Pending Action",
      value: String(data?.pendingAction ?? 0),
      hint: "Needs expert + needs merchant",
      icon: Clock,
      onClick: () => onGoBookings({ status: "accepted" }),
    },
    {
      label: "Online Right Now",
      value: String(data?.onlineNow ?? 0),
      hint: `${data?.onlineExperts ?? 0} experts · ${data?.openMerchants ?? 0} stores`,
      icon: Users,
      onClick: () => onGoExperts(true),
    },
  ];

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {isError ? (
          <p className="text-[14px] text-destructive">Failed to load stats. Retrying…</p>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            Unified view across service bookings and merchant commerce.
          </p>
        )}
        <label className="flex items-center gap-2 text-[13px]">
          <span className="text-muted-foreground font-medium">Segment</span>
          <select
            value={segmentId ?? ""}
            onChange={(e) => setSegmentId(e.target.value || null)}
            className="h-9 rounded-[10px] border border-border bg-card px-3 text-[13px] font-semibold text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <option value="">All Segments</option>
            {(segmentsQuery.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4 xl:gap-6">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.label}
              type="button"
              onClick={card.onClick}
              className="text-left bg-card border border-border rounded-[18px] p-5 flex items-start justify-between gap-3 cursor-pointer transition-all hover:border-primary/40 hover:shadow-sm hover:bg-primary-tint/30 active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <div className="min-w-0">
                <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {card.label}
                </p>
                <p className="mt-2 text-[26px] leading-none font-bold text-foreground truncate">
                  {isLoading && !data ? "—" : card.value}
                </p>
                {card.hint && (
                  <p className="mt-1.5 text-[11px] text-muted-foreground truncate">
                    {card.hint}
                  </p>
                )}
              </div>
              <div className="w-9 h-9 rounded-full bg-primary-tint text-primary flex items-center justify-center shrink-0">
                <Icon size={18} />
              </div>
            </button>
          );
        })}
      </div>

      <div className={showCommerce ? "grid gap-6 2xl:grid-cols-2" : ""}>
        <PipelineKanban role={role} segmentId={segmentId} />
        {showCommerce && <CommerceKanban segmentId={segmentId} />}
      </div>
    </div>
  );
}


