import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FilterBar, FilterField, filterInputCls, filterSelectCls, tableCls, countLabel, StatusPill } from "@/components/section-chrome";
import {
  listCustomerInvoices, setFinanceFlag, getWalletOverview, getWalletLedger, findCustomer, adjustWallet, saveBonusRule,
  type BonusRule, type WalletRow,
} from "@/lib/customer-finance.functions";
import { getWalletBonusDays, setWalletBonusDays } from "@/lib/customer-finance.functions";
import { downloadCustomerInvoicePdf, downloadCreditNotePdf } from "@/lib/customer-invoice-pdf";

const inr = (n: unknown) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const err = (e: unknown) => (e instanceof Error ? e.message : String(e));
const istToday = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const SERVICES: [string, string][] = [["", "All services"], ["clean_home", "Clean Home"], ["clean_auto", "Clean Auto"], ["store", "Store"], ["food", "Food"], ["parcel", "Parcel"]];
const svcLabel = (s: string) => SERVICES.find((x) => x[0] === s)?.[1] ?? s;

function Chips<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string][] }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {items.map(([k, l]) => (
        <button key={k} onClick={() => onChange(k)}
          className={`px-3 py-1.5 rounded-full text-[12px] font-semibold border ${value === k ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:text-foreground"}`}>{l}</button>
      ))}
    </div>
  );
}

