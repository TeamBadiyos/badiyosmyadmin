import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, X, Check, ArrowLeft, Search } from "lucide-react";
import {
  listWalletOwners,
  listOwnerLedger,
  walletAdjust,
  listPayoutBatches,
  listPayoutItems,
  generatePayoutBatch,
  markPayoutItemPaid,
  discardPayoutBatch,
  setPayoutItemRemoved,
  editPayoutItem,
  getTdsReport,
  markTdsDeposited,
  getTdsSettings,
  saveTdsSettings,
  type WalletOwner,
  type PayoutBatch,
  type PayoutItem,
} from "@/lib/wallets.functions";
import { downloadPayoutPdf, downloadPayoutCsv } from "@/lib/payout-pdf";
import { CommissionTab } from "@/components/commission-tab";
import {
  useSortFilter,
  SortFilterHeader,
  SortFilterReset,
} from "@/components/table-sort-filter";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

type Role = "super_admin" | "ops_manager" | "area_partner" | null;

export function WalletsPage({ role }: { role: Role }) {
  const [tab, setTab] = useState<
    "balances" | "payouts" | "merchant_payouts" | "commission" | "tds"
  >("balances");
  return (
    <div className="space-y-6">
      <div className="inline-flex rounded-[14px] border border-border bg-card p-1">
        <TabBtn active={tab === "balances"} onClick={() => setTab("balances")}>
          Balances
        </TabBtn>
        <TabBtn active={tab === "payouts"} onClick={() => setTab("payouts")}>
          Payouts
        </TabBtn>
        <TabBtn active={tab === "merchant_payouts"} onClick={() => setTab("merchant_payouts")}>
          Merchant Payouts
        </TabBtn>
        <TabBtn active={tab === "commission"} onClick={() => setTab("commission")}>
          Commission &amp; Incentives
        </TabBtn>
        <TabBtn active={tab === "tds"} onClick={() => setTab("tds")}>
          TDS
        </TabBtn>
      </div>
      {tab === "balances" && <BalancesTab role={role} />}
      {tab === "payouts" && <PayoutsTab mode="expert" />}
      {tab === "merchant_payouts" && <PayoutsTab mode="merchant" />}
      {tab === "commission" && <CommissionTab />}
      {tab === "tds" && <TdsTab role={role} />}
    </div>
  );
}


function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-9 px-4 rounded-[10px] text-[13px] font-semibold transition-colors ${
        active ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

// ============ Balances tab ============

function BalancesTab({ role }: { role: Role }) {
  const fetchOwners = useServerFn(listWalletOwners);
  const { data = [], isLoading } = useQuery({
    queryKey: ["wallets", "owners"],
    queryFn: () => fetchOwners(),
  });

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<WalletOwner | null>(null);
  const [adjustFor, setAdjustFor] = useState<WalletOwner | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data;
    return data.filter(
      (o) => o.name.toLowerCase().includes(q) || o.phone.toLowerCase().includes(q),
    );
  }, [data, query]);

  const sf = useSortFilter(filtered, [
    { key: "owner", label: "Owner", value: (o: WalletOwner) => o.name },
    {
      key: "type",
      label: "Type",
      value: (o: WalletOwner) => (o.owner_type === "expert" ? "Expert" : "Partner"),
    },
    {
      key: "balance",
      label: "Balance",
      type: "number",
      align: "right",
      value: (o: WalletOwner) => o.balance,
      filterable: false,
    },
  ]);
  const rows = sf.rows;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_420px] gap-6">
      <div className="space-y-4 min-w-0">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or phone"
              className="w-full h-11 pl-9 pr-3 rounded-[14px] border border-border bg-card text-[14px]"
            />
          </div>
          <SortFilterReset api={sf} />
          {role === "super_admin" && (
            <button
              onClick={() => setAdjustFor(selected ?? data[0] ?? null)}
              className="h-11 px-4 rounded-[14px] bg-primary text-white font-bold text-[14px] inline-flex items-center gap-2"
            >
              <Plus size={16} /> Manual Adjustment
            </button>
          )}
        </div>

        <div className="bg-card border border-border rounded-[18px] overflow-visible">
          <div className="grid grid-cols-[minmax(0,1fr)_120px_140px] gap-4 px-6 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <SortFilterHeader {...sf.headerProps("owner")} />
            <SortFilterHeader {...sf.headerProps("type")} />
            <SortFilterHeader {...sf.headerProps("balance")} />
          </div>
          {isLoading && (
            <p className="text-[13px] text-muted-foreground text-center py-10">Loading…</p>
          )}
          {!isLoading && rows.length === 0 && (
            <p className="text-[13px] text-muted-foreground text-center py-10">No matches.</p>
          )}
          {rows.map((o) => (
            <button
              key={`${o.owner_type}:${o.id}`}
              onClick={() => setSelected(o)}
              className={`w-full grid grid-cols-[minmax(0,1fr)_120px_140px] gap-4 items-center px-6 py-3 border-b border-border last:border-b-0 text-left text-[14px] hover:bg-muted/40 transition-colors ${
                selected && selected.id === o.id && selected.owner_type === o.owner_type
                  ? "bg-primary-tint"
                  : ""
              }`}
            >
              <div className="min-w-0">
                <p className="font-semibold text-foreground truncate">{o.name}</p>
                <p className="text-[12px] text-muted-foreground truncate">{o.phone}</p>
              </div>
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                {o.owner_type === "expert" ? "Expert" : "Partner"}
              </span>
              <span
                className={`text-right font-semibold ${
                  o.balance < 0 ? "text-destructive" : "text-foreground"
                }`}
              >
                {inr.format(o.balance)}
              </span>
            </button>
          ))}
        </div>
      </div>

      <aside className="lg:sticky lg:top-6 h-max">
        {selected ? (
          <LedgerCard owner={selected} onAdjust={() => setAdjustFor(selected)} role={role} />
        ) : (
          <div className="bg-card border border-border rounded-[18px] p-6 text-[13px] text-muted-foreground">
            Select an owner to see their ledger.
          </div>
        )}
      </aside>

      {adjustFor && (
        <AdjustModal
          owners={data}
          initialOwner={adjustFor}
          onClose={() => setAdjustFor(null)}
        />
      )}
    </div>
  );
}

