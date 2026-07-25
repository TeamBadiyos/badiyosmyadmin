import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, UserRound } from "lucide-react";
import { listExperts, type ExpertLevel, type KycStatus, type ExpertRow } from "@/lib/experts.functions";
import { listZoneOptions } from "@/lib/bookings.functions";
import { ExpertFormModal } from "@/components/expert-form-modal";
import { ExpertDetailsModal } from "@/components/expert-details-modal";

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

export function ExpertsPage({ role }: { role: StaffRole | null }) {
  const canManage = role === "super_admin" || role === "ops_manager";
  const showZoneFilter = role !== "area_partner";

  const [zoneId, setZoneId] = useState("");
  const [kycStatus, setKycStatus] = useState("");
  const [level, setLevel] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);

  const fetchExperts = useServerFn(listExperts);
  const fetchZones = useServerFn(listZoneOptions);

  const filters = useMemo(
    () => ({ zoneId: zoneId || null, kycStatus: kycStatus || null, level: level || null }),
    [zoneId, kycStatus, level],
  );

  const { data: zones = [] } = useQuery({
    queryKey: ["experts", "zone-options"],
    queryFn: () => fetchZones(),
    staleTime: 60_000,
  });

  const { data: experts = [], isLoading, isError } = useQuery({
    queryKey: ["experts", "list", filters],
    queryFn: () => fetchExperts({ data: filters }),
    staleTime: 15_000,
  });

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
      </div>

      <div className="bg-card border border-border rounded-[18px] overflow-hidden">
        <div className="grid grid-cols-[60px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_100px_110px_120px_100px] gap-4 px-6 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <span>Photo</span>
          <span>Name</span>
          <span>Phone</span>
          <span>Zone</span>
          <span>Level</span>
          <span>KYC</span>
          <span className="text-right">Wallet</span>
          <span>Status</span>
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
      className="w-full grid grid-cols-[60px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_100px_110px_120px_100px] gap-4 items-center px-6 py-3 border-b border-border last:border-b-0 text-[14px] text-left hover:bg-muted/40 transition-colors"
    >
      <div className="w-10 h-10 rounded-full bg-primary-tint text-primary flex items-center justify-center overflow-hidden">
        {expert.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={expert.photoUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <UserRound size={18} />
        )}
      </div>
      <span className="font-semibold text-foreground truncate">{expert.name}</span>
      <span className="font-mono text-[13px] text-muted-foreground truncate">{expert.phone}</span>
      <span className="text-muted-foreground truncate">
        {expert.zoneName ?? <span className="italic">Unassigned</span>}
      </span>
      <span>
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide ${LEVEL_STYLES[expert.level]}`}>
          {expert.level}
        </span>
      </span>
      <span>
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide ${KYC_STYLES[expert.kycStatus]}`}>
          {expert.kycStatus}
        </span>
      </span>
      <span className="text-right font-semibold text-foreground">{inr.format(expert.walletBalance)}</span>
      <span>
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide ${expert.status === "active" ? "bg-primary-tint text-primary" : "bg-muted text-muted-foreground"}`}>
          {expert.status}
        </span>
      </span>
    </button>
  );
}
