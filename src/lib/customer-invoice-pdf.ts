// Customer tax invoice / credit note PDFs on the shared branded template.
import type { CustomerInvoice, CreditNote } from "@/lib/customer-finance.functions";
import { type BrandedDoc, SERVICE_CHIP, placeOfSupply, roundOff, renderBrandedPdf, browserAssets } from "@/lib/branded-pdf";
import logo from "@/assets/badiyos-wordmark-white.png.asset.json";

const r2 = (n: number) => Math.round(n * 100) / 100;
const fmtDate = (d: string) => new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const refWord = (inv: { ref_type?: string; service: string }) => (inv.ref_type === "booking" || inv.service === "clean_home" || inv.service === "clean_auto" ? "Booking" : "Order");

export function customerInvoiceDoc(inv: CustomerInvoice & { status?: string; payment_mode?: string | null }): BrandedDoc {
  const company = inv.company ?? {};
  const lines = (inv.lines ?? []).map((l) => ({
    desc: String(l.desc), sac: l.sac, taxable: Number(l.taxable), gst_pct: Number(l.gst_pct), gst: Number(l.gst),
    amount: r2(Number(l.taxable) + Number(l.gst)),
    note: inv.service === "food" && /food/i.test(String(l.desc)) ? "Tax paid by e-commerce operator u/s 9(5)" : undefined,
  }));
  const taxable = Number(inv.taxable_value), cg = Number(inv.cgst), sg = Number(inv.sgst), ig = Number(inv.igst), disc = Number(inv.discount || 0);
  const half = (p: number) => `${Number(p) / 2}%`;
  const rate = lines.find((l) => l.gst > 0)?.gst_pct ?? 0;
  const mixed = new Set(lines.filter((l) => l.gst > 0).map((l) => l.gst_pct)).size > 1;
  const totals = [{ label: "Taxable value", value: taxable }];
  if (ig > 0) totals.push({ label: mixed ? "IGST" : `IGST ${rate}%`, value: ig });
  else totals.push({ label: mixed ? "CGST" : `CGST ${half(rate)}`, value: cg }, { label: mixed ? "SGST" : `SGST ${half(rate)}`, value: sg });
  if (disc > 0) totals.push({ label: inv.payments ? "Coupon discount (by badiyos)" : "Discount", value: -disc });
  const paid = Number(inv.total);
  totals.push({ label: "Round off", value: roundOff(paid, taxable + cg + sg + ig - disc) });
  const p = inv.payments;
  if (p) {
    // Whole-order payment summary: wallet is a payment method, not a discount
    if (inv.service === "store") {
      totals.push({ label: "Order total (goods + delivery)", value: Number(p.bill_total) });
      if (Number(p.coupon) > 0) totals.push({ label: "Coupon discount (by badiyos)", value: -Number(p.coupon) });
    }
    totals.push({ label: "Amount due", value: Number(p.amount_due) });
    if (Number(p.wallet) > 0) totals.push({ label: "Paid from wallet", value: Number(p.wallet) });
    totals.push({ label: "Paid online", value: Number(p.online) });
  }
  const g = inv.merchant_goods;
  return {
    title: "TAX INVOICE", number: inv.invoice_no, draft: inv.status === "draft", company,
    meta: [["Invoice date", fmtDate(inv.invoice_date)], ["Place of supply", placeOfSupply(company)], ["Payment mode", inv.payment_mode || "Online"]],
    paid: true,
    billTo: { title: "Bill to", lines: [inv.customer_name || "Customer", inv.customer_phone || ""].filter(Boolean) },
    chip: SERVICE_CHIP[inv.service] ?? null,
    refLabel: inv.ref_code ? `${refWord(inv)} ${inv.ref_code}` : undefined,
    lines,
    goods: g && (g.items?.length || Number(g.total) > 0) ? {
      title: `Items sold by ${g.merchant_name || "the store"} (GSTIN ${g.merchant_gstin || "Unregistered"})`,
      note: "Supplied directly by the merchant. NOT part of this badiyos tax invoice; no badiyos GST charged.",
      items: g.items ?? [], total: Number(g.total),
    } : null,
    totals, grandLabel: "TOTAL PAID", grand: paid,
    qrUrl: `https://www.badiyos.com/support?invoice=${encodeURIComponent(inv.invoice_no)}`,
    filename: `${inv.invoice_no.replace(/\//g, "-")}.pdf`,
  };
}

export function creditNoteDoc(cn: CreditNote, company: Record<string, string> = {}, invoiceDate?: string | null): BrandedDoc {
  const taxable = Number(cn.taxable_value), cg = Number(cn.cgst), sg = Number(cn.sgst), ig = Number(cn.igst), total = Number(cn.total);
  const totals = [{ label: "Taxable value", value: taxable }];
  if (ig > 0) totals.push({ label: "IGST", value: ig }); else totals.push({ label: "CGST", value: cg }, { label: "SGST", value: sg });
  totals.push({ label: "Round off", value: roundOff(total, taxable + cg + sg + ig) });
  return {
    title: "CREDIT NOTE", number: cn.credit_note_no, company,
    meta: [["Credit note date", fmtDate(cn.note_date)], ["Original invoice", cn.invoice_no], ...(invoiceDate ? [["Invoice date", fmtDate(invoiceDate)] as [string, string]] : []), ["Place of supply", placeOfSupply(company)]],
    billTo: { title: "Issued to", lines: [cn.customer_name || "Customer"] },
    extraInfo: [`Reason: ${cn.reason || "Refund"}`],
    chip: SERVICE_CHIP[cn.service] ?? null,
    refLabel: cn.ref_code ? `${refWord(cn)} ${cn.ref_code}` : undefined,
    lines: [{ desc: `Refund against invoice ${cn.invoice_no}`, taxable, gst_pct: taxable > 0 ? Math.round(((cg + sg + ig) / taxable) * 1000) / 10 : 0, gst: r2(cg + sg + ig), amount: total }],
    totals, grandLabel: "TOTAL CREDIT", grand: total,
    qrUrl: `https://www.badiyos.com/support?invoice=${encodeURIComponent(cn.invoice_no)}`,
    footerNote: "Computer-generated credit note. No signature required.",
    filename: `${cn.credit_note_no.replace(/\//g, "-")}.pdf`,
  };
}

async function save(d: BrandedDoc) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  await renderBrandedPdf(doc, d, await browserAssets(logo.url));
  doc.save(d.filename);
}

export const downloadCustomerInvoicePdf = (inv: CustomerInvoice) => save(customerInvoiceDoc(inv));
export const downloadCreditNotePdf = (cn: CreditNote, company: Record<string, string> = {}, invoiceDate?: string | null) => save(creditNoteDoc(cn, company, invoiceDate));
