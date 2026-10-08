import { DateInput } from "@/components/date-input";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Car, Bike, Phone, MessageCircle, Plus, Download, X, Search, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  listVehicles,
  getInsuranceOptions,
  getLeadNotes,
  upsertVehicle,
  setVehicleArchived,
  updateVehicleLead,
  type VehicleRow,
  type LeadStatus,
} from "@/lib/insurance.functions";

type Role = "super_admin" | "ops_manager" | "area_partner" | null;

const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  called: "Called",
  quote_sent: "Quote sent",
  renewed: "Renewed",
  lost: "Lost",
};
const STATUS_CLS: Record<LeadStatus, string> = {
  new: "bg-muted text-foreground",
  called: "bg-accent text-accent-foreground",
  quote_sent: "bg-secondary text-secondary-foreground",
  renewed: "bg-primary/15 text-primary",
  lost: "bg-destructive/10 text-destructive",
};

function todayIST() {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}
function daysUntil(d: string | null) {
  if (!d) return null;
  return Math.round((new Date(d).getTime() - new Date(todayIST()).getTime()) / 86400_000);
}
function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Kolkata" });
}
function waLink(v: VehicleRow) {
  const msg = `Namaste ${v.customerName}, aapki gaadi ${v.regNumber} ka insurance ${fmtDate(v.insuranceExpiry)} ko expire ho raha hai. Renewal ke liye Badiyos se baat karein.`;
  return `https://wa.me/91${v.customerPhone}?text=${encodeURIComponent(msg)}`;
}

