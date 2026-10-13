import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getDiscountBreakdown, type DiscountRow } from "@/lib/discounts.functions";

type Range = "today" | "yesterday" | "week" | "month" | "all";
const RANGES: Array<[Range, string]> = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["week", "This week"],
  ["month", "This month"],
  ["all", "All time"],
];

function rangeBounds(r: Range): { from: string | null; to: string | null } {
  const n = new Date();
  const day = (offset: number) => new Date(n.getFullYear(), n.getMonth(), n.getDate() + offset);
  if (r === "today") return { from: day(0).toISOString(), to: day(1).toISOString() };
  if (r === "yesterday") return { from: day(-1).toISOString(), to: day(0).toISOString() };
  if (r === "week") {
    const dow = (n.getDay() + 6) % 7; // Monday start
    return { from: day(-dow).toISOString(), to: day(1).toISOString() };
  }
  if (r === "month")
    return { from: new Date(n.getFullYear(), n.getMonth(), 1).toISOString(), to: day(1).toISOString() };
  return { from: null, to: null };
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export function DiscountBreakdownModal({
  open,
  onClose,
  onOpenBooking,
}: {
  open: boolean;
  onClose: () => void;
  onOpenBooking: (id: string) => void;
}) {
  const fetchFn = useServerFn(getDiscountBreakdown);
  const [range, setRange] = useState<Range>("today");
  const [kind, setKind] = useState<"all" | "coupon" | "coins">("all");
  const [q, setQ] = useState("");

  const query = useQuery({
    queryKey: ["discount-breakdown", range],
    queryFn: () => fetchFn({ data: rangeBounds(range) }),
    enabled: open,
  });

  const all = query.data ?? [];
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return all.filter(
      (r) =>
        (kind === "all" || r.kind === kind) &&
        (!s ||
          [r.customerName, r.customerPhone, r.couponCode, r.serviceLabel]
            .some((v) => String(v ?? "").toLowerCase().includes(s))),
    );
  }, [all, kind, q]);

  const sum = (list: DiscountRow[]) => list.reduce((a, r) => a + r.discount, 0);
  const coupons = all.filter((r) => r.kind === "coupon");
  const coins = all.filter((r) => r.kind === "coins");

  const exportCsv = () => {
    const head = ["Date", "Customer", "Phone", "Service", "Type", "Coupon", "Gross", "Discount", "Paid", "Status"];
    const lines = rows.map((r) =>
      [
        new Date(r.createdAt).toLocaleString("en-IN"),
        r.customerName ?? "",
        r.customerPhone ?? "",
        r.serviceLabel,
        r.kind === "coins" ? "Coins / Free" : "Coupon",
        r.couponCode ?? "",
        r.gross,
        r.discount,
        r.paid,
        r.status,
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `discounts-${range}.csv`;
    a.click();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Discount breakdown</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          {RANGES.map(([k, label]) => (
            <Button key={k} size="sm" variant={range === k ? "default" : "outline"} onClick={() => setRange(k)}>
              {label}
            </Button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Stat label="Total discount" value={inr.format(sum(all))} sub={`${all.length} orders`} />
          <Stat label="Via coupons" value={inr.format(sum(coupons))} sub={`${coupons.length} orders`} />
          <Stat label="Via coins / free" value={inr.format(sum(coins))} sub={`${coins.length} orders`} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search name, phone, coupon…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {(["all", "coupon", "coins"] as const).map((k) => (
            <Button key={k} size="sm" variant={kind === k ? "secondary" : "ghost"} onClick={() => setKind(k)}>
              {k === "all" ? "All" : k === "coupon" ? "Coupons" : "Coins"}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows.length}>
            <Download size={14} /> CSV
          </Button>
        </div>

        <div className="overflow-x-auto border border-border rounded-xl">
          <table className="w-full text-[13px]">
            <thead className="bg-muted text-muted-foreground text-left">
              <tr>
                <th className="p-2">Customer</th>
                <th className="p-2">Service</th>
                <th className="p-2">Discount via</th>
                <th className="p-2 text-right">Gross</th>
                <th className="p-2 text-right">Discount</th>
                <th className="p-2 text-right">Paid</th>
                <th className="p-2">Date</th>
              </tr>
            </thead>
            <tbody>
              {query.isLoading ? (
                <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
              ) : query.isError ? (
                <tr><td colSpan={7} className="p-6 text-center text-destructive">Failed to load</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No discounted orders</td></tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-border hover:bg-accent/40 cursor-pointer"
                    onClick={() => {
                      onClose();
                      onOpenBooking(r.id);
                    }}
                  >
                    <td className="p-2">
                      <div className="font-medium text-foreground">{r.customerName ?? "—"}</div>
                      <div className="text-muted-foreground">{r.customerPhone ?? ""}</div>
                    </td>
                    <td className="p-2">
                      <div>{r.serviceLabel}</div>
                      <div className="text-muted-foreground text-[11px]">#{r.id.slice(0, 6)} · {r.status}</div>
                    </td>
                    <td className="p-2">
                      {r.kind === "coins" ? (
                        <Badge variant="secondary">Coins / Free</Badge>
                      ) : (
                        <Badge variant="outline">Coupon {r.couponCode ?? ""}</Badge>
                      )}
                    </td>
                    <td className="p-2 text-right">{inr.format(r.gross)}</td>
                    <td className="p-2 text-right font-semibold text-primary">-{inr.format(r.discount)}</td>
                    <td className="p-2 text-right">{inr.format(r.paid)}</td>
                    <td className="p-2 whitespace-nowrap">
                      {new Date(r.createdAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="border border-border rounded-xl p-3 bg-card">
      <p className="text-[11px] uppercase font-semibold text-muted-foreground">{label}</p>
      <p className="text-[20px] font-bold text-foreground">{value}</p>
      <p className="text-[11px] text-muted-foreground">{sub}</p>
    </div>
  );
}
