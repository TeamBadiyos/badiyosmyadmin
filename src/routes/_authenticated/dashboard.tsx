import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { PipelineKanban } from "@/components/pipeline-kanban";
import { OfflinePosToday } from "@/components/commerce-kanban";
import { ServiceCommerceModule } from "@/components/service-commerce-module";

import { ZonesPage } from "@/components/zones-page";
import { BookingsPage } from "@/components/bookings-page";
import { ExpertsPage } from "@/components/experts-page";
import { TrainingOrdersPage } from "@/components/training-orders-page";
import { GraduationCap } from "lucide-react";
import { FinanceHub, type FinanceTab } from "@/components/finance-hub";
import { DashboardOverview } from "@/components/dashboard-overview";
import { BookingDetailsModal } from "@/components/booking-details-modal";
import { ServiceCataloguePage } from "@/components/service-catalogue-page";
import { LiveStoresView } from "@/components/live-stores-view";
import { StoreCategoriesPage } from "@/components/store-categories-page";
import { StoreSettingsPage } from "@/components/store-settings-page";
import { TaskTypesPage } from "@/components/task-types-page";
import { HomepageBuilderPage } from "@/components/homepage-builder-page";
import { WalletsPage } from "@/components/wallets-page";
import { ReferralsPage } from "@/components/referrals-page";
import { RewardsPage } from "@/components/rewards-page";
import { RolesPage } from "@/components/roles-page";
import { AuditLogsPage } from "@/components/audit-logs-page";
import { ReportsPage } from "@/components/reports-page";
import { SettlementsPage } from "@/components/settlements-page";
import { EmergencyAlertsPage } from "@/components/emergency-alerts-page";
import { UnassignedTripsPage } from "@/components/unassigned-trips-page";
import { SkillApprovalsPage } from "@/components/skill-approvals-page";
import { InterestLeadsPage } from "@/components/interest-leads-page";
import { InsurancePage } from "@/components/insurance-page";
import { PartnersPage } from "@/components/partners-page";
import { WaitlistPage } from "@/components/waitlist-page";
import { UsersPage } from "@/components/users-page";
import { MerchantApprovalsPage } from "@/components/merchant-approvals-page";
import { MerchantBillingPage } from "@/components/merchant-billing-page";
import { LegalPagesPage } from "@/components/legal-pages-page";
import { NotificationSoundsPage } from "@/components/notification-sounds-page";
import { SupportTicketsPage } from "@/components/support-tickets-page";
import { DeletionRequestsPage } from "@/components/deletion-requests-page";
import { NotificationBell } from "@/components/notification-bell";
import { DispatchAlertsPage } from "@/components/dispatch-alerts-page";
import { ServicesPage } from "@/components/services-page";
import { OffersPage } from "@/components/offers-page";
import { EventOffersPage } from "@/components/event-offers-page";
import { CourierPage } from "@/components/courier-page";
import { StoreFoodLiveBoard, ServiceHoursPanel } from "@/components/ops-panels";
import { SlotAvailabilityTab, CleanCapacitySettings } from "@/components/slot-availability-tab";
import { BookingTimingsTab } from "@/components/booking-timings-tab";
import { TaxSettingsPage, ChargesFeesPage } from "@/components/platform-settings-pages";
import { getStaffAlerts } from "@/lib/alerts.functions";




