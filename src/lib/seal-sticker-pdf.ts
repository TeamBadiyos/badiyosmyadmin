import QRCode from "qrcode";
import appIcon from "@/assets/badiyos-app-icon.png.asset.json";

export type SealExportRow = {
  serial: number;
  code: string;
  qr_payload: string;
  printed_text: string;
};

export type SealLabelSize = "25x50" | "38x50";
export type SealLabelColour = "green" | "black";

export type SealPdfOptions = {
  batchNo: number;
  from: number;
  to: number;
  size: SealLabelSize;
  colour: SealLabelColour;
  rows: SealExportRow[];
  onProgress?: (completed: number, total: number) => void;
};

const QR_GREEN = "#007A52";
const BRAND_GREEN = "#0CB37B";
const NUMBER_INK = "#111111";
const BLACK = "#000000";
const QUIET_ZONE_MODULES = 4;
const PAGES_PER_CHUNK = 20;

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load the Badiyos app icon"));
    image.src = src;
  });
}

async function iconDataUrl(black: boolean) {
  const image = await loadImage(appIcon.url);
  const canvas = document.createElement("canvas");
  const size = Math.max(image.naturalWidth, image.naturalHeight);
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: black });
  if (!context) throw new Error("Could not prepare the Badiyos app icon");
  context.clearRect(0, 0, size, size);
  context.drawImage(image, (size - image.naturalWidth) / 2, (size - image.naturalHeight) / 2);
  if (black) {
    const pixels = context.getImageData(0, 0, size, size);
    for (let index = 0; index < pixels.data.length; index += 4) {
      if (pixels.data[index + 3] > 8) {
        pixels.data[index] = 0;
        pixels.data[index + 1] = 0;
        pixels.data[index + 2] = 0;
      }
    }
    context.putImageData(pixels, 0, 0);
  }
  return canvas.toDataURL("image/png");
}

function fittedFontSize(pdf: import("jspdf").jsPDF, text: string, maxWidth: number) {
  let fontSize = 9;
  while (fontSize > 4.5) {
    pdf.setFontSize(fontSize);
    if (pdf.getTextWidth(text) <= maxWidth) return fontSize;
    fontSize -= 0.25;
  }
  return 4.5;
}

function drawVectorQr(
  pdf: import("jspdf").jsPDF,
  payload: string,
  x: number,
  y: number,
  width: number,
  colour: string,
) {
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
          moduleSize + 0.015,
          moduleSize + 0.015,
          "F",
        );
      }
    }
  }
}

function nextFrame() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

export function sealPdfFilename(options: Pick<SealPdfOptions, "batchNo" | "from" | "to" | "size" | "colour">) {
  return `badiyos-seal-batch-${options.batchNo}-${options.from}-${options.to}-${options.size}-${options.colour}.pdf`;
}

export async function generateSealStickerPdf(options: SealPdfOptions) {
  const { jsPDF } = await import("jspdf");
  const pageWidth = options.size === "25x50" ? 25 : 38;
  const pageHeight = 50;
  const qrWidth = pageWidth - 3;
  const qrX = 1.5;
  const qrY = pageHeight - qrWidth - 1.5;
  const logoWidth = qrWidth * 0.2;
  const logoPad = Math.max(0.55, logoWidth * 0.13);
  const logoBox = logoWidth + logoPad * 2;
  const logoX = (pageWidth - logoWidth) / 2;
  const logoY = qrY + (qrWidth - logoWidth) / 2;
  const logoBoxX = (pageWidth - logoBox) / 2;
  const logoBoxY = qrY + (qrWidth - logoBox) / 2;
  const logo = await iconDataUrl(options.colour === "black");
  const qrColour = options.colour === "green" ? QR_GREEN : BLACK;
  const brandColour = options.colour === "green" ? BRAND_GREEN : BLACK;
  const numberColour = options.colour === "green" ? NUMBER_INK : BLACK;
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: [pageWidth, pageHeight], compress: true });

  for (let index = 0; index < options.rows.length; index += 1) {
    const row = options.rows[index];
    if (!row) continue;
    if (index > 0) pdf.addPage([pageWidth, pageHeight], "portrait");

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(5.5);
    pdf.setTextColor(brandColour);
    pdf.text("badiyos", pageWidth / 2, 3.6, { align: "center", baseline: "middle" });

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(fittedFontSize(pdf, row.printed_text, pageWidth - 3));
    pdf.setTextColor(numberColour);
    pdf.text(row.printed_text, pageWidth / 2, 8.2, { align: "center", baseline: "middle" });

    drawVectorQr(pdf, row.qr_payload, qrX, qrY, qrWidth, qrColour);
    pdf.setFillColor("#FFFFFF");
    pdf.roundedRect(logoBoxX, logoBoxY, logoBox, logoBox, 0.8, 0.8, "F");
    pdf.addImage(logo, "PNG", logoX, logoY, logoWidth, logoWidth, "badiyos-seal-logo", "FAST");

    options.onProgress?.(index + 1, options.rows.length);
    if ((index + 1) % PAGES_PER_CHUNK === 0) await nextFrame();
  }

  return pdf.output("blob");
}