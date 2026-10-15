import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { MoreHorizontal, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FilterBar, FilterField, filterInputCls, filterSelectCls, tableCls, countLabel, StatusPill } from "@/components/section-chrome";
import { SettlementsTab, InvoicesTab } from "@/components/finance-hub";
import { MerchantBillingPage } from "@/components/merchant-billing-page";
import {
  getFinanceOverview, listExpenses, saveExpense, deleteExpense, saveExpenseCategory,
  listSubscriptions, saveSubscription, markSubscriptionPaid, getInstantFeePct, setInstantFeePct,
  type ExpenseRow, type SubscriptionRow,
} from "@/lib/expenses.functions";

type Role = "super_admin" | "ops_manager" | "area_partner" | "finance" | null;
const inr = (n: unknown) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const err = (e: unknown) => (e instanceof Error ? e.message : String(e));
const istToday = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);

function Chips<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string][] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(([k, l]) => (
        <button key={k} onClick={() => onChange(k)}
          className={`h-8 px-3 rounded-full text-[12px] font-semibold border transition-colors ${value === k ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:text-foreground"}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Overview ---------------- */
export function FinanceOverview({ onNav, isSuperAdmin }: { onNav: (key: string) => void; isSuperAdmin: boolean }) {
  const [period, setPeriod] = useState<"today" | "7d" | "month">("today");
  const to = istToday();
  const from = period === "today" ? to : period === "7d"
    ? new Date(Date.parse(to) - 6 * 86400000).toISOString().slice(0, 10)
    : to.slice(0, 7) + "-01";
  const fetch = useServerFn(getFinanceOverview);
  const q = useQuery({ queryKey: ["fin-overview", from, to], queryFn: () => fetch({ data: { from, to } }), refetchInterval: 60_000 });
  const d = q.data ?? {};
  const t = d.todo ?? {};
  const cards: { label: string; value: string; hint?: string; nav?: string }[] = [
    { label: "Collected", value: inr(d.collected), hint: "Razorpay settlements", nav: "settlements" },
    { label: "Owed to merchants", value: inr(d.owed_merchants), hint: "Draft + approved", nav: "fin-settlements" },
    { label: "Owed to experts / riders / partners", value: inr(d.owed_workers), hint: "Wallet balances", nav: "wallets" },
    { label: "Refunds pending", value: `${d.refunds_pending ?? 0} · ${inr(d.refunds_pending_amt)}`, nav: "fin-refunds" },
    { label: "Tax this month", value: inr(d.tax_month), hint: "Commission GST + TCS + TDS", nav: "fin-tax" },
    { label: "Other income", value: inr(d.other_income), hint: "Instant settlement fees", nav: "reports" },
    { label: "Expenses this month", value: inr(d.expenses_month), nav: isSuperAdmin ? "fin-expenses" : undefined },
    { label: "Customer wallet outstanding", value: inr(d.wallet_outstanding), hint: "Cash + bonus balances", nav: "fin-wallet" },
  ];
  const todo: { n: number | boolean; label: string; nav: string }[] = [
    { n: Number(t.instant_to_pay ?? 0), label: "instant settlement(s) to pay today", nav: "fin-settlements" },
    { n: !!t.batch_due, label: "Settlement batch is due today (Wed/Sat)", nav: "fin-settlements" },
    { n: Number(t.refunds_failed ?? 0), label: "failed refund(s) need a retry", nav: "fin-refunds" },
    ...(isSuperAdmin ? [{ n: Number(t.subs_due ?? 0), label: "subscription(s) due in 7 days", nav: "fin-expenses" }] : []),
    { n: Number(t.merchants_no_bank ?? 0), label: "merchant(s) on hold — missing bank details", nav: "fin-settlements" },
    { n: Number(t.experts_no_bank ?? 0), label: "expert(s) missing bank details", nav: "wallets" },
    { n: !!t.company_incomplete, label: "Company profile incomplete (GSTIN / PAN / address)", nav: "company-profile" },
  ].filter((x) => x.n);
  return (
    <div className="space-y-5">
      <Chips value={period} onChange={setPeriod} items={[["today", "Today"], ["7d", "7 days"], ["month", "This month"]]} />
      {q.isError && <p className="text-sm text-destructive">{err(q.error)}</p>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((c) => (
          <button key={c.label} disabled={!c.nav} onClick={() => c.nav && onNav(c.nav)}
            className="text-left bg-card border border-border rounded-[18px] p-4 hover:border-primary transition-colors disabled:hover:border-border">
            <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{c.label}</div>
            <div className="mt-1 text-[20px] font-bold text-foreground">{q.isLoading ? "…" : c.value}</div>
            {c.hint && <div className="text-[11px] text-muted-foreground">{c.hint}</div>}
          </button>
        ))}
      </div>
      <div className="bg-card border border-border rounded-[18px] p-4">
        <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">To do today</div>
        {!todo.length ? <p className="text-[13px] text-muted-foreground">All clear.</p> : (
          <ul className="divide-y divide-border">
            {todo.map((x) => (
              <li key={x.label}>
                <button onClick={() => onNav(x.nav)} className="w-full text-left py-2.5 text-[13px] hover:text-primary">
                  {typeof x.n === "number" ? <b className="mr-1">{x.n}</b> : null}{x.label} →
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ---------------- Merchants ---------------- */
function InstantFeeGear({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const get = useServerFn(getInstantFeePct);
  const set = useServerFn(setInstantFeePct);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["instant-fee-pct"], queryFn: () => get(), enabled: open });
  const [v, setV] = useState<string>("");
  const save = useMutation({
    mutationFn: () => set({ data: { pct: Number(v) } }),
    onSuccess: () => { toast.success("Instant settlement fee saved"); qc.invalidateQueries({ queryKey: ["instant-fee-pct"] }); setOpen(false); },
    onError: (e) => toast.error(err(e)),
  });
  return (
    <>
      <Button variant="outline" size="icon" aria-label="Settlement settings" onClick={() => { setOpen(true); setV(""); }}><Settings2 size={16} /></Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-[380px]">
          <SheetHeader><SheetTitle>Settlement settings</SheetTitle></SheetHeader>
          <div className="mt-4 space-y-4 text-[13px]">
            <div><b>Schedule:</b> batches run every Wednesday and Saturday.</div>
            <div className="space-y-1">
              <Label>Instant settlement fee % (global default)</Label>
              <Input type="number" step="0.1" min={0} max={10} disabled={!isSuperAdmin}
                value={v === "" ? String(q.data ?? "") : v} onChange={(e) => setV(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">Used by new merchants and any store with a blank fee in Store/Food → store → Commercials. GST on the fee uses "Instant settlement fee GST" in Settings → Tax.</p>
            </div>
            {isSuperAdmin && <Button disabled={save.isPending || v === ""} onClick={() => save.mutate()}>Save</Button>}
            {!isSuperAdmin && <p className="text-[11px] text-muted-foreground">Only super admins can change this.</p>}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

export function MerchantsFinance({ role }: { role: Role }) {
  const [chip, setChip] = useState<"settlements" | "commission" | "invoices">("settlements");
  const canEdit = role === "super_admin" || role === "ops_manager";
  return (
    <div className="space-y-4">
      <Chips value={chip} onChange={setChip} items={[["settlements", "Settlements"], ["commission", "Commission"], ["invoices", "Invoices"]]} />
      {chip === "settlements" && <SettlementsTab canEdit={canEdit} extra={<InstantFeeGear isSuperAdmin={role === "super_admin"} />} />}
      {chip === "commission" && <MerchantBillingPage role={role} />}
      {chip === "invoices" && <InvoicesTab />}
    </div>
  );
}

/* ---------------- Expenses (super admin) ---------------- */
export function ExpensesPage() {
  const [chip, setChip] = useState<"expenses" | "subscriptions">("expenses");
  return (
    <div className="space-y-4">
      <Chips value={chip} onChange={setChip} items={[["expenses", "Expenses"], ["subscriptions", "Subscriptions"]]} />
      {chip === "expenses" ? <ExpensesList /> : <SubscriptionsList />}
    </div>
  );
}

const PAGE = 25;

function ExpensesList() {
  const [month, setMonth] = useState(istToday().slice(0, 7));
  const [cat, setCat] = useState("");
  const [via, setVia] = useState("");
  const [page, setPage] = useState(0);
  const [edit, setEdit] = useState<Partial<ExpenseRow> | null>(null);
  const [catsOpen, setCatsOpen] = useState(false);
  const fetch = useServerFn(listExpenses);
  const del = useServerFn(deleteExpense);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["expenses", month], queryFn: () => fetch({ data: { month } }) });
  const all = q.data?.rows ?? [];
  const rows = all.filter((r) => (!cat || r.category === cat) && (!via || r.paid_via === via));
  const total = all.reduce((a, r) => a + Number(r.amount), 0);
  const gst = all.reduce((a, r) => a + Number(r.gst_paid), 0);
  const byCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of all) m.set(r.category, (m.get(r.category) ?? 0) + Number(r.amount));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [all]);
  const remove = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => { toast.success("Expense deleted"); qc.invalidateQueries({ queryKey: ["expenses"] }); },
    onError: (e) => toast.error(err(e)),
  });
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <div className="bg-card border border-border rounded-[18px] px-4 py-3">
          <div className="text-[11px] font-bold uppercase text-muted-foreground">Month total</div>
          <div className="text-[18px] font-bold">{inr(total)}</div>
          <div className="text-[11px] text-muted-foreground">GST paid (input credit) {inr(gst)}</div>
        </div>
        {byCat.map(([c, v]) => (
          <div key={c} className="bg-card border border-border rounded-[18px] px-4 py-3">
            <div className="text-[11px] font-bold uppercase text-muted-foreground">{c}</div>
            <div className="text-[16px] font-bold">{inr(v)}</div>
          </div>
        ))}
      </div>
      <FilterBar count={`${rows.length} of ${countLabel(all.length, "expense")}`}>
        <FilterField label="Month"><input type="month" className={filterInputCls} value={month} onChange={(e) => { setMonth(e.target.value); setPage(0); }} /></FilterField>
        <FilterField label="Category">
          <select className={filterSelectCls} value={cat} onChange={(e) => { setCat(e.target.value); setPage(0); }}>
            <option value="">All categories</option>
            {(q.data?.categories ?? []).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </FilterField>
        <FilterField label="Paid via">
          <select className={filterSelectCls} value={via} onChange={(e) => { setVia(e.target.value); setPage(0); }}>
            <option value="">All payment modes</option><option>Bank</option><option>UPI</option><option>Cash</option>
          </select>
        </FilterField>
        <div className="flex gap-2 self-end">
          <Button variant="outline" onClick={() => setCatsOpen(true)}>Categories</Button>
          <Button onClick={() => setEdit({ expense_date: istToday(), category: "Other", paid_via: "Bank" })}>+ Add expense</Button>
        </div>
      </FilterBar>
      <div className={tableCls.wrap}><div className={tableCls.scroll}>
        <table className={tableCls.table}>
          <thead className={tableCls.thead}><tr>
            {["Date", "Category", "Vendor / payee", "Amount", "GST paid", "Paid via", "Note", ""].map((h) => <th key={h} className={tableCls.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {q.isLoading && <tr><td colSpan={8} className={tableCls.td}>Loading…</td></tr>}
            {q.isError && <tr><td colSpan={8} className={`${tableCls.td} text-destructive`}>{err(q.error)}</td></tr>}
            {!q.isLoading && !rows.length && <tr><td colSpan={8} className={`${tableCls.td} text-muted-foreground`}>No expenses for this month.</td></tr>}
            {shown.map((r) => (
              <tr key={r.id} className={tableCls.tr} onClick={() => setEdit(r)}>
                <td className={tableCls.td}>{r.expense_date}</td>
                <td className={tableCls.td}>{r.category}</td>
                <td className={tableCls.td}>{r.vendor ?? "—"}</td>
                <td className={`${tableCls.td} font-semibold`}>{inr(r.amount)}</td>
                <td className={tableCls.td}>{inr(r.gst_paid)}</td>
                <td className={tableCls.td}>{r.paid_via}</td>
                <td className={`${tableCls.td} text-muted-foreground`}>{r.note ?? ""}</td>
                <td className={tableCls.td} onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="More"><MoreHorizontal size={16} /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setEdit(r)}>Edit</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onClick={() => { if (confirm("Delete this expense?")) remove.mutate(r.id); }}>Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div></div>
      {rows.length > PAGE && (
        <div className="flex items-center justify-end gap-2 text-[12px] text-muted-foreground">
          {page * PAGE + 1}–{Math.min(rows.length, page * PAGE + PAGE)} of {rows.length}
          <Button size="sm" variant="outline" disabled={!page} onClick={() => setPage(page - 1)}>Prev</Button>
          <Button size="sm" variant="outline" disabled={(page + 1) * PAGE >= rows.length} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
      {edit && <ExpenseSheet row={edit} categories={(q.data?.categories ?? []).filter((c) => c.is_active).map((c) => c.name)} onClose={() => setEdit(null)} />}
      {catsOpen && <CategoriesSheet categories={q.data?.categories ?? []} onClose={() => setCatsOpen(false)} />}
    </div>
  );
}

function ExpenseSheet({ row, categories, onClose }: { row: Partial<ExpenseRow>; categories: string[]; onClose: () => void }) {
  const [f, setF] = useState({
    expense_date: row.expense_date ?? istToday(), category: row.category ?? "Other", amount: String(row.amount ?? ""),
    gst_paid: String(row.gst_paid ?? "0"), paid_via: row.paid_via ?? "Bank", vendor: row.vendor ?? "", note: row.note ?? "",
  });
  const save = useServerFn(saveExpense);
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => save({ data: { id: row.id ?? null, p: { ...f, amount: Number(f.amount), gst_paid: Number(f.gst_paid || 0) } } }),
    onSuccess: () => { toast.success("Expense saved"); qc.invalidateQueries({ queryKey: ["expenses"] }); onClose(); },
    onError: (e) => toast.error(err(e)),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-[400px] overflow-y-auto">
        <SheetHeader><SheetTitle>{row.id ? "Edit expense" : "Add expense"}</SheetTitle></SheetHeader>
        <div className="mt-4 space-y-3">
          <div><Label>Date</Label><Input type="date" value={f.expense_date} onChange={set("expense_date")} /></div>
          <div><Label>Category</Label>
            <select className={`${filterSelectCls} w-full`} value={f.category} onChange={set("category")}>
              {[...new Set([...categories, f.category])].map((c) => <option key={c}>{c}</option>)}
            </select></div>
          <div><Label>Amount (₹)</Label><Input type="number" min={0} value={f.amount} onChange={set("amount")} /></div>
          <div><Label>GST paid (input credit, ₹)</Label><Input type="number" min={0} value={f.gst_paid} onChange={set("gst_paid")} /></div>
          <div><Label>Paid via</Label>
            <select className={`${filterSelectCls} w-full`} value={f.paid_via} onChange={set("paid_via")}><option>Bank</option><option>UPI</option><option>Cash</option></select></div>
          <div><Label>Vendor / payee</Label><Input value={f.vendor} onChange={set("vendor")} /></div>
          <div><Label>Note</Label><Input value={f.note} onChange={set("note")} /></div>
          <Button className="w-full" disabled={m.isPending || !(Number(f.amount) > 0)} onClick={() => m.mutate()}>Save</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CategoriesSheet({ categories, onClose }: { categories: { name: string; is_active: boolean }[]; onClose: () => void }) {
  const [name, setName] = useState("");
  const save = useServerFn(saveExpenseCategory);
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (v: { name: string; active: boolean }) => save({ data: v }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["expenses"] }); setName(""); },
    onError: (e) => toast.error(err(e)),
  });
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-[360px]">
        <SheetHeader><SheetTitle>Expense categories</SheetTitle></SheetHeader>
        <div className="mt-4 space-y-2">
          {categories.map((c) => (
            <div key={c.name} className="flex items-center justify-between text-[13px] py-1">
              {c.name}<Switch checked={c.is_active} onCheckedChange={(v) => m.mutate({ name: c.name, active: v })} />
            </div>
          ))}
          <div className="flex gap-2 pt-3">
            <Input placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} />
            <Button disabled={!name.trim()} onClick={() => m.mutate({ name: name.trim(), active: true })}>Add</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SubscriptionsList() {
  const fetch = useServerFn(listSubscriptions);
  const pay = useServerFn(markSubscriptionPaid);
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Partial<SubscriptionRow> | null>(null);
  const q = useQuery({ queryKey: ["subscriptions"], queryFn: () => fetch() });
  const rows = q.data ?? [];
  const active = rows.filter((r) => r.status === "active");
  const monthly = active.reduce((a, r) => a + (r.billing_cycle === "yearly" ? Number(r.amount) / 12 : Number(r.amount)), 0);
  const in7 = new Date(Date.parse(istToday()) + 7 * 86400000).toISOString().slice(0, 10);
  const due = active.filter((r) => r.next_due_date <= in7);
  const m = useMutation({
    mutationFn: (id: string) => pay({ data: { id, paidVia: "Bank" } }),
    onSuccess: () => { toast.success("Marked paid — expense added and next due date moved"); qc.invalidateQueries({ queryKey: ["subscriptions"] }); qc.invalidateQueries({ queryKey: ["expenses"] }); },
    onError: (e) => toast.error(err(e)),
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <div className="bg-card border border-border rounded-[18px] px-4 py-3">
          <div className="text-[11px] font-bold uppercase text-muted-foreground">Total monthly cost</div>
          <div className="text-[18px] font-bold">{inr(Math.round(monthly))}</div>
          <div className="text-[11px] text-muted-foreground">Yearly plans counted ÷ 12</div>
        </div>
        <div className="bg-card border border-border rounded-[18px] px-4 py-3">
          <div className="text-[11px] font-bold uppercase text-muted-foreground">Due in next 7 days</div>
          <div className="text-[18px] font-bold">{due.length} · {inr(due.reduce((a, r) => a + Number(r.amount), 0))}</div>
        </div>
        <div className="ml-auto self-end"><Button onClick={() => setEdit({ billing_cycle: "monthly", auto_renew: true, status: "active", category: "Software", next_due_date: istToday() })}>+ Add subscription</Button></div>
      </div>
      <div className={tableCls.wrap}><div className={tableCls.scroll}>
        <table className={tableCls.table}>
          <thead className={tableCls.thead}><tr>
            {["Name", "Vendor", "Amount", "Cycle", "Next due", "Auto-renew", "Payment method", "Status", ""].map((h) => <th key={h} className={tableCls.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {q.isLoading && <tr><td colSpan={9} className={tableCls.td}>Loading…</td></tr>}
            {!q.isLoading && !rows.length && <tr><td colSpan={9} className={`${tableCls.td} text-muted-foreground`}>No subscriptions yet.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className={tableCls.tr} onClick={() => setEdit(r)}>
                <td className={`${tableCls.td} font-semibold`}>{r.name}</td>
                <td className={tableCls.td}>{r.vendor ?? "—"}</td>
                <td className={tableCls.td}>{inr(r.amount)}</td>
                <td className={tableCls.td}>{r.billing_cycle === "yearly" ? "Yearly" : "Monthly"}</td>
                <td className={`${tableCls.td} ${r.status === "active" && r.next_due_date <= in7 ? "text-destructive font-semibold" : ""}`}>{r.next_due_date}</td>
                <td className={tableCls.td}>{r.auto_renew ? "Yes" : "No"}</td>
                <td className={tableCls.td}>{r.payment_method_label ?? "—"}</td>
                <td className={tableCls.td}><StatusPill status={r.status === "active" ? "active" : "cancelled"} label={r.status === "active" ? "Active" : "Cancelled"} /></td>
                <td className={tableCls.td} onClick={(e) => e.stopPropagation()}>
                  {r.status === "active" && <Button size="sm" disabled={m.isPending} onClick={() => { if (confirm(`Mark ${r.name} paid (${inr(r.amount)})?`)) m.mutate(r.id); }}>Mark paid</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div></div>
      {edit && <SubscriptionSheet row={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function SubscriptionSheet({ row, onClose }: { row: Partial<SubscriptionRow>; onClose: () => void }) {
  const [f, setF] = useState({
    name: row.name ?? "", vendor: row.vendor ?? "", amount: String(row.amount ?? ""), billing_cycle: row.billing_cycle ?? "monthly",
    next_due_date: row.next_due_date ?? istToday(), auto_renew: row.auto_renew ?? true, payment_method_label: row.payment_method_label ?? "",
    category: row.category ?? "Software", status: row.status ?? "active",
  });
  const save = useServerFn(saveSubscription);
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => save({ data: { id: row.id ?? null, p: { ...f, amount: Number(f.amount) } } }),
    onSuccess: () => { toast.success("Subscription saved"); qc.invalidateQueries({ queryKey: ["subscriptions"] }); onClose(); },
    onError: (e) => toast.error(err(e)),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-[400px] overflow-y-auto">
        <SheetHeader><SheetTitle>{row.id ? "Edit subscription" : "Add subscription"}</SheetTitle></SheetHeader>
        <div className="mt-4 space-y-3">
          <div><Label>Name</Label><Input value={f.name} onChange={set("name")} /></div>
          <div><Label>Vendor</Label><Input value={f.vendor} onChange={set("vendor")} /></div>
          <div><Label>Amount (₹)</Label><Input type="number" min={0} value={f.amount} onChange={set("amount")} /></div>
          <div><Label>Billing cycle</Label>
            <select className={`${filterSelectCls} w-full`} value={f.billing_cycle} onChange={set("billing_cycle")}><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></div>
          <div><Label>Next due date</Label><Input type="date" value={f.next_due_date} onChange={set("next_due_date")} /></div>
          <div className="flex items-center justify-between"><Label>Auto-renew</Label><Switch checked={f.auto_renew} onCheckedChange={(v) => setF({ ...f, auto_renew: v })} /></div>
          <div><Label>Payment method label</Label><Input placeholder="Card ending 4417" value={f.payment_method_label} onChange={set("payment_method_label")} />
            <p className="text-[11px] text-muted-foreground mt-1">Never enter a full card number.</p></div>
          <div><Label>Expense category when paid</Label><Input value={f.category} onChange={set("category")} /></div>
          <div><Label>Status</Label>
            <select className={`${filterSelectCls} w-full`} value={f.status} onChange={set("status")}><option value="active">Active</option><option value="cancelled">Cancelled</option></select></div>
          <Button className="w-full" disabled={m.isPending || !f.name.trim()} onClick={() => m.mutate()}>Save</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
