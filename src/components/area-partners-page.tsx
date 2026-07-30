import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Handshake, Pencil, Trash2, UserRound, AlertTriangle } from "lucide-react";
import {
  listAllAreaPartners,
  deleteAreaPartner,
  type AreaPartnerRow,
  type PartnerKycStatus,
} from "@/lib/area-partners.functions";
import { AreaPartnerFormModal } from "@/components/area-partner-form-modal";
import { AreaPartnerDetailsModal } from "@/components/area-partner-details-modal";

type StaffRole = "super_admin" | "ops_manager" | "area_partner";

const KYC_STYLES: Record<PartnerKycStatus, string> = {
  pending: "bg-amber-50 text-amber-700",
  approved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-red-50 text-red-700",
};

const GRID =
  "grid grid-cols-[48px_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.1fr)_120px_110px_110px_100px_92px] gap-4";

export function AreaPartnersPage({ role = null }: { role?: StaffRole | null }) {
  const canManage = role === "super_admin" || role === "ops_manager";
  const canDelete = role === "super_admin";

  const [showDeleted, setShowDeleted] = useState(false);
  const fetchPartners = useServerFn(listAllAreaPartners);
  const { data = [], isLoading, isError } = useQuery({
    queryKey: ["area-partners", "list", { showDeleted: canDelete && showDeleted }],
    queryFn: () => fetchPartners({ data: { includeDeleted: canDelete && showDeleted } }),
    staleTime: 30_000,
  });

  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AreaPartnerRow | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-[14px] text-muted-foreground">
          Manage area partners, KYC & payouts. Zone assignment happens on the Zones page.
        </p>
        <div className="flex items-center gap-3">
          {canDelete && (
            <label className="inline-flex items-center gap-2 text-[13px] text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={showDeleted}
                onChange={(e) => setShowDeleted(e.target.checked)}
                className="w-4 h-4 accent-[var(--color-primary,#00B97A)]"
              />
              Show deleted
            </label>
          )}
          {canManage && (
            <button
              onClick={() => { setEditId(null); setFormOpen(true); }}
              className="h-[52px] px-5 rounded-[14px] bg-primary text-white text-[14px] font-bold inline-flex items-center gap-2 hover:opacity-95"
            >
              <Plus size={18} />
              Add Area Partner
            </button>
          )}
        </div>
      </div>

      <div className="bg-card border border-border rounded-[18px] overflow-hidden">
        <div className={`${GRID} px-6 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground`}>
          <span></span>
          <span>Name</span>
          <span>Phone</span>
          <span>Assigned Zone</span>
          <span>Setup Fee</span>
          <span className="text-right">Commission</span>
          <span>KYC</span>
          <span>Status</span>
          <span className="text-right">Actions</span>
        </div>

        {isLoading && <p className="text-[13px] text-muted-foreground text-center py-10">Loading…</p>}
        {isError && <p className="text-[13px] text-destructive text-center py-10">Failed to load.</p>}
        {!isLoading && !isError && data.length === 0 && (
          <p className="text-[13px] text-muted-foreground text-center py-10">No area partners yet.</p>
        )}

        {data.map((p) => (
          <div
            key={p.id}
            className={`${GRID} items-center px-6 py-4 border-b border-border last:border-b-0 text-[14px] hover:bg-muted/40 transition-colors ${p.deletedAt ? "opacity-60" : ""}`}
          >
            <button
              onClick={() => setDetailsId(p.id)}
              className="w-8 h-8 rounded-lg bg-primary-tint text-primary flex items-center justify-center overflow-hidden"
              aria-label={`Open ${p.name}`}
            >
              {p.photoUrl ? <UserRound size={16} /> : <Handshake size={16} />}
            </button>
            <button onClick={() => setDetailsId(p.id)} className="text-left font-semibold text-foreground truncate">
              {p.name}
              {p.deletedAt && (
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-red-50 text-red-700">
                  deleted
                </span>
              )}
            </button>
            <span className="font-mono text-[13px] text-muted-foreground truncate">{p.phone}</span>
            <span className="truncate">
              {p.zoneName ? (
                <span className="text-foreground">{p.zoneName}</span>
              ) : (
                <span className="italic text-muted-foreground">Unassigned</span>
              )}
            </span>
            <span>
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide ${p.setupFeeStatus === "paid" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                {p.setupFeeStatus}
              </span>
            </span>
            <span className="text-right font-semibold text-foreground">{p.commissionRate}%</span>
            <span>
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide ${KYC_STYLES[p.kycStatus]}`}>
                {p.kycStatus}
              </span>
            </span>
            <span>
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide ${p.status === "active" ? "bg-primary-tint text-primary" : "bg-muted text-muted-foreground"}`}>
                {p.status}
              </span>
            </span>
            <span className="flex items-center justify-end gap-1">
              {canManage && !p.deletedAt && (
                <button
                  onClick={() => { setEditId(p.id); setFormOpen(true); }}
                  aria-label={`Edit ${p.name}`}
                  title="Edit"
                  className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Pencil size={16} />
                </button>
              )}
              {canDelete && !p.deletedAt && (
                <button
                  onClick={() => setDeleting(p)}
                  aria-label={`Delete ${p.name}`}
                  title="Delete"
                  className="w-9 h-9 rounded-full flex items-center justify-center text-destructive hover:bg-red-50"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </span>
          </div>
        ))}
      </div>

      {formOpen && canManage && (
        <AreaPartnerFormModal
          partnerId={editId}
          onClose={() => { setFormOpen(false); setEditId(null); }}
        />
      )}

      {detailsId && (
        <AreaPartnerDetailsModal
          partnerId={detailsId}
          role={role}
          onClose={() => setDetailsId(null)}
          onEdit={canManage ? () => { setEditId(detailsId); setFormOpen(true); setDetailsId(null); } : undefined}
          onDelete={
            canDelete
              ? () => {
                  const p = data.find((x) => x.id === detailsId) ?? null;
                  setDetailsId(null);
                  if (p) setDeleting(p);
                }
              : undefined
          }
        />
      )}

      {deleting && canDelete && (
        <DeletePartnerModal partner={deleting} onClose={() => setDeleting(null)} />
      )}
    </div>
  );
}

function DeletePartnerModal({
  partner,
  onClose,
}: {
  partner: AreaPartnerRow;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const remove = useServerFn(deleteAreaPartner);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => remove({ data: { partnerId: partner.id, reason: reason.trim() } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["area-partners"] });
      queryClient.invalidateQueries({ queryKey: ["zones"] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Delete failed"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-0 sm:p-6 bg-foreground/50" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-card w-full sm:max-w-[520px] sm:rounded-[24px] overflow-hidden shadow-xl">
        <header className="px-6 py-4 border-b border-border">
          <h2 className="text-[18px] font-bold text-foreground">Delete “{partner.name}”?</h2>
        </header>
        <div className="px-6 py-6 space-y-4">
          <p className="text-[14px] text-muted-foreground">
            This soft-deletes the partner. They will be hidden from active lists and dropdowns but
            remain visible via “Show deleted”.
          </p>
          {partner.zoneName && (
            <p className="text-[13px] text-amber-800 bg-amber-50 border border-amber-100 rounded-[12px] p-3 flex items-start gap-2">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>
                This partner is assigned to Zone <strong>{partner.zoneName}</strong> — deleting will
                leave the zone unassigned.
              </span>
            </p>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Reason *
            </label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this partner being deleted?"
              className="h-11 w-full px-3 rounded-[14px] border border-border bg-card text-[14px]"
            />
          </div>
          {error && <p className="text-[13px] text-destructive">{error}</p>}
        </div>
        <footer className="px-6 py-4 border-t border-border flex items-center justify-end gap-3">
          <button onClick={onClose} className="h-11 px-4 rounded-[14px] border border-border text-foreground font-semibold text-[14px]">
            Cancel
          </button>
          <button
            disabled={!reason.trim() || mutation.isPending}
            onClick={() => { setError(null); mutation.mutate(); }}
            className="h-11 px-5 rounded-[14px] bg-destructive text-white font-bold text-[14px] disabled:opacity-50 inline-flex items-center gap-2"
          >
            <Trash2 size={16} />
            {mutation.isPending ? "Deleting…" : "Delete partner"}
          </button>
        </footer>
      </div>
    </div>
  );
}