import {
  Award,
  LayoutDashboard,
  CalendarCheck,
  BadgePercent,
  Map,
  UserCog,
  Handshake,
  BookOpen,
  ClipboardList,
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
  Users,
  Sprout,
  Volume2,
  TrendingUp,
  Boxes,
  Landmark,
  type LucideIcon,
  LifeBuoy,
  UserMinus,
  BellRing,
  Megaphone,
  PackageCheck,
  SlidersHorizontal,
  Truck,
  Lightbulb,
  PanelLeftClose,
  PanelLeftOpen,
  UtensilsCrossed,
  Percent,
} from "lucide-react";
import { SuggestionsPage } from "@/components/suggestions-page";
import { LuckyDrawPage } from "@/components/lucky-draw-page";
import badiyoLogo from "@/assets/badiyos-wordmark-green.png.asset.json";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/dashboard")({
  validateSearch: (s: Record<string, unknown>): { tab?: string } =>
    typeof s.tab === "string" && s.tab ? { tab: s.tab } : {},
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
  { key: "bookings", label: "All Bookings", icon: CalendarCheck },
  { key: "live-board", label: "Store & Food Live Board", icon: Activity },
  { key: "maid-bookings", label: "Bookings", icon: CalendarCheck },
  { key: "maid-catalogue", label: "Services", icon: BookOpen },
  { key: "maid-slots", label: "Slots", icon: ListChecks },
  { key: "clean-experts", label: "Team", icon: UserCog },
  { key: "clean-training", label: "Training", icon: GraduationCap },
  { key: "maid-settings", label: "Settings", icon: Settings },
  { key: "wash-bookings", label: "Bookings", icon: CalendarCheck },
  { key: "wash-catalogue", label: "Services", icon: BookOpen },
  { key: "wash-slots", label: "Slots", icon: ListChecks },
  { key: "wash-team", label: "Team", icon: UserCog },
  { key: "wash-settings", label: "Settings", icon: Settings },
  { key: "courier-riders", label: "Riders & Capacity", icon: Users },
  { key: "zones", label: "Zones", icon: Map },
  { key: "experts", label: "Experts", icon: UserCog },
  { key: "training-orders", label: "Training Orders", icon: GraduationCap },
  { key: "skills", label: "Training & Skill Approvals", icon: BadgeCheck },
  { key: "merchants", label: "Merchants", icon: Store },
  { key: "live-stores", label: "Live Stores", icon: Store },
  { key: "merchant-billing", label: "Merchant Billing", icon: Receipt },
  { key: "users", label: "Customers", icon: Users },
  { key: "waitlist", label: "Waitlist", icon: ListChecks },
  { key: "interest-leads", label: "Business Leads", icon: Sprout },
  { key: "insurance", label: "Insurance", icon: ShieldCheck },
  { key: "suggestions", label: "Suggestions", icon: Lightbulb },
  { key: "lucky-draw", label: "Lucky Draw", icon: Gift },

  { key: "emergency", label: "Emergency Alerts", icon: Siren },
  { key: "unassigned-trips", label: "Unassigned Trips", icon: Truck },
  { key: "catalogue", label: "Service Catalogue", icon: BookOpen },
  { key: "store-categories", label: "Categories", icon: Store },
  { key: "task-types", label: "Task Types", icon: ClipboardList },
  { key: "homepage", label: "Homepage Builder", icon: LayoutTemplate },
  { key: "wallets", label: "Wallets & Payouts", icon: Wallet },
  { key: "partners", label: "Partner Program", icon: Handshake },
  { key: "referrals", label: "Referrals", icon: Gift },
  { key: "rewards", label: "Rewards", icon: Award },
  { key: "offers", label: "Offers & Campaigns", icon: Megaphone },
  { key: "event-offers", label: "Event Offers", icon: Gift },
  { key: "roles", label: "Roles & Permissions", icon: ShieldCheck },
  { key: "settlements", label: "Settlement", icon: Landmark },
  { key: "reports", label: "Reports", icon: BarChart3 },
  { key: "legal", label: "Legal", icon: Scale },
  { key: "notification-sounds", label: "Notification Sounds", icon: Volume2 },
  { key: "support", label: "Support Tickets", icon: LifeBuoy },
  { key: "deletion-requests", label: "Deletion Requests", icon: UserMinus },
  { key: "audit", label: "Audit Logs", icon: ScrollText },
  { key: "dispatch-alerts", label: "Dispatch Alerts", icon: BellRing },
  { key: "courier", label: "Courier", icon: PackageCheck },
  { key: "courier-orders", label: "Orders", icon: PackageCheck },
  { key: "courier-rates", label: "Rates", icon: IndianRupee },
  { key: "courier-types", label: "Parcel Types", icon: Boxes },
  { key: "courier-bulk", label: "Bulk / Business Delivery", icon: Truck },
  { key: "courier-settings", label: "Settings", icon: Settings },
  { key: "store-orders", label: "Manage Store", icon: Receipt },
  { key: "food-orders", label: "Manage Food", icon: UtensilsCrossed },
  { key: "store-settings", label: "Settings", icon: Settings },
  { key: "services", label: "Service Status", icon: SlidersHorizontal },
  { key: "tax-settings", label: "Tax Settings", icon: Percent },
  { key: "fees", label: "Charges & Fees", icon: IndianRupee },
  { key: "fin-settlements", label: "Merchant Settlements", icon: Landmark },
  { key: "fin-instant", label: "Instant — Pay today", icon: Landmark },
  { key: "fin-refunds", label: "Refunds", icon: Receipt },
  { key: "fin-invoices", label: "Commission Invoices", icon: Receipt },
  { key: "fin-tax", label: "Tax Reports", icon: Percent },
  { key: "company-profile", label: "Company Profile", icon: Settings },
] as const;

