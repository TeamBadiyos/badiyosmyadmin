import QRCode from "qrcode";
import appIcon from "@/assets/badiyos-app-icon.png.asset.json";
import wordmark from "@/assets/badiyos-wordmark-green.png.asset.json";

export type SealExportRow = {
  serial: number;
  code: string;
  qr_payload: string;
  printed_text: string;
};

export type SealLabelSize = "4x11.5";
export type SealLabelColour = "green" | "black";

export type SealPdfOptions = {
  batchNo: number;
  from: number;
  to: number;
  size?: SealLabelSize;
  colour: SealLabelColour;
  rows: SealExportRow[];
  onProgress?: (completed: number, total: number) => void;
};

/** Page: 4 inch x 11.5 inch portrait, in mm. */
const PAGE_W = 101.6;
const PAGE_H = 292.1;

const DARK_GREEN = "#0B7A4E";
const MID_GREEN = "#12A86C";
const QR_GREEN = "#007A52";
const MINT = "#E3F5EC";
const WATERMARK = "#E8F6EF";
const INK = "#111111";
const WHITE = "#FFFFFF";
const PANEL_LINE = "#E3EBE7";
const BLACK = "#000000";
const GREY_WATERMARK = "#F0F0F0";

const QUIET_ZONE_MODULES = 4;
const PAGES_PER_CHUNK = 5;

type Ink = {
  dark: string;
  mid: string;
  qr: string;
  tint: string;
  watermark: string;
  number: string;
  line: string;
  barText: string;
};

function palette(colour: SealLabelColour): Ink {
  if (colour === "black") {
    return {
      dark: BLACK,
      mid: BLACK,
      qr: BLACK,
      tint: "#EFEFEF",
      watermark: GREY_WATERMARK,
      number: BLACK,
      line: "#DDDDDD",
      barText: WHITE,
    };
  }
  return {
    dark: DARK_GREEN,
    mid: MID_GREEN,
    qr: QR_GREEN,
    tint: MINT,
    watermark: WATERMARK,
    number: INK,
    line: PANEL_LINE,
    barText: WHITE,
  };
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load the Badiyos artwork"));
    image.src = src;
  });
}

/**
 * Returns a PNG data URL.
 * black = "ink": every visible pixel becomes black (flat artwork such as the wordmark).
 * black = "knockout": only the light pixels become black (the "b" inside the icon tile).
 */
async function artworkDataUrl(src: string, black: false | "ink" | "knockout", maxWidth = 900) {
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, maxWidth / Math.max(1, image.naturalWidth));
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  const context = canvas.getContext("2d", { willReadFrequently: !!black });
  if (!context) throw new Error("Could not prepare the Badiyos artwork");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  if (black) {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const luminance =
        pixels.data[index]! * 0.2126 + pixels.data[index + 1]! * 0.7152 + pixels.data[index + 2]! * 0.0722;
      const keep = pixels.data[index + 3]! > 8 && (black === "ink" || luminance > 170);
      if (keep) {
        pixels.data[index] = 0;
        pixels.data[index + 1] = 0;
        pixels.data[index + 2] = 0;
        pixels.data[index + 3] = 255;
      } else {
        pixels.data[index + 3] = 0;
      }
    }
    context.putImageData(pixels, 0, 0);
  }
  return { url: canvas.toDataURL("image/png"), ratio: canvas.width / Math.max(1, canvas.height) };
}

type Pdf = import("jspdf").jsPDF;

function fittedFontSize(pdf: Pdf, text: string, maxWidth: number, start: number, min: number) {
  let fontSize = start;
  while (fontSize > min) {
    pdf.setFontSize(fontSize);
    if (pdf.getTextWidth(text) <= maxWidth) return fontSize;
    fontSize -= 0.25;
  }
  return min;
}

