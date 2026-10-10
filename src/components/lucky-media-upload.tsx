import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { uploadLuckyMedia } from "@/lib/lucky-draw.functions";

const TYPES = ["image/jpeg", "image/png", "image/webp"];

export function LuckyMediaUpload({
  label,
  kind,
  value,
  onChange,
}: {
  label: string;
  kind: "banner" | "prize";
  value: string;
  onChange: (url: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const upload = useServerFn(uploadLuckyMedia);

  const pick = async (file?: File) => {
    if (!file) return;
    if (!TYPES.includes(file.type)) return toast.error("Only JPG, PNG or WebP allowed");
    if (file.size > 2 * 1024 * 1024) return toast.error("Max 2 MB allowed");
    setBusy(true);
    try {
      const base64 = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(",")[1] ?? "");
        r.onerror = () => rej(r.error);
        r.readAsDataURL(file);
      });
      const { url } = await upload({ data: { kind, contentType: file.type, base64 } });
      onChange(url);
      toast.success("Photo uploaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-3">
        {value ? (
          <img src={value} alt="" className={kind === "banner" ? "h-16 w-28 rounded object-cover" : "h-16 w-16 rounded object-cover"} />
        ) : (
          <div className={kind === "banner" ? "h-16 w-28 rounded bg-muted" : "h-16 w-16 rounded bg-muted"} />
        )}
        <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => ref.current?.click()}>
          <Upload className="mr-1 h-3.5 w-3.5" /> {busy ? "Uploading…" : "Upload"}
        </Button>
        {value && (
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange("")}>
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">JPG/PNG/WebP, max 2 MB. Or paste a URL:</p>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://… (optional)" />
    </div>
  );
}
