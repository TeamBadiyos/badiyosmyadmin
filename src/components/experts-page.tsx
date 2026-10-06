import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, UserRound } from "lucide-react";
import { listExperts, type ExpertLevel, type KycStatus, type ExpertRow } from "@/lib/experts.functions";
import { listZoneOptions } from "@/lib/bookings.functions";
import { ExpertModeBadge } from "@/components/expert-mode-badge";
import { ExpertFormModal } from "@/components/expert-form-modal";
import { ExpertDetailsModal } from "@/components/expert-details-modal";
import {
  useSortFilter,
  SortFilterHeader,
  SortFilterReset,
} from "@/components/table-sort-filter";

type StaffRole = "super_admin" | "ops_manager" | "area_partner";

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
}: {
  role: StaffRole | null;
  initialOnlineOnly?: boolean;
}) {
  const canManage = role === "super_admin" || role === "ops_manager";
  const showZoneFilter = role !== "area_partner";

  const [zoneId, setZoneId] = useState("");
  const [kycStatus, setKycStatus] = useState("");
  const [level, setLevel] = useState("");
  const [availability, setAvailability] = useState<string>(
    initialOnlineOnly ? "online_free" : "",
  );
  const [mode, setMode] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);

  useEffect(() => {
    setAvailability(initialOnlineOnly ? "online_free" : "");
  }, [initialOnlineOnly]);

  const fetchExperts = useServerFn(listExperts);
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

  const expertsFiltered = (
    availability === "online_free" ? expertsRaw.filter((e) => !e.isBusy) : expertsRaw
  ).filter((e) => !mode || e.mode === mode);

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
  const experts = sf.rows;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-[14px] text-muted-foreground">
          {canManage ? "Manage experts, KYC & payouts." : "Experts in your assigned zone."}
        </p>
        {canManage && (
          <button
            onClick={() => setAddOpen(true)}
            className="h-[52px] px-5 rounded-[14px] bg-primary text-white text-[14px] font-bold inline-flex items-center gap-2 hover:opacity-95"
          >
            <Plus size={18} />
            Add Expert
          </button>
        )}
      </div>

      <div className="bg-card border border-border rounded-[18px] p-4 flex flex-wrap items-end gap-3">
        {showZoneFilter && (
          <Filter label="Zone" value={zoneId} onChange={setZoneId}>
            <option value="">All zones</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>{z.name}</option>
            ))}
          </Filter>
        )}
        <Filter label="KYC status" value={kycStatus} onChange={setKycStatus}>
          <option value="">All KYC</option>
          {KYC_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </Filter>
        <Filter label="Level" value={level} onChange={setLevel}>
          <option value="">All levels</option>
          {LEVELS.map((s) => <option key={s} value={s}>{s}</option>)}
        </Filter>
        <Filter label="Availability" value={availability} onChange={setAvailability}>
          <option value="">All experts</option>
          <option value="online">Online only</option>
          <option value="online_free">Online & free</option>
        </Filter>
        <Filter label="Mode" value={mode} onChange={setMode}>
          <option value="">All</option>
          <option value="TRAINING">Training</option>
          <option value="LIVE">Live</option>
        </Filter>
      </div>

      <div className="flex justify-end">
        <SortFilterReset api={sf} />
      </div>

      <div className="bg-card border border-border rounded-[18px] overflow-x-auto">
        <div className="grid grid-cols-[56px_minmax(220px,2.5fr)_110px_minmax(90px,0.8fr)_90px_100px] min-w-[720px] gap-4 px-6 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <span>Photo</span>
          <SortFilterHeader {...sf.headerProps("name")} />
          <SortFilterHeader {...sf.headerProps("phone")} />
          <SortFilterHeader {...sf.headerProps("zone")} />
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
          <p className="text-[13px] text-muted-foreground text-center py-10">No experts yet.</p>
        )}

        {experts.map((e) => (
          <ExpertRowItem
            key={e.id}
            expert={e}
            onOpen={() => setDetailsId(e.id)}
          />
        ))}
      </div>

      {addOpen && canManage && (
        <ExpertFormModal expertId={null} onClose={() => setAddOpen(false)} />
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
  );
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

function ExpertRowItem({ expert, onOpen }: { expert: ExpertRow; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="w-full grid grid-cols-[56px_minmax(220px,2.5fr)_110px_minmax(90px,0.8fr)_90px_100px] min-w-[720px] gap-4 items-center px-6 py-3 border-b border-border last:border-b-0 text-[14px] text-left hover:bg-muted/40 transition-colors"
    >
      <ExpertAvatar url={expert.photoUrl} />
      <span className="min-w-0 flex flex-col gap-1">
        <span className="font-semibold text-foreground break-words">{expert.name}</span>
        <span className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1">
          <ExpertModeBadge mode={expert.mode} />
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

      <span className="text-right font-semibold text-foreground">{inr.format(expert.walletBalance)}</span>
      <span className="flex items-center gap-1.5 flex-wrap">
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide ${expert.status === "active" ? "bg-primary-tint text-primary" : "bg-muted text-muted-foreground"}`}>
          {expert.status}
        </span>
        {expert.isOnline && (
          <span
            title={expert.isBusy ? "Online — on a job" : "Online — free"}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${expert.isBusy ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${expert.isBusy ? "bg-amber-500" : "bg-emerald-500"}`} />
            {expert.isBusy ? "busy" : "live"}
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
