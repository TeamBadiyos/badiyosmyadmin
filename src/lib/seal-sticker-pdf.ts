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
type Box = { x: number; y: number; w: number; h: number };

/**
 * Drawing frame. The back panel of the seal is printed upside down so it reads
 * correctly once the strip is folded over the packet, so everything there is
 * drawn through a 180 degree frame.
 */
type Frame = { px: (x: number) => number; py: (y: number) => number; s: 1 | -1 };

const UPRIGHT: Frame = { px: (x) => x, py: (y) => y, s: 1 };

function flipped(box: Box): Frame {
  return {
    px: (x) => 2 * box.x + box.w - x,
    py: (y) => 2 * box.y + box.h - y,
    s: -1,
  };
}

function frect(f: Frame, x: number, y: number, w: number, h: number): [number, number, number, number] {
  return f.s === 1 ? [x, y, w, h] : [f.px(x + w), f.py(y + h), w, h];
}

function fdeltas(f: Frame, segments: number[][]) {
  return f.s === 1 ? segments : segments.map((segment) => segment.map((value) => -value));
}

function fline(pdf: Pdf, f: Frame, x1: number, y1: number, x2: number, y2: number) {
  pdf.line(f.px(x1), f.py(y1), f.px(x2), f.py(y2));
}

function fittedFontSize(pdf: Pdf, text: string, maxWidth: number, start: number, min: number) {
  let fontSize = start;
  while (fontSize > min) {
    pdf.setFontSize(fontSize);
    if (pdf.getTextWidth(text) <= maxWidth) return fontSize;
    fontSize -= 0.25;
  }
  return min;
}

/** Centred (or left aligned) text drawn through a frame. */
function ftext(pdf: Pdf, f: Frame, text: string, x: number, y: number, align: "center" | "left" = "center") {
  const width = pdf.getTextWidth(text);
  const startX = align === "center" ? x - width / 2 : x;
  if (f.s === 1) {
    pdf.text(text, startX, y, { baseline: "middle" });
  } else {
    void width;
    pdf.text(text, f.px(startX), f.py(y), { baseline: "middle", angle: 180 });
  }
}

