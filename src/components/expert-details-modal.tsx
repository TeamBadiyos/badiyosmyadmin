import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { X, ExternalLink, Check, Ban, RotateCcw, Pencil, UserRound } from "lucide-react";
import {
  getExpert,
  kycDecision,
  signStorageUrl,
  type KycStatus,
} from "@/lib/experts.functions";
import { listExpertSkills } from "@/lib/partner-skills.functions";

type StaffRole = "super_admin" | "ops_manager" | "area_partner";

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

export function ExpertDetailsModal({
  expertId,
  role,
  onClose,
  onEdit,
}: {
  expertId: string;
  role: StaffRole | null;
  onClose: () => void;
  onEdit?: () => void;
}) {
  const queryClient = useQueryClient();
  const fetch = useServerFn(getExpert);
  const decide = useServerFn(kycDecision);
  const sign = useServerFn(signStorageUrl);
  const fetchSkills = useServerFn(listExpertSkills);

  const { data: skills = [] } = useQuery({
    queryKey: ["partner-skills", "expert", expertId],
    queryFn: () => fetchSkills({ data: { expertId } }),
    staleTime: 30_000,
  });
  const approvedSkills = skills.filter((s) => s.status === "approved");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["experts", "details", expertId],
    queryFn: () => fetch({ data: { id: expertId } }),
  });

  const canManage = role === "super_admin" || role === "ops_manager";
  const canReset = role === "super_admin";

  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!data?.photoUrl) { setPhotoUrl(null); return; }
    (async () => {
      try {
        const res = await sign({ data: { bucket: "expert-photos", path: data.photoUrl! } });
        if (!cancelled) setPhotoUrl(res.url);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [data?.photoUrl, sign]);

  const mutation = useMutation({
    mutationFn: (payload: { decision: KycStatus; reason?: string }) =>
      decide({ data: { expertId, decision: payload.decision, reason: payload.reason } }),
    onSuccess: () => {
      setRejectOpen(false); setReason(""); setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["experts", "details", expertId] });
      queryClient.invalidateQueries({ queryKey: ["experts", "list"] });
    },
    onError: (e) => setActionError(e instanceof Error ? e.message : "Action failed"),
  });

  async function openDoc(path: string) {
    try {
      const res = await sign({ data: { bucket: "expert-kyc-docs", path } });
      window.open(res.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not open document");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-0 sm:p-6 bg-foreground/50"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-card w-full sm:max-w-[760px] max-h-[100vh] sm:max-h-[92vh] sm:rounded-[24px] overflow-hidden shadow-xl flex flex-col"
      >
        <header className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Expert</p>
            <h2 className="text-[18px] font-bold text-foreground">
              {data?.name ?? (isLoading ? "Loading…" : "—")}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {onEdit && (
              <button
                onClick={onEdit}
                className="h-10 px-3 rounded-[12px] border border-border text-foreground font-semibold text-[13px] inline-flex items-center gap-2 hover:bg-muted"
              >
                <Pencil size={14} /> Edit
              </button>
            )}
            <button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted">
              <X size={20} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {isLoading && <p className="text-[14px] text-muted-foreground">Loading…</p>}
          {isError && (
            <p className="text-[14px] text-destructive">
              {(error as Error)?.message ?? "Failed to load expert."}
            </p>
          )}
          {data && (
            <>
              <section className="flex items-start gap-4">
                <div className="w-20 h-20 rounded-full bg-primary-tint text-primary flex items-center justify-center overflow-hidden shrink-0">
                  {photoUrl ? (
                    <img src={photoUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <UserRound size={28} />
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={KYC_STYLES[data.kycStatus]}>KYC {data.kycStatus}</Badge>
                  <Badge className={data.status === "active" ? "bg-primary-tint text-primary" : "bg-muted text-muted-foreground"}>
                    {data.status}
                  </Badge>
                  <Badge className="bg-slate-100 text-slate-700">Level {data.level}</Badge>
                  <Badge className="bg-blue-50 text-blue-700">Wallet {inr.format(data.walletBalance)}</Badge>
                  <Badge className="bg-slate-100 text-slate-700">
                    Deposit {data.securityDepositStatus}
                  </Badge>
                  <Badge className="bg-emerald-50 text-emerald-700">
                    {approvedSkills.length} approved skill{approvedSkills.length === 1 ? "" : "s"}
                  </Badge>
                </div>
              </section>

              <section className="bg-background border border-border rounded-[18px] p-4">
                <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
                  Approved skills
                </h3>
                {approvedSkills.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">No approved skills yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {approvedSkills.map((s) => (
                      <Badge key={s.id} className="bg-emerald-50 text-emerald-700">
                        {s.categoryName}
                      </Badge>
                    ))}
                  </div>
                )}
              </section>

              <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card title="Contact">
                  <Row label="Phone" value={data.phone} mono />
                  <Row label="Address" value={data.address ?? "—"} />
                  <Row label="Zone" value={data.zoneName ?? "Unassigned"} />
                </Card>
                <Card title="Bank">
                  <Row label="Holder" value={data.bankAccountHolderName ?? "—"} />
                  <Row label="Account" value={data.bankAccountNumber ?? "—"} mono />
                  <Row label="IFSC" value={data.bankIfsc ?? "—"} mono />
                </Card>
              </section>

              <section className="bg-background border border-border rounded-[18px] p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">
                    KYC review
                  </h3>
                  <Badge className={KYC_STYLES[data.kycStatus]}>{data.kycStatus}</Badge>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                  <DocLink label="Aadhaar" path={data.kycAadhaarPath} onOpen={openDoc} />
                  <DocLink label="PAN" path={data.kycPanPath} onOpen={openDoc} />
                  <DocLink label="Address proof" path={data.kycAddressProofPath} onOpen={openDoc} />
                </div>

                {data.kycStatus === "rejected" && data.kycRejectionReason && (
                  <p className="text-[13px] text-red-700 bg-red-50 border border-red-100 rounded-[12px] p-3 mb-3">
                    <span className="font-bold uppercase text-[11px] tracking-wide mr-2">Reason</span>
                    {data.kycRejectionReason}
                  </p>
                )}

                {canManage && data.kycStatus === "pending" && !rejectOpen && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      disabled={mutation.isPending}
                      onClick={() => mutation.mutate({ decision: "approved" })}
                      className="h-11 px-4 rounded-[14px] bg-primary text-white font-bold text-[14px] disabled:opacity-50 inline-flex items-center gap-2"
                    >
                      <Check size={16} /> Approve KYC
                    </button>
                    <button
                      onClick={() => setRejectOpen(true)}
                      className="h-11 px-4 rounded-[14px] border border-destructive text-destructive font-bold text-[14px] inline-flex items-center gap-2 hover:bg-red-50"
                    >
                      <Ban size={16} /> Reject KYC
                    </button>
                  </div>
                )}

                {canManage && rejectOpen && (
                  <div className="rounded-[14px] border border-border bg-card p-3 space-y-3">
                    <label className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
                      Rejection reason
                    </label>
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Explain why KYC is being rejected"
                      className="w-full h-11 px-3 rounded-[14px] border border-border bg-card text-[14px]"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        disabled={!reason.trim() || mutation.isPending}
                        onClick={() => mutation.mutate({ decision: "rejected", reason })}
                        className="h-11 px-4 rounded-[14px] bg-destructive text-white font-bold text-[14px] disabled:opacity-50 inline-flex items-center gap-2"
                      >
                        <Ban size={16} />
                        {mutation.isPending ? "Rejecting…" : "Confirm reject"}
                      </button>
                      <button
                        onClick={() => { setRejectOpen(false); setReason(""); }}
                        className="h-11 px-4 rounded-[14px] border border-border text-foreground font-semibold text-[14px]"
                      >
                        Back
                      </button>
                    </div>
                  </div>
                )}

                {canReset && data.kycStatus !== "pending" && (
                  <button
                    disabled={mutation.isPending}
                    onClick={() => mutation.mutate({ decision: "pending" })}
                    className="mt-3 h-10 px-3 rounded-[12px] border border-border text-foreground font-semibold text-[13px] inline-flex items-center gap-2 hover:bg-muted"
                  >
                    <RotateCcw size={14} /> Reset to Pending
                  </button>
                )}

                {actionError && (
                  <p className="mt-3 text-[12px] text-destructive">{actionError}</p>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-background border border-border rounded-[18px] p-4">
      <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">{title}</h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2 py-1">
      <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground w-24 shrink-0 pt-0.5">
        {label}
      </span>
      <span className={`text-[13px] text-foreground break-all ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide ${className ?? ""}`}>
      {children}
    </span>
  );
}

function DocLink({ label, path, onOpen }: { label: string; path: string | null; onOpen: (p: string) => void }) {
  return (
    <div className="border border-border rounded-[14px] p-3 flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-[13px] text-foreground truncate">
          {path ? path.split("/").pop() : <span className="italic text-muted-foreground">Not uploaded</span>}
        </p>
      </div>
      {path && (
        <button
          onClick={() => onOpen(path)}
          className="w-9 h-9 rounded-full flex items-center justify-center text-primary hover:bg-primary-tint shrink-0"
          aria-label={`Open ${label}`}
        >
          <ExternalLink size={16} />
        </button>
      )}
    </div>
  );
}