function LedgerCard({
  owner,
  onAdjust,
  role,
}: {
  owner: WalletOwner;
  onAdjust: () => void;
  role: Role;
}) {
  const fetchLedger = useServerFn(listOwnerLedger);
  const { data = [], isLoading } = useQuery({
    queryKey: ["wallets", "ledger", owner.owner_type, owner.id],
    queryFn: () => fetchLedger({ data: { owner_type: owner.owner_type, owner_id: owner.id } }),
  });

  return (
    <div className="bg-card border border-border rounded-[18px] overflow-hidden">
      <header className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            {owner.owner_type === "expert" ? "Expert" : "Area Partner"}
          </p>
          <h3 className="text-[16px] font-bold text-foreground truncate">{owner.name}</h3>
          <p className="text-[12px] text-muted-foreground">
            Balance: <span className="font-semibold text-foreground">{inr.format(owner.balance)}</span>
          </p>
        </div>
        {role === "super_admin" && (
          <button
            onClick={onAdjust}
            className="h-9 px-3 rounded-[12px] bg-primary text-white text-[13px] font-bold inline-flex items-center gap-1"
          >
            <Plus size={14} /> Adjust
          </button>
        )}
      </header>
      <div className="max-h-[520px] overflow-y-auto">
        {isLoading && (
          <p className="text-[13px] text-muted-foreground text-center py-6">Loading…</p>
        )}
        {!isLoading && data.length === 0 && (
          <p className="text-[13px] text-muted-foreground text-center py-6">No ledger entries.</p>
        )}
        {data.map((e) => (
          <div key={e.id} className="px-5 py-3 border-b border-border last:border-b-0">
            <div className="flex items-center justify-between gap-3">
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${
                  e.type === "credit"
                    ? "bg-primary-tint text-primary"
                    : "bg-destructive/10 text-destructive"
                }`}
              >
                {e.type}
              </span>
              <span
                className={`text-[14px] font-semibold ${
                  e.type === "credit" ? "text-primary" : "text-destructive"
                }`}
              >
                {e.type === "credit" ? "+" : "-"}
                {inr.format(e.amount)}
              </span>
            </div>
            <p className="mt-1 text-[13px] text-foreground">{e.reason}</p>
            <p className="text-[11px] text-muted-foreground">
              {new Date(e.created_at).toLocaleString()}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdjustModal({
  owners,
  initialOwner,
  onClose,
}: {
  owners: WalletOwner[];
  initialOwner: WalletOwner;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const save = useServerFn(walletAdjust);
  const [ownerKey, setOwnerKey] = useState(`${initialOwner.owner_type}:${initialOwner.id}`);
  const [type, setType] = useState<"credit" | "debit">("credit");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const [owner_type, owner_id] = ownerKey.split(":") as ["expert" | "area_partner", string];
      const amt = Number(amount);
      if (!(amt > 0)) throw new Error("Amount must be positive");
      if (!reason.trim()) throw new Error("Reason required");
      return save({ data: { owner_type, owner_id, amount: amt, type, reason: reason.trim() } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wallets"] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-0 sm:p-6 bg-foreground/50"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-card w-full sm:max-w-[520px] sm:rounded-[24px] overflow-hidden shadow-xl flex flex-col"
      >
        <header className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-[18px] font-bold text-foreground">Manual wallet adjustment</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted"
          >
            <X size={20} />
          </button>
        </header>
        <div className="px-6 py-6 space-y-4">
          <Field label="Owner">
            <select
              value={ownerKey}
              onChange={(e) => setOwnerKey(e.target.value)}
              className="w-full h-11 px-3 rounded-[14px] border border-border bg-card text-[14px]"
            >
              {owners.map((o) => (
                <option
                  key={`${o.owner_type}:${o.id}`}
                  value={`${o.owner_type}:${o.id}`}
                >
                  {o.name} · {o.owner_type === "expert" ? "Expert" : "Partner"} · {o.phone}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Type">
              <select
                value={type}
                onChange={(e) => setType(e.target.value as "credit" | "debit")}
                className="w-full h-11 px-3 rounded-[14px] border border-border bg-card text-[14px]"
              >
                <option value="credit">Credit</option>
                <option value="debit">Debit</option>
              </select>
            </Field>
            <Field label="Amount (₹)">
              <input
                type="number"
                min="0"
                step="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full h-11 px-3 rounded-[14px] border border-border bg-card text-[14px]"
              />
            </Field>
          </div>

          <Field label="Reason">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Reason for this adjustment"
              className="w-full px-3 py-2 rounded-[14px] border border-border bg-card text-[14px] resize-none"
            />
          </Field>

          {error && <p className="text-[13px] text-destructive">{error}</p>}
        </div>
        <footer className="px-6 py-4 border-t border-border flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="h-11 px-4 rounded-[14px] border border-border font-semibold text-[14px]"
          >
            Cancel
          </button>
          <button
            disabled={mutation.isPending}
            onClick={() => {
              setError(null);
              mutation.mutate();
            }}
            className="h-11 px-5 rounded-[14px] bg-primary text-white font-bold text-[14px] disabled:opacity-50 inline-flex items-center gap-2"
          >
            <Check size={16} /> {mutation.isPending ? "Saving…" : "Post adjustment"}
          </button>
        </footer>
      </div>
    </div>
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

// ============ Payouts tab ============

function ymd(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function lastWeekRange() {
  const t = new Date();
  const dow = (t.getDay() + 6) % 7; // Mon=0
  const thisMon = new Date(t.getFullYear(), t.getMonth(), t.getDate() - dow);
  const lastMon = new Date(thisMon.getFullYear(), thisMon.getMonth(), thisMon.getDate() - 7);
  const lastSun = new Date(thisMon.getFullYear(), thisMon.getMonth(), thisMon.getDate() - 1);
  return { from: ymd(lastMon), to: ymd(lastSun), thisMon: ymd(thisMon), today: ymd(t) };
}

function GenerateBatchDialog({
  mode,
  onClose,
  onDone,
}: {
  mode: "expert" | "merchant";
  onClose: () => void;
  onDone: () => void;
}) {
  const gen = useServerFn(generatePayoutBatch);
  const r = lastWeekRange();
  const [from, setFrom] = useState(r.from);
  const [to, setTo] = useState(r.to);
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => gen({ data: { batch_type: mode, from, to, notes } }),
    onSuccess: onDone,
    onError: (e) => setErr(e instanceof Error ? e.message : "Failed"),
  });
  const preset = (f: string, t: string) => {
    setFrom(f);
    setTo(t);
  };
  const inp = "w-full h-11 px-3 rounded-[14px] border border-border bg-card text-[14px]";
  return (
    <div className="fixed inset-0 z-50 bg-foreground/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-[18px] border border-border w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-[17px] font-bold text-foreground">Generate payout batch</h3>
          <button onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => preset(r.from, r.to)} className="h-8 px-3 rounded-full border border-border text-[12px] font-semibold hover:bg-muted">Last week (Mon–Sun)</button>
          <button onClick={() => preset(r.thisMon, r.today)} className="h-8 px-3 rounded-full border border-border text-[12px] font-semibold hover:bg-muted">This week so far</button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-[12px] font-semibold text-muted-foreground space-y-1">
            <span>From</span>
            <input type="date" className={inp} value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-[12px] font-semibold text-muted-foreground space-y-1">
            <span>To</span>
            <input type="date" className={inp} value={to} min={from} max={r.today} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <input className={inp} placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <p className="text-[12px] text-muted-foreground">
          Includes all unpaid wallet earnings up to the end date — order payouts and bonuses. Bonuses are shown separately.
        </p>
        {err && <p className="text-[13px] text-destructive">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="h-10 px-4 rounded-[12px] border border-border font-semibold text-[13px]">Cancel</button>
          <button
            disabled={m.isPending || !from || !to || from > to || to > r.today}
            onClick={() => { setErr(null); m.mutate(); }}
            className="h-10 px-4 rounded-[12px] bg-primary text-primary-foreground font-bold text-[13px] disabled:opacity-50"
          >
            {m.isPending ? "Generating…" : "Generate"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PayoutsTab({ mode }: { mode: "expert" | "merchant" }) {
  const queryClient = useQueryClient();
  const fetchBatches = useServerFn(listPayoutBatches);
  const discard = useServerFn(discardPayoutBatch);
  const { data = [], isLoading } = useQuery({
    queryKey: ["wallets", "batches", mode],
    queryFn: () => fetchBatches({ data: { batch_type: mode } }),
  });
  const [openBatch, setOpenBatch] = useState<PayoutBatch | null>(null);
  const [showGen, setShowGen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const del = useMutation({
    mutationFn: (p: { id: string; reason: string }) => discard({ data: { batch_id: p.id, reason: p.reason } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["wallets", "batches"] }),
    onError: (e) => setError(e instanceof Error ? e.message : "Failed"),
  });

  const sf = useSortFilter(all, [
    {
      key: "week",
      label: "Period",
      value: (b: PayoutBatch) => b.week_start,
      display: (b: PayoutBatch) => `${formatDate(b.week_start)} – ${formatDate(b.week_end)}`,
    },
    {
      key: "total",
      label: "Total",
      type: "number",
      align: "right",
      value: (b: PayoutBatch) => b.total_amount,
      filterable: false,
    },
    { key: "status", label: "Status", value: (b: PayoutBatch) => b.status },
  ]);

  if (openBatch) {
    return <BatchDetail batch={openBatch} onBack={() => setOpenBatch(null)} />;
  }

  return (
    <div className="space-y-4">
      {showGen && (
        <GenerateBatchDialog
          mode={mode}
          onClose={() => setShowGen(false)}
          onDone={() => {
            setShowGen(false);
            queryClient.invalidateQueries({ queryKey: ["wallets", "batches"] });
          }}
        />
      )}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[14px] text-muted-foreground">
          {mode === "merchant"
            ? "Merchant payout batches for a chosen period."
            : "Payout batches to experts and area partners for a chosen period (bonuses included)."}
        </p>
        <div className="flex items-center gap-3">
          <SortFilterReset api={sf} />
          <button
            onClick={() => {
              setError(null);
              setShowGen(true);
            }}
            className="h-11 px-4 rounded-[14px] bg-primary text-primary-foreground font-bold text-[14px] inline-flex items-center gap-2"
          >
            <Plus size={16} /> Generate batch
          </button>
        </div>
      </div>

      {error && <p className="text-[13px] text-destructive">{error}</p>}

      <div className="bg-card border border-border rounded-[18px] overflow-visible">
        <div className="grid grid-cols-[minmax(0,1fr)_140px_120px_120px] gap-4 px-6 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <SortFilterHeader {...sf.headerProps("week")} />
          <SortFilterHeader {...sf.headerProps("total")} />
          <SortFilterHeader {...sf.headerProps("status")} />
          <span></span>
        </div>
        {isLoading && (
          <p className="text-[13px] text-muted-foreground text-center py-10">Loading…</p>
        )}
        {!isLoading && sf.rows.length === 0 && (
          <p className="text-[13px] text-muted-foreground text-center py-10">No batches yet.</p>
        )}
        {sf.rows.map((b) => (
          <div
            key={b.id}
            className="grid grid-cols-[minmax(0,1fr)_140px_120px_120px] gap-4 items-center px-6 py-3 border-b border-border last:border-b-0 text-[14px]"
          >
            <div className="min-w-0">
              <p className="font-semibold text-foreground">
                {formatDate(b.week_start)} – {formatDate(b.week_end)}
              </p>
              <p className="text-[12px] text-muted-foreground">
                Created {new Date(b.created_at).toLocaleString()}
              </p>
            </div>
            <span className="text-right font-semibold">{inr.format(b.total_amount)}</span>
            <span>
              <span
                className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide ${
                  b.status === "paid"
                    ? "bg-primary-tint text-primary"
                    : "bg-amber-100 text-amber-700"
                }`}
              >
                {b.status}
              </span>
            </span>
            <div className="flex justify-end gap-1">
              <button
                onClick={() => setOpenBatch(b)}
                className="h-9 px-3 rounded-[12px] border border-border font-semibold text-[13px] hover:bg-muted"
              >
                Open
              </button>
              {b.status === "pending" && (
                <button
                  disabled={del.isPending}
                  title="Delete batch"
                  onClick={() => {
                    const reason = window.prompt("Delete this batch? Enter a reason (needed). Nothing paid is affected.");
                    if (reason && reason.trim()) del.mutate({ id: b.id, reason: reason.trim() });
                  }}
                  className="h-9 w-9 inline-flex items-center justify-center rounded-[12px] border border-border text-destructive hover:bg-muted"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BatchDetail({ batch, onBack }: { batch: PayoutBatch; onBack: () => void }) {
  const queryClient = useQueryClient();
  const fetchItems = useServerFn(listPayoutItems);
  const markItem = useServerFn(markPayoutItemPaid);
  const discardBatch = useServerFn(discardPayoutBatch);
  const [discardReason, setDiscardReason] = useState("");
  const [showDiscard, setShowDiscard] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<PayoutItem | null>(null);
  const [editFor, setEditFor] = useState<PayoutItem | null>(null);
  const removeItem = useServerFn(setPayoutItemRemoved);
  const editItem = useServerFn(editPayoutItem);

  const { data = [], isLoading } = useQuery({
    queryKey: ["wallets", "batch-items", batch.id],
    queryFn: () => fetchItems({ data: { batch_id: batch.id } }),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["wallets"] });
  };

  const itemMutation = useMutation({
    mutationFn: (p: { item_id: string; paid: boolean; paid_on?: string; utr?: string; mode?: string; notes?: string }) =>
      markItem({ data: p }),
    onSuccess: () => {
      setPayFor(null);
      refresh();
    },
    onError: (e) => setDetailError(e instanceof Error ? e.message : "Failed"),
  });

  const removeMutation = useMutation({
    mutationFn: (p: { item_id: string; removed: boolean; reason?: string }) => removeItem({ data: p }),
    onSuccess: refresh,
    onError: (e) => setDetailError(e instanceof Error ? e.message : "Failed"),
  });

  const editMutation = useMutation({
    mutationFn: (p: { item_id: string; gross: number; bonus: number; reason: string }) => editItem({ data: p }),
    onSuccess: () => {
      setEditFor(null);
      refresh();
    },
    onError: (e) => setDetailError(e instanceof Error ? e.message : "Failed"),
  });

  const discardMutation = useMutation({
    mutationFn: () => discardBatch({ data: { batch_id: batch.id, reason: discardReason } }),
    onSuccess: () => {
      setShowDiscard(false);
      setDiscardReason("");
      refresh();
      onBack();
    },
    onError: (e) => setDetailError(e instanceof Error ? e.message : "Failed"),
  });

  const all = data;
  const active = all.filter((i) => !i.removed);
  const unpaid = active.filter((i) => !i.paid).length;
  const tdsTotal = active.reduce((s, i) => s + (i.tds_amount ?? 0), 0);
  const bonusTotal = active.reduce((s, i) => s + (i.bonus_amount ?? 0), 0);
  const netTotal = active.reduce((s, i) => s + i.net_amount, 0);
  const paidNet = active.filter((i) => i.paid).reduce((s, i) => s + i.net_amount, 0);
  const anyPaid = data.some((i) => i.paid);

  type Item = (typeof data)[number];
  const sf = useSortFilter(data, [
    { key: "owner", label: "Owner", value: (i: Item) => i.owner_name },
    {
      key: "type",
      label: "Type",
      value: (i: Item) =>
        i.owner_type === "expert" ? "Expert" : i.owner_type === "merchant" ? "Merchant" : "Partner",
    },
    { key: "gross", label: "Gross", type: "number", align: "right", value: (i: Item) => i.gross_amount, filterable: false },
    { key: "bonus", label: "Bonus", type: "number", align: "right", value: (i: Item) => i.bonus_amount, filterable: false },
    { key: "tds", label: "TDS", type: "number", align: "right", value: (i: Item) => i.tds_amount ?? 0, filterable: false },
    { key: "net", label: "Net", type: "number", align: "right", value: (i: Item) => i.net_amount, filterable: false },
    { key: "paid", label: "Payment", value: (i: Item) => (i.removed ? "Removed" : i.paid ? "Paid" : "Unpaid") },
  ]);

  const grid = "grid grid-cols-[minmax(0,1fr)_90px_100px_90px_100px_100px_minmax(0,200px)] gap-3";

  return (
    <div className="space-y-4">
      {payFor && (
        <RecordPaymentDialog
          item={payFor}
          pending={itemMutation.isPending}
          onClose={() => setPayFor(null)}
          onSave={(v) => itemMutation.mutate({ item_id: payFor.id, paid: true, ...v })}
        />
      )}
      {editFor && (
        <EditItemDialog
          item={editFor}
          pending={editMutation.isPending}
          onClose={() => setEditFor(null)}
          onSave={(v) => editMutation.mutate({ item_id: editFor.id, ...v })}
        />
      )}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          onClick={onBack}
          className="h-10 px-3 rounded-[12px] border border-border font-semibold text-[13px] inline-flex items-center gap-1 hover:bg-muted"
        >
          <ArrowLeft size={14} /> Back to batches
        </button>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            disabled={!data.length}
            onClick={() => downloadPayoutCsv(batch, active)}
            className="h-10 px-4 rounded-[12px] border border-border font-semibold text-[13px] hover:bg-muted disabled:opacity-50"
          >
            Download CSV
          </button>
          <button
            disabled={!data.length}
            onClick={() => downloadPayoutPdf(batch, active).catch((e) => setDetailError(String(e)))}
            className="h-10 px-4 rounded-[12px] bg-primary text-primary-foreground font-bold text-[13px] disabled:opacity-50"
          >
            Download PDF
          </button>
          {batch.status === "pending" && (
            <button
              disabled={anyPaid}
              title={anyPaid ? "Un-mark paid people first" : undefined}
              onClick={() => setShowDiscard(true)}
              className="h-10 px-4 rounded-[12px] border border-border font-semibold text-[13px] text-destructive hover:bg-muted disabled:opacity-50"
            >
              Delete batch
            </button>
          )}
        </div>
      </div>

      {detailError && <p className="text-[13px] text-destructive">{detailError}</p>}

      {showDiscard && (
        <div className="bg-card border border-border rounded-[18px] p-5 space-y-3">
          <p className="text-[14px] font-semibold text-foreground">Delete this batch?</p>
          <p className="text-[13px] text-muted-foreground">
            The batch is moved out (kept in history). Balances stay unpaid and you can create a new batch with corrected dates.
          </p>
          <input
            value={discardReason}
            onChange={(e) => setDiscardReason(e.target.value)}
            placeholder="Reason"
            className="w-full h-11 px-3 rounded-[14px] border border-border bg-card text-[14px]"
          />
          <div className="flex gap-2">
            <button
              disabled={discardMutation.isPending || !discardReason.trim()}
              onClick={() => discardMutation.mutate()}
              className="h-10 px-4 rounded-[12px] bg-destructive text-destructive-foreground font-bold text-[13px] disabled:opacity-50"
            >
              {discardMutation.isPending ? "Deleting…" : "Delete"}
            </button>
            <button
              onClick={() => setShowDiscard(false)}
              className="h-10 px-4 rounded-[12px] border border-border font-semibold text-[13px]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-[18px] p-5">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Batch</p>
        <h2 className="text-[20px] font-bold text-foreground">
          {formatDate(batch.week_start)} – {formatDate(batch.week_end)}
        </h2>
        <p className="text-[13px] text-muted-foreground">
          Gross <span className="font-semibold text-foreground">{inr.format(batch.total_amount)}</span>
          {bonusTotal > 0 && <> · Bonus incl. <span className="font-semibold text-foreground">{inr.format(bonusTotal)}</span></>}
          {tdsTotal > 0 && <> · TDS <span className="font-semibold text-foreground">{inr.format(tdsTotal)}</span></>}
          {" · "}Net <span className="font-semibold text-foreground">{inr.format(netTotal)}</span>
          {" · "}Paid <span className="font-semibold text-foreground">{inr.format(paidNet)}</span>
          {" · "}{unpaid} unpaid
        </p>
        {batch.notes && <p className="text-[12px] text-muted-foreground mt-1">Notes: {batch.notes}</p>}
      </div>

      <div className="flex justify-end">
        <SortFilterReset api={sf} />
      </div>

      <div className="bg-card border border-border rounded-[18px] overflow-visible">
        <div className={`${grid} px-6 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground`}>
          <SortFilterHeader {...sf.headerProps("owner")} />
          <SortFilterHeader {...sf.headerProps("type")} />
          <SortFilterHeader {...sf.headerProps("gross")} />
          <SortFilterHeader {...sf.headerProps("bonus")} />
          <SortFilterHeader {...sf.headerProps("tds")} />
          <SortFilterHeader {...sf.headerProps("net")} />
          <SortFilterHeader {...sf.headerProps("paid")} />
        </div>
        {isLoading && <p className="text-[13px] text-muted-foreground text-center py-10">Loading…</p>}
        {!isLoading && sf.rows.length === 0 && (
          <p className="text-[13px] text-muted-foreground text-center py-10">No items in this batch.</p>
        )}
        {sf.rows.map((i) => (
          <div key={i.id} className={`${grid} items-center px-6 py-3 border-b border-border last:border-b-0 text-[14px] ${i.removed ? "opacity-50" : ""}`}>
            <div className="min-w-0">
              <p className="font-semibold text-foreground truncate">{i.owner_name}</p>
              <p className="text-[11px] text-muted-foreground">
                {i.owner_phone ?? ""}{i.pan_last4 ? ` · PAN ••••${i.pan_last4}` : ""}
              </p>
            </div>
            <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              {i.owner_type === "expert" ? "Expert" : i.owner_type === "merchant" ? "Merchant" : "Partner"}
            </span>
            <span className="text-right font-semibold">{inr.format(i.gross_amount)}</span>
            <span className="text-right text-muted-foreground">{i.bonus_amount > 0 ? inr.format(i.bonus_amount) : "—"}</span>
            <span className="text-right text-muted-foreground">
              {i.tds_amount > 0 ? `${inr.format(i.tds_amount)} (${i.tds_rate}%)` : "—"}
            </span>
            <span className="text-right font-semibold">{inr.format(i.net_amount)}</span>
            <div className="min-w-0">
              {i.paid ? (
                <div className="text-[12px]">
                  <p className="font-bold text-primary">Paid {i.paid_on ? formatDate(i.paid_on) : ""}</p>
                  <p className="text-muted-foreground truncate">
                    {[i.payment_mode, i.utr].filter(Boolean).join(" · ") || "—"}
                  </p>
                  <button
                    disabled={itemMutation.isPending}
                    onClick={() => {
                      if (window.confirm("Un-mark this payment? The amount will be returned to their wallet."))
                        itemMutation.mutate({ item_id: i.id, paid: false });
                    }}
                    className="text-[11px] font-semibold text-destructive underline"
                  >
                    Un-mark
                  </button>
                </div>
              ) : i.removed ? (
                <div className="text-[12px]">
                  <p className="font-bold text-destructive">Removed</p>
                  <p className="text-muted-foreground truncate" title={i.removed_reason ?? ""}>{i.removed_reason ?? "—"}</p>
                  {batch.status !== "discarded" && (
                    <button
                      disabled={removeMutation.isPending}
                      onClick={() => { setDetailError(null); removeMutation.mutate({ item_id: i.id, removed: false }); }}
                      className="text-[11px] font-semibold text-primary underline"
                    >
                      Add back
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-start gap-1">
                  <button
                    disabled={batch.status === "discarded"}
                    onClick={() => { setDetailError(null); setPayFor(i); }}
                    className="h-9 px-3 rounded-[12px] bg-primary text-primary-foreground font-bold text-[12px] disabled:opacity-50"
                  >
                    Record payment
                  </button>
                  {batch.status !== "discarded" && (
                    <div className="flex gap-3 text-[11px] font-semibold">
                      <button onClick={() => { setDetailError(null); setEditFor(i); }} className="text-foreground underline">
                        Edit
                      </button>
                      <button
                        disabled={removeMutation.isPending}
                        onClick={() => {
                          const reason = window.prompt(`Remove ${i.owner_name} from this batch? Reason:`);
                          if (reason && reason.trim()) {
                            setDetailError(null);
                            removeMutation.mutate({ item_id: i.id, removed: true, reason });
                          }
                        }}
                        className="text-destructive underline"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EditItemDialog({
  item,
  pending,
  onClose,
  onSave,
}: {
  item: PayoutItem;
  pending: boolean;
  onClose: () => void;
  onSave: (v: { gross: number; bonus: number; reason: string }) => void;
}) {
  const [gross, setGross] = useState(String(item.gross_amount));
  const [bonus, setBonus] = useState(String(item.bonus_amount));
  const [reason, setReason] = useState("");
  const g = Number(gross);
  const b = Number(bonus);
  const valid = g > 0 && b >= 0 && b <= g && reason.trim().length > 0;
  const inp = "w-full h-11 px-3 rounded-[14px] border border-border bg-card text-[14px]";
  return (
    <div className="fixed inset-0 z-50 bg-foreground/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-[18px] border border-border p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
        <p className="text-[16px] font-bold text-foreground">Edit payout – {item.owner_name}</p>
        <p className="text-[12px] text-muted-foreground">TDS aur Net naye amount se apne aap dobara calculate honge.</p>
        <label className="block text-[12px] font-semibold text-muted-foreground">
          Gross amount (₹, bonus included)
          <input type="number" min={0} value={gross} onChange={(e) => setGross(e.target.value)} className={inp} />
        </label>
        <label className="block text-[12px] font-semibold text-muted-foreground">
          Bonus (₹)
          <input type="number" min={0} value={bonus} onChange={(e) => setBonus(e.target.value)} className={inp} />
        </label>
        <label className="block text-[12px] font-semibold text-muted-foreground">
          Reason
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Kyun badal rahe ho" className={inp} />
        </label>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="h-10 px-4 rounded-[12px] border border-border font-semibold text-[13px]">Cancel</button>
          <button
            disabled={!valid || pending}
            onClick={() => onSave({ gross: g, bonus: b, reason })}
            className="h-10 px-4 rounded-[12px] bg-primary text-primary-foreground font-bold text-[13px] disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RecordPaymentDialog({
  item,
  pending,
  onClose,
  onSave,
}: {
  item: PayoutItem;
  pending: boolean;
  onClose: () => void;
  onSave: (v: { paid_on: string; utr: string; mode: string; notes: string }) => void;
}) {
  const today = ymd(new Date());
  const [paidOn, setPaidOn] = useState(today);
  const [utr, setUtr] = useState("");
  const [mode, setMode] = useState("UPI");
  const [notes, setNotes] = useState("");
  const inp = "w-full h-11 px-3 rounded-[14px] border border-border bg-card text-[14px]";
  return (
    <div className="fixed inset-0 z-50 bg-foreground/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-[18px] border border-border w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-[17px] font-bold text-foreground">Record payment</h3>
          <button onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <p className="text-[13px] text-muted-foreground">
          {item.owner_name} · Net payable <span className="font-bold text-foreground">{inr.format(item.net_amount)}</span>
        </p>
        <label className="block text-[12px] font-semibold text-muted-foreground space-y-1">
          <span>Payment date</span>
          <input type="date" className={inp} value={paidOn} max={today} onChange={(e) => setPaidOn(e.target.value)} />
        </label>
        <label className="block text-[12px] font-semibold text-muted-foreground space-y-1">
          <span>Mode</span>
          <select className={inp} value={mode} onChange={(e) => setMode(e.target.value)}>
            {["UPI", "IMPS", "NEFT", "RTGS", "Bank transfer", "Cash"].map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
        <label className="block text-[12px] font-semibold text-muted-foreground space-y-1">
          <span>UTR / Reference no.</span>
          <input className={inp} value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="e.g. 427812345678" />
        </label>
        <input className={inp} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" />
        <p className="text-[12px] text-muted-foreground">Saving reduces their wallet balance by this payout.</p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="h-10 px-4 rounded-[12px] border border-border font-semibold text-[13px]">Cancel</button>
          <button
            disabled={pending || !paidOn || paidOn > today || (mode !== "Cash" && !utr.trim())}
            onClick={() => onSave({ paid_on: paidOn, utr, mode, notes })}
            className="h-10 px-4 rounded-[12px] bg-primary text-primary-foreground font-bold text-[13px] disabled:opacity-50"
          >
            {pending ? "Saving…" : "Mark paid"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TdsSettingsCard({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient();
  const fetchSettings = useServerFn(getTdsSettings);
  const save = useServerFn(saveTdsSettings);
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["wallets", "tds-settings"],
    queryFn: () => fetchSettings(),
  });

  const mutation = useMutation({
    mutationFn: (v: { enabled?: boolean; rate?: number }) => save({ data: v }),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["wallets"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Failed"),
  });

  const enabled = data?.enabled ?? false;
  const rate = data?.rate ?? 2;

  return (
    <div className="bg-card border border-border rounded-[18px] p-5 space-y-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-[16px] font-bold text-foreground">TDS deduction</h3>
          <p className="text-[13px] text-muted-foreground">
            One rate for every payout — experts and area partners.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-[13px] font-semibold">
            <input
              type="checkbox"
              checked={enabled}
              disabled={!canWrite || mutation.isPending}
              onChange={(e) => mutation.mutate({ enabled: e.target.checked })}
            />
            {enabled ? "On" : "Off"}
          </label>
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-muted-foreground">Rate</span>
            <input
              key={rate}
              type="number"
              step="0.1"
              min="0"
              max="100"
              defaultValue={rate}
              disabled={!canWrite}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v !== rate) mutation.mutate({ rate: v });
              }}
              className="w-24 h-11 px-3 rounded-[14px] border border-border bg-card text-[14px] disabled:opacity-60"
            />
            <span className="text-[13px] text-muted-foreground">%</span>
          </div>
        </div>
      </div>
      {!canWrite && (
        <p className="text-[13px] text-muted-foreground">Read-only — Super Admin can change this.</p>
      )}
      {error && <p className="text-[13px] text-destructive">{error}</p>}
    </div>
  );
}

function TdsTab({ role }: { role: Role }) {
  const queryClient = useQueryClient();
  const fetchReport = useServerFn(getTdsReport);
  const markDeposited = useServerFn(markTdsDeposited);
  const now = new Date();
  const currentFy = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  const [fy, setFy] = useState(currentFy);
  const [error, setError] = useState<string | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ["wallets", "tds", fy],
    queryFn: () => fetchReport({ data: { fy_start_year: fy } }),
  });

  type TdsRow = (typeof data)[number];
  const sf = useSortFilter(data, [
    { key: "person", label: "Person", value: (r: TdsRow) => r.owner_name },
    {
      key: "type",
      label: "Type",
      value: (r: TdsRow) => (r.owner_type === "expert" ? "Expert" : "Partner"),
    },
    {
      key: "gross",
      label: "Gross",
      type: "number",
      align: "right",
      value: (r: TdsRow) => r.gross_total,
      filterable: false,
    },
    {
      key: "tds",
      label: "TDS",
      type: "number",
      align: "right",
      value: (r: TdsRow) => r.tds_total,
      filterable: false,
    },
    {
      key: "deposited",
      label: "Deposited",
      type: "number",
      align: "right",
      value: (r: TdsRow) => r.deposited_total,
      filterable: false,
    },
  ]);

  const deposit = useMutation({
    mutationFn: (p: { owner_type: string; owner_id: string }) =>
      markDeposited({ data: { ...p, fy_start_year: fy } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["wallets", "tds", fy] }),
    onError: (e) => setError(e instanceof Error ? e.message : "Failed"),
  });

  function exportCsv() {
    const header = ["Name", "Type", "PAN last 4", "Gross", "TDS", "Net", "Deposited", "Items"];
    const lines = data.map((r) =>
      [
        r.owner_name,
        r.owner_type,
        r.pan_last4 ?? "",
        r.gross_total,
        r.tds_total,
        r.net_total,
        r.deposited_total,
        r.items,
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const csv = [header.join(","), ...lines].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `tds-report-fy-${fy}-${fy + 1}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <TdsSettingsCard canWrite={role === "super_admin"} />
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-muted-foreground">Financial year</span>
          <select
            value={fy}
            onChange={(e) => setFy(Number(e.target.value))}
            className="h-10 px-3 rounded-[12px] border border-border bg-card text-[14px]"
          >
            {[0, 1, 2, 3].map((n) => {
              const y = currentFy - n;
              return (
                <option key={y} value={y}>
                  April {y} – March {y + 1}
                </option>
              );
            })}
          </select>
        </div>
        <button
          onClick={exportCsv}
          disabled={data.length === 0}
          className="h-10 px-4 rounded-[12px] border border-border font-semibold text-[13px] disabled:opacity-40 hover:bg-muted"
        >
          Export CSV
        </button>
      </div>

      {error && <p className="text-[13px] text-destructive">{error}</p>}

      <div className="flex justify-end">
        <SortFilterReset api={sf} />
      </div>

      <div className="bg-card border border-border rounded-[18px] overflow-visible">
        <div className="grid grid-cols-[minmax(0,1fr)_110px_120px_120px_120px_130px] gap-4 px-6 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <SortFilterHeader {...sf.headerProps("person")} />
          <SortFilterHeader {...sf.headerProps("type")} />
          <SortFilterHeader {...sf.headerProps("gross")} />
          <SortFilterHeader {...sf.headerProps("tds")} />
          <SortFilterHeader {...sf.headerProps("deposited")} />
          <span></span>
        </div>
        {isLoading && (
          <p className="text-[13px] text-muted-foreground text-center py-10">Loading…</p>
        )}
        {!isLoading && sf.rows.length === 0 && (
          <p className="text-[13px] text-muted-foreground text-center py-10">
            No paid payouts in this financial year.
          </p>
        )}
        {sf.rows.map((r) => (
          <div
            key={`${r.owner_type}:${r.owner_id}`}
            className="grid grid-cols-[minmax(0,1fr)_110px_120px_120px_120px_130px] gap-4 items-center px-6 py-3 border-b border-border last:border-b-0 text-[14px]"
          >
            <div className="min-w-0">
              <p className="font-semibold text-foreground truncate">{r.owner_name}</p>
              <p className="text-[11px] text-muted-foreground">
                {r.pan_last4 ? `PAN ••••${r.pan_last4}` : "PAN not provided"}
              </p>
            </div>
            <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              {r.owner_type === "expert" ? "Expert" : "Partner"}
            </span>
            <span className="text-right font-semibold">{inr.format(r.gross_total)}</span>
            <span className="text-right">{inr.format(r.tds_total)}</span>
            <span className="text-right text-muted-foreground">
              {inr.format(r.deposited_total)}
            </span>
            <div className="flex justify-end">
              {role === "super_admin" && r.tds_total > r.deposited_total && (
                <button
                  disabled={deposit.isPending}
                  onClick={() =>
                    deposit.mutate({ owner_type: r.owner_type, owner_id: r.owner_id })
                  }
                  className="h-9 px-3 rounded-[12px] border border-border font-semibold text-[12px] hover:bg-muted disabled:opacity-50"
                >
                  Mark deposited
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
