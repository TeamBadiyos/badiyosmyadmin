import type { WeeklyExpertReportRow } from "@/lib/experts.functions";

const rs = (n: number) => "Rs " + Math.round(n).toLocaleString("en-IN");
const hm = (m: number) => { const h = Math.floor(m / 60), r = Math.round(m % 60); return r ? `${h}h ${r}m` : `${h}h`; };
const dmy = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;

/** Browser-generated A4 landscape weekly Expert report, ranked by worked hours. */
export async function downloadWeeklyExpertPdf(from: string, to: string, rows: WeeklyExpertReportRow[], batchStatus: string | null) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = 297;
  let y = 14;
  doc.setFont("helvetica", "bold").setFontSize(16).setTextColor(11, 122, 78);
  doc.text("Badiyos - Weekly Expert Report", 12, y);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(60);
  doc.text(`Generated ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`, W - 12, y, { align: "right" });
  y += 7;
  doc.setFontSize(10).setTextColor(20);
  doc.text(`Period: ${dmy(from)} - ${dmy(to)}   |   Ranked by highest worked hours   |   Payout batch: ${batchStatus ? batchStatus.toUpperCase() : "not generated (TDS / Net blank)"}`, 12, y);
  y += 8;

  const sum = (f: (r: WeeklyExpertReportRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const kpis: [string, string][] = [
    ["Experts", String(rows.length)],
    ["Orders", String(sum((r) => r.orders))],
    ["Hours worked", hm(sum((r) => r.minutes))],
    ["Work pay", rs(sum((r) => r.workPay))],
    ["Bonus", rs(sum((r) => r.bonus))],
    ["Total payment", rs(sum((r) => r.gross))],
  ];
  const kw = (W - 24 - 5 * 3) / 6;
  kpis.forEach(([l, v], i) => {
    const x = 12 + i * (kw + 3);
    doc.setFillColor(240, 248, 244).roundedRect(x, y, kw, 15, 2, 2, "F");
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(90).text(l.toUpperCase(), x + 3, y + 5);
    doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(20).text(v, x + 3, y + 12);
  });
  y += 22;

  const cols = [
    { h: "Rank", w: 13 }, { h: "Expert", w: 58 }, { h: "Phone", w: 28 },
    { h: "Orders", w: 16, r: true }, { h: "Hours", w: 22, r: true }, { h: "Extended", w: 20, r: true },
    { h: "Work pay", w: 25, r: true }, { h: "Bonus", w: 22, r: true }, { h: "Total pay", w: 26, r: true },
    { h: "TDS", w: 19, r: true }, { h: "Net payable", w: 24, r: true },
  ];
  const header = () => {
    doc.setFillColor(227, 245, 236).rect(12, y - 4, W - 24, 6.5, "F");
    doc.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(20);
    let x = 12;
    for (const c of cols) { doc.text(c.h, c.r ? x + c.w - 1.5 : x + 1.5, y, { align: c.r ? "right" : "left" }); x += c.w; }
    y += 6.5;
    doc.setFont("helvetica", "normal");
  };
  const line = (vals: string[], bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(8.5).setTextColor(20);
    let x = 12;
    cols.forEach((c, k) => {
      const t = doc.splitTextToSize(vals[k], c.w - 3)[0] ?? "";
      doc.text(t, c.r ? x + c.w - 1.5 : x + 1.5, y, { align: c.r ? "right" : "left" });
      x += c.w;
    });
    doc.setDrawColor(230).line(12, y + 2, W - 12, y + 2);
    y += 6.5;
  };
  header();
  rows.forEach((r, i) => {
    if (y > 192) { doc.addPage(); y = 14; header(); }
    line([`#${i + 1}`, r.name, r.phone ?? "-", String(r.orders), hm(r.minutes), r.extensionMinutes ? hm(r.extensionMinutes) : "-",
      rs(r.workPay), r.bonus ? rs(r.bonus) : "-", rs(r.gross), r.tds == null ? "-" : rs(r.tds), r.net == null ? "-" : rs(r.net)]);
  });
  if (y > 192) { doc.addPage(); y = 14; header(); }
  const anyTds = rows.some((r) => r.tds != null);
  line(["", `TOTAL (${rows.length} experts)`, "", String(sum((r) => r.orders)), hm(sum((r) => r.minutes)), hm(sum((r) => r.extensionMinutes)),
    rs(sum((r) => r.workPay)), rs(sum((r) => r.bonus)), rs(sum((r) => r.gross)),
    anyTds ? rs(sum((r) => r.tds ?? 0)) : "-", anyTds ? rs(sum((r) => r.net ?? 0)) : "-"], true);
  y += 4;
  doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(110);
  doc.text("Hours = completed customer orders by work date (training excluded) incl. approved extensions. Work pay = actual credited order payouts. Bonus = rewards credited for this period. TDS / Net from the matching payout batch.", 12, Math.min(y, 204), { maxWidth: W - 24 });
  doc.save(`badiyos-weekly-expert-report-${from}_to_${to}.pdf`);
}