export function CustomerInvoicesPage({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<"invoices" | "credit">("invoices");
  const [from, setFrom] = useState(istToday().slice(0, 7) + "-01");
  const [to, setTo] = useState(istToday());
  const [service, setService] = useState("");
  const [q, setQ] = useState("");
  const fetch = useServerFn(listCustomerInvoices);
  const flag = useServerFn(setFinanceFlag);
  const data = useQuery({ queryKey: ["cust-invoices", from, to, service, q], queryFn: () => fetch({ data: { from, to, service: service || null, q: q || null } }) });
  const toggle = useMutation({
    mutationFn: (v: boolean) => flag({ data: { key: "customer_invoices_visible", value: v } }),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["cust-invoices"] }); },
    onError: (e) => toast.error(err(e)),
  });
  const inv = data.data?.invoices ?? [];
  const cns = data.data?.credit_notes ?? [];
  const totals = inv.reduce((a, i) => ({ t: a.t + Number(i.total), g: a.g + Number(i.cgst) + Number(i.sgst) + Number(i.igst) }), { t: 0, g: 0 });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Chips value={kind} onChange={setKind} items={[["invoices", `Invoices (${inv.length})`], ["credit", `Credit notes (${cns.length})`]]} />
        <label className="flex items-center gap-2 text-[13px]">
          <Switch checked={!!data.data?.visible} disabled={!isSuperAdmin || toggle.isPending} onCheckedChange={(v) => toggle.mutate(v)} />
          Show invoices in Customer App
        </label>
      </div>
      <FilterBar>
        <FilterField label="From"><input type="date" className={filterInputCls} value={from} onChange={(e) => setFrom(e.target.value)} /></FilterField>
        <FilterField label="To"><input type="date" className={filterInputCls} value={to} onChange={(e) => setTo(e.target.value)} /></FilterField>
        <FilterField label="Service">
          <select className={filterSelectCls} value={service} onChange={(e) => setService(e.target.value)}>
            {SERVICES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </FilterField>
        {kind === "invoices" && <FilterField label="Search"><input className={filterInputCls} placeholder="Invoice, order, phone" value={q} onChange={(e) => setQ(e.target.value)} /></FilterField>}
      </FilterBar>
      {data.isError && <p className="text-sm text-destructive">{err(data.error)}</p>}
      {kind === "invoices" ? (
        <>
          <p className="text-[12px] text-muted-foreground">{countLabel(inv.length, "invoice")} · Total {inr(totals.t)} · GST {inr(totals.g)}</p>
          <div className="overflow-x-auto">
            <table className={`w-full text-[13px] ${tableCls.table}`}>
              <thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Service</th><th>Order</th><th className="text-right">Taxable</th><th className="text-right">GST</th><th className="text-right">Total</th><th /></tr></thead>
              <tbody>
                {inv.map((i) => (
                  <tr key={i.id}>
                    <td className="font-semibold">{i.invoice_no}{(i as { status?: string }).status === "draft" && <span className="ml-2"><StatusPill status="pending" label="Draft" /></span>}</td><td>{i.invoice_date}</td>
                    <td>{i.customer_name ?? "—"}<div className="text-[11px] text-muted-foreground">{i.customer_phone}</div></td>
                    <td>{svcLabel(i.service)}</td><td>{i.ref_code}</td>
                    <td className="text-right">{inr(i.taxable_value)}</td><td className="text-right">{inr(Number(i.cgst) + Number(i.sgst) + Number(i.igst))}</td>
                    <td className="text-right font-semibold">{inr(i.total)}</td>
                    <td>{(i as { status?: string }).status === "draft"
                      ? <span className="text-[11px] text-muted-foreground" title="Complete Settings → Company (GSTIN, PAN, address) to issue">—</span>
                      : <Button size="sm" variant="ghost" onClick={() => downloadCustomerInvoicePdf(i)}><Download className="h-4 w-4" /></Button>}</td>
                  </tr>
                ))}
                {!inv.length && !data.isLoading && <tr><td colSpan={9} className="text-center text-muted-foreground py-6">No invoices in this period.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="overflow-x-auto">
          <table className={`w-full text-[13px] ${tableCls.table}`}>
            <thead><tr><th>Credit note</th><th>Date</th><th>Invoice</th><th>Customer</th><th>Service</th><th>Reason</th><th className="text-right">GST</th><th className="text-right">Total</th><th /></tr></thead>
            <tbody>
              {cns.map((c) => (
                <tr key={c.id}>
                  <td className="font-semibold">{c.credit_note_no}</td><td>{c.note_date}</td><td>{c.invoice_no}</td><td>{c.customer_name ?? "—"}</td>
                  <td>{svcLabel(c.service)}</td><td>{c.reason}</td>
                  <td className="text-right">{inr(Number(c.cgst) + Number(c.sgst) + Number(c.igst))}</td><td className="text-right font-semibold">{inr(c.total)}</td>
                  <td><Button size="sm" variant="ghost" onClick={() => downloadCreditNotePdf(c, inv.find((i) => i.invoice_no === c.invoice_no)?.company, inv.find((i) => i.invoice_no === c.invoice_no)?.invoice_date)}><Download className="h-4 w-4" /></Button></td>
                </tr>
              ))}
              {!cns.length && !data.isLoading && <tr><td colSpan={9} className="text-center text-muted-foreground py-6">No credit notes in this period.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function CustomerWalletPage({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"wallets" | "bonus">("wallets");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<WalletRow | null>(null);
  const [adjust, setAdjust] = useState(false);
  const [rule, setRule] = useState<Partial<BonusRule> | null>(null);
  const fetch = useServerFn(getWalletOverview);
  const flag = useServerFn(setFinanceFlag);
  const data = useQuery({ queryKey: ["cust-wallet", q], queryFn: () => fetch({ data: { q: q || null } }) });
  const toggle = useMutation({
    mutationFn: (v: boolean) => flag({ data: { key: "customer_wallet_enabled", value: v } }),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["cust-wallet"] }); },
    onError: (e) => toast.error(err(e)),
  });
  const t = data.data?.totals;
  return (
    <div className="space-y-4">
      <WalletBonusDaysCard isSuperAdmin={isSuperAdmin} />
      <div className="grid grid-cols-3 gap-3">
        {[["Outstanding (cash)", inr(t?.cash)], ["Bonus balance", inr(t?.bonus)], ["Wallets with balance", String(t?.wallets ?? 0)]].map(([l, v]) => (
          <div key={l} className="bg-card border border-border rounded-[18px] p-4">
            <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{l}</div>
            <div className="mt-1 text-[20px] font-bold">{data.isLoading ? "…" : v}</div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Chips value={tab} onChange={setTab} items={[["wallets", "Wallets"], ["bonus", "Bonus rules"]]} />
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-[13px]">
            <Switch checked={!!data.data?.enabled} disabled={!isSuperAdmin || toggle.isPending} onCheckedChange={(v) => toggle.mutate(v)} />
            Wallet live in Customer App
          </label>
          {isSuperAdmin && tab === "wallets" && <Button size="sm" onClick={() => setAdjust(true)}>Adjust balance</Button>}
          {isSuperAdmin && tab === "bonus" && <Button size="sm" onClick={() => setRule({ bonus_type: "flat", validity_days: 30, min_topup: 500, is_active: false })}>Add rule</Button>}
        </div>
      </div>
      <p className="text-[12px] text-muted-foreground">Top-ups ₹100–₹5,000 · Max balance ₹10,000 · Payments use bonus first, then cash · Expired bonus is removed daily.</p>
      {data.isError && <p className="text-sm text-destructive">{err(data.error)}</p>}
      {tab === "wallets" ? (
        <>
          <FilterBar><FilterField label="Search"><input className={filterInputCls} placeholder="Name or phone" value={q} onChange={(e) => setQ(e.target.value)} /></FilterField></FilterBar>
          <table className={`w-full text-[13px] ${tableCls.table}`}>
            <thead><tr><th>Customer</th><th>Phone</th><th className="text-right">Cash</th><th className="text-right">Bonus</th><th>Last change</th></tr></thead>
            <tbody>
              {(data.data?.wallets ?? []).map((w) => (
                <tr key={w.user_id} className="cursor-pointer" onClick={() => setOpen(w)}>
                  <td className="font-semibold">{w.name ?? "—"}</td><td>{w.phone}</td>
                  <td className="text-right">{inr(w.cash)}</td><td className="text-right">{inr(w.bonus)}</td>
                  <td>{new Date(w.updated_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
                </tr>
              ))}
              {!data.data?.wallets?.length && !data.isLoading && <tr><td colSpan={5} className="text-center text-muted-foreground py-6">No customer wallets yet.</td></tr>}
            </tbody>
          </table>
        </>
      ) : (
        <table className={`w-full text-[13px] ${tableCls.table}`}>
          <thead><tr><th>Name</th><th>Min top-up</th><th>Bonus</th><th>Valid</th><th>Dates</th><th>Status</th></tr></thead>
          <tbody>
            {(data.data?.rules ?? []).map((r) => (
              <tr key={r.id} className={isSuperAdmin ? "cursor-pointer" : ""} onClick={() => isSuperAdmin && setRule(r)}>
                <td className="font-semibold">{r.name}</td><td>{inr(r.min_topup)}</td>
                <td>{r.bonus_type === "flat" ? inr(r.bonus_value) : `${r.bonus_value}%${r.max_bonus ? ` (max ${inr(r.max_bonus)})` : ""}`}</td>
                <td>{r.validity_days} days</td><td>{r.starts_at ?? "—"} → {r.ends_at ?? "—"}</td>
                <td><StatusPill status={r.is_active ? "active" : "inactive"} label={r.is_active ? "Active" : "Off"} /></td>
              </tr>
            ))}
            {!data.data?.rules?.length && <tr><td colSpan={6} className="text-center text-muted-foreground py-6">No bonus rules.</td></tr>}
          </tbody>
        </table>
      )}
      {open && <LedgerSheet w={open} onClose={() => setOpen(null)} />}
      {adjust && <AdjustSheet onClose={() => setAdjust(false)} />}
      {rule && <RuleSheet row={rule} onClose={() => setRule(null)} />}
    </div>
  );
}

const TYPE: Record<string, string> = { top_up: "Top-up", payment: "Payment", refund_in: "Refund", bonus: "Bonus", bonus_expiry: "Bonus expired", admin_adjustment: "Adjustment" };

function LedgerSheet({ w, onClose }: { w: WalletRow; onClose: () => void }) {
  const fetch = useServerFn(getWalletLedger);
  const q = useQuery({ queryKey: ["cust-wallet-ledger", w.user_id], queryFn: () => fetch({ data: { userId: w.user_id } }) });
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader><SheetTitle>{w.name ?? w.phone} · {inr(w.cash)} + {inr(w.bonus)} bonus</SheetTitle></SheetHeader>
        <ul className="mt-4 divide-y divide-border">
          {(q.data ?? []).map((l) => (
            <li key={l.id} className="py-2.5 text-[13px] flex justify-between gap-3">
              <div>
                <div className="font-semibold">{TYPE[l.type] ?? l.type} · {l.bucket}</div>
                <div className="text-[11px] text-muted-foreground">{new Date(l.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}{l.reason ? ` · ${l.reason}` : ""}</div>
              </div>
              <div className={`font-bold ${Number(l.amount) < 0 ? "text-destructive" : "text-foreground"}`}>{Number(l.amount) > 0 ? "+" : ""}{inr(l.amount)}</div>
            </li>
          ))}
          {!q.data?.length && !q.isLoading && <li className="py-4 text-muted-foreground text-[13px]">No entries.</li>}
        </ul>
      </SheetContent>
    </Sheet>
  );
}

function AdjustSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const find = useServerFn(findCustomer);
  const adj = useServerFn(adjustWallet);
  const [phone, setPhone] = useState("");
  const [user, setUser] = useState<{ user_id: string; name: string | null; phone: string | null } | null>(null);
  const [bucket, setBucket] = useState<"cash" | "bonus">("cash");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const results = useQuery({ queryKey: ["find-cust", phone], queryFn: () => find({ data: { phone } }), enabled: phone.replace(/\D/g, "").length >= 4 });
  const m = useMutation({
    mutationFn: () => adj({ data: { userId: user!.user_id, bucket, amount: Number(amount), reason } }),
    onSuccess: () => { toast.success("Balance adjusted"); qc.invalidateQueries({ queryKey: ["cust-wallet"] }); onClose(); },
    onError: (e) => toast.error(err(e)),
  });
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader><SheetTitle>Adjust wallet balance</SheetTitle></SheetHeader>
        <div className="mt-4 space-y-3">
          {!user ? (
            <div><Label>Customer phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98…" />
              <ul className="mt-2 divide-y divide-border">
                {(results.data ?? []).map((u) => <li key={u.user_id}><button className="py-2 text-[13px] w-full text-left hover:text-primary" onClick={() => setUser(u)}>{u.name ?? "—"} · {u.phone}</button></li>)}
              </ul>
            </div>
          ) : (
            <>
              <p className="text-[13px]"><b>{user.name ?? "—"}</b> · {user.phone} <button className="text-primary ml-2" onClick={() => setUser(null)}>Change</button></p>
              <div><Label>Balance</Label>
                <select className={filterSelectCls + " w-full"} value={bucket} onChange={(e) => setBucket(e.target.value as "cash" | "bonus")}><option value="cash">Cash</option><option value="bonus">Bonus</option></select></div>
              <div><Label>Amount (₹, negative to deduct)</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
              <div><Label>Reason (required)</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} /></div>
              <Button className="w-full" disabled={!Number(amount) || reason.trim().length < 3 || m.isPending} onClick={() => m.mutate()}>Save</Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function RuleSheet({ row, onClose }: { row: Partial<BonusRule>; onClose: () => void }) {
  const qc = useQueryClient();
  const save = useServerFn(saveBonusRule);
  const [p, setP] = useState<Partial<BonusRule>>(row);
  const set = (k: keyof BonusRule, v: unknown) => setP((s) => ({ ...s, [k]: v }));
  const m = useMutation({
    mutationFn: () => save({ data: { id: row.id ?? null, p: p as Record<string, unknown> } }),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["cust-wallet"] }); onClose(); },
    onError: (e) => toast.error(err(e)),
  });
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <SheetHeader><SheetTitle>{row.id ? "Edit bonus rule" : "New bonus rule"}</SheetTitle></SheetHeader>
        <div className="mt-4 space-y-3">
          <div><Label>Name</Label><Input value={p.name ?? ""} onChange={(e) => set("name", e.target.value)} placeholder="Add ₹1,000 get ₹100" /></div>
          <div><Label>Minimum top-up (₹)</Label><Input type="number" value={p.min_topup ?? ""} onChange={(e) => set("min_topup", e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Bonus type</Label>
              <select className={filterSelectCls + " w-full"} value={p.bonus_type} onChange={(e) => set("bonus_type", e.target.value)}><option value="flat">Flat ₹</option><option value="percent">Percent %</option></select></div>
            <div><Label>Bonus value</Label><Input type="number" value={p.bonus_value ?? ""} onChange={(e) => set("bonus_value", e.target.value)} /></div>
          </div>
          {p.bonus_type === "percent" && <div><Label>Max bonus (₹)</Label><Input type="number" value={p.max_bonus ?? ""} onChange={(e) => set("max_bonus", e.target.value)} /></div>}
          <div><Label>Bonus valid for (days)</Label><Input type="number" value={p.validity_days ?? 30} onChange={(e) => set("validity_days", e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Starts</Label><Input type="date" value={p.starts_at ?? ""} onChange={(e) => set("starts_at", e.target.value)} /></div>
            <div><Label>Ends</Label><Input type="date" value={p.ends_at ?? ""} onChange={(e) => set("ends_at", e.target.value)} /></div>
          </div>
          <label className="flex items-center gap-2 text-[13px]"><Switch checked={!!p.is_active} onCheckedChange={(v) => set("is_active", v)} />Active</label>
          <Button className="w-full" disabled={!p.name || m.isPending} onClick={() => m.mutate()}>Save</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function WalletBonusDaysCard({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const qc = useQueryClient();
  const get = useServerFn(getWalletBonusDays);
  const set = useServerFn(setWalletBonusDays);
  const q = useQuery({ queryKey: ["wallet-bonus-days"], queryFn: () => get() });
  const [v, setV] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => set({ data: { days: Number(v) } }),
    onSuccess: () => { toast.success("Saved"); setV(null); qc.invalidateQueries({ queryKey: ["wallet-bonus-days"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });
  return (
    <div className="bg-card border border-border rounded-[18px] p-4 flex flex-wrap items-end gap-3">
      <div>
        <div className="text-[13px] font-bold">Wallet settings</div>
        <p className="text-[12px] text-muted-foreground">Referral and reward bonus expires this many days after it is credited. Reminders go out 15, 10 and 5 days before. Changes apply to new bonus only.</p>
      </div>
      <div className="w-40"><Label>Bonus expires after (days)</Label>
        <Input type="number" min={1} max={365} disabled={!isSuperAdmin} value={v ?? String(q.data?.days ?? 30)} onChange={(e) => setV(e.target.value)} /></div>
      {isSuperAdmin && <Button size="sm" disabled={v == null || save.isPending} onClick={() => save.mutate()}>Save</Button>}
    </div>
  );
}
