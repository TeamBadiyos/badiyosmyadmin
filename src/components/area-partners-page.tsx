import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, X, Check, Handshake } from "lucide-react";
import {
  listAllAreaPartners,
  upsertAreaPartner,
  type AreaPartnerRow,
  type UpsertAreaPartnerInput,
} from "@/lib/area-partners.functions";

export function AreaPartnersPage() {
  const fetchPartners = useServerFn(listAllAreaPartners);
  const { data = [], isLoading, isError } = useQuery({
    queryKey: ["area-partners", "list"],
    queryFn: () => fetchPartners(),
    staleTime: 30_000,
  });

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AreaPartnerRow | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-[14px] text-muted-foreground">
          Manage area partners. Zone assignment happens on the Zones page.
        </p>
        <button
          onClick={() => { setEditing(null); setFormOpen(true); }}
          className="h-[52px] px-5 rounded-[14px] bg-primary text-white text-[14px] font-bold inline-flex items-center gap-2 hover:opacity-95"
        >
          <Plus size={18} />
          Add Area Partner
        </button>
      </div>

      <div className="bg-card border border-border rounded-[18px] overflow-hidden">
        <div className="grid grid-cols-[40px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)_130px_120px_100px] gap-4 px-6 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <span></span>
          <span>Name</span>
          <span>Phone</span>
          <span>Assigned Zone</span>
          <span>Setup Fee</span>
          <span className="text-right">Commission</span>
          <span>Status</span>
        </div>

        {isLoading && <p className="text-[13px] text-muted-foreground text-center py-10">Loading…</p>}
        {isError && <p className="text-[13px] text-destructive text-center py-10">Failed to load.</p>}
        {!isLoading && !isError && data.length === 0 && (
          <p className="text-[13px] text-muted-foreground text-center py-10">No area partners yet.</p>
        )}

        {data.map((p) => (
          <button
            key={p.id}
            onClick={() => { setEditing(p); setFormOpen(true); }}
            className="w-full grid grid-cols-[40px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)_130px_120px_100px] gap-4 items-center px-6 py-4 border-b border-border last:border-b-0 text-[14px] text-left hover:bg-muted/40 transition-colors"
          >
            <div className="w-8 h-8 rounded-lg bg-primary-tint text-primary flex items-center justify-center">
              <Handshake size={16} />
            </div>
            <span className="font-semibold text-foreground truncate">{p.name}</span>
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
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide ${p.status === "active" ? "bg-primary-tint text-primary" : "bg-muted text-muted-foreground"}`}>
                {p.status}
              </span>
            </span>
          </button>
        ))}
      </div>

      {formOpen && (
        <AreaPartnerFormModal
          existing={editing}
          onClose={() => { setFormOpen(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

function AreaPartnerFormModal({
  existing,
  onClose,
}: {
  existing: AreaPartnerRow | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const save = useServerFn(upsertAreaPartner);
  const [name, setName] = useState(existing?.name ?? "");
  const [phone, setPhone] = useState(existing?.phone ?? "");
  const [fee, setFee] = useState<"pending" | "paid">(existing?.setupFeeStatus ?? "pending");
  const [rate, setRate] = useState<string>(existing?.commissionRate?.toString() ?? "0");
  const [status, setStatus] = useState<"active" | "inactive">(existing?.status ?? "active");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const payload: UpsertAreaPartnerInput = {
        id: existing?.id ?? null,
        name: name.trim(),
        phone: phone.trim(),
        setup_fee_status: fee,
        commission_rate: Number(rate) || 0,
        status,
      };
      return save({ data: payload });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["area-partners"] });
      queryClient.invalidateQueries({ queryKey: ["zones", "list"] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Save failed"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-0 sm:p-6 bg-foreground/50" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-card w-full sm:max-w-[560px] sm:rounded-[24px] overflow-hidden shadow-xl flex flex-col">
        <header className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-[18px] font-bold text-foreground">
            {existing ? "Edit Area Partner" : "Add Area Partner"}
          </h2>
          <button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted">
            <X size={20} />
          </button>
        </header>
        <div className="px-6 py-6 space-y-4">
          <FormField label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} className="h-11 w-full px-3 rounded-[14px] border border-border bg-card text-[14px]" />
          </FormField>
          <FormField label="Phone">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="h-11 w-full px-3 rounded-[14px] border border-border bg-card text-[14px]" />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Setup fee status">
              <select value={fee} onChange={(e) => setFee(e.target.value as "pending" | "paid")} className="h-11 w-full px-3 rounded-[14px] border border-border bg-card text-[14px]">
                <option value="pending">pending</option>
                <option value="paid">paid</option>
              </select>
            </FormField>
            <FormField label="Commission rate (%)">
              <input
                type="number"
                min={0}
                max={100}
                step="0.1"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                className="h-11 w-full px-3 rounded-[14px] border border-border bg-card text-[14px]"
              />
            </FormField>
          </div>
          <FormField label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value as "active" | "inactive")} className="h-11 w-full px-3 rounded-[14px] border border-border bg-card text-[14px]">
              <option value="active">active</option>
              <option value="inactive">inactive</option>
            </select>
          </FormField>
          {error && <p className="text-[13px] text-destructive">{error}</p>}
        </div>
        <footer className="px-6 py-4 border-t border-border flex items-center justify-end gap-3">
          <button onClick={onClose} className="h-11 px-4 rounded-[14px] border border-border text-foreground font-semibold text-[14px]">
            Cancel
          </button>
          <button
            disabled={!name.trim() || !phone.trim() || mutation.isPending}
            onClick={() => { setError(null); mutation.mutate(); }}
            className="h-11 px-5 rounded-[14px] bg-primary text-white font-bold text-[14px] disabled:opacity-50 inline-flex items-center gap-2"
          >
            <Check size={16} />
            {mutation.isPending ? "Saving…" : existing ? "Save changes" : "Create partner"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
