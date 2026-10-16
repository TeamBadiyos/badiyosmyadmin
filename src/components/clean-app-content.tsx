import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useCity } from "@/lib/city-scope";
import { getCleanMedia, resetCleanMedia, saveCleanMedia, uploadCleanMediaImage } from "@/lib/homepage.functions";
import { normalizeCleanMedia, validateCleanMedia, type CleanMedia } from "@/lib/clean-media";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

async function toWebp(file: File, w: number, h: number): Promise<{ b64: string; warn: string | null }> {
  const url = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("This photo can't be read. Use PNG, JPG or WebP."));
    i.src = url;
  });
  URL.revokeObjectURL(url);
  const nw = img.naturalWidth, nh = img.naturalHeight;
  let warn: string | null = null;
  if (nw < w || nh < h) warn = `Picture is ${nw}×${nh}; recommended ${w}×${h}.`;
  else if (Math.abs(nw / nh - w / h) > 0.05) warn = `Picture shape is ${nw}×${nh}; recommended ${w}×${h}.`;
  const scale = Math.min(1, w / nw, h / nh);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(nw * scale));
  c.height = Math.max(1, Math.round(nh * scale));
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height); // transparent background kept
  return { b64: c.toDataURL("image/webp", 0.85), warn };
}

export function CleanAppContent() {
  const { city } = useCity();
  const [target, setTarget] = useState<"city" | "default">("city");
  const cityId = target === "default" ? null : city?.id ?? null;
  const get = useServerFn(getCleanMedia), save = useServerFn(saveCleanMedia), reset = useServerFn(resetCleanMedia), upload = useServerFn(uploadCleanMediaImage);
  const [m, setM] = useState<CleanMedia | null>(null);
  const [isDefault, setIsDefault] = useState(true);
  const [busy, setBusy] = useState(false);
  const [lang, setLang] = useState<"en" | "mr">("en");

  function load(r: Record<string, unknown>) { setM(normalizeCleanMedia(r)); setIsDefault(!!r.is_default); }
  useEffect(() => {
    setM(null);
    get({ data: { cityId } }).then(load).catch((e) => toast.error(e.message));
  }, [cityId, get]);

  async function pick(kind: "maid" | "tile", idx?: number) {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/png,image/jpeg,image/webp";
    inp.onchange = async () => {
      const f = inp.files?.[0]; if (!f) return;
      setBusy(true);
      try {
        const { b64, warn } = kind === "maid" ? await toWebp(f, 600, 750) : await toWebp(f, 500, 500);
        if (warn) toast.warning(warn);
        const { url } = await upload({ data: { cityId, kind, base64: b64 } });
        setM((x) => x && (kind === "maid" ? { ...x, maid_url: url } : { ...x, tiles: x.tiles.map((t, i) => (i === idx ? { ...t, url } : t)) }));
      } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
    };
    inp.click();
  }
  async function onSave() {
    if (!m) return;
    const err = validateCleanMedia(m); if (err) return toast.error(err);
    setBusy(true);
    try { load(await save({ data: { cityId, payload: m } })); toast.success("App content saved"); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  async function onReset() {
    if (!cityId || !confirm("Remove this city's own content and use the default?")) return;
    setBusy(true);
    try { load(await reset({ data: { cityId } })); toast.success("Using default content"); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  const move = (i: number, d: number) => setM((x) => {
    if (!x) return x; const t = [...x.tiles]; const j = i + d; if (j < 0 || j >= t.length) return x;
    [t[i], t[j]] = [t[j], t[i]]; return { ...x, tiles: t };
  });
  const setTile = (i: number, p: Partial<CleanMedia["tiles"][number]>) => setM((x) => x && { ...x, tiles: x.tiles.map((t, k) => (k === i ? { ...t, ...p } : t)) });

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[16px] font-bold text-foreground">App content (old app version)</h2>
        <div className="ml-auto inline-flex rounded-md border border-border p-0.5 text-xs">
          <button onClick={() => setTarget("city")} className={`rounded px-2 py-1 ${target === "city" ? "bg-primary text-primary-foreground" : ""}`}>{city?.name ?? "City"}</button>
          <button onClick={() => setTarget("default")} className={`rounded px-2 py-1 ${target === "default" ? "bg-primary text-primary-foreground" : ""}`}>Default</button>
        </div>
      </div>
      <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
        {target === "default" ? "Editing default (used by cities without their own)."
          : isDefault ? <>{city?.name} uses the default. Saving creates {city?.name}'s own content.</>
          : <>Editing {city?.name}. <button className="font-semibold text-primary underline" disabled={busy} onClick={onReset}>Reset to default</button></>}
      </div>
      {!m ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="text-sm font-semibold">Instant card maid photo</div>
              <p className="text-xs text-muted-foreground">PNG with transparent background, 600×750. Saved as WebP.</p>
              <div className="mt-2 flex items-center gap-3">
                <div className="flex h-[100px] w-[80px] items-center justify-center rounded border border-dashed border-border bg-muted">
                  {m.maid_url ? <img src={m.maid_url} alt="Maid" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-muted-foreground">None</span>}
                </div>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => pick("maid")}>{m.maid_url ? "Replace" : "Upload"}</Button>
                {m.maid_url && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setM({ ...m, maid_url: null })}>Remove</Button>}
              </div>
            </div>
            <div className="grid gap-2 rounded-lg border border-border bg-card p-3 sm:grid-cols-2">
              <div className="sm:col-span-2 text-sm font-semibold">Section heading</div>
              <Input value={m.heading} maxLength={80} placeholder="English" onChange={(e) => setM({ ...m, heading: e.target.value })} />
              <Input value={m.heading_mr} maxLength={80} placeholder="मराठी" onChange={(e) => setM({ ...m, heading_mr: e.target.value })} />
            </div>
            <div className="rounded-lg border border-border bg-card">
              <div className="border-b border-border px-3 py-2 text-sm font-semibold">Tiles <span className="font-normal text-xs text-muted-foreground">· square 500×500, saved as WebP</span></div>
              {m.tiles.map((t, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 last:border-0">
                  <div className="flex flex-col">
                    <button className="text-xs disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">▲</button>
                    <button className="text-xs disabled:opacity-30" disabled={i === 5} onClick={() => move(i, 1)} aria-label="Move down">▼</button>
                  </div>
                  <button onClick={() => pick("tile", i)} disabled={busy} className="h-14 w-14 overflow-hidden rounded border border-dashed border-border bg-muted text-[10px] text-muted-foreground">
                    {t.url ? <img src={t.url} alt="" className="h-full w-full object-cover" /> : "Upload"}
                  </button>
                  {t.url && <button className="text-xs text-muted-foreground underline" onClick={() => setTile(i, { url: null })}>Remove</button>}
                  <Input className="w-40" value={t.title} maxLength={40} placeholder="English" onChange={(e) => setTile(i, { title: e.target.value })} />
                  <Input className="w-40" value={t.title_mr} maxLength={40} placeholder="मराठी" onChange={(e) => setTile(i, { title_mr: e.target.value })} />
                  <Switch checked={t.enabled} onCheckedChange={(v) => setTile(i, { enabled: v })} />
                </div>
              ))}
            </div>
            <Button disabled={busy} onClick={onSave}>Save app content</Button>
          </div>
          <Preview m={m} lang={lang} setLang={setLang} />
        </div>
      )}
    </section>
  );
}

function Preview({ m, lang, setLang }: { m: CleanMedia; lang: "en" | "mr"; setLang: (l: "en" | "mr") => void }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-muted-foreground">App preview</span>
        <div className="inline-flex rounded border border-border">
          {(["en", "mr"] as const).map((l) => <button key={l} onClick={() => setLang(l)} className={`px-2 py-0.5 ${lang === l ? "bg-primary text-primary-foreground" : ""}`}>{l === "en" ? "EN" : "मराठी"}</button>)}
        </div>
      </div>
      <div ref={ref} className="mx-auto w-[280px] space-y-3 rounded-[28px] border-4 border-foreground/80 bg-background p-3">
        <div className="relative flex h-[120px] items-end overflow-hidden rounded-xl bg-primary p-3">
          <div className="z-10 text-sm font-bold text-primary-foreground">Instant</div>
          {m.maid_url && <img src={m.maid_url} alt="" className="absolute bottom-0 right-1 h-[115px] object-contain" />}
        </div>
        <div className="text-sm font-bold text-foreground">{lang === "en" ? m.heading : m.heading_mr || m.heading}</div>
        <div className="grid grid-cols-3 gap-2">
          {m.tiles.filter((t) => t.enabled).map((t, i) => (
            <div key={i} className="text-center">
              <div className="aspect-square overflow-hidden rounded-lg bg-muted">{t.url && <img src={t.url} alt="" className="h-full w-full object-cover" />}</div>
              <div className="mt-1 text-[10px] leading-tight text-foreground">{lang === "en" ? t.title : t.title_mr || t.title}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
