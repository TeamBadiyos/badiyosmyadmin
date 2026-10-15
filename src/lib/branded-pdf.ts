// One shared, branded A4 template for every badiyos money document:
// customer tax invoice, credit note and merchant commission invoice.
// Pure drawing code: assets (fonts, logo, QR) are passed in so the same template
// renders in the browser and in scripts.
import type { jsPDF as JsPDF } from "jspdf";

export type PdfAssets = { regular: string; bold: string; logo: string | null; qr: (text: string) => Promise<string> };

export type DocLine = { desc: string; note?: string; sac?: string; taxable: number; gst_pct: number; gst: number; amount: number };
export type DocTotalsRow = { label: string; value: number; muted?: boolean };

export type BrandedDoc = {
  title: string; // TAX INVOICE / CREDIT NOTE
  number: string;
  draft?: boolean;
  company: Record<string, string>;
  meta: Array<[string, string]>; // right side: date, place of supply, payment mode…
  paid?: boolean;
  billTo: { title: string; lines: string[] };
  chip?: { label: string; color: string } | null;
  refLabel?: string; // "Order BDS-…" / "Booking CH-10001"
  extraInfo?: string[]; // e.g. "Against invoice …"
  lines: DocLine[];
  showGstCols?: boolean;
  goods?: { title: string; note: string; items: { desc: string; qty: number; amount: number }[]; total: number } | null;
  totals: DocTotalsRow[];
  grandLabel: string; // TOTAL PAID
  grand: number;
  after?: { title: string; rows: DocTotalsRow[]; final?: DocTotalsRow } | null;
  qrUrl: string;
  footerNote?: string;
  filename: string;
};

export const BRAND = { green: "#00B97A", ink: "#222831", soft: "#F8FAFA", line: "#E6EBEB", muted: "#6B7280" };
export const SERVICE_CHIP: Record<string, { label: string; color: string }> = {
  clean_home: { label: "Clean Home", color: "#00B97A" },
  clean_auto: { label: "Clean Auto", color: "#222831" },
  store: { label: "Store", color: "#7C3AED" },
  food: { label: "Food", color: "#DC2626" },
  parcel: { label: "Parcel", color: "#2563EB" },
};

const STATE_CODES: Record<string, string> = { "27": "Maharashtra" };
export function placeOfSupply(company: Record<string, string>) {
  const code = (company.gstin || "").slice(0, 2);
  const state = company.state || STATE_CODES[code] || "Maharashtra";
  return `${state} (${/^\d\d$/.test(code) ? code : "27"})`;
}

