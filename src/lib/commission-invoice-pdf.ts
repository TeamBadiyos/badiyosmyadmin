// Merchant commission tax invoice on the shared branded template (data from get_settlement_invoice()).
import { type BrandedDoc, placeOfSupply, roundOff, renderBrandedPdf, browserAssets } from "@/lib/branded-pdf";
import logo from "@/assets/badiyos-wordmark-white.png.asset.json";

export type CommissionInvoice = {
  invoice_no: string | null; date: string; period_from: string; period_to: string; type: string;
  company: Record<string, string>;
  merchant: { name: string; gstin: string | null; pan: string | null; state: string | null; address: string | null };
  gross: number; commission: number; gst_rate: number; intra_state: boolean;
  cgst: number; sgst: number; igst: number; commission_gst: number;
  tcs: number; tds: number; adjustments: number; instant_fee: number; instant_fee_gst?: number; instant_fee_gst_rate?: number; sac_instant_fee?: string | null; net: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const fmtDate = (d: string) => new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export function commissionInvoiceDoc(inv: CommissionInvoice, sac = "998599"): BrandedDoc {
  const fee = Number(inv.instant_fee || 0), feeGst = Number(inv.instant_fee_gst || 0), feeRate = Number(inv.instant_fee_gst_rate ?? 18);
  const lines = [{ desc: `Commission on orders (${fmtDate(inv.period_from)} – ${fmtDate(inv.period_to)})`, sac, taxable: Number(inv.commission), gst_pct: Number(inv.gst_rate), gst: Number(inv.commission_gst), amount: r2(Number(inv.commission) + Number(inv.commission_gst)) }];
  if (fee > 0) lines.push({ desc: "Instant settlement fee", sac: inv.sac_instant_fee || "", taxable: fee, gst_pct: feeRate, gst: feeGst, amount: r2(fee + feeGst) });
  const taxable = Number(inv.commission) + fee;
  const totals = [{ label: "Taxable value", value: taxable }];
  if (inv.intra_state) {
    const fc = r2(feeGst / 2);
    totals.push({ label: "CGST", value: r2(Number(inv.cgst) + fc) }, { label: "SGST", value: r2(Number(inv.sgst) + (feeGst - fc)) });
  } else totals.push({ label: "IGST", value: r2(Number(inv.igst) + feeGst) });
  const grand = r2(Number(inv.commission) + Number(inv.commission_gst) + fee + feeGst);
  totals.push({ label: "Round off", value: roundOff(grand, totals.reduce((s, t) => s + t.value, 0)) });
  const m = inv.merchant;
  return {
    title: "TAX INVOICE", number: inv.invoice_no ?? "—", company: inv.company,
    meta: [["Invoice date", fmtDate(inv.date)], ["Place of supply", placeOfSupply({ ...inv.company, state: m.state || inv.company.state })], ["Settlement", inv.type === "instant" ? "Instant" : "Scheduled"]],
    paid: true,
    billTo: { title: "Bill to (merchant)", lines: [m.name || "—", m.address || "", `GSTIN ${m.gstin || "Unregistered"}${m.pan ? `  ·  PAN ${m.pan}` : ""}`].filter(Boolean) },
    chip: { label: "Commission", color: "#00B97A" },
    lines, totals, grandLabel: "TOTAL (recovered from settlement)", grand,
    after: {
      title: "Settlement summary (for information, not part of taxable value)",
      rows: [
        { label: "Gross order value", value: inv.gross }, { label: "Less commission", value: -inv.commission }, { label: "Less GST on commission", value: -inv.commission_gst },
        { label: "Less TCS (Sec 52)", value: -inv.tcs }, { label: "Less TDS (Sec 194-O)", value: -inv.tds }, { label: "Adjustments", value: inv.adjustments },
        { label: "Less instant settlement fee", value: -fee }, { label: "Less GST on instant fee", value: -feeGst },
      ],
      final: { label: "Net paid to merchant", value: inv.net },
    },
    qrUrl: `https://www.badiyos.com/support?invoice=${encodeURIComponent(inv.invoice_no ?? "")}`,
    footerNote: `Computer-generated invoice. Commission SAC ${sac}.`,
    filename: `${(inv.invoice_no ?? "invoice").replace(/\//g, "-")}.pdf`,
  };
}

export async function downloadCommissionInvoicePdf(inv: CommissionInvoice, sac = "998599") {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const d = commissionInvoiceDoc(inv, sac);
  await renderBrandedPdf(doc, d, await browserAssets(logo.url));
  doc.save(d.filename);
}
