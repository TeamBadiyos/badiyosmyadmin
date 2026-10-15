// Customer tax invoice / credit note PDFs, built in the browser from the stored snapshot.
import type { CustomerInvoice, CreditNote } from "@/lib/customer-finance.functions";

const r = (n: number) => "Rs " + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const SERVICE: Record<string, string> = { clean_home: "Clean Home", clean_auto: "Clean Auto", store: "Store", food: "Food", parcel: "Parcel" };

function header(doc: any, title: string, no: string, date: string, company: Record<string, string>) {
  doc.setFontSize(16); doc.text(title, 14, 18);
  doc.setFontSize(10);
  doc.text(`No: ${no}`, 140, 14); doc.text(`Date: ${date}`, 140, 19);
  let y = 28;
  doc.setFont("helvetica", "bold"); doc.text(company.legal_name || "Badiyos", 14, y); doc.setFont("helvetica", "normal");
  for (const l of [company.address, company.state && `State: ${company.state}`, company.gstin && `GSTIN: ${company.gstin}`, company.pan && `PAN: ${company.pan}`].filter(Boolean) as string[]) {
    y += 5; doc.text(doc.splitTextToSize(l, 120), 14, y);
  }
  return y + 8;
}

export async function downloadCustomerInvoicePdf(inv: CustomerInvoice) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = header(doc, "TAX INVOICE", inv.invoice_no, inv.invoice_date, inv.company ?? {});
  doc.text(`Bill to: ${inv.customer_name ?? "Customer"}${inv.customer_phone ? " · " + inv.customer_phone : ""}`, 14, y);
  y += 5; doc.text(`Service: ${SERVICE[inv.service] ?? inv.service} · Order ${inv.ref_code ?? ""}`, 14, y);
  y += 9;
  doc.setFont("helvetica", "bold");
  doc.text("Description", 14, y); doc.text("SAC", 95, y); doc.text("Taxable", 120, y); doc.text("GST %", 150, y); doc.text("GST", 175, y);
  doc.setFont("helvetica", "normal"); y += 2; doc.line(14, y, 196, y); y += 5;
  for (const l of inv.lines ?? []) {
    doc.text(String(l.desc), 14, y); doc.text(String(l.sac || "-"), 95, y); doc.text(r(l.taxable), 120, y); doc.text(`${l.gst_pct}%`, 150, y); doc.text(r(l.gst), 175, y); y += 6;
  }
  doc.line(14, y, 196, y); y += 7;
  const rows: [string, number][] = [["Taxable value", inv.taxable_value], ["CGST", inv.cgst], ["SGST", inv.sgst]];
  if (Number(inv.igst) > 0) rows.push(["IGST", inv.igst]);
  if (Number(inv.discount) > 0) rows.push(["Discount", -inv.discount]);
  for (const [k, v] of rows) { doc.text(k, 130, y); doc.text(r(v), 175, y); y += 6; }
  doc.setFont("helvetica", "bold"); doc.text("Total", 130, y); doc.text(r(inv.total), 175, y); doc.setFont("helvetica", "normal");
  const g = inv.merchant_goods;
  if (g && (g.items?.length || Number(g.total) > 0)) {
    y += 14;
    doc.setFont("helvetica", "bold");
    doc.text(`Items sold by ${g.merchant_name || "the store"} (GSTIN ${g.merchant_gstin || "Unregistered"})`, 14, y);
    doc.setFont("helvetica", "normal"); y += 5;
    doc.setFontSize(8); doc.text("Supplied directly by the merchant. NOT part of this Badiyos tax invoice; no Badiyos GST charged.", 14, y); doc.setFontSize(10);
    y += 3; doc.line(14, y, 196, y); y += 5;
    for (const it of g.items ?? []) {
      if (y > 270) { doc.addPage(); y = 20; }
      doc.text(doc.splitTextToSize(String(it.desc), 120)[0] ?? "", 14, y); doc.text(`x${it.qty}`, 140, y); doc.text(r(it.amount), 175, y); y += 6;
    }
    doc.setFont("helvetica", "bold"); doc.text("Items total (merchant)", 130, y); doc.text(r(g.total), 175, y); doc.setFont("helvetica", "normal");
  }
  doc.setFontSize(8); doc.text("Computer-generated invoice. No signature required.", 14, 285);
  doc.save(`${inv.invoice_no.replace(/\//g, "-")}.pdf`);
}

export async function downloadCreditNotePdf(cn: CreditNote, company: Record<string, string> = {}) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = header(doc, "CREDIT NOTE", cn.credit_note_no, cn.note_date, company);
  doc.text(`Against invoice: ${cn.invoice_no}`, 14, y); y += 5;
  doc.text(`Customer: ${cn.customer_name ?? "Customer"} · ${SERVICE[cn.service] ?? cn.service} · Order ${cn.ref_code ?? ""}`, 14, y); y += 5;
  doc.text(`Reason: ${cn.reason ?? "Refund"}`, 14, y); y += 10;
  for (const [k, v] of [["Taxable value", cn.taxable_value], ["CGST", cn.cgst], ["SGST", cn.sgst], ["IGST", cn.igst]] as [string, number][]) {
    if (k === "IGST" && !Number(v)) continue;
    doc.text(k, 130, y); doc.text(r(v), 175, y); y += 6;
  }
  doc.setFont("helvetica", "bold"); doc.text("Total credit", 130, y); doc.text(r(cn.total), 175, y);
  doc.save(`${cn.credit_note_no.replace(/\//g, "-")}.pdf`);
}