type NavKey = (typeof NAV_ITEMS)[number]["key"];

const NAV_GROUPS = [
  {
    id: "live-ops",
    label: "Live Ops",
    icon: Activity,
    keys: ["live-board", "bookings", "emergency", "support", "unassigned-trips", "dispatch-alerts", "suggestions"],
  },
  {
    id: "clean",
    label: "Clean Home",
    icon: Boxes,
    keys: ["maid-bookings", "maid-catalogue", "maid-slots", "clean-experts", "clean-training", "maid-settings"],
  },
  {
    id: "wash",
    label: "Clean Auto",
    icon: Boxes,
    keys: ["wash-bookings", "wash-catalogue", "wash-slots", "wash-team", "wash-settings"],
  },
  {
    id: "store",
    label: "Store",
    icon: Store,
    keys: ["store-orders", "merchants", "live-stores", "store-categories", "store-settings"],
  },
  {
    id: "food",
    label: "Food",
    icon: UtensilsCrossed,
    keys: ["food-orders"],
  },
  {
    id: "courier",
    label: "Parcel",
    icon: PackageCheck,
    keys: ["courier-orders", "courier-rates", "courier-types", "courier-bulk", "courier-riders", "courier-settings"],
  },
  {
    id: "rewards",
    label: "Rewards",
    icon: Award,
    keys: ["rewards", "offers", "event-offers", "lucky-draw"],
  },
  {
    id: "people",
    label: "People",
    icon: Users,
    keys: ["users", "experts", "partners", "deletion-requests"],
  },
  {
    id: "growth",
    label: "Growth",
    icon: TrendingUp,
    keys: ["referrals", "waitlist", "interest-leads", "homepage", "insurance"],
  },
  {
    id: "finance",
    label: "Finance",
    icon: Landmark,
    keys: ["fin-settlements", "fin-instant", "fin-refunds", "fin-invoices", "fin-tax", "wallets", "merchant-billing", "settlements", "reports"],
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    keys: ["services", "tax-settings", "fees", "company-profile", "roles", "zones", "audit", "notification-sounds", "legal"],
  },
] as const;

const GROUPED_KEYS: ReadonlyArray<string> = NAV_GROUPS.flatMap((g) => g.keys as ReadonlyArray<string>);

// Reachable (old links, notifications) but never listed in the sidebar.
const HIDDEN_KEYS: ReadonlyArray<string> = ["courier", "catalogue", "task-types", "skills", "training-orders"];

const LEGACY_NAV_ALIASES: Partial<Record<NavKey, NavKey>> = {
  courier: "courier-orders",
};

type StaffRole = "super_admin" | "ops_manager" | "area_partner";

const ROLE_ALLOWED: Record<StaffRole, ReadonlyArray<NavKey>> = {
  super_admin: NAV_ITEMS.map((n) => n.key),
  ops_manager: NAV_ITEMS.map((n) => n.key).filter(
    (k) => k !== "roles" && k !== "event-offers" && k !== "catalogue" && k !== "maid-catalogue" && k !== "wash-catalogue" && k !== "referrals" && k !== "rewards",
  ),
  area_partner: ["dashboard", "bookings", "maid-bookings", "wash-bookings", "experts", "clean-experts", "wash-team", "reports"],
};