/** Centred text with extra letter spacing (used for "HOME SERVICES" style lines). */
function trackedText(pdf: Pdf, text: string, cx: number, y: number, tracking: number) {
  const chars = [...text];
  const widths = chars.map((c) => pdf.getTextWidth(c));
  const total = widths.reduce((sum, w) => sum + w, 0) + tracking * (chars.length - 1);
  let x = cx - total / 2;
  chars.forEach((char, index) => {
    pdf.text(char, x, y, { baseline: "middle" });
    x += widths[index]! + tracking;
  });
}

function drawVectorQr(pdf: Pdf, payload: string, x: number, y: number, width: number, colour: string) {
  const qr = QRCode.create(payload, { errorCorrectionLevel: "H" });
  const moduleCount = qr.modules.size;
  const totalModules = moduleCount + QUIET_ZONE_MODULES * 2;
  const moduleSize = width / totalModules;
  pdf.setFillColor(colour);
  for (let row = 0; row < moduleCount; row += 1) {
    for (let column = 0; column < moduleCount; column += 1) {
      if (qr.modules.get(row, column)) {
        pdf.rect(
          x + (column + QUIET_ZONE_MODULES) * moduleSize,
          y + (row + QUIET_ZONE_MODULES) * moduleSize,
          moduleSize + 0.02,
          moduleSize + 0.02,
          "F",
        );
      }
    }
  }
}

function shield(pdf: Pdf, cx: number, top: number, w: number, h: number, colour: string) {
  pdf.setDrawColor(colour);
  pdf.setLineWidth(0.45);
  pdf.lines(
    [
      [w, 0],
      [0, h * 0.42],
      [-w * 0.02, h * 0.24, -w * 0.2, h * 0.42, -w * 0.5, h * 0.58],
      [-w * 0.3, -h * 0.16, -w * 0.48, -h * 0.34, -w * 0.5, -h * 0.58],
    ],
    cx - w / 2,
    top,
    [1, 1],
    "S",
    true,
  );
}

function tick(pdf: Pdf, cx: number, cy: number, size: number, colour: string) {
  pdf.setDrawColor(colour);
  pdf.setLineWidth(size * 0.16);
  pdf.setLineCap("round");
  pdf.setLineJoin("round");
  pdf.lines([[size * 0.32, size * 0.34], [size * 0.62, -size * 0.7]], cx - size * 0.36, cy, [1, 1], "S");
  pdf.setLineCap("butt");
}

function lock(pdf: Pdf, cx: number, top: number, w: number, h: number, colour: string) {
  const bodyH = h * 0.58;
  const bodyY = top + h - bodyH;
  const shackleW = w * 0.56;
  pdf.setDrawColor(colour);
  pdf.setLineWidth(0.45);
  pdf.ellipse(cx, bodyY + 0.2, shackleW / 2, h * 0.3, "S");
  pdf.setFillColor(WHITE);
  pdf.rect(cx - w / 2, bodyY, w, bodyH + 0.2, "F");
  pdf.roundedRect(cx - w / 2, bodyY, w, bodyH, w * 0.18, w * 0.18, "S");
  pdf.setFillColor(colour);
  pdf.circle(cx, bodyY + bodyH * 0.42, w * 0.09, "F");
  pdf.setLineWidth(w * 0.09);
  pdf.line(cx, bodyY + bodyH * 0.42, cx, bodyY + bodyH * 0.72);
}

function rosette(pdf: Pdf, cx: number, cy: number, r: number, colour: string) {
  pdf.setDrawColor(colour);
  pdf.setLineWidth(0.45);
  pdf.circle(cx, cy, r * 0.78, "S");
  pdf.setLineWidth(0.4);
  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2;
    pdf.line(
      cx + Math.cos(angle) * r * 0.82,
      cy + Math.sin(angle) * r * 0.82,
      cx + Math.cos(angle) * r,
      cy + Math.sin(angle) * r,
    );
  }
  tick(pdf, cx, cy, r * 0.95, colour);
}

