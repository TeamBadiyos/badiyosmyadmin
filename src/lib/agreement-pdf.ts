// Branded agreement PDF (same green header / Nunito Sans as invoices), drawn in the browser
// from the agreement's frozen filled-in text.
import { BRAND, browserAssets } from "@/lib/branded-pdf";
import logo from "@/assets/badiyos-wordmark-white.png.asset.json";

export type AgreementDoc = {
  id: string; title: string; template_type: string; template_version: number; rendered_body: string;
  status: string; signed_method?: string | null; accepted_at?: string | null; accepted_phone?: string | null;
  accepted_ip?: string | null; accepted_device?: string | null; created_at: string;
};

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const dt = (s?: string | null) => (s ? new Date(s).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—");

export async function downloadAgreementPdf(a: AgreementDoc) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const as = await browserAssets(logo.url);
  doc.addFileToVFS("NunitoSans-Regular.ttf", as.regular); doc.addFont("NunitoSans-Regular.ttf", "Nunito", "normal");
  doc.addFileToVFS("NunitoSans-Bold.ttf", as.bold); doc.addFont("NunitoSans-Bold.ttf", "Nunito", "bold");
  const W = 210, M = 16, CW = W - 2 * M;
  const font = (s: "normal" | "bold", z: number) => { doc.setFont("Nunito", s); doc.setFontSize(z); };
  let y = 0;
  const header = () => {
    doc.setFillColor(...hex(BRAND.green)); doc.rect(0, 0, W, 26, "F");
    if (as.logo) { try { const ip = doc.getImageProperties(as.logo); const h = 10; doc.addImage(as.logo, "PNG", M, 8, Math.min(50, (h * ip.width) / ip.height), h); } catch { /* optional */ } }
    doc.setTextColor(255, 255, 255); font("bold", 14); doc.text("AGREEMENT", W - M, 13, { align: "right" });
    font("normal", 9); doc.text(`Version ${a.template_version} · ${a.id.slice(0, 8).toUpperCase()}`, W - M, 19, { align: "right" });
    y = 36;
  };
  const ensure = (h: number) => { if (y + h > 275) { doc.addPage(); header(); } };
  header();
  for (const raw of a.rendered_body.split("\n")) {
    const line = raw.replace(/\*\*/g, "");
    if (!line.trim()) { y += 3; continue; }
    let size = 10, style: "normal" | "bold" = "normal", text = line, indent = 0, gap = 5;
    if (line.startsWith("# ")) { size = 16; style = "bold"; text = line.slice(2); gap = 8; }
    else if (line.startsWith("## ")) { size = 12; style = "bold"; text = line.slice(3); gap = 6; y += 2; }
    else if (/^[-*] /.test(line)) { text = "•  " + line.slice(2); indent = 3; }
    font(style, size); doc.setTextColor(...hex(BRAND.ink));
    for (const s of doc.splitTextToSize(text, CW - indent)) { ensure(gap); doc.text(s, M + indent, y); y += gap; }
  }
  ensure(40); y += 6;
  doc.setFillColor(...hex(BRAND.soft)); doc.setDrawColor(...hex(BRAND.line)); doc.roundedRect(M, y, CW, 34, 3, 3, "FD");
  font("bold", 10); doc.setTextColor(...hex(BRAND.green));
  const st = a.status === "accepted" ? (a.signed_method === "paper" ? "Signed on paper" : "Accepted (I agree + OTP)") : a.status === "expired" ? "Expired" : "Awaiting acceptance";
  doc.text(st, M + 4, y + 7);
  font("normal", 9); doc.setTextColor(...hex(BRAND.muted));
  const rows = [`Issued: ${dt(a.created_at)}`, `Accepted: ${dt(a.accepted_at)}`, `Phone: ${a.accepted_phone ?? "—"}   IP: ${a.accepted_ip ?? "—"}`, `Device: ${(a.accepted_device ?? "—").slice(0, 90)}`];
  rows.forEach((r, i) => doc.text(r, M + 4, y + 13 + i * 5));
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) { doc.setPage(p); font("normal", 8); doc.setTextColor(...hex(BRAND.muted)); doc.text(`badiyos.com · ${a.title}`, M, 289); doc.text(`Page ${p} of ${pages}`, W - M, 289, { align: "right" }); }
  doc.save(`${a.title.replace(/[^\w]+/g, "-")}-v${a.template_version}.pdf`);
}