export const money = (n: number) => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (n: number) => (n < 0 ? "−" : "") + money(Math.abs(n));

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function two(n: number) { return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? " " + ONES[n % 10] : ""}`; }
function three(n: number) { const h = Math.floor(n / 100), r = n % 100; return [h ? `${ONES[h]} Hundred` : "", r ? two(r) : ""].filter(Boolean).join(" "); }
export function amountInWords(v: number) {
  const n = Math.round(Math.abs(v) * 100);
  let rs = Math.floor(n / 100); const ps = n % 100;
  if (rs === 0 && ps === 0) return "Rupees Zero Only";
  const parts: string[] = [];
  const cr = Math.floor(rs / 1e7); rs %= 1e7;
  const lk = Math.floor(rs / 1e5); rs %= 1e5;
  const th = Math.floor(rs / 1e3); rs %= 1e3;
  if (cr) parts.push(`${three(cr)} Crore`);
  if (lk) parts.push(`${two(lk)} Lakh`);
  if (th) parts.push(`${two(th)} Thousand`);
  if (rs) parts.push(three(rs));
  const r = parts.length ? `Rupees ${parts.join(" ")}` : "Rupees Zero";
  return `${r}${ps ? ` and ${two(ps)} Paise` : ""} Only`;
}

/** Round off so the TOTAL always equals the amount actually paid. */
export function roundOff(paid: number, computed: number) { return Math.round((paid - computed) * 100) / 100; }

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export async function renderBrandedPdf(doc: JsPDF, d: BrandedDoc, a: PdfAssets) {
  doc.addFileToVFS("NunitoSans-Regular.ttf", a.regular);
  doc.addFont("NunitoSans-Regular.ttf", "Nunito", "normal");
  doc.addFileToVFS("NunitoSans-Bold.ttf", a.bold);
  doc.addFont("NunitoSans-Bold.ttf", "Nunito", "bold");
  const W = 210, M = 14, CW = W - 2 * M;
  const fill = (c: string) => doc.setFillColor(...hex(c));
  const ink = (c: string) => doc.setTextColor(...hex(c));
  const font = (style: "normal" | "bold", size: number) => { doc.setFont("Nunito", style); doc.setFontSize(size); };
  let y = 0;
  const page = () => {
    // header band
    fill(BRAND.green); doc.rect(0, 0, W, 30, "F");
    if (a.logo) { try { doc.addImage(a.logo, "PNG", M, 9, 38, 12); } catch { /* logo optional */ } }
    else { ink("#FFFFFF"); font("bold", 20); doc.text("badiyos", M, 20); }
    ink("#FFFFFF"); font("bold", 16); doc.text(d.title, W - M, 15, { align: "right" });
    font("normal", 10); doc.text(d.number, W - M, 22, { align: "right" });
    if (d.draft) {
      doc.saveGraphicsState();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      doc.setGState(new (doc as any).GState({ opacity: 0.12 }));
      ink("#6B7280"); font("bold", 110); doc.text("DRAFT", W / 2, 175, { align: "center", angle: 35 });
      doc.restoreGraphicsState();
    }
    y = 40;
  };
  const ensure = (h: number) => { if (y + h > 262) { doc.addPage(); page(); } };
  page();

  // company + meta
  const c = d.company;
  ink(BRAND.ink); font("bold", 12); doc.text(c.legal_name || "badiyos", M, y);
  font("normal", 9); ink(BRAND.muted);
  const cl = [c.address, [c.gstin && `GSTIN ${c.gstin}`, c.pan && `PAN ${c.pan}`].filter(Boolean).join("  ·  "),
    [c.support_phone || c.phone, c.support_email || c.email].filter(Boolean).join("  ·  ")].filter(Boolean) as string[];
  let ly = y + 5;
  for (const l of cl) for (const s of doc.splitTextToSize(l, 105)) { doc.text(s, M, ly); ly += 4.5; }
  let my = y;
  for (const [k, v] of d.meta) {
    font("normal", 9); ink(BRAND.muted); doc.text(k, 140, my);
    font("bold", 9); ink(BRAND.ink); doc.text(v, W - M, my, { align: "right" }); my += 5;
  }
  if (d.paid) {
    my += 1; fill(BRAND.green); doc.roundedRect(W - M - 22, my - 3.6, 22, 6.5, 3.2, 3.2, "F");
    ink("#FFFFFF"); font("bold", 9); doc.text("Paid", W - M - 13.5, my + 0.9, { align: "center" });
    doc.setDrawColor(255, 255, 255); doc.setLineWidth(0.5);
    doc.line(W - M - 7.6, my - 0.1, W - M - 6.4, my + 1.1); doc.line(W - M - 6.4, my + 1.1, W - M - 4, my - 1.5);
    my += 6;
  }
  y = Math.max(ly, my) + 4;

  // bill to card
  const billH = 10 + d.billTo.lines.length * 4.8 + (d.extraInfo?.length ?? 0) * 4.8;
  fill(BRAND.soft); doc.roundedRect(M, y, CW, billH, 3, 3, "F");
  ink(BRAND.muted); font("bold", 8); doc.text(d.billTo.title.toUpperCase(), M + 5, y + 6);
  ink(BRAND.ink); let by = y + 11;
  d.billTo.lines.forEach((l, i) => { font(i === 0 ? "bold" : "normal", i === 0 ? 11 : 9); doc.text(l, M + 5, by); by += 4.8; });
  for (const l of d.extraInfo ?? []) { font("normal", 9); doc.text(l, M + 5, by); by += 4.8; }
  if (d.chip) {
    font("bold", 8.5); const tw = doc.getTextWidth(d.chip.label) + 8;
    fill(d.chip.color); doc.roundedRect(W - M - 5 - tw, y + 4, tw, 6, 3, 3, "F");
    ink("#FFFFFF"); doc.text(d.chip.label, W - M - 5 - tw / 2, y + 8.1, { align: "center" });
  }
  if (d.refLabel) { ink(BRAND.ink); font("bold", 9); doc.text(d.refLabel, W - M - 5, y + 15, { align: "right" }); }
  y += billH + 7;

  // items table
  const gst = d.showGstCols !== false;
  const cols = gst
    ? [{ t: "Description", x: M + 3, al: "left" }, { t: "SAC", x: 100, al: "left" }, { t: "Taxable", x: 136, al: "right" }, { t: "GST %", x: 152, al: "right" }, { t: "GST", x: 172, al: "right" }, { t: "Amount", x: W - M - 3, al: "right" }]
    : [{ t: "Description", x: M + 3, al: "left" }, { t: "Amount", x: W - M - 3, al: "right" }];
  fill(BRAND.ink); doc.roundedRect(M, y, CW, 8, 2, 2, "F");
  ink("#FFFFFF"); font("bold", 8.5);
  for (const cc of cols) doc.text(cc.t, cc.x, y + 5.4, { align: cc.al as "left" | "right" });
  y += 8;
  d.lines.forEach((l, i) => {
    const descLines: string[] = doc.splitTextToSize(l.desc, gst ? 80 : 140);
    const h = 4 + descLines.length * 4.2 + (l.note ? 4 : 0) + 2;
    ensure(h);
    if (i % 2 === 1) { fill(BRAND.soft); doc.rect(M, y, CW, h, "F"); }
    ink(BRAND.ink); font("normal", 9);
    descLines.forEach((s, j) => doc.text(s, M + 3, y + 5 + j * 4.2));
    if (l.note) { ink(BRAND.muted); font("normal", 7.5); doc.text(l.note, M + 3, y + 5 + descLines.length * 4.2); }
    ink(BRAND.ink); font("normal", 9);
    if (gst) {
      doc.text(l.sac || "—", 100, y + 5);
      doc.text(money(l.taxable), 136, y + 5, { align: "right" });
      doc.text(`${Number(l.gst_pct)}%`, 152, y + 5, { align: "right" });
      doc.text(money(l.gst), 172, y + 5, { align: "right" });
    }
    font("bold", 9); doc.text(signed(l.amount), W - M - 3, y + 5, { align: "right" });
    y += h;
  });
  doc.setDrawColor(...hex(BRAND.line)); doc.setLineWidth(0.3); doc.line(M, y, W - M, y);
  y += 6;

  // totals
  ensure(d.totals.length * 5.5 + 30);
  const tx = 120;
  for (const t of d.totals) {
    font("normal", 9.5); ink(t.muted ? BRAND.muted : BRAND.ink);
    doc.text(t.label, tx, y); doc.text(signed(t.value), W - M - 3, y, { align: "right" }); y += 5.5;
  }
  y += 1;
  fill(BRAND.green); doc.roundedRect(tx - 4, y, W - M - tx + 4, 12, 3, 3, "F");
  ink("#FFFFFF"); font("bold", 10); doc.text(d.grandLabel, tx, y + 7.7);
  font("bold", 13); doc.text(money(d.grand), W - M - 3, y + 8, { align: "right" });
  y += 17;
  ink(BRAND.muted); font("normal", 8.5);
  for (const s of doc.splitTextToSize(amountInWords(d.grand), CW)) { doc.text(s, W - M - 3, y, { align: "right" }); y += 4.2; }
  y += 4;

  // merchant goods (store)
  if (d.goods && (d.goods.items.length || d.goods.total > 0)) {
    const gh = 16 + d.goods.items.length * 5.2 + 7;
    ensure(gh);
    doc.setDrawColor(...hex(BRAND.line)); fill("#FFFFFF"); doc.roundedRect(M, y, CW, gh, 3, 3, "FD");
    ink(BRAND.ink); font("bold", 10); doc.text(d.goods.title, M + 5, y + 6);
    ink(BRAND.muted); font("normal", 7.8); doc.text(d.goods.note, M + 5, y + 10.5);
    let gy = y + 16;
    ink(BRAND.ink); font("normal", 9);
    for (const it of d.goods.items) {
      doc.text(doc.splitTextToSize(it.desc, 120)[0] ?? "", M + 5, gy);
      doc.text(`x${it.qty}`, 160, gy, { align: "right" });
      doc.text(money(it.amount), W - M - 5, gy, { align: "right" }); gy += 5.2;
    }
    font("bold", 9); doc.text("Items total (paid to merchant)", M + 5, gy + 1); doc.text(money(d.goods.total), W - M - 5, gy + 1, { align: "right" });
    y += gh + 6;
  }

  // info section (commission settlement summary)
  if (d.after) {
    const ah = 10 + d.after.rows.length * 5.2 + (d.after.final ? 8 : 0);
    ensure(ah);
    fill(BRAND.soft); doc.roundedRect(M, y, CW, ah, 3, 3, "F");
    ink(BRAND.ink); font("bold", 9.5); doc.text(d.after.title, M + 5, y + 6.5);
    let ay = y + 12;
    for (const r of d.after.rows) { font("normal", 9); ink(BRAND.ink); doc.text(r.label, M + 5, ay); doc.text(signed(r.value), W - M - 5, ay, { align: "right" }); ay += 5.2; }
    if (d.after.final) { font("bold", 10); doc.text(d.after.final.label, M + 5, ay + 2); doc.text(signed(d.after.final.value), W - M - 5, ay + 2, { align: "right" }); }
    y += ah + 6;
  }

  // footer on every page
  const qr = await a.qr(d.qrUrl);
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...hex(BRAND.line)); doc.line(M, 266, W - M, 266);
    if (p === pages) doc.addImage(qr, "PNG", W - M - 20, 268, 20, 20);
    ink(BRAND.green); font("bold", 11); doc.text("Thank you for choosing badiyos", M, 273);
    // small heart
    const hx = M + doc.getTextWidth("Thank you for choosing badiyos") + 3.5; fill(BRAND.green);
    doc.circle(hx, 271.4, 1.1, "F"); doc.circle(hx + 1.9, 271.4, 1.1, "F"); doc.triangle(hx - 1.1, 271.8, hx + 3, 271.8, hx + 0.95, 274.3, "F");
    ink(BRAND.muted); font("normal", 8);
    doc.text(["badiyos.com", c.support_phone || c.phone, c.support_email || c.email].filter(Boolean).join("  ·  "), M, 278);
    doc.text(d.footerNote || "Computer-generated invoice. No signature required.", M, 283);
    if (pages > 1) doc.text(`Page ${p} of ${pages}`, W / 2, 289, { align: "center" });
  }
  return doc;
}

// ---------- browser asset loader ----------
let cache: Promise<Omit<PdfAssets, "qr">> | null = null;
const b64 = (buf: ArrayBuffer) => { let s = ""; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
async function imgToPng(src: string): Promise<string | null> {
  try {
    const img = new Image(); img.crossOrigin = "anonymous"; img.src = src; await img.decode();
    const cv = document.createElement("canvas"); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    cv.getContext("2d")!.drawImage(img, 0, 0); return cv.toDataURL("image/png");
  } catch { return null; }
}
export async function browserAssets(logoUrl: string | null): Promise<PdfAssets> {
  cache ??= (async () => {
    const [r, b] = await Promise.all(["/fonts/NunitoSans-Regular.ttf", "/fonts/NunitoSans-Bold.ttf"].map(async (u) => b64(await (await fetch(u)).arrayBuffer())));
    return { regular: r, bold: b, logo: logoUrl ? await imgToPng(logoUrl) : null };
  })();
  const base = await cache;
  const QR = await import("qrcode");
  return { ...base, qr: (t) => QR.toDataURL(t, { margin: 0, width: 240, color: { dark: BRAND.ink, light: "#FFFFFF" } }) };
}