function warningTriangle(pdf: Pdf, cx: number, top: number, w: number, h: number, colour: string) {
  pdf.setDrawColor(colour);
  pdf.setLineWidth(0.5);
  pdf.setLineJoin("round");
  pdf.lines([[w / 2, h], [-w, 0]], cx, top, [1, 1], "S", true);
  pdf.setLineWidth(0.55);
  pdf.setLineCap("round");
  pdf.line(cx, top + h * 0.42, cx, top + h * 0.7);
  pdf.setFillColor(colour);
  pdf.circle(cx, top + h * 0.82, 0.4, "F");
  pdf.setLineCap("butt");
}

type Box = { x: number; y: number; w: number; h: number };

function watermarkLayer(pdf: Pdf, colour: string, skip: Box[]) {
  const blocked = (x: number, y: number) =>
    skip.some((box) => x > box.x - 16 && x < box.x + box.w + 16 && y > box.y - 6 && y < box.y + box.h + 6);
  pdf.setTextColor(colour);
  pdf.setFont("helvetica", "bold");
  let row = 0;
  for (let y = 8; y < PAGE_H - 4; y += 26) {
    row += 1;
    const offset = row % 2 === 0 ? 26 : 0;
    for (let x = 6 + offset; x < PAGE_W; x += 52) {
      if (!blocked(x, y)) {
        pdf.setFontSize(9);
        pdf.text("badiyos", x, y, { baseline: "middle" });
      }
      const bx = x + 26;
      const by = y + 13;
      if (bx < PAGE_W - 2 && by < PAGE_H - 4 && !blocked(bx, by)) {
        pdf.setFontSize(20);
        pdf.text("b", bx, by, { baseline: "middle" });
      }
    }
  }
}

export function sealPdfFilename(options: Pick<SealPdfOptions, "batchNo" | "from" | "to" | "colour">) {
  return `badiyos-seal-batch-${options.batchNo}-${options.from}-${options.to}-4x11_5in-${options.colour}.pdf`;
}

