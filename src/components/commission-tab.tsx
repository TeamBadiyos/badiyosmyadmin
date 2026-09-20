import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, X, Calculator, ShieldCheck } from "lucide-react";
import {
  getCommissionAccess,
  listCommissionRules,
  saveCommissionRule,
  bulkSaveCommissionRules,
  verifyCommissionParity,
  listFinanceSettings,
  setFinanceSetting,
  type CommissionRuleRow,
  type CommissionType,
} from "@/lib/commission.functions";
import { IncentivesTab } from "@/components/incentives-tab";
import { BonusPreviewTab } from "@/components/bonus-preview-tab";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const TYPES: { value: CommissionType; label: string }[] = [
  { value: "per_hour", label: "Per hour" },
  { value: "fixed", label: "Fixed / order" },
  { value: "percent", label: "Percent" },
];

function splitOf(
  price: number,
  minutes: number | null,
  et: CommissionType,
  ev: number,
  pt: CommissionType,
  pv: number,
) {
  const hours = Math.max((minutes ?? 60) / 60, 1 / 60);
  const calc = (t: CommissionType, v: number) =>
    t === "per_hour" ? v * hours : t === "percent" ? (price * v) / 100 : v;
  const expert = Math.round(calc(et, ev));
  const partner = Math.round(calc(pt, pv));
  return { expert, partner, hq: Math.round(price) - expert - partner };
}

