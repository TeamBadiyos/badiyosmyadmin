import { CityName, useShowCity } from "@/lib/city-scope";
import { useUrlState } from "@/components/ui/data-table";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Plus, UserRound } from "lucide-react";
import { listExperts, workHourRanges, type ExpertLevel, type KycStatus, type ExpertRow } from "@/lib/experts.functions";
import { listZoneOptions } from "@/lib/bookings.functions";
import { listExpertsWithoutDevice } from "@/lib/booking-settings.functions";
import { ExpertModeBadge } from "@/components/expert-mode-badge";
import { ExpertFormModal } from "@/components/expert-form-modal";
import { ExpertDetailsModal } from "@/components/expert-details-modal";
import { ExpertApplicationsPanel, useApplicationsCount } from "@/components/expert-applications";
import { OldAppBadge, useAppConfig } from "@/components/app-versions";

function ViewChips({ view, setView, count }: { view: string; setView: (v: string) => void; count: number }) {
  return (
    <div className="flex gap-1.5">
      {([["experts", "Experts"], ["applications", "Applications"]] as const).map(([k, l]) => (
        <button key={k} onClick={() => setView(k)} className={`h-8 px-3 rounded-full text-[12px] font-semibold border inline-flex items-center gap-1.5 ${view === k ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border"}`}>
          {l}{k === "applications" && count > 0 && <span className="rounded-full bg-destructive text-destructive-foreground px-1.5 text-[10px]">{count}</span>}
        </button>
      ))}
    </div>
  );
}
import { DataTablePagination, EmptyState } from "@/components/ui/data-table";
import {
  useSortFilter,
  SortFilterHeader,
  SortFilterReset,
} from "@/components/table-sort-filter";

type StaffRole = "super_admin" | "ops_manager" | "area_partner" | "finance";

const LEVELS: ExpertLevel[] = ["bronze", "silver", "gold", "diamond"];
const KYC_STATUSES: KycStatus[] = ["pending", "approved", "rejected"];

const LEVEL_STYLES: Record<ExpertLevel, string> = {
  bronze: "bg-amber-50 text-amber-800",
  silver: "bg-slate-100 text-slate-700",
  gold: "bg-yellow-50 text-yellow-800",
  diamond: "bg-indigo-50 text-indigo-700",
};