/** Centred text with extra letter spacing (used for "HOME SERVICES" style lines). */
function trackedText(pdf: Pdf, text: string, cx: number, y: number, tracking: number, f: Frame = UPRIGHT) {
  const chars = [...text];
  const widths = chars.map((c) => pdf.getTextWidth(c));
  const total = widths.reduce((sum, w) => sum + w, 0) + tracking * (chars.length - 1);
  let x = cx - total / 2;
  chars.forEach((char, index) => {
    ftext(pdf, f, char, x, y, "left");
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

function shield(pdf: Pdf, cx: number, top: number, w: number, h: number, colour: string, f: Frame = UPRIGHT) {
  pdf.setDrawColor(colour);
  pdf.setLineWidth(0.45);
  pdf.lines(
    fdeltas(f, [
      [w, 0],
      [0, h * 0.42],
      [-w * 0.02, h * 0.24, -w * 0.2, h * 0.42, -w * 0.5, h * 0.58],
      [-w * 0.3, -h * 0.16, -w * 0.48, -h * 0.34, -w * 0.5, -h * 0.58],
    ]),
    f.px(cx - w / 2),
    f.py(top),
    [1, 1],
    "S",
    true,
  );
}

function tick(pdf: Pdf, cx: number, cy: number, size: number, colour: string, f: Frame = UPRIGHT) {
  pdf.setDrawColor(colour);
  pdf.setLineWidth(size * 0.16);
  pdf.setLineCap("round");
  pdf.setLineJoin("round");
  pdf.lines(
    fdeltas(f, [
      [size * 0.32, size * 0.34],
      [size * 0.62, -size * 0.7],
    ]),
    f.px(cx - size * 0.36),
    f.py(cy),
    [1, 1],
    "S",
  );
  pdf.setLineCap("butt");
}

function lock(pdf: Pdf, cx: number, top: number, w: number, h: number, colour: string, f: Frame = UPRIGHT) {
  const bodyH = h * 0.58;
  const bodyY = top + h - bodyH;
  const shackleW = w * 0.56;
  pdf.setDrawColor(colour);
  pdf.setLineWidth(0.45);
  pdf.ellipse(f.px(cx), f.py(bodyY + 0.2), shackleW / 2, h * 0.3, "S");
  pdf.setFillColor(WHITE);
  pdf.rect(...frect(f, cx - w / 2, bodyY, w, bodyH + 0.2), "F");
  pdf.roundedRect(...frect(f, cx - w / 2, bodyY, w, bodyH), w * 0.18, w * 0.18, "S");
  pdf.setFillColor(colour);
  pdf.circle(f.px(cx), f.py(bodyY + bodyH * 0.42), w * 0.09, "F");
  pdf.setLineWidth(w * 0.09);
  fline(pdf, f, cx, bodyY + bodyH * 0.42, cx, bodyY + bodyH * 0.72);
}

function rosette(pdf: Pdf, cx: number, cy: number, r: number, colour: string, f: Frame = UPRIGHT) {
  pdf.setDrawColor(colour);
  pdf.setLineWidth(0.45);
  pdf.circle(f.px(cx), f.py(cy), r * 0.78, "S");
  pdf.setLineWidth(0.4);
  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2;
    fline(
      pdf,
      f,
      cx + Math.cos(angle) * r * 0.82,
      cy + Math.sin(angle) * r * 0.82,
      cx + Math.cos(angle) * r,
      cy + Math.sin(angle) * r,
    );
  }
  tick(pdf, cx, cy, r * 0.95, colour, f);
}

function warningTriangle(pdf: Pdf, cx: number, top: number, w: number, h: number, colour: string, f: Frame = UPRIGHT) {
  pdf.setDrawColor(colour);
  pdf.setLineWidth(0.5);
  pdf.setLineJoin("round");
  pdf.lines(
    fdeltas(f, [
      [w / 2, h],
      [-w, 0],
    ]),
    f.px(cx),
    f.py(top),
    [1, 1],
    "S",
    true,
  );
  pdf.setLineWidth(0.55);
  pdf.setLineCap("round");
  fline(pdf, f, cx, top + h * 0.42, cx, top + h * 0.7);
  pdf.setFillColor(colour);
  pdf.circle(f.px(cx), f.py(top + h * 0.82), 0.4, "F");
  pdf.setLineCap("butt");
}

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

/** "BDY 000004-2" — never doubles the prefix when the backend already sends it. */
function sealIdText(printedText: string) {
  const raw = String(printedText ?? "").trim();
  const stripped = raw.replace(/^bdy[\s-]*/i, "");
  return `BDY ${stripped}`.replace(/\s+/g, " ").trim();
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

  // Top of the page = back of the pack: printed upside down so it reads
  // correctly once the strip folds over the packet.
  const backPanel: Box = { x: margin, y: margin, w: panelW, h: 58 };
  const foldPanel: Box = { x: margin, y: 64, w: panelW, h: 44 };
  const frontPanel: Box = { x: margin, y: 112, w: panelW, h: PAGE_H - 112 - margin };
  const back = flipped(backPanel);

  const barH = 18;
  const barY = backPanel.y + backPanel.h - barH;
  const barGlobal: Box = { x: 0, y: backPanel.y, w: PAGE_W, h: barH + 2 };

  const qrSize = 52;
  const qrX = cx - qrSize / 2;
  const qrY = 180;
  const logoW = qrSize * 0.155;
  const logoBox = logoW + Math.max(0.7, logoW * 0.2) * 2;

  const markW = 54;
  const markH = markW / Math.max(0.2, mark.ratio);
  const markSmallW = 40;
  const markSmallH = markSmallW / Math.max(0.2, mark.ratio);

  const badgeCols = [cx - 30, cx, cx + 30];

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: [PAGE_W, PAGE_H], compress: true });

  for (let index = 0; index < options.rows.length; index += 1) {
    const row = options.rows[index];
    if (!row) continue;
    if (index > 0) pdf.addPage([PAGE_W, PAGE_H], "portrait");

    // Panels
    pdf.setFillColor(WHITE);
    pdf.setDrawColor(ink.line);
    pdf.setLineWidth(0.3);
    for (const panel of [backPanel, foldPanel, frontPanel]) {
      pdf.roundedRect(panel.x, panel.y, panel.w, panel.h, 3, 3, "FD");
    }

    // Faint background pattern (kept clear of the QR and the warning bar)
    watermarkLayer(pdf, ink.watermark, [{ x: qrX, y: qrY, w: qrSize, h: qrSize }, barGlobal]);

    // ---- Back panel (upside down) ----
    pdf.addImage(
      mark.url,
      "PNG",
      back.px(cx - markSmallW / 2),
      back.py(backPanel.y + 5),
      markSmallW,
      markSmallH,
      "seal-wordmark",
      "FAST",
      back.s === 1 ? 0 : 180,
    );

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(ink.number);
    const backServicesY = backPanel.y + 5 + markSmallH + 3.4;
    trackedText(pdf, "HOME SERVICES", cx, backServicesY, 1.7, back);

    const backBadgeY = backServicesY + 3.6;
    shield(pdf, badgeCols[0]!, backBadgeY, 6.4, 7.6, ink.dark, back);
    tick(pdf, badgeCols[0]!, backBadgeY + 3.6, 3.4, ink.dark, back);
    lock(pdf, badgeCols[1]!, backBadgeY, 6, 7.6, ink.dark, back);
    rosette(pdf, badgeCols[2]!, backBadgeY + 3.9, 3.9, ink.dark, back);
    pdf.setDrawColor(ink.line);
    pdf.setLineWidth(0.3);
    fline(pdf, back, cx - 15, backBadgeY, cx - 15, backBadgeY + 12.5);
    fline(pdf, back, cx + 15, backBadgeY, cx + 15, backBadgeY + 12.5);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.5);
    pdf.setTextColor(ink.number);
    ["VERIFIED", "SECURE", "AUTHENTIC"].forEach((label, i) => {
      trackedText(pdf, label, badgeCols[i]!, backBadgeY + 11.6, 0.2, back);
    });

    // Tamper warning bar (sits at the very top edge of the page once flipped)
    pdf.setFillColor(ink.dark);
    pdf.roundedRect(...frect(back, backPanel.x, barY, backPanel.w, barH), 3, 3, "F");
    pdf.rect(...frect(back, backPanel.x, barY + 4, backPanel.w, barH - 4), "F");
    warningTriangle(pdf, backPanel.x + 12, barY + 4.2, 11, 9.6, ink.barText, back);
    pdf.setDrawColor(ink.barText);
    pdf.setLineWidth(0.3);
    fline(pdf, back, backPanel.x + 20, barY + 4, backPanel.x + 20, barY + 14);
    const barCx = (backPanel.x + 20 + backPanel.x + backPanel.w) / 2;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.6);
    pdf.setTextColor(ink.barText);
    ftext(pdf, back, "DO NOT ACCEPT IF SEAL IS TORN,", barCx, barY + 6.4);
    ftext(pdf, back, "DAMAGED OR TAMPERED WITH.", barCx, barY + 10.4);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(6.2);
    ftext(pdf, back, "In case of any issue, contact Badiyos Support.", barCx, barY + 14.6);

    // ---- Fold panel (blank middle, guides on both sides) ----
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
    pdf.text("FOLD HERE", 10.6, foldMid, { align: "center", baseline: "middle", angle: 90 });
    pdf.text("FOLD HERE", PAGE_W - 9.4, foldMid, { align: "center", baseline: "middle", angle: 90 });
    for (const x of [8.6, PAGE_W - 8.6]) {
      pdf.setFillColor(ink.dark);
      pdf.triangle(x, foldMid - 17, x - 1.5, foldMid - 14.4, x + 1.5, foldMid - 14.4, "F");
      pdf.triangle(x, foldMid + 17, x - 1.5, foldMid + 14.4, x + 1.5, foldMid + 14.4, "F");
    }

    // ---- Front panel ----
    pdf.addImage(mark.url, "PNG", cx - markW / 2, frontPanel.y + 7, markW, markH, "seal-wordmark", "FAST");

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(ink.number);
    trackedText(pdf, "HOME SERVICES", cx, 141, 1.9);

    pdf.setFillColor(ink.tint);
    pdf.roundedRect(cx - 26, 145, 52, 9, 4.5, 4.5, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(ink.dark);
    trackedText(pdf, "VERIFICATION ID", cx, 149.5, 1.1);

    const idText = sealIdText(row.printed_text);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(fittedFontSize(pdf, idText, panelW - 16, 26, 12));
    pdf.setTextColor(ink.number);
    pdf.text(idText, cx, 161, { align: "center", baseline: "middle" });

    pdf.setDrawColor(ink.dark);
    pdf.setLineWidth(0.9);
    pdf.line(cx - 8, 169, cx + 8, 169);

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10.5);
    pdf.setTextColor(ink.dark);
    trackedText(pdf, "SCAN TO VERIFY", cx, 175, 0.6);
    pdf.setLineWidth(0.5);
    pdf.setLineCap("round");
    for (const dir of [-1, 1]) {
      const bx = cx + dir * 34;
      pdf.line(bx, 172.4, bx + dir * 2.4, 171.6);
      pdf.line(bx + dir * 0.4, 175, bx + dir * 3, 175);
      pdf.line(bx, 177.6, bx + dir * 2.4, 178.4);
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
    pdf.setFontSize(9);
    pdf.setTextColor(ink.number);
    pdf.text("This seal confirms that your package", cx, packY + 19, { align: "center", baseline: "middle" });
    pdf.text("has been verified by Badiyos.", cx, packY + 24.5, { align: "center", baseline: "middle" });

    const badgeY = packY + 29;
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

    options.onProgress?.(index + 1, options.rows.length);
    if ((index + 1) % PAGES_PER_CHUNK === 0) await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }

  return pdf.output("blob");
}