export async function generateSealStickerPdf(options: SealPdfOptions) {
  const { jsPDF } = await import("jspdf");
  const black = options.colour === "black";
  const ink = palette(options.colour);
  const [logo, mark] = await Promise.all([
    artworkDataUrl(appIcon.url, black ? "knockout" : false, 400),
    artworkDataUrl(wordmark.url, black ? "ink" : false, 900),
  ]);

  const cx = PAGE_W / 2;
  const margin = 3;
  const panelW = PAGE_W - margin * 2;

  const topPanel: Box = { x: margin, y: margin, w: panelW, h: 186 };
  const foldPanel: Box = { x: margin, y: 192, w: panelW, h: 38 };
  const bottomPanel: Box = { x: margin, y: 233, w: panelW, h: PAGE_H - 233 - margin };
  const barH = 19;
  const barY = bottomPanel.y + bottomPanel.h - barH;

  const qrSize = 56;
  const qrX = cx - qrSize / 2;
  const qrY = 76;
  const logoW = qrSize * 0.19;
  const logoBox = logoW + Math.max(0.8, logoW * 0.24) * 2;

  const markW = 58;
  const markH = markW / Math.max(0.2, mark.ratio);
  const markSmallW = 42;
  const markSmallH = markSmallW / Math.max(0.2, mark.ratio);

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: [PAGE_W, PAGE_H], compress: true });

  for (let index = 0; index < options.rows.length; index += 1) {
    const row = options.rows[index];
    if (!row) continue;
    if (index > 0) pdf.addPage([PAGE_W, PAGE_H], "portrait");

    // Panels
    pdf.setFillColor(WHITE);
    pdf.setDrawColor(ink.line);
    pdf.setLineWidth(0.3);
    for (const panel of [topPanel, foldPanel, bottomPanel]) {
      pdf.roundedRect(panel.x, panel.y, panel.w, panel.h, 3, 3, "FD");
    }

    // Faint background pattern (kept clear of the QR and the warning bar)
    watermarkLayer(pdf, ink.watermark, [
      { x: qrX, y: qrY, w: qrSize, h: qrSize },
      { x: 0, y: barY, w: PAGE_W, h: barH },
    ]);

    // ---- Top panel ----
    pdf.addImage(mark.url, "PNG", cx - markW / 2, 10, markW, markH, "seal-wordmark", "FAST");

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(ink.number);
    trackedText(pdf, "HOME SERVICES", cx, 32, 1.9);

    pdf.setFillColor(ink.tint);
    pdf.roundedRect(cx - 26, 36.5, 52, 9, 4.5, 4.5, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(ink.dark);
    trackedText(pdf, "VERIFICATION ID", cx, 41, 1.1);

    const idText = `BDY ${row.printed_text}`;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(fittedFontSize(pdf, idText, panelW - 16, 26, 12));
    pdf.setTextColor(ink.number);
    pdf.text(idText, cx, 55, { align: "center", baseline: "middle" });

    pdf.setDrawColor(ink.dark);
    pdf.setLineWidth(0.9);
    pdf.line(cx - 8, 64, cx + 8, 64);

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10.5);
    pdf.setTextColor(ink.dark);
    trackedText(pdf, "SCAN TO VERIFY", cx, 71, 0.6);
    pdf.setLineWidth(0.5);
    pdf.setLineCap("round");
    for (const dir of [-1, 1]) {
      const bx = cx + dir * 34;
      pdf.line(bx, 68.4, bx + dir * 2.4, 67.6);
      pdf.line(bx + dir * 0.4, 71, bx + dir * 3, 71);
      pdf.line(bx, 73.6, bx + dir * 2.4, 74.4);
    }
    pdf.setLineCap("butt");

    drawVectorQr(pdf, row.qr_payload, qrX, qrY, qrSize, ink.qr);
    pdf.setFillColor(WHITE);
    pdf.roundedRect(cx - logoBox / 2, qrY + qrSize / 2 - logoBox / 2, logoBox, logoBox, 1.1, 1.1, "F");
    pdf.addImage(logo.url, "PNG", cx - logoW / 2, qrY + qrSize / 2 - logoW / 2, logoW, logoW, "seal-icon", "FAST");

    const packY = qrY + qrSize + 6;
    pdf.setFillColor(ink.tint);
    pdf.roundedRect(cx - 32, packY, 64, 12, 6, 6, "F");
    shield(pdf, cx - 22, packY + 2.4, 6.2, 7.6, ink.dark);
    tick(pdf, cx - 22, packY + 6, 3.4, ink.dark);
    pdf.setDrawColor(ink.dark);
    pdf.setLineWidth(0.3);
    pdf.line(cx - 16, packY + 3, cx - 16, packY + 9);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.setTextColor(ink.dark);
    trackedText(pdf, "PACK VERIFIED", cx - 16 + (32 + 16) / 2, packY + 6, 0.35);

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9.5);
    pdf.setTextColor(ink.number);
    pdf.text("This seal confirms that your package", cx, packY + 21, { align: "center", baseline: "middle" });
    pdf.text("has been verified by Badiyos.", cx, packY + 26.5, { align: "center", baseline: "middle" });

    const badgeY = packY + 31;
    const badgeCols = [cx - 30, cx, cx + 30];
    shield(pdf, badgeCols[0]!, badgeY, 7.6, 9, ink.dark);
    tick(pdf, badgeCols[0]!, badgeY + 4.2, 4, ink.dark);
    lock(pdf, badgeCols[1]!, badgeY, 7.2, 9, ink.dark);
    rosette(pdf, badgeCols[2]!, badgeY + 4.6, 4.6, ink.dark);
    pdf.setDrawColor(ink.line);
    pdf.setLineWidth(0.3);
    pdf.line(cx - 15, badgeY, cx - 15, badgeY + 15);
    pdf.line(cx + 15, badgeY, cx + 15, badgeY + 15);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(ink.number);
    ["VERIFIED", "SECURE", "AUTHENTIC"].forEach((label, i) => {
      trackedText(pdf, label, badgeCols[i]!, badgeY + 14, 0.25);
    });

    // ---- Fold panel ----
    pdf.setDrawColor(ink.dark);
    pdf.setLineWidth(0.35);
    pdf.setLineDashPattern([1.3, 1.3], 0);
    pdf.line(12, foldPanel.y + 3, 12, foldPanel.y + foldPanel.h - 3);
    pdf.line(PAGE_W - 12, foldPanel.y + 3, PAGE_W - 12, foldPanel.y + foldPanel.h - 3);
    pdf.setLineDashPattern([], 0);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.5);
    pdf.setTextColor(ink.dark);
    const foldMid = foldPanel.y + foldPanel.h / 2;
    pdf.text("FOLD HERE", 9.6, foldMid, { align: "center", baseline: "middle", angle: 90 });
    pdf.text("FOLD HERE", PAGE_W - 8.2, foldMid, { align: "center", baseline: "middle", angle: 90 });
    pdf.setFontSize(7);
    for (const x of [8.2, PAGE_W - 8.4]) {
      pdf.setFillColor(ink.dark);
      pdf.triangle(x, foldMid - 15, x - 1.5, foldMid - 12.4, x + 1.5, foldMid - 12.4, "F");
      pdf.triangle(x, foldMid + 15, x - 1.5, foldMid + 12.4, x + 1.5, foldMid + 12.4, "F");
    }

    // ---- Bottom panel ----
    pdf.addImage(mark.url, "PNG", cx - markSmallW / 2, bottomPanel.y + 3, markSmallW, markSmallH, "seal-wordmark", "FAST");
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(ink.number);
    trackedText(pdf, "HOME SERVICES", cx, bottomPanel.y + 3 + markSmallH + 3.2, 1.7);

    const bBadgeY = bottomPanel.y + 3 + markSmallH + 6.5;
    shield(pdf, badgeCols[0]!, bBadgeY, 6.4, 7.6, ink.dark);
    tick(pdf, badgeCols[0]!, bBadgeY + 3.6, 3.4, ink.dark);
    lock(pdf, badgeCols[1]!, bBadgeY, 6, 7.6, ink.dark);
    rosette(pdf, badgeCols[2]!, bBadgeY + 3.9, 3.9, ink.dark);
    pdf.setDrawColor(ink.line);
    pdf.setLineWidth(0.3);
    pdf.line(cx - 15, bBadgeY, cx - 15, bBadgeY + 12.5);
    pdf.line(cx + 15, bBadgeY, cx + 15, bBadgeY + 12.5);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.5);
    pdf.setTextColor(ink.number);
    ["VERIFIED", "SECURE", "AUTHENTIC"].forEach((label, i) => {
      trackedText(pdf, label, badgeCols[i]!, bBadgeY + 11.6, 0.2);
    });

    // Tamper warning bar
    pdf.setFillColor(ink.dark);
    pdf.roundedRect(bottomPanel.x, barY, bottomPanel.w, barH, 3, 3, "F");
    pdf.rect(bottomPanel.x, barY, bottomPanel.w, barH - 4, "F");
    warningTriangle(pdf, bottomPanel.x + 12, barY + 4.2, 11, 9.6, ink.barText);
    pdf.setDrawColor(ink.barText);
    pdf.setLineWidth(0.3);
    pdf.line(bottomPanel.x + 20, barY + 4, bottomPanel.x + 20, barY + 14);
    const barCx = (bottomPanel.x + 20 + bottomPanel.x + bottomPanel.w) / 2;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.6);
    pdf.setTextColor(ink.barText);
    pdf.text("DO NOT ACCEPT IF SEAL IS TORN,", barCx, barY + 6.4, { align: "center", baseline: "middle" });
    pdf.text("DAMAGED OR TAMPERED WITH.", barCx, barY + 10.4, { align: "center", baseline: "middle" });
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(6.2);
    pdf.text("In case of any issue, contact Badiyos Support.", barCx, barY + 14.6, { align: "center", baseline: "middle" });

    options.onProgress?.(index + 1, options.rows.length);
    if ((index + 1) % PAGES_PER_CHUNK === 0) await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }

  return pdf.output("blob");
}
