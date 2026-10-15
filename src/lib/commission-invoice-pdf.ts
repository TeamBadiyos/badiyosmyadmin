// Builds the commission tax invoice PDF from get_settlement_invoice() output.
// Browser-only; reusable by the Merchant App with the same RPC payload.
export type CommissionInvoice = {
  invoice_no: string | null; date: string; period_from: string; period_to: string; type: string;
  company: Record<string, string>;
  merchant: { name: string; gstin: string | null; pan: string | null; state: string | null; address: string | null };
  gross: number; commission: number; gst_rate: number; intra_state: boolean;
  cgst: number; sgst: number; igst: number; commission_gst: number;
  tcs: number; tds: number; adjustments: number; instant_fee: number; instant_fee_gst?: number; instant_fee_gst_rate?: number; sac_instant_fee?: string | null; net: number;
};

const r = (n: number) => "Rs " + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function downloadCommissionInvoicePdf(inv: CommissionInvoice, sac = "998599") {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = 18;
  doc.setFontSize(16); doc.text("TAX INVOICE — Commission", 14, y);
  doc.setFontSize(10);
  doc.text(`Invoice no: ${inv.invoice_no ?? "—"}`, 140, y - 4); doc.text(`Date: ${inv.date}`, 140, y + 1);
  y += 10;
  const c = inv.company;
  doc.setFont("helvetica", "bold"); doc.text("From", 14, y); doc.text("To", 110, y); doc.setFont("helvetica", "normal");
  const left = [c.legal_name || "—", c.address || "", `State: ${c.state || "—"}`, `GSTIN: ${c.gstin || "—"}`, `PAN: ${c.pan || "—"}`];
  const right = [inv.merchant.name || "—", inv.merchant.address || "", `State: ${inv.merchant.state || "—"}`, `GSTIN: ${inv.merchant.gstin || "Unregistered"}`, `PAN: ${inv.merchant.pan || "—"}`];
  for (let i = 0; i < 5; i++) {
    doc.text(doc.splitTextToSize(left[i], 90)[0] ?? "", 14, y + 6 + i * 5);
    doc.text(doc.splitTextToSize(right[i], 90)[0] ?? "", 110, y + 6 + i * 5);
  }
  y += 36;
  doc.text(`Settlement period: ${inv.period_from} to ${inv.period_to} (${inv.type})`, 14, y); y += 8;
  const rows: [string, number][] = [["Commission on orders (taxable value)", inv.commission]];
  if (inv.intra_state) {
    rows.push([`CGST @ ${inv.gst_rate / 2}%`, inv.cgst], [`SGST @ ${inv.gst_rate / 2}%`, inv.sgst]);
  } else rows.push([`IGST @ ${inv.gst_rate}%`, inv.igst]);
  const fee = Number(inv.instant_fee || 0), feeGst = Number(inv.instant_fee_gst || 0), feeRate = Number(inv.instant_fee_gst_rate ?? 18);
  if (fee > 0) {
    rows.push([`Instant settlement fee${inv.sac_instant_fee ? ` — SAC ${inv.sac_instant_fee}` : ""}`, fee]);
    if (inv.intra_state) {
      const half = Math.round((feeGst / 2) * 100) / 100;
      rows.push([`CGST on instant fee @ ${feeRate / 2}%`, half], [`SGST on instant fee @ ${feeRate / 2}%`, Math.round((feeGst - half) * 100) / 100]);
    } else rows.push([`IGST on instant fee @ ${feeRate}%`, feeGst]);
  }
  rows.push(["Invoice total", inv.commission + inv.commission_gst + fee + feeGst]);
  doc.setFont("helvetica", "bold"); doc.text("Description", 14, y); doc.text("Amount", 180, y, { align: "right" }); doc.setFont("helvetica", "normal");
  doc.line(14, y + 2, 196, y + 2); y += 8;
  for (const [k, v] of rows) { doc.text(k, 14, y); doc.text(r(v), 180, y, { align: "right" }); y += 6; }
  y += 6;
  doc.setFont("helvetica", "bold"); doc.text("Settlement summary (for information, not part of taxable value)", 14, y); doc.setFont("helvetica", "normal"); y += 7;
  const s: [string, number][] = [
    ["Gross order value", inv.gross], ["Less commission", -inv.commission], ["Less GST on commission", -inv.commission_gst],
    ["Less TCS (Sec 52)", -inv.tcs], ["Less TDS (Sec 194-O)", -inv.tds], ["Adjustments", inv.adjustments],
    ["Instant settlement fee", -inv.instant_fee], ["Less GST on instant fee", -(inv.instant_fee_gst || 0)], ["Net paid to merchant", inv.net],
  ];
  for (const [k, v] of s) { doc.text(k, 14, y); doc.text(r(v), 180, y, { align: "right" }); y += 6; }
  doc.setFontSize(8); doc.text(`Computer-generated invoice. SAC ${sac}.`, 14, 285);
  doc.save(`${(inv.invoice_no ?? "invoice").replace(/\//g, "-")}.pdf`);
}