export function CommissionTab() {
  const queryClient = useQueryClient();
  const fetchAccess = useServerFn(getCommissionAccess);
  const fetchRules = useServerFn(listCommissionRules);

  const { data: access } = useQuery({
    queryKey: ["commission", "access"],
    queryFn: () => fetchAccess(),
  });
  const { data: rules = [], isLoading } = useQuery({
    queryKey: ["commission", "rules"],
    queryFn: () => fetchRules(),
  });

  const canWrite = !!access?.canWrite;
  const [sub, setSub] = useState<"commission" | "incentives" | "bonus preview">("commission");
  const [editing, setEditing] = useState<CommissionRuleRow | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [simFor, setSimFor] = useState<CommissionRuleRow | null>(null);
  const [parityOpen, setParityOpen] = useState(false);

  const products = useMemo(() => rules.filter((r) => r.scope === "price_option"), [rules]);
  const defaultRule = rules.find((r) => r.scope === "default") ?? null;

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-[14px] border border-border bg-card p-1">
        {(canWrite
          ? (["commission", "incentives", "bonus preview"] as const)
          : (["commission", "incentives"] as const)
        ).map((s) => (
          <button
            key={s}
            onClick={() => setSub(s)}
            className={`h-9 px-4 rounded-[10px] text-[13px] font-semibold capitalize ${
              sub === s ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {sub === "incentives" && <IncentivesTab canWrite={canWrite} />}

      {sub === "bonus preview" && canWrite && <BonusPreviewTab />}

      {sub === "commission" && (
      <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[14px] text-muted-foreground">
            Product-wise commission. Customer price comes from the catalogue and is read-only. HQ
            share is always customer price minus expert minus partner.
          </p>
          {access && !access.newEngineEnabled && (
            <p className="mt-1 text-[12px] font-semibold text-amber-700">
              New engine is OFF — bookings still use the old catalogue values. Rules below are
              prepared and verified before switching on.
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setParityOpen(true)}
            className="h-11 px-4 rounded-[14px] border border-border font-semibold text-[14px] inline-flex items-center gap-2"
          >
            <ShieldCheck size={16} /> Parity check
          </button>
          {canWrite && (
            <button
              onClick={() => setBulkOpen(true)}
              className="h-11 px-4 rounded-[14px] bg-primary text-white font-bold text-[14px]"
            >
              Bulk edit
            </button>
          )}
        </div>
      </div>

      {defaultRule && (
        <div className="bg-card border border-border rounded-[18px] p-5 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Default rule
            </p>
            <p className="text-[14px] font-semibold text-foreground">
              Expert {typeLabel(defaultRule.expert_type, defaultRule.expert_value)} · Partner{" "}
              {typeLabel(defaultRule.partner_type, defaultRule.partner_value)}
            </p>
          </div>
          {canWrite && (
            <button
              onClick={() => setEditing(defaultRule)}
              className="h-9 px-3 rounded-[12px] border border-border font-semibold text-[13px] hover:bg-muted"
            >
              Edit
            </button>
          )}
        </div>
      )}

      <div className="bg-card border border-border rounded-[18px] overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1fr)_110px_150px_150px_110px_150px] gap-3 px-5 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <span>Product</span>
          <span className="text-right">Price</span>
          <span>Expert</span>
          <span>Partner</span>
          <span className="text-right">HQ</span>
          <span></span>
        </div>
        {isLoading && (
          <p className="text-[13px] text-muted-foreground text-center py-10">Loading…</p>
        )}
        {!isLoading && products.length === 0 && (
          <p className="text-[13px] text-muted-foreground text-center py-10">
            No active catalogue items.
          </p>
        )}
        {products.map((r) => (
          <div
            key={r.price_option_id}
            className="grid grid-cols-[minmax(0,1fr)_110px_150px_150px_110px_150px] gap-3 items-center px-5 py-3 border-b border-border last:border-b-0 text-[14px]"
          >
            <div className="min-w-0">
              <p className="font-semibold text-foreground truncate">{r.product_label}</p>
              <p className="text-[12px] text-muted-foreground truncate">
                {r.service_name}
                {r.duration_minutes ? ` · ${r.duration_minutes} min` : ""}
                {r.rule_id ? "" : " · using default"}
              </p>
            </div>
            <span className="text-right font-semibold">{inr.format(r.customer_price)}</span>
            <span className="text-[13px]">
              {typeLabel(r.expert_type, r.expert_value)}
              <span className="block text-[12px] text-muted-foreground">
                = {inr.format(r.expert_amount)}
              </span>
            </span>
            <span className="text-[13px]">
              {typeLabel(r.partner_type, r.partner_value)}
              <span className="block text-[12px] text-muted-foreground">
                = {inr.format(r.partner_amount)}
              </span>
            </span>
            <span
              className={`text-right font-semibold ${r.hq_amount < 0 ? "text-destructive" : ""}`}
            >
              {inr.format(r.hq_amount)}
            </span>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setSimFor(r)}
                className="h-9 w-9 rounded-[12px] border border-border inline-flex items-center justify-center hover:bg-muted"
                aria-label="Simulate"
              >
                <Calculator size={15} />
              </button>
              {canWrite && (
                <button
                  onClick={() => setEditing(r)}
                  className="h-9 px-3 rounded-[12px] border border-border font-semibold text-[13px] hover:bg-muted"
                >
                  Edit
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <FinanceSettingsCard canWrite={canWrite} />
      </>
      )}

      {editing && (
        <EditRuleModal
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["commission"] });
            setEditing(null);
          }}
        />
      )}
      {bulkOpen && (
        <BulkModal
          products={products}
          onClose={() => setBulkOpen(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["commission"] });
            setBulkOpen(false);
          }}
        />
      )}
      {simFor && <SimulatorModal row={simFor} onClose={() => setSimFor(null)} />}
      {parityOpen && <ParityModal onClose={() => setParityOpen(false)} />}
    </div>
  );
}

function typeLabel(t: CommissionType, v: number) {
  if (t === "per_hour") return `₹${v}/hr`;
  if (t === "percent") return `${v}%`;
  return `₹${v} fixed`;
}

function EditRuleModal({
  row,
  onClose,
  onSaved,
}: {
  row: CommissionRuleRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const save = useServerFn(saveCommissionRule);
  const [et, setEt] = useState<CommissionType>(row.expert_type);
  const [ev, setEv] = useState(String(row.expert_value));
  const [pt, setPt] = useState<CommissionType>(row.partner_type);
  const [pv, setPv] = useState(String(row.partner_value));
  const [minHq, setMinHq] = useState(String(row.min_hq_share));
  const [error, setError] = useState<string | null>(null);

  const preview = splitOf(row.customer_price, row.duration_minutes, et, Number(ev) || 0, pt, Number(pv) || 0);
  const belowMin = row.scope === "price_option" && preview.hq < (Number(minHq) || 0);

  const mutation = useMutation({
    mutationFn: () => {
      if (belowMin) throw new Error("HQ share is below the minimum for this product");
      return save({
        data: {
          id: row.rule_id,
          scope: row.scope,
          price_option_id: row.price_option_id,
          expert_type: et,
          expert_value: Number(ev) || 0,
          partner_type: pt,
          partner_value: Number(pv) || 0,
          min_hq_share: Number(minHq) || 0,
          is_active: true,
        },
      });
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Modal title={`Commission · ${row.product_label}`} onClose={onClose}>
      <div className="space-y-4">
        {row.scope === "price_option" && (
          <p className="text-[13px] text-muted-foreground">
            Customer price {inr.format(row.customer_price)} (from catalogue, read-only)
          </p>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Expert type">
            <Select value={et} onChange={(v) => setEt(v as CommissionType)} />
          </Field>
          <Field label="Expert value">
            <input
              type="number"
              min="0"
              value={ev}
              onChange={(e) => setEv(e.target.value)}
              className="w-full h-11 px-3 rounded-[14px] border border-border bg-card text-[14px]"
            />
          </Field>
          <Field label="Partner type">
            <Select value={pt} onChange={(v) => setPt(v as CommissionType)} />
          </Field>
          <Field label="Partner value">
            <input
              type="number"
              min="0"
              value={pv}
              onChange={(e) => setPv(e.target.value)}
              className="w-full h-11 px-3 rounded-[14px] border border-border bg-card text-[14px]"
            />
          </Field>
          <Field label="Minimum HQ share (₹)">
            <input
              type="number"
              min="0"
              value={minHq}
              onChange={(e) => setMinHq(e.target.value)}
              className="w-full h-11 px-3 rounded-[14px] border border-border bg-card text-[14px]"
            />
          </Field>
        </div>

        {row.scope === "price_option" && (
          <div className="rounded-[14px] bg-muted/50 p-4 text-[13px] space-y-1">
            <p>Expert: <b>{inr.format(preview.expert)}</b></p>
            <p>Partner: <b>{inr.format(preview.partner)}</b></p>
            <p className={preview.hq < 0 ? "text-destructive" : ""}>
              HQ: <b>{inr.format(preview.hq)}</b>
            </p>
          </div>
        )}

        {belowMin && (
          <p className="text-[13px] text-destructive">
            HQ share {inr.format(preview.hq)} is below the minimum {inr.format(Number(minHq) || 0)}.
          </p>
        )}
        {error && <p className="text-[13px] text-destructive">{error}</p>}
      </div>
      <Footer
        onClose={onClose}
        disabled={mutation.isPending || belowMin}
        pending={mutation.isPending}
        onSave={() => {
          setError(null);
          mutation.mutate();
        }}
      />
    </Modal>
  );
}

function BulkModal({
  products,
  onClose,
  onSaved,
}: {
  products: CommissionRuleRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const save = useServerFn(bulkSaveCommissionRules);
  const [selected, setSelected] = useState<string[]>([]);
  const [et, setEt] = useState<CommissionType>("per_hour");
  const [ev, setEv] = useState("80");
  const [pt, setPt] = useState<CommissionType>("fixed");
  const [pv, setPv] = useState("10");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          price_option_ids: selected,
          expert_type: et,
          expert_value: Number(ev) || 0,
          partner_type: pt,
          partner_value: Number(pv) || 0,
        },
      }),
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Modal title="Bulk edit commission" onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Expert type">
            <Select value={et} onChange={(v) => setEt(v as CommissionType)} />
          </Field>
          <Field label="Expert value">
            <input
              type="number"
              min="0"
              value={ev}
              onChange={(e) => setEv(e.target.value)}
              className="w-full h-11 px-3 rounded-[14px] border border-border bg-card text-[14px]"
            />
          </Field>
          <Field label="Partner type">
            <Select value={pt} onChange={(v) => setPt(v as CommissionType)} />
          </Field>
          <Field label="Partner value">
            <input
              type="number"
              min="0"
              value={pv}
              onChange={(e) => setPv(e.target.value)}
              className="w-full h-11 px-3 rounded-[14px] border border-border bg-card text-[14px]"
            />
          </Field>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Apply to {selected.length} product(s)
          </p>
          <button
            onClick={() =>
              setSelected(
                selected.length === products.length
                  ? []
                  : products.map((p) => p.price_option_id!).filter(Boolean),
              )
            }
            className="text-[13px] font-semibold text-primary"
          >
            {selected.length === products.length ? "Clear all" : "Select all"}
          </button>
        </div>

        <div className="max-h-[260px] overflow-y-auto border border-border rounded-[14px]">
          {products.map((p) => (
            <label
              key={p.price_option_id}
              className="flex items-center gap-3 px-4 py-2.5 border-b border-border last:border-b-0 text-[14px] cursor-pointer hover:bg-muted/40"
            >
              <input
                type="checkbox"
                checked={selected.includes(p.price_option_id!)}
                onChange={(e) =>
                  setSelected((prev) =>
                    e.target.checked
                      ? [...prev, p.price_option_id!]
                      : prev.filter((id) => id !== p.price_option_id),
                  )
                }
              />
              <span className="flex-1 truncate">
                {p.product_label}
                <span className="text-muted-foreground"> · {p.service_name}</span>
              </span>
              <span className="text-[13px] text-muted-foreground">
                {inr.format(p.customer_price)}
              </span>
            </label>
          ))}
        </div>

        {error && <p className="text-[13px] text-destructive">{error}</p>}
      </div>
      <Footer
        onClose={onClose}
        disabled={mutation.isPending || selected.length === 0}
        pending={mutation.isPending}
        onSave={() => {
          setError(null);
          mutation.mutate();
        }}
      />
    </Modal>
  );
}

function SimulatorModal({ row, onClose }: { row: CommissionRuleRow; onClose: () => void }) {
  const [price, setPrice] = useState(String(row.customer_price));
  const [minutes, setMinutes] = useState(String(row.duration_minutes ?? 60));
  const [incentive, setIncentive] = useState("0");

  const p = Number(price) || 0;
  const s = splitOf(
    p,
    Number(minutes) || 60,
    row.expert_type,
    row.expert_value,
    row.partner_type,
    row.partner_value,
  );
  const inc = Number(incentive) || 0;

  return (
    <Modal title={`Split simulator · ${row.product_label}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <Field label="Customer price (₹)">
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full h-11 px-3 rounded-[14px] border border-border bg-card text-[14px]"
            />
          </Field>
          <Field label="Duration (min)">
            <input
              type="number"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              className="w-full h-11 px-3 rounded-[14px] border border-border bg-card text-[14px]"
            />
          </Field>
          <Field label="Incentive (₹)">
            <input
              type="number"
              value={incentive}
              onChange={(e) => setIncentive(e.target.value)}
              className="w-full h-11 px-3 rounded-[14px] border border-border bg-card text-[14px]"
            />
          </Field>
        </div>
        <div className="rounded-[14px] bg-muted/50 p-4 text-[14px] space-y-2">
          <Row label="Expert earning" value={inr.format(s.expert)} />
          <Row label="Area partner commission" value={inr.format(s.partner)} />
          <Row label="HQ share" value={inr.format(s.hq)} danger={s.hq < 0} />
          <Row label="Incentive (paid by HQ)" value={inr.format(inc)} />
          <div className="pt-2 border-t border-border">
            <Row label="HQ after incentive" value={inr.format(s.hq - inc)} danger={s.hq - inc < 0} />
          </div>
        </div>
      </div>
      <footer className="px-6 py-4 border-t border-border flex justify-end">
        <button
          onClick={onClose}
          className="h-11 px-5 rounded-[14px] border border-border font-semibold text-[14px]"
        >
          Close
        </button>
      </footer>
    </Modal>
  );
}

function ParityModal({ onClose }: { onClose: () => void }) {
  const fetchParity = useServerFn(verifyCommissionParity);
  const { data = [], isLoading } = useQuery({
    queryKey: ["commission", "parity"],
    queryFn: () => fetchParity(),
  });
  const allMatch = data.length > 0 && data.every((r) => r.matches);

  return (
    <Modal title="Parity check (old vs new engine)" onClose={onClose}>
      <div className="space-y-3">
        {isLoading && <p className="text-[13px] text-muted-foreground">Checking…</p>}
        {!isLoading && (
          <p className={`text-[13px] font-semibold ${allMatch ? "text-primary" : "text-destructive"}`}>
            {allMatch
              ? "All products match — safe to switch the new engine on."
              : "Mismatches found — fix rules before switching the engine on."}
          </p>
        )}
        <div className="border border-border rounded-[14px] overflow-hidden">
          <div className="grid grid-cols-[minmax(0,1fr)_100px_100px_80px] gap-2 px-4 py-2 bg-muted/40 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            <span>Product</span>
            <span className="text-right">Old</span>
            <span className="text-right">New</span>
            <span className="text-right">OK</span>
          </div>
          {data.map((r) => (
            <div
              key={r.label}
              className="grid grid-cols-[minmax(0,1fr)_100px_100px_80px] gap-2 px-4 py-2 border-t border-border text-[13px]"
            >
              <span className="truncate">{r.label}</span>
              <span className="text-right">
                {r.legacy_expert}/{r.legacy_partner}
              </span>
              <span className="text-right">
                {r.new_expert}/{r.new_partner}
              </span>
              <span className={`text-right font-bold ${r.matches ? "text-primary" : "text-destructive"}`}>
                {r.matches ? "✓" : "✕"}
              </span>
            </div>
          ))}
        </div>
      </div>
      <footer className="px-6 py-4 border-t border-border flex justify-end">
        <button
          onClick={onClose}
          className="h-11 px-5 rounded-[14px] border border-border font-semibold text-[14px]"
        >
          Close
        </button>
      </footer>
    </Modal>
  );
}

function FinanceSettingsCard({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient();
  const fetchSettings = useServerFn(listFinanceSettings);
  const save = useServerFn(setFinanceSetting);
  const { data = [] } = useQuery({
    queryKey: ["commission", "settings"],
    queryFn: () => fetchSettings(),
  });
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (v: { key: string; value: string }) => save({ data: v }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["commission"] }),
    onError: (e) => setError(e instanceof Error ? e.message : "Failed"),
  });

  const toggles = data.filter((s) => s.value === "0" || s.value === "1");
  const values = data.filter((s) => s.value !== "0" && s.value !== "1");

  return (
    <div className="bg-card border border-border rounded-[18px] p-5 space-y-4">
      <h3 className="text-[16px] font-bold text-foreground">Finance switches</h3>
      {!canWrite && (
        <p className="text-[13px] text-muted-foreground">Read-only — Super Admin can change these.</p>
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        {toggles.map((s) => (
          <label
            key={s.key}
            className="flex items-center justify-between gap-3 px-4 py-3 rounded-[14px] border border-border text-[13px]"
          >
            <span className="min-w-0">
              <span className="block font-semibold text-foreground truncate">
                {s.label ?? s.key}
              </span>
              <span className="block text-[11px] text-muted-foreground">{s.key}</span>
            </span>
            <input
              type="checkbox"
              disabled={!canWrite || mutation.isPending}
              checked={s.value === "1"}
              onChange={(e) =>
                mutation.mutate({ key: s.key, value: e.target.checked ? "1" : "0" })
              }
            />
          </label>
        ))}
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        {values.map((s) => (
          <Field key={s.key} label={s.label ?? s.key}>
            <input
              defaultValue={s.value}
              disabled={!canWrite}
              onBlur={(e) => {
                if (e.target.value !== s.value)
                  mutation.mutate({ key: s.key, value: e.target.value });
              }}
              className="w-full h-11 px-3 rounded-[14px] border border-border bg-card text-[14px] disabled:opacity-60"
            />
          </Field>
        ))}
      </div>
      {error && <p className="text-[13px] text-destructive">{error}</p>}
    </div>
  );
}

// ---------- shared bits ----------

function Row({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-bold ${danger ? "text-destructive" : "text-foreground"}`}>{value}</span>
    </div>
  );
}

function Select({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-11 px-3 rounded-[14px] border border-border bg-card text-[14px]"
    >
      {TYPES.map((t) => (
        <option key={t.value} value={t.value}>
          {t.label}
        </option>
      ))}
    </select>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-0 sm:p-6 bg-foreground/50 overflow-y-auto"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-card w-full sm:max-w-[640px] sm:rounded-[24px] overflow-hidden shadow-xl"
      >
        <header className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-[18px] font-bold text-foreground">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted"
          >
            <X size={20} />
          </button>
        </header>
        <div className="px-6 py-6">{children}</div>
      </div>
    </div>
  );
}

function Footer({
  onClose,
  onSave,
  disabled,
  pending,
}: {
  onClose: () => void;
  onSave: () => void;
  disabled: boolean;
  pending: boolean;
}) {
  return (
    <footer className="px-6 py-4 border-t border-border flex items-center justify-end gap-3">
      <button
        onClick={onClose}
        className="h-11 px-4 rounded-[14px] border border-border font-semibold text-[14px]"
      >
        Cancel
      </button>
      <button
        disabled={disabled}
        onClick={onSave}
        className="h-11 px-5 rounded-[14px] bg-primary text-white font-bold text-[14px] disabled:opacity-50 inline-flex items-center gap-2"
      >
        <Check size={16} /> {pending ? "Saving…" : "Save"}
      </button>
    </footer>
  );
}