const KYC_STYLES: Record<KycStatus, string> = {
  pending: "bg-amber-50 text-amber-700",
  approved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-red-50 text-red-700",
};

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export function ExpertsPage({
  role,
  initialOnlineOnly = false,
  skill,
}: {
  role: StaffRole | null;
  initialOnlineOnly?: boolean;
  /** Team tab: only Experts with an approved maid (Home) or wash (Auto) skill. */
  skill?: "maid" | "wash" | "rider";
}) {
  const canManage = role === "super_admin" || role === "ops_manager";
  const noDevFn = useServerFn(listExpertsWithoutDevice);
  const noDevQ = useQuery({ queryKey: ["experts-no-device"], queryFn: () => noDevFn(), staleTime: 60_000 });
  const noDevice = useMemo(() => new Set((noDevQ.data ?? []).map((x) => x.id)), [noDevQ.data]);
  const showZoneFilter = role !== "area_partner";

  const [zoneId, setZoneId] = useUrlState<string>("zone", "");
  const [kycStatus, setKycStatus] = useUrlState<string>("kyc", "");
  const [level, setLevel] = useUrlState<string>("level", "");
  const [availability, setAvailability] = useState<string>(
    initialOnlineOnly ? "online_free" : "",
  );
  const [mode, setMode] = useUrlState<string>("mode", "");
  const [skillF, setSkillF] = useUrlState<"" | "maid" | "wash" | "rider">("skill", "");
  const [moreOpen, setMoreOpen] = useState(false);
  const [page, setPage] = useUrlState<number>("page", 1);
  const [pageSize, setPageSize] = useUrlState<number>("size", 25);
  const effSkill = skill ?? (skillF || undefined);
  const [statusF, setStatusF] = useUrlState<string>("status", skill ? "active" : "");
  const [addOpen, setAddOpen] = useState(false);
  const [view, setView] = useUrlState<string>("view", "experts");
  const appsCount = useApplicationsCount();
  const [editId, setEditId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);

  useEffect(() => {
    setAvailability(initialOnlineOnly ? "online_free" : "");
  }, [initialOnlineOnly]);

  const fetchExperts = useServerFn(listExperts);
  const qc = useQueryClient();
  const leaveQ = useQuery({
    queryKey: ["experts", "leave-today"],
    staleTime: 30_000,
    queryFn: async () => {
      const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
      const { data } = await supabase.from("expert_leave_days" as never).select("expert_id").eq("leave_date", today);
      return new Set(((data ?? []) as Array<{ expert_id: string }>).map((r) => r.expert_id));
    },
  });
  const canLeave = role === "area_partner" || role === "super_admin" || role === "ops_manager";
  async function toggleLeave(id: string, on: boolean) {
    if (!confirm(on ? "Mark this expert on leave today? They won't be assigned today." : "Clear today's leave?")) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)("staff_set_expert_leave_today", { _expert_id: id, _on: on });
    if (error) return toast.error(error.message);
    toast.success(on ? "Marked on leave today" : "Leave cleared");
    qc.invalidateQueries({ queryKey: ["experts", "leave-today"] });
  }
  const fetchZones = useServerFn(listZoneOptions);

  const filters = useMemo(
    () => ({
      zoneId: zoneId || null,
      kycStatus: kycStatus || null,
      level: level || null,
      onlineOnly: availability === "online" || availability === "online_free",
    }),
    [zoneId, kycStatus, level, availability],
  );

  const { data: zones = [] } = useQuery({
    queryKey: ["experts", "zone-options"],
    queryFn: () => fetchZones(),
    staleTime: 60_000,
  });

  const { data: expertsRaw = [], isLoading, isError } = useQuery({
    queryKey: ["experts", "list", filters],
    queryFn: () => fetchExperts({ data: filters }),
    staleTime: 15_000,
  });

  const { data: skillIds } = useQuery({
    queryKey: ["experts", "skill-ids", effSkill],
    enabled: !!effSkill,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("partner_skills")
        .select("expert_id, service_category_id, service_categories(slug)").eq("status", "approved");
      if (error) throw new Error(error.message);
      if (effSkill === "rider") {
        const { data: v } = await supabase.from("courier_vehicle_types").select("required_skill").eq("is_active", true);
        const req = new Set(((v ?? []) as Array<{ required_skill: string | null }>).map((x) => x.required_skill).filter(Boolean));
        return new Set(((data ?? []) as Array<{ expert_id: string; service_category_id: string }>).filter((r) => req.has(r.service_category_id)).map((r) => r.expert_id));
      }
      const CLEAN_SLUGS = new Set(["home-cleaning", "festival-special-cleaning"]);
      const ids = new Set<string>();
      for (const r of (data ?? []) as unknown as Array<{ expert_id: string; service_category_id: string; service_categories: { slug: string } | null }>) {
        const slug = r.service_categories?.slug ?? "";
        if (effSkill === "wash" ? slug === "car-bike-wash" : CLEAN_SLUGS.has(slug)) ids.add(r.expert_id);
      }
      return ids;
    },
  });
  const isRider = skill === "rider";
  const { data: riderSkillIds = [] } = useQuery({
    queryKey: ["experts", "rider-skill-ids"],
    enabled: isRider,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: v } = await supabase.from("courier_vehicle_types").select("required_skill").eq("is_active", true);
      return Array.from(new Set(((v ?? []) as Array<{ required_skill: string | null }>).map((x) => x.required_skill).filter((x): x is string => !!x)));
    },
  });
  const { data: riderStats } = useQuery({
    queryKey: ["experts", "rider-stats"],
    enabled: isRider,
    staleTime: 30_000,
    queryFn: async () => {
      const ist = new Date(Date.now() + 5.5 * 3600_000);
      const dayStart = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 5.5 * 3600_000);
      const dow = (ist.getUTCDay() + 6) % 7;
      const weekStart = new Date(dayStart.getTime() - dow * 86400_000);
      const [{ data: vt }, { data: orders }, { data: today }, { data: led }] = await Promise.all([
        supabase.from("courier_vehicle_types").select("id, name"),
        supabase.from("courier_orders").select("assigned_expert_id, vehicle_type_id, created_at").eq("is_training", false).not("assigned_expert_id", "is", null).order("created_at", { ascending: false }).limit(1000),
        supabase.from("courier_orders").select("assigned_expert_id").eq("is_training", false).eq("status", "delivered").gte("delivered_at", dayStart.toISOString()),
        supabase.from("wallet_ledger").select("owner_id, amount").eq("owner_type", "expert").eq("type", "credit").gte("created_at", weekStart.toISOString()),
      ]);
      const vName = new Map(((vt ?? []) as Array<{ id: string; name: string }>).map((v) => [v.id, v.name]));
      const vehicle = new Map<string, string>();
      for (const o of (orders ?? []) as Array<{ assigned_expert_id: string; vehicle_type_id: string | null }>) {
        if (!vehicle.has(o.assigned_expert_id) && o.vehicle_type_id) vehicle.set(o.assigned_expert_id, vName.get(o.vehicle_type_id) ?? "");
      }
      const deliveries = new Map<string, number>();
      for (const o of (today ?? []) as Array<{ assigned_expert_id: string }>) deliveries.set(o.assigned_expert_id, (deliveries.get(o.assigned_expert_id) ?? 0) + 1);
      const earnings = new Map<string, number>();
      for (const l of (led ?? []) as Array<{ owner_id: string; amount: number }>) earnings.set(l.owner_id, (earnings.get(l.owner_id) ?? 0) + Number(l.amount));
      return { vehicle, deliveries, earnings };
    },
  });
  const [riderStatus, setRiderStatus] = useState("");
  const [riderSearch, setRiderSearch] = useState("");
  const [oldOnly, setOldOnly] = useState(false);
  const appCfg = useAppConfig();
  const oldMin = Math.max(appCfg.data?.expert_min_version_code ?? 6, 6);
  const expertsFiltered = (
    availability === "online_free" ? expertsRaw.filter((e) => !e.isBusy) : availability === "offline" ? expertsRaw.filter((e) => !e.isOnline) : expertsRaw
  ).filter((e) => !mode || e.mode === mode)
   .filter((e) => !effSkill || (skillIds ? skillIds.has(e.id) : false))
   .filter((e) => !statusF || (statusF === "active" ? e.status === "active" : e.status !== "active"))
   .filter((e) => !oldOnly || (e.status === "active" && (e.appVersionCode == null || e.appVersionCode < oldMin)))
   .filter((e) => !isRider || !riderStatus || riderState(e) === riderStatus)
   .filter((e) => {
     const q = riderSearch.trim().toLowerCase();
     return !q || e.name.toLowerCase().includes(q) || (e.phone ?? "").includes(q);
   })
   .sort((a, b) => rank(a) - rank(b));

  const sf = useSortFilter(expertsFiltered, [
    { key: "name", label: "Name", value: (e: ExpertRow) => e.name },
    { key: "phone", label: "Phone", value: (e: ExpertRow) => e.phone, filterable: false },
    {
      key: "zone",
      label: "Zone",
      value: (e: ExpertRow) => e.zoneNames?.join(", ") || "Unassigned",
    },
    { key: "level", label: "Level", value: (e: ExpertRow) => e.level },
    { key: "kyc", label: "KYC", value: (e: ExpertRow) => e.kycStatus },
    { key: "lastWeek", label: "This week", type: "number", align: "right", value: (e: ExpertRow) => e.lastWeekMinutes, filterable: false },
    { key: "month", label: "This month", type: "number", align: "right", value: (e: ExpertRow) => e.monthMinutes, filterable: false },
    {
      key: "wallet",
      label: "Wallet",
      type: "number",
      align: "right",
      value: (e: ExpertRow) => e.walletBalance,
      filterable: false,
    },
    { key: "status", label: "Status", value: (e: ExpertRow) => e.status },
  ]);
  const allRows = sf.rows;
  const filterSig = [zoneId, kycStatus, level, availability, mode, statusF, skillF, riderSearch, allRows.length].join("|");
  useEffect(() => setPage(1), [filterSig]);
  const experts = isRider ? allRows : allRows.slice((page - 1) * pageSize, page * pageSize);
  const moreCount = [zoneId, kycStatus, level, mode].filter(Boolean).length;
  const hasFilters = !!(riderSearch || skillF || availability || moreCount || statusF !== (skill ? "active" : ""));
  const clearFilters = () => { setRiderSearch(""); setSkillF(""); setAvailability(""); setZoneId(""); setKycStatus(""); setLevel(""); setMode(""); setStatusF(skill ? "active" : ""); };
  const hr = workHourRanges();
  const showAppsChip = !skill && canManage;

  if (showAppsChip && view === "applications") return (
    <div className="space-y-4"><ViewChips view={view} setView={setView} count={appsCount.data ?? 0} /><ExpertApplicationsPanel /></div>
  );

  return (
    <>
    {!isRider && (
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {showAppsChip && <ViewChips view={view} setView={setView} count={appsCount.data ?? 0} />}
        <OldAppBadge active={oldOnly} onClick={() => setOldOnly(!oldOnly)} />
      </div>
    )}
    <div className="space-y-6">
      {isRider ? (
      <div className="bg-card border border-border rounded-[18px] p-4 flex flex-wrap items-end gap-3">
        <input
          placeholder="Search name or phone"
          value={riderSearch}
          onChange={(e) => setRiderSearch(e.target.value)}
          className="h-10 w-[240px] rounded-[12px] border border-border bg-background px-3 text-[13px] text-foreground"
        />
        <Filter label="Status" value={riderStatus} onChange={setRiderStatus}>
          <option value="">All statuses</option>
          <option value="free">Free</option>
          <option value="busy">Busy</option>
          <option value="offline">Offline</option>
          <option value="inactive">Inactive</option>
        </Filter>
        {canManage && (
          <button
            onClick={() => setAddOpen(true)}
            className="ml-auto h-10 px-4 rounded-[12px] bg-primary text-primary-foreground text-[13px] font-bold inline-flex items-center gap-2 hover:opacity-95"
          >
            <Plus size={16} />
            Add rider
          </button>
        )}
      </div>
      ) : (
      <div className="bg-card border border-border rounded-[18px] p-4 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Search</label>
          <input
            placeholder="Name or phone"
            value={riderSearch}
            onChange={(e) => setRiderSearch(e.target.value)}
            className="h-10 w-[220px] rounded-[12px] border border-border bg-card px-3 text-[13px] text-foreground"
          />
        </div>
        {!skill && (
          <Filter label="Skill" value={skillF} onChange={(v) => setSkillF(v as typeof skillF)}>
            <option value="">All skills</option>
            <option value="maid">Maid</option>
            <option value="wash">Washer</option>
            <option value="rider">Rider</option>
          </Filter>
        )}
        <Filter label="Status" value={statusF} onChange={setStatusF}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="">All statuses</option>
        </Filter>
        <Filter label="Online" value={availability} onChange={setAvailability}>
          <option value="">Online & offline</option>
          <option value="online">Online</option>
          <option value="online_free">Online & free</option>
          <option value="offline">Offline</option>
        </Filter>
        <button
          onClick={() => setMoreOpen((v) => !v)}
          className="h-10 px-3 rounded-[12px] border border-border text-[13px] font-semibold hover:bg-muted"
        >
          More filters{moreCount ? ` (${moreCount})` : ""}
        </button>
        {hasFilters && (
          <button onClick={clearFilters} className="h-10 text-[12px] font-semibold text-primary hover:underline">Clear filters</button>
        )}
        <span className="ml-auto self-center text-[12px] text-muted-foreground">
          {isLoading ? "Loading…" : `${allRows.length} of ${expertsRaw.length}`}
        </span>
        {canManage && (
          <button
            onClick={() => setAddOpen(true)}
            className="h-10 px-4 rounded-[12px] bg-primary text-primary-foreground text-[13px] font-bold inline-flex items-center gap-2 hover:opacity-95"
          >
            <Plus size={16} />
            Add Expert
          </button>
        )}
      </div>
      {moreOpen && (
      <div className="flex flex-wrap items-end gap-3 pt-3 border-t border-border">
        {showZoneFilter && (
          <Filter label="Zone" value={zoneId} onChange={setZoneId}>
            <option value="">All zones</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>{z.name}</option>
            ))}
          </Filter>
        )}
        <Filter label="KYC" value={kycStatus} onChange={setKycStatus}>
          <option value="">All KYC statuses</option>
          {KYC_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </Filter>
        <Filter label="Level" value={level} onChange={setLevel}>
          <option value="">All levels</option>
          {LEVELS.map((s) => <option key={s} value={s}>{s}</option>)}
        </Filter>
        <Filter label="Mode" value={mode} onChange={setMode}>
          <option value="">All modes</option>
          <option value="TRAINING">Training</option>
          <option value="LIVE">Live</option>
        </Filter>
      </div>
      )}
      </div>
      )}

      {!isRider && (
      <div className="flex justify-end">
        <SortFilterReset api={sf} />
      </div>
      )}

      {isRider ? (
        <div className="bg-card border border-border rounded-[18px] overflow-x-auto">
          <div className="grid grid-cols-[56px_minmax(180px,2fr)_120px_100px_90px_90px_110px] min-w-[800px] gap-4 px-6 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <span>Photo</span><span>Name</span><span>Phone</span><span>Vehicle</span><span>Status</span><span className="text-right">Today</span><span className="text-right">This week</span>
          </div>
          {isLoading && <p className="text-[13px] text-muted-foreground text-center py-10">Loading…</p>}
          {!isLoading && experts.length === 0 && <p className="text-[13px] text-muted-foreground text-center py-10">No riders found.</p>}
          {experts.map((e) => {
            const st = riderState(e);
            const cls = st === "free" ? "bg-primary/10 text-primary" : st === "busy" ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground";
            return (
              <button key={e.id} onClick={() => setDetailsId(e.id)} className="w-full grid grid-cols-[56px_minmax(180px,2fr)_120px_100px_90px_90px_110px] min-w-[800px] gap-4 items-center px-6 py-3 border-b border-border last:border-b-0 text-[14px] text-left hover:bg-muted/40">
                <ExpertAvatar url={e.photoUrl} />
                <span className="font-semibold text-foreground break-words">{e.name}</span>
                <span className="font-mono text-[12px] text-muted-foreground">{e.phone}</span>
                <span className="text-[12px] text-muted-foreground truncate">{riderStats?.vehicle.get(e.id) || "—"}</span>
                <span><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold capitalize ${cls}`}>{st}</span></span>
                <span className="text-right text-foreground">{riderStats?.deliveries.get(e.id) ?? 0}</span>
                <span className="text-right text-foreground">₹{Math.round(riderStats?.earnings.get(e.id) ?? 0)}</span>
              </button>
            );
          })}
        </div>
      ) : (
      <div className="bg-card border border-border rounded-[18px] overflow-x-auto">
        <div className="grid grid-cols-[56px_minmax(220px,2.5fr)_110px_minmax(90px,0.8fr)_80px_80px_90px_100px] min-w-[900px] gap-4 px-6 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <span>Photo</span>
          <SortFilterHeader {...sf.headerProps("name")} />
          <SortFilterHeader {...sf.headerProps("phone")} />
          <SortFilterHeader {...sf.headerProps("zone")} />
          <span title={`${hr.weekFrom} – ${hr.weekTo} (Mon–today)`}><SortFilterHeader {...sf.headerProps("lastWeek")} /></span>
          <span title={`${hr.monthFrom} – ${hr.today}`}><SortFilterHeader {...sf.headerProps("month")} /></span>
          <SortFilterHeader {...sf.headerProps("wallet")} />
          <SortFilterHeader {...sf.headerProps("status")} />
        </div>

        {isLoading && (
          <p className="text-[13px] text-muted-foreground text-center py-10">Loading…</p>
        )}
        {isError && (
          <p className="text-[13px] text-destructive text-center py-10">Failed to load experts.</p>
        )}
        {!isLoading && !isError && experts.length === 0 && (
          <EmptyState text="No experts found." onClear={hasFilters ? clearFilters : undefined} />
        )}

        {experts.map((e) => (
          <ExpertRowItem
            key={e.id}
            expert={e}
            noDevice={noDevice.has(e.id)}
            onLeave={leaveQ.data?.has(e.id) ?? false}
            onToggleLeave={canLeave && e.status === "active" ? (on) => toggleLeave(e.id, on) : undefined}
            onOpen={() => setDetailsId(e.id)}
          />
        ))}
        {allRows.length > 0 && (
          <DataTablePagination page={page} pageSize={pageSize} total={allRows.length} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
        )}
      </div>
      )}

      {addOpen && canManage && (
        <ExpertFormModal
          expertId={null}
          onClose={() => setAddOpen(false)}
          presetSkillIds={isRider ? riderSkillIds : undefined}
          title={isRider ? "Add rider" : undefined}
        />
      )}
      {editId && canManage && (
        <ExpertFormModal expertId={editId} onClose={() => setEditId(null)} />
      )}
      {detailsId && (
        <ExpertDetailsModal
          expertId={detailsId}
          role={role}
          onClose={() => setDetailsId(null)}
          onEdit={canManage ? () => { setEditId(detailsId); setDetailsId(null); } : undefined}
        />
      )}
    </div>
    </>
  );
}

function riderState(e: ExpertRow): "free" | "busy" | "offline" | "inactive" {
  if (e.status !== "active") return "inactive";
  return e.isBusy ? "busy" : e.isOnline ? "free" : "offline";
}

function rank(e: ExpertRow) {
  if (e.status !== "active") return 3;
  return e.isBusy ? 0 : e.isOnline ? 1 : 2;
}

function Filter({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 px-3 rounded-[12px] border border-border bg-card text-[13px] min-w-[160px]"
      >
        {children}
      </select>
    </div>
  );
}

function ExpertRowItem({ expert, noDevice, onOpen, onLeave, onToggleLeave }: { expert: ExpertRow; noDevice?: boolean; onOpen: () => void; onLeave?: boolean; onToggleLeave?: (on: boolean) => void }) {
  const showCity = useShowCity();
  return (
    <button
      onClick={onOpen}
      className="w-full grid grid-cols-[56px_minmax(220px,2.5fr)_110px_minmax(90px,0.8fr)_80px_80px_90px_100px] min-w-[900px] gap-4 items-center px-6 py-3 border-b border-border last:border-b-0 text-[14px] text-left hover:bg-muted/40 transition-colors"
    >
      <ExpertAvatar url={expert.photoUrl} />
      <span className="min-w-0 flex flex-col gap-1">
        <span className="font-semibold text-foreground break-words">{expert.name}</span>
        <span className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1">
          <ExpertModeBadge mode={expert.mode} />
          <span className="shrink-0 text-[11px] text-muted-foreground" title="Expert App version (build)">
            {expert.appVersion || expert.appVersionCode != null ? `App v${expert.appVersion ?? "?"} (${expert.appVersionCode ?? "?"})` : "App version —"}
          </span>
          {noDevice && expert.status === "active" && (
            <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-[11px] font-bold whitespace-nowrap"
              title="No phone registered for job alerts — not counted as available">
              Not receiving job alerts
            </span>
          )}
          {onLeave && (
            <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full bg-muted text-foreground text-[11px] font-bold">On leave today</span>
          )}
          {onToggleLeave && (
            <span role="button" tabIndex={0}
              onClick={(ev) => { ev.stopPropagation(); onToggleLeave(!onLeave); }}
              onKeyDown={(ev) => { if (ev.key === "Enter") { ev.stopPropagation(); onToggleLeave(!onLeave); } }}
              className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full border border-border text-[11px] font-semibold text-foreground hover:bg-muted">
              {onLeave ? "Clear leave" : "Mark on leave today"}
            </span>
          )}
          {expert.isBusy && (
            <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[11px] font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              Busy
            </span>
          )}
          {expert.avgRating != null ? (
            <span
              className="shrink-0 inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-warning/20 text-foreground text-[11px] font-bold"
              title={`${expert.ratingCount} rating${expert.ratingCount === 1 ? "" : "s"}`}
            >
              ★ {expert.avgRating.toFixed(1)}
              <span className="font-medium text-muted-foreground">({expert.ratingCount})</span>
            </span>
          ) : (
            <span className="shrink-0 text-[11px] text-muted-foreground">No rating</span>
          )}
        </span>
      </span>
      <span className="font-mono text-[12px] text-muted-foreground">{expert.phone}</span>
      <span className="text-muted-foreground truncate">
        {showCity && <span className="mr-1 font-semibold text-foreground"><CityName id={expert.cityId} /> ·</span>}
        {expert.zoneNames?.length ? (
          <span className="inline-flex flex-wrap gap-1">
            {expert.zoneNames.slice(0, 2).map((n) => (
              <span
                key={n}
                className="px-2 py-0.5 rounded-full bg-muted text-[11px] font-semibold text-foreground"
              >
                {n}
              </span>
            ))}
            {expert.zoneNames.length > 2 && (
              <span className="px-2 py-0.5 rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                +{expert.zoneNames.length - 2}
              </span>
            )}
          </span>
        ) : (
          <span className="italic">Unassigned</span>
        )}
      </span>

      <span className="text-right font-semibold text-foreground">{fmtHrs(expert.lastWeekMinutes)}</span>
      <span className="text-right font-semibold text-foreground">{fmtHrs(expert.monthMinutes)}</span>
      <span className="text-right font-semibold text-foreground">{inr.format(expert.walletBalance)}</span>
      <span className="flex flex-col items-start gap-0.5">
        {expert.status !== "active" ? (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide bg-muted text-muted-foreground">Inactive</span>
        ) : (
          <span
            title={expert.isOnline ? (expert.isBusy ? "Online — on a job" : "Online") : "Offline"}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide ${
              expert.isOnline ? (expert.isBusy ? "bg-accent text-accent-foreground" : "bg-primary-tint text-primary") : "bg-muted text-muted-foreground"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${expert.isOnline ? (expert.isBusy ? "bg-amber-500" : "bg-emerald-500") : "bg-muted-foreground/40"}`} />
            {expert.isOnline ? (expert.isBusy ? "Busy" : "Online") : "Offline"}
          </span>
        )}
      </span>
    </button>
  );
}

function ExpertAvatar({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="w-10 h-10 rounded-full bg-primary-tint text-primary flex items-center justify-center overflow-hidden">
      {url && !failed ? (
        <img src={url} alt="" className="w-full h-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <UserRound size={18} />
      )}
    </div>
  );
}

function fmtHrs(m: number) {
  return `${(m / 60).toFixed(1)} hrs`;
}
