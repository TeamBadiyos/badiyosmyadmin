import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { X, Upload, Check, Loader2, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  getExpert,
  upsertExpert,
  signStorageUrl,
  type ExpertLevel,
  type ActiveStatus,
} from "@/lib/experts.functions";
import { listZoneOptions } from "@/lib/bookings.functions";

const LEVELS: ExpertLevel[] = ["bronze", "silver", "gold", "diamond"];
const STATUSES: ActiveStatus[] = ["active", "inactive"];

type UploadedDoc = { path: string | null; name: string | null };

function newDoc(path: string | null): UploadedDoc {
  return { path, name: path ? path.split("/").pop() ?? path : null };
}

async function uploadTo(bucket: string, file: File, prefix: string): Promise<string> {
  const ext = file.name.split(".").pop() || "bin";
  const path = `${prefix}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw new Error(error.message);
  return path;
}

export function ExpertFormModal({
  expertId,
  onClose,
}: {
  expertId: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const fetchExpert = useServerFn(getExpert);
  const fetchZones = useServerFn(listZoneOptions);
  const save = useServerFn(upsertExpert);
  const sign = useServerFn(signStorageUrl);

  const isEdit = !!expertId;

  const { data: existing } = useQuery({
    queryKey: ["experts", "details", expertId],
    queryFn: () => fetchExpert({ data: { id: expertId! } }),
    enabled: !!expertId,
  });

  const { data: zones = [] } = useQuery({
    queryKey: ["experts", "zone-options"],
    queryFn: () => fetchZones(),
    staleTime: 60_000,
  });

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [level, setLevel] = useState<ExpertLevel>("bronze");
  const [status, setStatus] = useState<ActiveStatus>("active");
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [aadhaar, setAadhaar] = useState<UploadedDoc>(newDoc(null));
  const [pan, setPan] = useState<UploadedDoc>(newDoc(null));
  const [addressProof, setAddressProof] = useState<UploadedDoc>(newDoc(null));
  const [bankAcc, setBankAcc] = useState("");
  const [bankIfsc, setBankIfsc] = useState("");
  const [bankHolder, setBankHolder] = useState("");
  const [ifscInfo, setIfscInfo] = useState<{ bank: string; branch: string } | null>(null);
  const [ifscError, setIfscError] = useState<string | null>(null);
  const [ifscLoading, setIfscLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const seededRef = useRef(false);

  useEffect(() => {
    if (existing && !seededRef.current) {
      seededRef.current = true;
      setName(existing.name);
      setPhone(existing.phone);
      setAddress(existing.address ?? "");
      setZoneId(existing.zoneId ?? "");
      setLevel(existing.level);
      setStatus(existing.status);
      setPhotoPath(existing.photoUrl);
      setAadhaar(newDoc(existing.kycAadhaarPath));
      setPan(newDoc(existing.kycPanPath));
      setAddressProof(newDoc(existing.kycAddressProofPath));
      setBankAcc(existing.bankAccountNumber ?? "");
      setBankIfsc(existing.bankIfsc ?? "");
      setBankHolder(existing.bankAccountHolderName ?? "");
    }
  }, [existing]);

  // Photo preview signed URL
  useEffect(() => {
    let cancelled = false;
    if (!photoPath) { setPhotoPreview(null); return; }
    (async () => {
      try {
        const res = await sign({ data: { bucket: "expert-photos", path: photoPath } });
        if (!cancelled) setPhotoPreview(res.url);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [photoPath, sign]);

  async function lookupIfsc(code: string) {
    const c = code.trim().toUpperCase();
    if (c.length !== 11) { setIfscInfo(null); setIfscError(null); return; }
    setIfscLoading(true); setIfscError(null); setIfscInfo(null);
    try {
      const res = await fetch(`https://ifsc.razorpay.com/${encodeURIComponent(c)}`);
      if (!res.ok) throw new Error("IFSC not found");
      const json = await res.json();
      setIfscInfo({ bank: json.BANK ?? "", branch: json.BRANCH ?? "" });
    } catch (e) {
      setIfscError(e instanceof Error ? e.message : "IFSC lookup failed");
    } finally {
      setIfscLoading(false);
    }
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          id: expertId ?? null,
          name: name.trim(),
          phone: phone.trim(),
          address: address.trim() || null,
          zone_id: zoneId || null,
          level,
          status,
          photo_url: photoPath,
          bank_account_number: bankAcc.trim() || null,
          bank_ifsc: bankIfsc.trim().toUpperCase() || null,
          bank_account_holder_name: bankHolder.trim() || null,
          kyc_aadhaar_url: aadhaar.path,
          kyc_pan_url: pan.path,
          kyc_address_proof_url: addressProof.path,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["experts", "list"] });
      if (expertId) {
        queryClient.invalidateQueries({ queryKey: ["experts", "details", expertId] });
      }
      onClose();
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : "Save failed"),
  });

  const canSave = useMemo(
    () => name.trim().length > 0 && phone.trim().length > 0,
    [name, phone],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-0 sm:p-6 bg-foreground/50"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-card w-full sm:max-w-[820px] max-h-[100vh] sm:max-h-[92vh] sm:rounded-[24px] overflow-hidden shadow-xl flex flex-col"
      >
        <header className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-[18px] font-bold text-foreground">
            {isEdit ? "Edit Expert" : "Add Expert"}
          </h2>
          <button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted">
            <X size={20} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          <section className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-full bg-primary-tint text-primary flex items-center justify-center overflow-hidden shrink-0">
              {photoPreview ? (
                <img src={photoPreview} alt="" className="w-full h-full object-cover" />
              ) : (
                <UserRound size={28} />
              )}
            </div>
            <FileButton
              label={photoPath ? "Replace photo" : "Upload photo"}
              accept="image/*"
              onFile={async (file) => {
                try {
                  const path = await uploadTo("expert-photos", file, "photos");
                  setPhotoPath(path);
                } catch (e) {
                  setFormError(e instanceof Error ? e.message : "Photo upload failed");
                }
              }}
            />
          </section>

          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Name" value={name} onChange={setName} required />
            <Field label="Phone" value={phone} onChange={setPhone} required />
            <Field label="Address" value={address} onChange={setAddress} className="md:col-span-2" />
            <SelectField label="Zone" value={zoneId} onChange={setZoneId}>
              <option value="">Unassigned</option>
              {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </SelectField>
            <SelectField label="Level" value={level} onChange={(v) => setLevel(v as ExpertLevel)}>
              {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </SelectField>
            <SelectField label="Status" value={status} onChange={(v) => setStatus(v as ActiveStatus)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </SelectField>
          </section>

          <section>
            <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground mb-3">
              KYC documents
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <KycUpload label="Aadhaar" doc={aadhaar} onUploaded={(d) => setAadhaar(d)} onError={(m) => setFormError(m)} />
              <KycUpload label="PAN" doc={pan} onUploaded={(d) => setPan(d)} onError={(m) => setFormError(m)} />
              <KycUpload label="Address proof" doc={addressProof} onUploaded={(d) => setAddressProof(d)} onError={(m) => setFormError(m)} />
            </div>
          </section>

          <section>
            <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground mb-3">
              Bank details
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Account number" value={bankAcc} onChange={setBankAcc} />
              <div>
                <Field
                  label="IFSC"
                  value={bankIfsc}
                  onChange={(v) => setBankIfsc(v.toUpperCase())}
                  onBlur={() => lookupIfsc(bankIfsc)}
                />
                {ifscLoading && (
                  <p className="mt-1 text-[12px] text-muted-foreground inline-flex items-center gap-1">
                    <Loader2 size={12} className="animate-spin" /> Looking up IFSC…
                  </p>
                )}
                {ifscInfo && (
                  <p className="mt-1 text-[12px] text-foreground">
                    <span className="font-semibold">{ifscInfo.bank}</span> — {ifscInfo.branch}
                  </p>
                )}
                {ifscError && (
                  <p className="mt-1 text-[12px] text-destructive">{ifscError}</p>
                )}
              </div>
              <Field label="Account holder name" value={bankHolder} onChange={setBankHolder} className="md:col-span-2" />
            </div>
          </section>

          {formError && <p className="text-[13px] text-destructive">{formError}</p>}
        </div>

        <footer className="px-6 py-4 border-t border-border flex items-center justify-end gap-3 shrink-0">
          <button
            onClick={onClose}
            className="h-11 px-4 rounded-[14px] border border-border text-foreground font-semibold text-[14px]"
          >
            Cancel
          </button>
          <button
            disabled={!canSave || saveMutation.isPending}
            onClick={() => { setFormError(null); saveMutation.mutate(); }}
            className="h-11 px-5 rounded-[14px] bg-primary text-white font-bold text-[14px] disabled:opacity-50 inline-flex items-center gap-2"
          >
            <Check size={16} />
            {saveMutation.isPending ? "Saving…" : isEdit ? "Save changes" : "Create expert"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  onBlur,
  required,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className ?? ""}`}>
      <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}{required ? " *" : ""}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className="h-11 px-3 rounded-[14px] border border-border bg-card text-[14px]"
      />
    </div>
  );
}

function SelectField({
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
      <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 px-3 rounded-[14px] border border-border bg-card text-[14px]"
      >
        {children}
      </select>
    </div>
  );
}

function FileButton({
  label,
  accept,
  onFile,
}: {
  label: string;
  accept: string;
  onFile: (file: File) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <label className={`h-11 px-4 rounded-[14px] border border-border text-foreground font-semibold text-[13px] inline-flex items-center gap-2 cursor-pointer hover:bg-muted ${busy ? "opacity-60" : ""}`}>
      {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
      {busy ? "Uploading…" : label}
      <input
        type="file"
        accept={accept}
        className="hidden"
        disabled={busy}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setBusy(true);
          try { await onFile(f); }
          finally { setBusy(false); e.target.value = ""; }
        }}
      />
    </label>
  );
}

function KycUpload({
  label,
  doc,
  onUploaded,
  onError,
}: {
  label: string;
  doc: UploadedDoc;
  onUploaded: (d: UploadedDoc) => void;
  onError: (m: string) => void;
}) {
  return (
    <div className="border border-border rounded-[14px] p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-foreground">{label}</span>
        {doc.path && <Check size={16} className="text-emerald-600" />}
      </div>
      {doc.name && (
        <p className="text-[12px] text-muted-foreground truncate">{doc.name}</p>
      )}
      <FileButton
        label={doc.path ? "Replace" : "Upload"}
        accept="image/*,.pdf"
        onFile={async (file) => {
          try {
            const path = await uploadTo("expert-kyc-docs", file, label.toLowerCase().replace(/\s+/g, "-"));
            onUploaded(newDoc(path));
          } catch (e) {
            onError(e instanceof Error ? e.message : "Upload failed");
          }
        }}
      />
    </div>
  );
}
