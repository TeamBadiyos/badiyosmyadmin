import type { PayoutBatch, PayoutItem } from "@/lib/wallets.functions";

const rs = (n: number) => "Rs " + Math.round(n).toLocaleString("en-IN");
const d = (s?: string | null) =>
  s ? new Date(s.length === 10 ? s + "T00:00:00" : s).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Kolkata" }) : "-";
const typeLabel = (t: string) => (t === "expert" ? "Expert" : t === "merchant" ? "Merchant" : "Partner");

/** Browser-generated A4 payout sheet for one batch. */
export async function downloadPayoutPdf(batch: PayoutBatch, items: PayoutItem[]) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = 297;
  let y = 14;
  doc.setFont("helvetica", "bold").setFontSize(16).setTextColor(11, 122, 78);
  doc.text("Badiyos — Payout Sheet", 12, y);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(60);
  doc.text(`Generated ${new Date().toLocaleString("en-IN")}`, W - 12, y, { align: "right" });
  y += 7;
  doc.setFontSize(10).setTextColor(20);
  doc.text(
    `Batch: ${batch.batch_type === "merchant" ? "Merchant" : "Expert / Partner"}  |  Period: ${d(batch.week_start)} – ${d(batch.week_end)}  |  Status: ${batch.status.toUpperCase()}  |  ID: ${batch.id.slice(0, 8)}`,
    12,
    y,
  );
  y += 6;
  const gross = items.reduce((s, i) => s + i.gross_amount, 0);
  const bonus = items.reduce((s, i) => s + i.bonus_amount, 0);
  const tds = items.reduce((s, i) => s + i.tds_amount, 0);
  const net = items.reduce((s, i) => s + i.net_amount, 0);
  const paid = items.filter((i) => i.paid);
  doc.text(
    `Gross ${rs(gross)}  |  Bonus incl. ${rs(bonus)}  |  TDS ${rs(tds)}  |  Net ${rs(net)}  |  Paid ${paid.length}/${items.length} (${rs(paid.reduce((s, i) => s + i.net_amount, 0))})`,
    12,
    y,
  );
  if (batch.notes) {
    y += 5;
    doc.text(`Notes: ${batch.notes}`, 12, y);
  }
  y += 6;

  const cols = [
    { h: "#", w: 8 },
    { h: "Name", w: 52 },
    { h: "Type", w: 18 },
    { h: "Phone", w: 26 },
    { h: "Gross", w: 22, r: true },
    { h: "Bonus", w: 18, r: true },
    { h: "TDS", w: 18, r: true },
    { h: "Net payable", w: 24, r: true },
    { h: "Status", w: 16 },
    { h: "Paid on", w: 22 },
    { h: "Mode", w: 16 },
    { h: "UTR / Ref", w: 33 },
  ];
  const header = () => {
    doc.setFillColor(227, 245, 236).rect(12, y - 4, W - 24, 6, "F");
    doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(20);
    let x = 12;
    for (const c of cols) {
      doc.text(c.h, c.r ? x + c.w - 1 : x + 1, y, { align: c.r ? "right" : "left" });
      x += c.w;
    }
    y += 6;
    doc.setFont("helvetica", "normal");
  };
  header();
  items.forEach((i, idx) => {
    if (y > 196) {
      doc.addPage();
      y = 14;
      header();
    }
    const vals = [
      String(idx + 1),
      i.owner_name,
      typeLabel(i.owner_type),
      i.owner_phone ?? "-",
      rs(i.gross_amount),
      i.bonus_amount ? rs(i.bonus_amount) : "-",
      i.tds_amount ? rs(i.tds_amount) : "-",
      rs(i.net_amount),
      i.paid ? "Paid" : "Unpaid",
      d(i.paid_on),
      i.payment_mode ?? "-",
      i.utr ?? "-",
    ];
    let x = 12;
    cols.forEach((c, k) => {
      const t = doc.splitTextToSize(vals[k], c.w - 2)[0] ?? "";
      doc.text(t, c.r ? x + c.w - 1 : x + 1, y, { align: c.r ? "right" : "left" });
      x += c.w;
    });
    doc.setDrawColor(227, 235, 231).line(12, y + 2, W - 12, y + 2);
    y += 6;
  });
  doc.save(`payout-${batch.batch_type}-${batch.week_start}_to_${batch.week_end}.pdf`);
}

export function downloadPayoutCsv(batch: PayoutBatch, items: PayoutItem[]) {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [
    ["Name", "Type", "Phone", "Gross", "Bonus", "TDS", "Net", "Status", "Paid on", "Mode", "UTR", "Notes"],
    ...items.map((i) => [
      i.owner_name, typeLabel(i.owner_type), i.owner_phone, i.gross_amount, i.bonus_amount, i.tds_amount,
      i.net_amount, i.paid ? "Paid" : "Unpaid", i.paid_on, i.payment_mode, i.utr, i.payment_notes,
    ]),
  ];
  const blob = new Blob([rows.map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `payout-${batch.batch_type}-${batch.week_start}_to_${batch.week_end}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
