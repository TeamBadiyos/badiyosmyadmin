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
  markPayoutBatchPaid,
  type WalletOwner,
  type PayoutBatch,
} from "@/lib/wallets.functions";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

type Role = "super_admin" | "ops_manager" | "area_partner" | null;

export function WalletsPage({ role }: { role: Role }) {
  const [tab, setTab] = useState<"balances" | "payouts" | "merchant_payouts">("balances");
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
      </div>
      {tab === "balances" && <BalancesTab role={role} />}
      {tab === "payouts" && <PayoutsTab mode="expert" />}
      {tab === "merchant_payouts" && <PayoutsTab mode="merchant" />}
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
          {role === "super_admin" && (
            <button
              onClick={() => setAdjustFor(selected ?? data[0] ?? null)}
              className="h-11 px-4 rounded-[14px] bg-primary text-white font-bold text-[14px] inline-flex items-center gap-2"
            >
              <Plus size={16} /> Manual Adjustment
            </button>
          )}
        </div>

        <div className="bg-card border border-border rounded-[18px] overflow-hidden">
          <div className="grid grid-cols-[minmax(0,1fr)_120px_140px] gap-4 px-6 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <span>Owner</span>
            <span>Type</span>
            <span className="text-right">Balance</span>
          </div>
          {isLoading && (
            <p className="text-[13px] text-muted-foreground text-center py-10">Loading…</p>
          )}
          {!isLoading && filtered.length === 0 && (
            <p className="text-[13px] text-muted-foreground text-center py-10">No matches.</p>
          )}
          {filtered.map((o) => (
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

function PayoutsTab({ mode }: { mode: "expert" | "merchant" }) {
  const queryClient = useQueryClient();
  const fetchBatches = useServerFn(listPayoutBatches);
  const genExpert = useServerFn(generatePayoutBatch);
  const genMerchant = useServerFn(generateMerchantPayoutBatch);
  const { data = [], isLoading } = useQuery({
    queryKey: ["wallets", "batches", mode],
    queryFn: () => fetchBatches({ data: { batch_type: mode } }),
  });
  const [openBatch, setOpenBatch] = useState<PayoutBatch | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = useMutation({
    mutationFn: () => (mode === "merchant" ? genMerchant() : genExpert()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["wallets", "batches"] }),
    onError: (e) => setError(e instanceof Error ? e.message : "Failed"),
  });

  if (openBatch) {
    return <BatchDetail batch={openBatch} onBack={() => setOpenBatch(null)} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[14px] text-muted-foreground">
          {mode === "merchant"
            ? "Weekly merchant payout batches from completed order earnings."
            : "Weekly payout batches to experts and area partners."}
        </p>
        <button
          disabled={generate.isPending}
          onClick={() => {
            setError(null);
            generate.mutate();
          }}
          className="h-11 px-4 rounded-[14px] bg-primary text-white font-bold text-[14px] disabled:opacity-50 inline-flex items-center gap-2"
        >
          <Plus size={16} /> {generate.isPending ? "Generating…" : "Generate this week's batch"}
        </button>
      </div>


      {error && <p className="text-[13px] text-destructive">{error}</p>}

      <div className="bg-card border border-border rounded-[18px] overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1fr)_140px_120px_100px] gap-4 px-6 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <span>Week</span>
          <span className="text-right">Total</span>
          <span>Status</span>
          <span></span>
        </div>
        {isLoading && (
          <p className="text-[13px] text-muted-foreground text-center py-10">Loading…</p>
        )}
        {!isLoading && data.length === 0 && (
          <p className="text-[13px] text-muted-foreground text-center py-10">No batches yet.</p>
        )}
        {data.map((b) => (
          <div
            key={b.id}
            className="grid grid-cols-[minmax(0,1fr)_140px_120px_100px] gap-4 items-center px-6 py-3 border-b border-border last:border-b-0 text-[14px]"
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
            <div className="flex justify-end">
              <button
                onClick={() => setOpenBatch(b)}
                className="h-9 px-3 rounded-[12px] border border-border font-semibold text-[13px] hover:bg-muted"
              >
                Open
              </button>
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
  const markBatch = useServerFn(markPayoutBatchPaid);

  const { data = [], isLoading } = useQuery({
    queryKey: ["wallets", "batch-items", batch.id],
    queryFn: () => fetchItems({ data: { batch_id: batch.id } }),
  });

  const itemMutation = useMutation({
    mutationFn: (p: { item_id: string; paid: boolean }) => markItem({ data: p }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wallets", "batch-items", batch.id] });
      queryClient.invalidateQueries({ queryKey: ["wallets", "batches"] });
    },
  });

  const batchMutation = useMutation({
    mutationFn: () => markBatch({ data: { batch_id: batch.id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wallets", "batch-items", batch.id] });
      queryClient.invalidateQueries({ queryKey: ["wallets", "batches"] });
    },
  });

  const unpaid = data.filter((i) => !i.paid).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          onClick={onBack}
          className="h-10 px-3 rounded-[12px] border border-border font-semibold text-[13px] inline-flex items-center gap-1 hover:bg-muted"
        >
          <ArrowLeft size={14} /> Back to batches
        </button>
        <button
          disabled={batchMutation.isPending || unpaid === 0}
          onClick={() => batchMutation.mutate()}
          className="h-10 px-4 rounded-[12px] bg-primary text-white font-bold text-[13px] disabled:opacity-50"
        >
          {batchMutation.isPending ? "Marking…" : "Mark entire batch paid"}
        </button>
      </div>

      <div className="bg-card border border-border rounded-[18px] p-5">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          Batch
        </p>
        <h2 className="text-[20px] font-bold text-foreground">
          {formatDate(batch.week_start)} – {formatDate(batch.week_end)}
        </h2>
        <p className="text-[13px] text-muted-foreground">
          Total <span className="font-semibold text-foreground">{inr.format(batch.total_amount)}</span>
          {" · "}
          {unpaid} unpaid item(s)
        </p>
      </div>

      <div className="bg-card border border-border rounded-[18px] overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1fr)_120px_140px_120px] gap-4 px-6 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <span>Owner</span>
          <span>Type</span>
          <span className="text-right">Amount</span>
          <span>Paid</span>
        </div>
        {isLoading && (
          <p className="text-[13px] text-muted-foreground text-center py-10">Loading…</p>
        )}
        {!isLoading && data.length === 0 && (
          <p className="text-[13px] text-muted-foreground text-center py-10">
            No items in this batch.
          </p>
        )}
        {data.map((i) => (
          <div
            key={i.id}
            className="grid grid-cols-[minmax(0,1fr)_120px_140px_120px] gap-4 items-center px-6 py-3 border-b border-border last:border-b-0 text-[14px]"
          >
            <p className="font-semibold text-foreground truncate">{i.owner_name}</p>
            <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              {i.owner_type === "expert" ? "Expert" : "Partner"}
            </span>
            <span className="text-right font-semibold">{inr.format(i.amount)}</span>
            <label className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
              <input
                type="checkbox"
                checked={i.paid}
                disabled={itemMutation.isPending}
                onChange={(e) =>
                  itemMutation.mutate({ item_id: i.id, paid: e.target.checked })
                }
                className="w-4 h-4 accent-primary"
              />
              {i.paid ? "Paid" : "Unpaid"}
            </label>
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
