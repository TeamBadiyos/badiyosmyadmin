import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ImagePlus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { type MerchantProduct, updateMerchantProduct } from "@/lib/merchants.functions";

type PhotoState =
  | { kind: "keep"; url: string | null }
  | { kind: "new"; preview: string; base64: string; contentType: string }
  | { kind: "remove" };

function readFile(file: File): Promise<{ base64: string; preview: string }> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      resolve({ base64: s.split(",")[1] ?? "", preview: s });
    };
    r.onerror = () => reject(new Error("Could not read file"));
    r.readAsDataURL(file);
  });
}

const input = "w-full h-10 px-3 rounded-[12px] border border-border bg-background text-[13px]";
const label = "text-[12px] font-semibold text-muted-foreground mb-1 block";

export function ProductEditDialog({
  product,
  onClose,
  onSaved,
}: {
  product: MerchantProduct;
  onClose: () => void;
  onSaved: () => void;
}) {
  const save = useServerFn(updateMerchantProduct);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    name: product.name,
    description: product.description ?? "",
    categoryLabel: product.categoryLabel ?? "",
    price: String(product.price),
    unit: product.unit ?? "",
    stockQuantity: String(product.stockQuantity),
    lowStockThreshold: String(product.lowStockThreshold),
    hsnSacCode: product.hsnSacCode ?? "",
    gstRate: String(product.gstRate),
    isActive: product.isActive,
  });
  const [photos, setPhotos] = useState<PhotoState[]>([
    { kind: "keep", url: product.imageUrl },
    { kind: "keep", url: product.imageUrl2 },
  ]);
  const set = (k: keyof typeof f, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));

  const pick = async (i: number, file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Only image files");
    if (file.size > 5 * 1024 * 1024) return toast.error("Photo must be under 5 MB");
    const { base64, preview } = await readFile(file);
    setPhotos((p) => p.map((x, j) => (j === i ? { kind: "new", preview, base64, contentType: file.type } : x)));
  };

  const payloadFor = (p: PhotoState) =>
    p.kind === "keep" ? undefined : p.kind === "remove" ? null : { base64: p.base64, contentType: p.contentType };

  const submit = async () => {
    setBusy(true);
    try {
      await save({
        data: {
          productId: product.id,
          name: f.name,
          description: f.description,
          categoryLabel: f.categoryLabel,
          price: Number(f.price),
          unit: f.unit,
          stockQuantity: Number(f.stockQuantity),
          lowStockThreshold: Number(f.lowStockThreshold),
          hsnSacCode: f.hsnSacCode,
          gstRate: Number(f.gstRate),
          isActive: f.isActive,
          photo1: payloadFor(photos[0]),
          photo2: payloadFor(photos[1]),
        },
      });
      toast.success("Item updated");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 grid place-items-center p-3 sm:p-6">
      <div className="w-full max-w-[560px] max-h-[92dvh] rounded-[18px] bg-card border border-border flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <p className="text-[16px] font-bold">Edit item</p>
          <button onClick={onClose} className="h-9 w-9 rounded-[12px] border border-border grid place-items-center" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-3">
          <div>
            <span className={label}>Photos (up to 2)</span>
            <div className="flex gap-3">
              {photos.map((p, i) => {
                const src = p.kind === "keep" ? p.url : p.kind === "new" ? p.preview : null;
                return (
                  <div key={i} className="flex flex-col items-center gap-1">
                    <label className="h-24 w-24 rounded-[14px] border border-dashed border-border bg-muted overflow-hidden grid place-items-center cursor-pointer text-muted-foreground">
                      {src ? <img src={src} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" /> : <ImagePlus size={20} />}
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => pick(i, e.target.files?.[0])} />
                    </label>
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      Photo {i + 1}
                      {src && (
                        <button type="button" onClick={() => setPhotos((ps) => ps.map((x, j) => (j === i ? { kind: "remove" } : x)))} aria-label="Remove photo" className="text-destructive">
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <span className={label}>Name</span>
            <input className={input} value={f.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div>
            <span className={label}>Description</span>
            <textarea className={`${input} h-20 py-2`} value={f.description} onChange={(e) => set("description", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><span className={label}>Category</span><input className={input} value={f.categoryLabel} onChange={(e) => set("categoryLabel", e.target.value)} /></div>
            <div><span className={label}>Unit</span><input className={input} value={f.unit} onChange={(e) => set("unit", e.target.value)} placeholder="piece, kg, pack" /></div>
            <div><span className={label}>Price (₹)</span><input type="number" min={0} className={input} value={f.price} onChange={(e) => set("price", e.target.value)} /></div>
            <div><span className={label}>Stock</span><input type="number" min={0} className={input} value={f.stockQuantity} onChange={(e) => set("stockQuantity", e.target.value)} /></div>
            <div><span className={label}>Low stock alert at</span><input type="number" min={0} className={input} value={f.lowStockThreshold} onChange={(e) => set("lowStockThreshold", e.target.value)} /></div>
            <div><span className={label}>GST %</span><input type="number" min={0} className={input} value={f.gstRate} onChange={(e) => set("gstRate", e.target.value)} /></div>
            <div className="col-span-2"><span className={label}>HSN / SAC code</span><input className={input} value={f.hsnSacCode} onChange={(e) => set("hsnSacCode", e.target.value)} /></div>
          </div>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={f.isActive} onChange={(e) => set("isActive", e.target.checked)} />
            Active (visible in store)
          </label>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button onClick={onClose} className="h-10 px-4 rounded-[12px] border border-border text-[13px] font-semibold">Cancel</button>
          <button disabled={busy} onClick={submit} className="h-10 px-4 rounded-[12px] bg-primary text-primary-foreground text-[13px] font-bold disabled:opacity-50">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