export function InsurancePage({ role }: { role: Role }) {
  const canView = role === null || role === "super_admin" || role === "ops_manager";
  const [tab, setTab] = useState<"board" | "followups" | "list">("board");
  const [openId, setOpenId] = useState<string | null>(null);
  const [formFor, setFormFor] = useState<VehicleRow | "new" | null>(null);
  const fetchList = useServerFn(listVehicles);
  const fetchOpts = useServerFn(getInsuranceOptions);
  const list = useQuery({ queryKey: ["insurance", "list"], queryFn: () => fetchList(), enabled: canView });
  const opts = useQuery({ queryKey: ["insurance", "opts"], queryFn: () => fetchOpts(), enabled: canView });

  if (!canView) return <p className="text-[14px] text-muted-foreground">You do not have access to Insurance.</p>;

  const rows = list.data ?? [];
  const open = rows.find((r) => r.id === openId) ?? null;
  const stats = opts.data?.stats;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat label="Due this month" value={stats?.due ?? "—"} />
        <Stat label="Renewed this month" value={stats?.renewed ?? "—"} />
        <Stat label="Conversion" value={stats ? `${stats.conversion}%` : "—"} />
      </div>

      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          {(
            [
              ["board", "Expiry board"],
              ["followups", "Aaj ke follow-ups"],
              ["list", "Vehicles"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`h-10 px-4 rounded-[12px] text-[13px] font-semibold border ${tab === k ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:bg-muted"}`}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => list.refetch()}
            className="h-10 px-3 rounded-[12px] border border-border bg-card hover:bg-muted"
            aria-label="Refresh"
          >
            <RefreshCw size={15} className={list.isFetching ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => setFormFor("new")}
            className="h-10 px-4 rounded-[12px] bg-primary text-primary-foreground text-[13px] font-semibold inline-flex items-center gap-2"
          >
            <Plus size={15} /> Add vehicle
          </button>
        </div>
      </div>

      {list.isLoading ? (
        <p className="text-muted-foreground text-[14px]">Loading…</p>
      ) : list.isError ? (
        <p className="text-destructive text-[14px]">{(list.error as Error).message}</p>
      ) : tab === "board" ? (
        <ExpiryBoard rows={rows.filter((r) => !r.archived)} onOpen={setOpenId} />
      ) : tab === "followups" ? (
        <Followups rows={rows.filter((r) => !r.archived)} onOpen={setOpenId} />
      ) : (
        <VehicleList rows={rows} onOpen={setOpenId} />
      )}

      {open && (
        <LeadDetail
          v={open}
          staff={opts.data?.staff ?? []}
          onClose={() => setOpenId(null)}
          onEdit={() => setFormFor(open)}
        />
      )}
      {formFor && (
        <VehicleForm
          initial={formFor === "new" ? null : formFor}
          experts={opts.data?.experts ?? []}
          onClose={() => setFormFor(null)}
          onSaved={(id) => {
            setFormFor(null);
            setOpenId(id);
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[16px] border border-border bg-card p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</p>
      <p className="mt-2 text-[24px] font-bold">{value}</p>
    </div>
  );
}

function ConsentBadge() {
  return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">No consent</span>;
}

function ContactButtons({ v }: { v: VehicleRow }) {
  return (
    <div className="flex gap-2">
      <a
        href={`tel:+91${v.customerPhone}`}
        onClick={(e) => e.stopPropagation()}
        className="h-8 px-3 rounded-[10px] border border-border inline-flex items-center gap-1 text-[12px] font-semibold hover:bg-muted"
      >
        <Phone size={13} /> Call
      </a>
      {v.consent ? (
        <a
          href={waLink(v)}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="h-8 px-3 rounded-[10px] border border-border inline-flex items-center gap-1 text-[12px] font-semibold hover:bg-muted"
        >
          <MessageCircle size={13} /> WhatsApp
        </a>
      ) : (
        <ConsentBadge />
      )}
    </div>
  );
}

function VehicleCard({ v, onOpen }: { v: VehicleRow; onOpen: (id: string) => void }) {
  const d = daysUntil(v.insuranceExpiry);
  return (
    <button
      onClick={() => onOpen(v.id)}
      className="w-full text-left rounded-[14px] border border-border bg-card p-3 space-y-2 hover:border-primary"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-[13px] tracking-wide">{v.regNumber}</span>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_CLS[v.status]}`}>
          {STATUS_LABEL[v.status]}
        </span>
      </div>
      <p className="text-[13px]">{v.customerName}</p>
      <p className="text-[12px] text-muted-foreground">
        Expiry {fmtDate(v.insuranceExpiry)}
        {d !== null && (d < 0 ? ` · ${-d}d ago` : ` · in ${d}d`)}
      </p>
      <ContactButtons v={v} />
    </button>
  );
}

function ExpiryBoard({ rows, onOpen }: { rows: VehicleRow[]; onOpen: (id: string) => void }) {
  const cols = [
    { label: "Expired", test: (d: number) => d < 0 },
    { label: "7 days", test: (d: number) => d >= 0 && d <= 7 },
    { label: "15 days", test: (d: number) => d > 7 && d <= 15 },
    { label: "30 days", test: (d: number) => d > 15 && d <= 30 },
    { label: "60 days", test: (d: number) => d > 30 && d <= 60 },
  ];
  const active = rows.filter((r) => r.status !== "renewed" && r.status !== "lost");
  return (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
      {cols.map((c) => {
        const items = active
          .filter((r) => {
            const d = daysUntil(r.insuranceExpiry);
            return d !== null && c.test(d);
          })
          .sort((a, b) => (a.insuranceExpiry ?? "").localeCompare(b.insuranceExpiry ?? ""));
        return (
          <div key={c.label} className="rounded-[16px] bg-muted/50 p-3 space-y-2 min-h-[200px]">
            <p className="text-[12px] font-bold uppercase tracking-wide">
              {c.label} <span className="text-muted-foreground">({items.length})</span>
            </p>
            {items.length === 0 && <p className="text-[12px] text-muted-foreground">None</p>}
            {items.map((v) => (
              <VehicleCard key={v.id} v={v} onOpen={onOpen} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function Followups({ rows, onOpen }: { rows: VehicleRow[]; onOpen: (id: string) => void }) {
  const t = todayIST();
  const items = rows
    .filter((r) => r.nextFollowup && r.nextFollowup <= t && r.status !== "renewed" && r.status !== "lost")
    .sort((a, b) => (a.nextFollowup ?? "").localeCompare(b.nextFollowup ?? ""));
  if (!items.length) return <p className="text-[14px] text-muted-foreground">Aaj koi follow-up baaki nahi hai.</p>;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {items.map((v) => (
        <div key={v.id}>
          <p className={`text-[11px] font-semibold mb-1 ${v.nextFollowup! < t ? "text-destructive" : "text-muted-foreground"}`}>
            {v.nextFollowup! < t ? `Overdue · ${fmtDate(v.nextFollowup)}` : "Today"}
            {v.assignedName ? ` · ${v.assignedName}` : ""}
          </p>
          <VehicleCard v={v} onOpen={onOpen} />
        </div>
      ))}
    </div>
  );
}

function VehicleList({ rows, onOpen }: { rows: VehicleRow[]; onOpen: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [insurer, setInsurer] = useState("");
  const [status, setStatus] = useState("");
  const [consent, setConsent] = useState("");
  const [archived, setArchived] = useState(false);
  const insurers = useMemo(
    () => [...new Set(rows.map((r) => r.insurer).filter((x): x is string => !!x))].sort(),
    [rows],
  );
  const filtered = rows.filter((r) => {
    if (r.archived !== archived) return false;
    if (type && r.vehicleType !== type) return false;
    if (insurer && r.insurer !== insurer) return false;
    if (status && r.status !== status) return false;
    if (consent && String(r.consent) !== consent) return false;
    if (q) {
      const s = q.toLowerCase().replace(/\s/g, "");
      return (
        r.customerName.toLowerCase().replace(/\s/g, "").includes(s) ||
        r.customerPhone.includes(s) ||
        r.regNumber.toLowerCase().includes(s)
      );
    }
    return true;
  });

  function exportCsv() {
    const head = ["Name", "Mobile", "Number", "Type", "Model", "Insurer", "Insurance expiry", "PUC expiry", "Consent", "Status", "Next follow-up", "Assigned", "Expert", "Archived"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = filtered.map((r) =>
      [r.customerName, r.customerPhone, r.regNumber, r.vehicleType, r.makeModel, r.insurer, r.insuranceExpiry, r.pucExpiry, r.consent ? "yes" : "no", STATUS_LABEL[r.status], r.nextFollowup, r.assignedName, r.expertName, r.archived ? "yes" : "no"]
        .map(esc)
        .join(","),
    );
    const blob = new Blob([[head.map(esc).join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `badiyos-vehicles-${todayIST()}.csv`;
    a.click();
  }

  const sel = "h-10 px-3 rounded-[12px] border border-border bg-card text-[13px]";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-3 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, mobile, number" className={`${sel} pl-8 w-[220px]`} />
        </div>
        <select value={type} onChange={(e) => setType(e.target.value)} className={sel}>
          <option value="">All types</option>
          <option value="car">Car</option>
          <option value="bike">Bike</option>
        </select>
        <select value={insurer} onChange={(e) => setInsurer(e.target.value)} className={sel}>
          <option value="">All insurers</option>
          {insurers.map((i) => (
            <option key={i}>{i}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={sel}>
          <option value="">All status</option>
          {Object.entries(STATUS_LABEL).map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </select>
        <select value={consent} onChange={(e) => setConsent(e.target.value)} className={sel}>
          <option value="">Consent: any</option>
          <option value="true">Consent yes</option>
          <option value="false">Consent no</option>
        </select>
        <label className="text-[13px] inline-flex items-center gap-1">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Archived
        </label>
        <button onClick={exportCsv} className={`${sel} inline-flex items-center gap-2 font-semibold hover:bg-muted`}>
          <Download size={14} /> Export CSV ({filtered.length})
        </button>
      </div>
      <div className="rounded-[16px] border border-border bg-card overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/50 text-left text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="p-3">Number</th>
              <th className="p-3">Customer</th>
              <th className="p-3">Vehicle</th>
              <th className="p-3">Insurer</th>
              <th className="p-3">Ins. expiry</th>
              <th className="p-3">PUC</th>
              <th className="p-3">Status</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((v) => (
              <tr key={v.id} onClick={() => onOpen(v.id)} className="border-t border-border cursor-pointer hover:bg-muted/40">
                <td className="p-3 font-bold">{v.regNumber}</td>
                <td className="p-3">
                  {v.customerName}
                  <div className="text-[11px] text-muted-foreground">{v.customerPhone}</div>
                </td>
                <td className="p-3">
                  <span className="inline-flex items-center gap-1">
                    {v.vehicleType === "car" ? <Car size={13} /> : <Bike size={13} />} {v.makeModel ?? "—"}
                  </span>
                </td>
                <td className="p-3">{v.insurer ?? "—"}</td>
                <td className="p-3">{fmtDate(v.insuranceExpiry)}</td>
                <td className="p-3">{fmtDate(v.pucExpiry)}</td>
                <td className="p-3">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_CLS[v.status]}`}>{STATUS_LABEL[v.status]}</span>
                </td>
                <td className="p-3">
                  <ContactButtons v={v} />
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={8} className="p-6 text-center text-muted-foreground">No vehicles.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-foreground/40 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-card rounded-[20px] w-full max-w-[560px] p-5 space-y-4 my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-[16px] font-bold">{title}</h3>
          <button onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inp = "w-full h-10 px-3 rounded-[12px] border border-border bg-background text-[13px]";

function VehicleForm({
  initial,
  experts,
  onClose,
  onSaved,
}: {
  initial: VehicleRow | null;
  experts: { id: string; name: string }[];
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const qc = useQueryClient();
  const save = useServerFn(upsertVehicle);
  const [f, setF] = useState({
    customerName: initial?.customerName ?? "",
    customerPhone: initial?.customerPhone ?? "",
    regNumber: initial?.regNumber ?? "",
    vehicleType: (initial?.vehicleType ?? "car") as "car" | "bike",
    makeModel: initial?.makeModel ?? "",
    insurer: initial?.insurer ?? "",
    insuranceExpiry: initial?.insuranceExpiry ?? "",
    pucExpiry: initial?.pucExpiry ?? "",
    consent: initial?.consent ?? true,
    expertId: initial?.expertId ?? "",
  });
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  async function submit() {
    setBusy(true);
    try {
      const reg = f.regNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");
      const photos = [...(initial?.photos ?? [])];
      for (const file of files) {
        const path = `${reg}/${Date.now()}-${file.name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
        const { error } = await supabase.storage.from("vehicle-docs").upload(path, file);
        if (error) throw new Error(`Photo upload failed: ${error.message}`);
        photos.push(path);
      }
      const res = await save({
        data: {
          id: initial?.id ?? null,
          ...f,
          insuranceExpiry: f.insuranceExpiry || null,
          pucExpiry: f.pucExpiry || null,
          expertId: f.expertId || null,
          bookingId: initial?.bookingId ?? null,
          photos,
        },
      });
      await qc.invalidateQueries({ queryKey: ["insurance"] });
      if (res.duplicate) toast.info(`${reg} pehle se hai — wahi vehicle khol rahe hain.`);
      else toast.success("Saved");
      onSaved(res.id);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={initial ? "Edit vehicle" : "Add vehicle"} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name"><input className={inp} value={f.customerName} onChange={(e) => set("customerName", e.target.value)} /></Field>
        <Field label="Mobile"><input className={inp} inputMode="numeric" value={f.customerPhone} onChange={(e) => set("customerPhone", e.target.value)} /></Field>
        <Field label="Gaadi number"><input className={`${inp} uppercase`} value={f.regNumber} onChange={(e) => set("regNumber", e.target.value)} placeholder="MH24AB1234" /></Field>
        <Field label="Car / Bike">
          <select className={inp} value={f.vehicleType} onChange={(e) => set("vehicleType", e.target.value)}>
            <option value="car">Car</option>
            <option value="bike">Bike</option>
          </select>
        </Field>
        <Field label="Company / Model"><input className={inp} value={f.makeModel} onChange={(e) => set("makeModel", e.target.value)} /></Field>
        <Field label="Insurer"><input className={inp} value={f.insurer} onChange={(e) => set("insurer", e.target.value)} /></Field>
        <Field label="Insurance expiry"><DateInput  className={inp} value={f.insuranceExpiry} onChange={(e) => set("insuranceExpiry", e.target.value)} /></Field>
        <Field label="PUC expiry"><DateInput  className={inp} value={f.pucExpiry} onChange={(e) => set("pucExpiry", e.target.value)} /></Field>
        <Field label="Consent for reminders">
          <select className={inp} value={f.consent ? "yes" : "no"} onChange={(e) => set("consent", e.target.value === "yes")}>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </Field>
        <Field label="Expert">
          <select className={inp} value={f.expertId} onChange={(e) => set("expertId", e.target.value)}>
            <option value="">—</option>
            {experts.map((x) => (
              <option key={x.id} value={x.id}>{x.name}</option>
            ))}
          </select>
        </Field>
        <div className="col-span-2">
          <Field label="Photos (RC / policy / vehicle)">
            <input type="file" accept="image/*,application/pdf" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} className="text-[13px]" />
          </Field>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="h-10 px-4 rounded-[12px] border border-border text-[13px]">Cancel</button>
        <button disabled={busy} onClick={submit} className="h-10 px-4 rounded-[12px] bg-primary text-primary-foreground text-[13px] font-semibold disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function LeadDetail({
  v,
  staff,
  onClose,
  onEdit,
}: {
  v: VehicleRow;
  staff: { id: string; name: string }[];
  onClose: () => void;
  onEdit: () => void;
}) {
  const qc = useQueryClient();
  const fetchNotes = useServerFn(getLeadNotes);
  const updateFn = useServerFn(updateVehicleLead);
  const archiveFn = useServerFn(setVehicleArchived);
  const notes = useQuery({
    queryKey: ["insurance", "notes", v.leadId],
    queryFn: () => fetchNotes({ data: { leadId: v.leadId! } }),
    enabled: !!v.leadId,
  });
  const [status, setStatus] = useState<LeadStatus>(v.status);
  const [next, setNext] = useState(v.nextFollowup ?? "");
  const [assigned, setAssigned] = useState(v.assignedTo ?? "");
  const [note, setNote] = useState("");

  const save = useMutation({
    mutationFn: () =>
      updateFn({ data: { leadId: v.leadId!, status, nextFollowup: next || null, assignedTo: assigned || null, note } }),
    onSuccess: () => {
      setNote("");
      toast.success("Lead updated");
      qc.invalidateQueries({ queryKey: ["insurance"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const archive = useMutation({
    mutationFn: () => archiveFn({ data: { id: v.id, archived: !v.archived } }),
    onSuccess: () => {
      toast.success(v.archived ? "Restored" : "Archived");
      qc.invalidateQueries({ queryKey: ["insurance"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  async function openPhoto(path: string) {
    const { data, error } = await supabase.storage.from("vehicle-docs").createSignedUrl(path, 300);
    if (error || !data) return toast.error(error?.message ?? "Could not open photo");
    window.open(data.signedUrl, "_blank");
  }

  return (
    <Modal title={v.regNumber} onClose={onClose}>
      <div className="text-[13px] space-y-1">
        <p className="font-semibold flex items-center gap-2">
          {v.customerName} · {v.customerPhone} {!v.consent && <ConsentBadge />}
          {v.userId && <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary">App customer</span>}
          {v.archived && <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted">Archived</span>}
        </p>
        <p className="text-muted-foreground">
          {v.vehicleType === "car" ? "Car" : "Bike"} · {v.makeModel ?? "—"} · {v.insurer ?? "—"}
        </p>
        <p className="text-muted-foreground">
          Insurance {fmtDate(v.insuranceExpiry)} · PUC {fmtDate(v.pucExpiry)}
          {v.expertName ? ` · Expert ${v.expertName}` : ""}
        </p>
        <div className="pt-2"><ContactButtons v={v} /></div>
        {v.photos.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2">
            {v.photos.map((p, i) => (
              <button key={p} onClick={() => openPhoto(p)} className="text-[12px] underline text-primary">Photo {i + 1}</button>
            ))}
          </div>
        )}
      </div>

      {v.leadId && (
        <div className="grid grid-cols-2 gap-3 border-t border-border pt-4">
          <Field label="Status">
            <select className={inp} value={status} onChange={(e) => setStatus(e.target.value as LeadStatus)}>
              {Object.entries(STATUS_LABEL).map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </select>
          </Field>
          <Field label="Next follow-up"><DateInput  className={inp} value={next} onChange={(e) => setNext(e.target.value)} /></Field>
          <div className="col-span-2">
            <Field label="Assigned to">
              <select className={inp} value={assigned} onChange={(e) => setAssigned(e.target.value)}>
                <option value="">—</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="Add note">
              <textarea className={`${inp} h-20 py-2`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
            </Field>
          </div>
          <div className="col-span-2 flex justify-between gap-2">
            <div className="flex gap-2">
              <button onClick={onEdit} className="h-10 px-4 rounded-[12px] border border-border text-[13px]">Edit vehicle</button>
              <button onClick={() => archive.mutate()} className="h-10 px-4 rounded-[12px] border border-border text-[13px]">
                {v.archived ? "Restore" : "Archive"}
              </button>
            </div>
            <button disabled={save.isPending} onClick={() => save.mutate()} className="h-10 px-4 rounded-[12px] bg-primary text-primary-foreground text-[13px] font-semibold disabled:opacity-50">
              Save lead
            </button>
          </div>
        </div>
      )}

      <div className="border-t border-border pt-4 space-y-2 max-h-[240px] overflow-y-auto">
        <p className="text-[12px] font-bold uppercase text-muted-foreground">History</p>
        {(notes.data ?? []).map((n) => (
          <div key={n.id} className="text-[12px]">
            <span className="font-semibold">{n.author ?? "Staff"}</span>{" "}
            <span className="text-muted-foreground">{new Date(n.createdAt).toLocaleString("en-IN")}</span>
            <p>{n.note}</p>
          </div>
        ))}
        {notes.data?.length === 0 && <p className="text-[12px] text-muted-foreground">No notes yet.</p>}
      </div>
    </Modal>
  );
}