function Shell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const isNavKey = (k: unknown): k is NavKey => typeof k === "string" && NAV_ITEMS.some((n) => n.key === k);
  const [active, setActiveState] = useState<NavKey>(() => (isNavKey(search.tab) ? search.tab : "dashboard"));
  useEffect(() => {
    if (search.tab) return;
    try {
      const s = window.sessionStorage.getItem("cc_active_tab");
      if (isNavKey(s) && s !== "dashboard") navigate({ to: "/dashboard", search: { tab: s }, replace: true });
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setActive = (k: NavKey) => {
    setActiveState(k);
    try { window.sessionStorage.setItem("cc_active_tab", k); } catch { /* ignore */ }
    if (search.tab !== k) navigate({ to: "/dashboard", search: k === "dashboard" ? {} : { tab: k } });
  };
  useEffect(() => {
    const t = isNavKey(search.tab) ? search.tab : "dashboard";
    setActiveState((cur) => (cur === t ? cur : t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.tab]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [bookingsInitial, setBookingsInitial] = useState<
    { status?: string; from?: string; to?: string } | null
  >(null);
  const [expertsOnlineOnly, setExpertsOnlineOnly] = useState(false);
  const [navNonce, setNavNonce] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(localStorage.getItem("cc_sidebar_collapsed") === "1");
  }, []);
  function toggleCollapsed() {
    setCollapsed((c) => {
      localStorage.setItem("cc_sidebar_collapsed", c ? "0" : "1");
      return !c;
    });
  }
  const mini = collapsed && !mobileOpen;
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

  const fetchAlerts = useServerFn(getStaffAlerts);
  const { data: alerts } = useQuery({
    queryKey: ["staff", "alerts", "unread"],
    queryFn: () => fetchAlerts({ data: { filter: "unread" as const } }),
    refetchInterval: 60_000,
    staleTime: 20_000,
  });
  const openTickets = alerts?.openTickets ?? 0;

  const allowedKeys = role ? ROLE_ALLOWED[role] : NAV_ITEMS.map((n) => n.key);

  const visibleItems = NAV_ITEMS.filter((n) => allowedKeys.includes(n.key));
  const topLevelItems = visibleItems.filter(
    (n) => !GROUPED_KEYS.includes(n.key) && !HIDDEN_KEYS.includes(n.key),
  );
  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: visibleItems.filter((n) => (g.keys as ReadonlyArray<string>).includes(n.key)),
    isActive: (g.keys as ReadonlyArray<string>).includes(active),
  })).filter((g) => g.items.length > 0);

  const activeGroup = groups.find((g) => g.items.some((i) => i.key === active)) ?? null;

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
    <div className={`min-h-screen w-full bg-background transition-[padding] duration-200 ${collapsed ? "lg:pl-[68px]" : "lg:pl-[240px]"}`}>
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[240px] ${collapsed ? "lg:w-[68px]" : ""} bg-card border-r border-border flex flex-col transition-transform duration-200 lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className={`h-16 flex items-center justify-between border-b border-border ${mini ? "lg:justify-center lg:px-2 px-6" : "px-6"}`}>
          <img src={badiyoLogo.url} alt="Badiyos" className={`h-7 w-auto ${mini ? "lg:hidden" : ""}`} />
          <button
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand menu" : "Minimize menu"}
            title={collapsed ? "Expand menu" : "Minimize menu"}
            className="hidden lg:flex items-center justify-center w-9 h-9 rounded-[10px] text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            {collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
          </button>
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
                title={item.label}
                onClick={() => {
                  setActive(item.key);
                  setMobileOpen(false);
                }}
                className={`w-full ${mini ? "lg:justify-center lg:pl-0 lg:pr-0" : ""} flex items-center gap-3 pl-5 pr-4 py-2.5 text-[14px] font-medium transition-colors border-l-[3px] ${
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
                <span className={mini ? "lg:hidden" : ""}>{item.label}</span>
              </button>
            );
          })}

          {groups.map((group) => {
            const GroupIcon = group.icon;
            return (
              <div key={group.id}>
                <button
                  title={group.label}
                  onClick={() => {
                    if (group.items[0]) {
                      setActive(group.items[0].key);
                      setNavNonce((n) => n + 1);
                      setMobileOpen(false);
                    }
                  }}
                  className={`w-full ${mini ? "lg:justify-center lg:pl-0 lg:pr-0" : ""} flex items-center gap-3 pl-5 pr-4 py-2.5 text-[14px] font-medium transition-colors border-l-[3px] ${
                    group.isActive
                      ? "border-primary bg-primary-tint text-foreground font-semibold"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  <GroupIcon
                    size={18}
                    strokeWidth={group.isActive ? 2.25 : 2}
                    className={group.isActive ? "text-primary" : ""}
                  />
                  <span className={`flex-1 text-left ${mini ? "lg:hidden" : ""}`}>{group.label}</span>
                  {(group.keys as readonly string[]).includes("support") &&
                    openTickets > 0 && (
                      <span className="w-2 h-2 rounded-full bg-destructive" aria-hidden />
                    )}




                </button>

                {false &&
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
                        {item.key === "support" && openTickets > 0 && (
                          <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                            {openTickets > 9 ? "9+" : openTickets}
                          </span>
                        )}

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
      <header className="sticky top-0 z-20 h-16 bg-card border-b border-border grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-3 sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="lg:hidden text-muted-foreground hover:text-foreground shrink-0"
          >
            <Menu size={22} />
          </button>
          <h1 className="truncate text-[15px] sm:text-[18px] font-bold text-foreground">
            {activeGroup ? (
              <>
                <span className="text-muted-foreground font-semibold">{activeGroup.label}</span>
                <span className="text-muted-foreground font-semibold"> · </span>
                {activeItem.label}
              </>
            ) : (
              activeItem.label
            )}
          </h1>
        </div>
        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          <NotificationBell
            onOpenTarget={(a) => {
              // Website lead notifications point at the Business Leads screen.
              const target = a.kind === "lead" ? "interest-leads" : a.target;
              const match = NAV_ITEMS.find((n) => n.key === target);
              const matchedKey = match ? match.key : ("dashboard" as const);
              const key = LEGACY_NAV_ALIASES[matchedKey] ?? matchedKey;
              setActive(key);

              setNavNonce((n) => n + 1);
              const group = NAV_GROUPS.find((g) =>
                (g.keys as ReadonlyArray<string>).includes(key),
              );
              if (group) setOpenGroups((p) => ({ ...p, [group.id]: true }));
              if (key === "bookings" && a.targetId) setSelectedBookingId(a.targetId);
            }}
          />

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

      {/* Hub sub-tabs */}
      {activeGroup && activeGroup.items.length > 1 && (
        <div className="sticky top-16 z-10 bg-card border-b border-border px-2 sm:px-8">
          <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {activeGroup.items.map((item) => {
              const Icon = item.icon;
              const isActive = item.key === active;
              return (
                <button
                  key={item.key}
                  onClick={() => {
                    setActive(item.key);
                    setNavNonce((n) => n + 1);
                  }}
                  className={`shrink-0 flex items-center gap-2 px-3 py-3 text-[13px] font-semibold whitespace-nowrap border-b-2 transition-colors ${
                    isActive
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon size={15} strokeWidth={isActive ? 2.25 : 2} />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Content */}
      <main className="min-h-[calc(100vh-4rem)] w-full min-w-0 overflow-x-hidden p-3 sm:p-6 lg:p-8">
        {active === "dashboard" ? (
          (role === "super_admin" || role === "ops_manager") ? (
            <DashboardOverview role={role} onNavigate={(k) => { if (isNavKey(k)) setActive(k); }} />
          ) : (
            <PipelineKanban role={role} unified />
          )
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
        ) : active === "training-orders" ? (
          <TrainingOrdersPage />
        ) : active === "skills" ? (
          <SkillApprovalsPage role={role} />
        ) : active === "merchants" ? (
          <MerchantApprovalsPage role={role} />
        ) : active === "merchant-billing" ? (
          <MerchantBillingPage role={role} />
        ) : active === "users" ? (
          <UsersPage onSelectBooking={setSelectedBookingId} />
        ) : active === "waitlist" ? (
          <WaitlistPage role={role} />
        ) : active === "insurance" ? (
          <InsurancePage role={role} />
        ) : active === "lucky-draw" ? (
          <LuckyDrawPage />
        ) : active === "suggestions" ? (
          <SuggestionsPage />
        ) : active === "interest-leads" ? (
          <InterestLeadsPage role={role} />

        ) : active === "unassigned-trips" ? (
          <UnassignedTripsPage role={role} />
        ) : active === "emergency" ? (
          <EmergencyAlertsPage role={role} />
        ) : active === "catalogue" ? (
          <ServiceCataloguePage />
        ) : active === "store-settings" ? (
          <StoreSettingsPage onOpenTax={() => setActive("tax-settings")} />
        ) : active === "live-stores" ? (
          <LiveStoresView />
        ) : active === "store-categories" ? (
          <StoreCategoriesPage role={role} />
        ) : active === "task-types" ? (
          <TaskTypesPage />
        ) : active === "homepage" ? (
          <HomepageBuilderPage />
        ) : active === "partners" ? (
          <PartnersPage role={role} />
        ) : active === "wallets" ? (
          <WalletsPage role={role} />
        ) : active === "referrals" ? (
          <ReferralsPage />
        ) : active === "rewards" ? (
          <RewardsPage />
        ) : active === "roles" ? (
          <RolesPage />
        ) : active === "legal" ? (
          <LegalPagesPage role={role} />
                ) : active === "notification-sounds" ? (
          <NotificationSoundsPage role={role} />
        ) : active === "support" ? (
          <SupportTicketsPage role={role} />
        ) : active === "deletion-requests" ? (
          <DeletionRequestsPage role={role} />
        ) : active === "dispatch-alerts" ? (
          <DispatchAlertsPage />
        ) : active === "services" ? (
          <ServicesPage
            onEditHours={(k) =>
              setActive(k === "clean" ? "maid-settings" : k === "courier" ? "courier-settings" : k === "food" ? "food-orders" : "store-orders")
            }
          />
        ) : active === "event-offers" ? (
          role === "super_admin" ? <EventOffersPage /> : null
        ) : active === "offers" ? (
          <OffersPage />
        ) : active === "courier" || active === "courier-orders" ? (
          <CourierPage section="orders" />
        ) : active === "courier-rates" ? (
          <CourierPage section="rates" />
        ) : active === "courier-types" ? (
          <CourierPage section="types" />
        ) : active === "courier-bulk" ? (
          <CourierPage section="bulk" />
        ) : active === "courier-riders" ? (
          <CourierPage section="riders" />
        ) : active === "live-board" ? (
          <StoreFoodLiveBoard />
        ) : active === "maid-bookings" || active === "wash-bookings" ? (
          <BookingsPage
            key={`${active}-${navNonce}`}
            role={role}
            cleanKind={active === "wash-bookings" ? "wash" : "maid"}
            onSelect={(id) => setSelectedBookingId(id)}
          />
        ) : active === "maid-catalogue" ? (
          <ServiceCataloguePage kind="maid" />
        ) : active === "wash-catalogue" ? (
          <ServiceCataloguePage kind="wash" />
        ) : active === "maid-slots" ? (
          <SlotAvailabilityTab group="clean" />
        ) : active === "wash-slots" ? (
          <SlotAvailabilityTab group="wash" />
        ) : active === "clean-experts" ? (
          <ExpertsPage key={`cexperts-${navNonce}`} role={role} initialOnlineOnly={false} skill="maid" />
        ) : active === "wash-team" ? (
          <ExpertsPage key={`wexperts-${navNonce}`} role={role} initialOnlineOnly={false} skill="wash" />
        ) : active === "clean-training" ? (
          <div className="space-y-8">
            <section><h2 className="mb-3 text-[16px] font-bold text-foreground">Training orders</h2><TrainingOrdersPage /></section>
            <section><h2 className="mb-3 text-[16px] font-bold text-foreground">Skill approvals</h2><SkillApprovalsPage role={role} /></section>
          </div>
        ) : active === "maid-settings" || active === "wash-settings" ? (
          <div className="space-y-6 max-w-4xl">
            <CleanCapacitySettings group={active === "wash-settings" ? "wash" : "clean"} />
            <ServiceHoursPanel serviceKey="clean" title="Opening hours" />
            <BookingTimingsTab />
          </div>
        ) : active === "courier-settings" ? (
          <CourierPage section="settings" />
        ) : active === "store-orders" ? (
          <div>
            <OfflinePosToday />
            <ServiceCommerceModule service="store" role={role ?? ""} />
          </div>
        ) : active === "food-orders" ? (
          <ServiceCommerceModule service="food" role={role ?? ""} />
        ) : active === "tax-settings" ? (
          <TaxSettingsPage isSuperAdmin={role === "super_admin"} />
        ) : active === "fees" ? (
          <ChargesFeesPage isSuperAdmin={role === "super_admin"} />
        ) : active === "audit" ? (
          <AuditLogsPage />
        ) : active.startsWith("fin-") || active === "company-profile" ? (
          <FinanceHub
            tab={(active === "company-profile" ? "company" : active.slice(4)) as FinanceTab}
            canEdit={role === "super_admin" || role === "ops_manager"}
            isSuperAdmin={role === "super_admin"}
          />
        ) : active === "settlements" ? (
          <SettlementsPage />
        ) : active === "reports" ? (
          <ReportsPage role={role} />
        ) : (
          <div className="flex min-h-[60vh] items-center justify-center">
            <p className="text-[15px] text-muted-foreground">Select a section from the sidebar</p>
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
