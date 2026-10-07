// Browser-only: prepares a catalog photo for upload. HEIC/HEIF and other
// formats are re-encoded to JPEG, and a 400px WebP thumbnail is generated
// so every upload ships with its thumbnail.
export type PreparedCatalogImage = {
  base64: string;
  contentType: string;
  thumbBase64: string;
  preview: string;
};

const KEEP = new Set(["image/jpeg", "image/png", "image/webp"]);

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This photo format can't be read here. Please use a JPG or PNG photo."));
    };
    img.src = url;
  });
}

function draw(img: HTMLImageElement, max: number, type: string, quality: number) {
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = c.getContext("2d")!;
  if (type === "image/jpeg") {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
  }
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL(type, quality);
}

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error("Could not read file"));
    r.readAsDataURL(file);
  });
}

export async function prepareCatalogImage(file: File): Promise<PreparedCatalogImage> {
  const img = await loadImage(file);
  const type = (file.type || "").toLowerCase();
  let main: string;
  let contentType: string;
  if (KEEP.has(type)) {
    main = await fileToDataUrl(file);
    contentType = type;
  } else {
    main = draw(img, 2000, "image/jpeg", 0.88);
    contentType = "image/jpeg";
  }
  const thumb = draw(img, 400, "image/webp", 0.75);
  if (!thumb.startsWith("data:image/webp")) throw new Error("Could not create thumbnail");
  URL.revokeObjectURL(img.src);
  return {
    base64: main.split(",")[1] ?? "",
    contentType,
    thumbBase64: thumb.split(",")[1] ?? "",
    preview: main,
  };
}
