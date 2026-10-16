import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useCity } from "@/lib/city-scope";
import { getServiceContent, resetServiceContent, saveServiceContent, uploadServiceContentImage } from "@/lib/homepage.functions";
import { BANNER_STATES, NOTE_ICONS, PLACEHOLDERS, normalizeServiceContent, validateServiceContent, type Banner, type BannerState, type Card, type Line, type LiveOption, type OptionExtra, type ServiceContent, type ServiceKey } from "@/lib/service-content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

async function toWebp(file: File, w: number, h: number): Promise<{ b64: string; warn: string | null }> {
  const url = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("This photo can't be read. Use PNG, JPG or WebP.")); i.src = url;
  });
  URL.revokeObjectURL(url);
  const nw = img.naturalWidth, nh = img.naturalHeight;
  let warn: string | null = null;
  if (nw < w || nh < h) warn = `Picture is ${nw}×${nh}; recommended ${w}×${h}.`;
  else if (Math.abs(nw / nh - w / h) > 0.05) warn = `Picture shape is ${nw}×${nh}; recommended ${w}×${h}.`;
  const scale = Math.min(1, w / nw, h / nh);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(nw * scale)); c.height = Math.max(1, Math.round(nh * scale));
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return { b64: c.toDataURL("image/webp", 0.85), warn };
}

const emptyExtra: OptionExtra = { name: "", name_mr: "", image_url: null, original_price: null };

export function ServiceAppContent({ service }: { service: ServiceKey }) {
  const { city } = useCity();
  const [target, setTarget] = useState<"city" | "default">("city");
  const cityId = target === "default" ? null : city?.id ?? null;
  const get = useServerFn(getServiceContent), save = useServerFn(saveServiceContent), reset = useServerFn(resetServiceContent), upload = useServerFn(uploadServiceContentImage);
  const [m, setM] = useState<ServiceContent | null>(null);
  const [live, setLive] = useState<LiveOption[]>([]);
  const [isDefault, setIsDefault] = useState(true);
  const [busy, setBusy] = useState(false);
  const [lang, setLang] = useState<"en" | "mr">("en");

  function load(r: Record<string, unknown>) {
    setM(normalizeServiceContent(r.content, service)); setIsDefault(!!r.is_default);
    setLive(((r.options as LiveOption[]) ?? []).map((o) => ({ ...o, price: Number(o.price) })));
  }
  useEffect(() => { setM(null); get({ data: { service, cityId } }).then(load).catch((e) => toast.error(e.message)); }, [service, cityId, get]); // eslint-disable-line react-hooks/exhaustive-deps

  function pick(kind: "hero" | "card" | "option" | "banner", w: number, h: number, apply: (url: string) => void) {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/png,image/jpeg,image/webp";
    inp.onchange = async () => {
      const f = inp.files?.[0]; if (!f) return;
      setBusy(true);
      try {
        const { b64, warn } = await toWebp(f, w, h);
        if (warn) toast.warning(warn);
        const { url } = await upload({ data: { service, cityId, kind, base64: b64 } });
        apply(url);
      } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
    };
    inp.click();
  }
  async function onSave() {
    if (!m) return;
    const err = validateServiceContent(m, live); if (err) return toast.error(err);
    setBusy(true);
    try { load(await save({ data: { service, cityId, payload: m } })); toast.success("App content saved"); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  async function onReset() {
    if (!cityId || !confirm("Remove this city's own content and use the default?")) return;
    setBusy(true);
    try { load(await reset({ data: { service, cityId } })); toast.success("Using default content"); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  if (!m) return <section><h2 className="text-[16px] font-bold text-foreground">App content</h2><p className="text-sm text-muted-foreground">Loading…</p></section>;

  const setHero = (p: Partial<ServiceContent["hero"]>) => setM({ ...m, hero: { ...m.hero, ...p } });
  const setCard = (i: number, p: Partial<Card>) => setM({ ...m, cards: m.cards.map((c, k) => (k === i ? { ...c, ...p } : c)) });
  const moveCard = (i: number, d: number) => { const j = i + d; if (j < 0 || j > 2) return; const c = [...m.cards]; [c[i], c[j]] = [c[j], c[i]]; setM({ ...m, cards: c }); };
  const setOpt = (id: string, p: Partial<OptionExtra>) => setM({ ...m, options: { ...m.options, [id]: { ...emptyExtra, ...m.options[id], ...p } } });
  const setDet = (p: Partial<ServiceContent["details"]>) => setM({ ...m, details: { ...m.details, ...p } });
  const setCamp = (p: Partial<ServiceContent["campaign"]>) => setM({ ...m, campaign: { ...m.campaign, ...p } });

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[16px] font-bold text-foreground">App content</h2>
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
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <Box title="Hero card">
            <div className="grid gap-2 sm:grid-cols-2">
              <Input value={m.hero.card_title} maxLength={30} placeholder="Card title (small card on Clean tab)" onChange={(e) => setHero({ card_title: e.target.value })} />
              <Input value={m.hero.card_title_mr} maxLength={30} placeholder="कार्ड शीर्षक (मराठी)" onChange={(e) => setHero({ card_title_mr: e.target.value })} />
              <Input value={m.hero.heading} maxLength={80} placeholder="Heading (optional, blank = hidden)" onChange={(e) => setHero({ heading: e.target.value })} />
              <Input value={m.hero.heading_mr} maxLength={80} placeholder="शीर्षक (मराठी)" onChange={(e) => setHero({ heading_mr: e.target.value })} />
              <Input value={m.hero.subline} maxLength={120} placeholder="Sub-line" onChange={(e) => setHero({ subline: e.target.value })} />
              <Input value={m.hero.subline_mr} maxLength={120} placeholder="उप-ओळ (मराठी)" onChange={(e) => setHero({ subline_mr: e.target.value })} />
              <Input value={m.hero.button} maxLength={30} placeholder="Button text" onChange={(e) => setHero({ button: e.target.value })} />
              <Input value={m.hero.button_mr} maxLength={30} placeholder="बटण (मराठी)" onChange={(e) => setHero({ button_mr: e.target.value })} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Photo url={m.hero.image_url} w={80} h={100} contain />
              <Button size="sm" variant="outline" disabled={busy} onClick={() => pick("hero", 600, 750, (url) => setHero({ image_url: url }))}>{m.hero.image_url ? "Replace" : "Upload"}</Button>
              {m.hero.image_url && <Button size="sm" variant="ghost" onClick={() => setHero({ image_url: null })}>Remove</Button>}
              <span className="text-xs text-muted-foreground">Transparent PNG, 600×750</span>
              <label className="ml-auto flex items-center gap-2 text-xs">Background
                <input type="color" value={/^#[0-9a-f]{6}$/i.test(m.hero.bg_color) ? m.hero.bg_color : "#000000"} onChange={(e) => setHero({ bg_color: e.target.value.toUpperCase() })} className="h-8 w-10 rounded border border-border" />
                <Input className="w-24" value={m.hero.bg_color} maxLength={7} onChange={(e) => setHero({ bg_color: e.target.value })} />
              </label>
            </div>
          </Box>

          <Box title="Cards under the hero" hint="square 500×500">
            {m.cards.map((c, i) => (
              <div key={i} className="space-y-2 border-b border-border py-3 last:border-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex flex-col">
                    <button className="text-xs disabled:opacity-30" disabled={i === 0} onClick={() => moveCard(i, -1)} aria-label="Move up">▲</button>
                    <button className="text-xs disabled:opacity-30" disabled={i === 2} onClick={() => moveCard(i, 1)} aria-label="Move down">▼</button>
                  </div>
                  <button disabled={busy} onClick={() => pick("card", 500, 500, (url) => setCard(i, { image_url: url }))}><Photo url={c.image_url} w={56} h={56} /></button>
                  {c.image_url && <button className="text-xs text-muted-foreground underline" onClick={() => setCard(i, { image_url: null })}>Remove</button>}
                  <Input className="w-40" value={c.title} maxLength={40} placeholder="Title" onChange={(e) => setCard(i, { title: e.target.value })} />
                  <Input className="w-40" value={c.title_mr} maxLength={40} placeholder="शीर्षक (मराठी)" onChange={(e) => setCard(i, { title_mr: e.target.value })} />
                  {service === "wash" && (
                    <select className="h-9 rounded-md border border-border bg-background px-2 text-sm" value={c.price_option_id ?? ""} onChange={(e) => setCard(i, { price_option_id: e.target.value || null })}>
                      <option value="">No price option</option>
                      {live.map((o) => <option key={o.price_option_id} value={o.price_option_id}>{o.label}</option>)}
                    </select>
                  )}
                  <Switch className="ml-auto" checked={c.enabled} onCheckedChange={(v) => setCard(i, { enabled: v })} />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Lines label="Included" items={c.included} onChange={(v) => setCard(i, { included: v })} />
                  <Lines label="Not included" items={c.not_included} onChange={(v) => setCard(i, { not_included: v })} />
                </div>
              </div>
            ))}
          </Box>

          <Box title="Price options" hint="current price comes from the price list">
            {live.length === 0 && <p className="py-2 text-sm text-muted-foreground">No active price options in this city.</p>}
            {live.map((o) => {
              const x = { ...emptyExtra, ...m.options[o.price_option_id] };
              return (
                <div key={o.price_option_id} className="flex flex-wrap items-center gap-2 border-b border-border py-2 last:border-0">
                  <button disabled={busy} onClick={() => pick("option", 500, 500, (url) => setOpt(o.price_option_id, { image_url: url }))}><Photo url={x.image_url} w={48} h={48} /></button>
                  {x.image_url && <button className="text-xs text-muted-foreground underline" onClick={() => setOpt(o.price_option_id, { image_url: null })}>Remove</button>}
                  <Input className="w-36" value={x.name} maxLength={40} placeholder={o.label} onChange={(e) => setOpt(o.price_option_id, { name: e.target.value })} />
                  <Input className="w-36" value={x.name_mr} maxLength={40} placeholder="नाव (मराठी)" onChange={(e) => setOpt(o.price_option_id, { name_mr: e.target.value })} />
                  <Input className="w-28" type="number" min={0} value={x.original_price ?? ""} placeholder={o.strikethrough_price ? `₹${o.strikethrough_price}` : "Original ₹"} onChange={(e) => setOpt(o.price_option_id, { original_price: e.target.value === "" ? null : Number(e.target.value) })} />
                  <span className="text-sm font-semibold">₹{o.price}</span>
                </div>
              );
            })}
          </Box>
          <Box title="Details sheet">
            <div className="grid gap-2 sm:grid-cols-2">
              <Input value={m.details.included_title} maxLength={40} placeholder="Included section title" onChange={(e) => setDet({ included_title: e.target.value })} />
              <Input value={m.details.included_title_mr} maxLength={40} placeholder="मराठी" onChange={(e) => setDet({ included_title_mr: e.target.value })} />
              <Input value={m.details.excluded_title} maxLength={40} placeholder="Not-included section title" onChange={(e) => setDet({ excluded_title: e.target.value })} />
              <Input value={m.details.excluded_title_mr} maxLength={40} placeholder="मराठी" onChange={(e) => setDet({ excluded_title_mr: e.target.value })} />
              <Input value={m.details.note} maxLength={140} placeholder="Note (blank = hidden)" onChange={(e) => setDet({ note: e.target.value })} />
              <Input value={m.details.note_mr} maxLength={140} placeholder="टीप (मराठी)" onChange={(e) => setDet({ note_mr: e.target.value })} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">Note icon:
              {Object.entries(NOTE_ICONS).map(([k, ic]) => (
                <button key={k} onClick={() => setDet({ note_icon: k })} className={`rounded border px-2 py-1 ${m.details.note_icon === k ? "border-primary bg-primary/10" : "border-border"}`}>{ic}</button>
              ))}
            </div>
          </Box>

          <Box title="Top banner" hint="1080×600">
            <p className="mb-2 text-xs text-muted-foreground">Placeholders: {PLACEHOLDERS.map((p) => `{${p}}`).join(" ")}</p>
            {BANNER_STATES.map(({ key, label }) => (
              <BannerFields key={key} label={label} b={m.banners[key]} busy={busy}
                onChange={(p) => setM({ ...m, banners: { ...m.banners, [key]: { ...m.banners[key], ...p } } })}
                onPick={() => pick("banner", 1080, 600, (url) => setM((cur) => cur && ({ ...cur, banners: { ...cur.banners, [key]: { ...cur.banners[key], image_url: url } } })))} />
            ))}
            <div className="mt-2 rounded-md border border-dashed border-border p-2">
              <div className="flex items-center gap-2 text-sm font-semibold">Campaign banner <span className="text-xs font-normal text-muted-foreground">replaces the open-state banners while active</span>
                <Switch className="ml-auto" checked={m.campaign.enabled} onCheckedChange={(v) => setCamp({ enabled: v })} />
              </div>
              <BannerFields label="" b={m.campaign} busy={busy} onChange={setCamp}
                onPick={() => pick("banner", 1080, 600, (url) => setM((cur) => cur && ({ ...cur, campaign: { ...cur.campaign, image_url: url } })))} />
              <div className="grid gap-2 sm:grid-cols-3">
                <Input value={m.campaign.link} maxLength={300} placeholder="Link (app link or https://)" onChange={(e) => setCamp({ link: e.target.value })} />
                <label className="text-xs">Start (IST)<Input type="datetime-local" value={m.campaign.starts_at.slice(0, 16)} onChange={(e) => setCamp({ starts_at: e.target.value ? `${e.target.value}:00+05:30` : "" })} /></label>
                <label className="text-xs">End (IST)<Input type="datetime-local" value={m.campaign.ends_at.slice(0, 16)} onChange={(e) => setCamp({ ends_at: e.target.value ? `${e.target.value}:00+05:30` : "" })} /></label>
              </div>
            </div>
          </Box>
          <Button disabled={busy} onClick={onSave}>Save app content</Button>
        </div>
        <Preview m={m} live={live} lang={lang} setLang={setLang} service={service} />
      </div>
    </section>
  );
}

function Box({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-2 text-sm font-semibold">{title}{hint && <span className="font-normal text-xs text-muted-foreground"> · {hint}, saved as WebP</span>}</div>
      {children}
    </div>
  );
}

function Photo({ url, w, h, contain }: { url: string | null; w: number; h: number; contain?: boolean }) {
  return (
    <div style={{ width: w, height: h }} className="flex items-center justify-center overflow-hidden rounded border border-dashed border-border bg-muted text-[10px] text-muted-foreground">
      {url ? <img src={url} alt="" className={contain ? "max-h-full max-w-full object-contain" : "h-full w-full object-cover"} /> : "Upload"}
    </div>
  );
}

function Lines({ label, items, onChange }: { label: string; items: Line[]; onChange: (v: Line[]) => void }) {
  const set = (i: number, p: Partial<Line>) => onChange(items.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= items.length) return; const c = [...items]; [c[i], c[j]] = [c[j], c[i]]; onChange(c); };
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      {items.map((l, i) => (
        <div key={i} className="flex items-center gap-1">
          <button className="text-[10px] disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)}>▲</button>
          <button className="text-[10px] disabled:opacity-30" disabled={i === items.length - 1} onClick={() => move(i, 1)}>▼</button>
          <Input className="h-8" value={l.en} maxLength={80} placeholder="English" onChange={(e) => set(i, { en: e.target.value })} />
          <Input className="h-8" value={l.mr} maxLength={80} placeholder="मराठी" onChange={(e) => set(i, { mr: e.target.value })} />
          <button className="px-1 text-xs text-muted-foreground" onClick={() => onChange(items.filter((_, k) => k !== i))} aria-label="Remove">✕</button>
        </div>
      ))}
      {items.length < 15 && <button className="text-xs text-primary underline" onClick={() => onChange([...items, { en: "", mr: "" }])}>+ Add line</button>}
    </div>
  );
}

const SAMPLE: Record<string, string> = { greeting: "Good evening", name: "Priya", open_time: "8:00 AM", day: "Tomorrow", next_slot: "4:30 PM" };
const fill = (x: string) => x.replace(/\{(\w+)\}/g, (_, k) => SAMPLE[k] ?? `{${k}}`);

function BannerFields({ label, b, busy, onChange, onPick }: { label: string; b: Banner; busy: boolean; onChange: (p: Partial<Banner>) => void; onPick: () => void }) {
  return (
    <div className="space-y-2 border-b border-border py-2 last:border-0">
      {label && <div className="text-xs font-semibold text-muted-foreground">{label}</div>}
      <div className="flex flex-wrap items-start gap-2">
        <button disabled={busy} onClick={onPick}><Photo url={b.image_url} w={90} h={50} /></button>
        {b.image_url && <button className="text-xs text-muted-foreground underline" onClick={() => onChange({ image_url: null })}>Remove</button>}
        <div className="grid flex-1 gap-2 sm:grid-cols-2">
          <Input value={b.title} maxLength={80} placeholder="Title" onChange={(e) => onChange({ title: e.target.value })} />
          <Input value={b.title_mr} maxLength={80} placeholder="शीर्षक (मराठी)" onChange={(e) => onChange({ title_mr: e.target.value })} />
          <Input value={b.subline} maxLength={120} placeholder="Sub-line" onChange={(e) => onChange({ subline: e.target.value })} />
          <Input value={b.subline_mr} maxLength={120} placeholder="उप-ओळ (मराठी)" onChange={(e) => onChange({ subline_mr: e.target.value })} />
        </div>
      </div>
    </div>
  );
}

function Preview({ m, live, lang, setLang, service }: { m: ServiceContent; live: LiveOption[]; lang: "en" | "mr"; setLang: (l: "en" | "mr") => void; service: ServiceKey }) {
  const t = (en: string, mr: string) => (lang === "en" ? en : mr || en);
  const [st, setSt] = useState<BannerState | "campaign">("open_available");
  const b: Banner = st === "campaign" ? m.campaign : m.banners[st];
  const card = m.cards.find((c) => c.enabled);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-muted-foreground">App preview</span>
        <div className="inline-flex rounded border border-border">
          {(["en", "mr"] as const).map((l) => <button key={l} onClick={() => setLang(l)} className={`px-2 py-0.5 ${lang === l ? "bg-primary text-primary-foreground" : ""}`}>{l === "en" ? "EN" : "मराठी"}</button>)}
        </div>
      </div>
      <select className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs" value={st} onChange={(e) => setSt(e.target.value as BannerState | "campaign")}>
        {BANNER_STATES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        <option value="campaign">Campaign</option>
      </select>
      <div className="mx-auto w-[280px] space-y-3 rounded-[28px] border-4 border-foreground/80 bg-background p-3">
        <div className="relative flex aspect-[1080/600] flex-col justify-end overflow-hidden rounded-xl bg-muted p-2">
          {b.image_url && <img src={b.image_url} alt="" className="absolute inset-0 h-full w-full object-cover" />}
          <div className="relative rounded bg-background/80 px-2 py-1">
            <div className="text-[12px] font-bold text-foreground">{fill(t(b.title, b.title_mr))}</div>
            <div className="text-[10px] text-muted-foreground">{fill(t(b.subline, b.subline_mr))}</div>
          </div>
        </div>
        <div className="inline-block rounded-lg border border-border px-2 py-1 text-[10px] font-semibold">{t(m.hero.card_title, m.hero.card_title_mr)}</div>
        {/* Hero colour is staff-chosen content, so it is applied inline. */}
        <div className="relative flex h-[130px] flex-col justify-end overflow-hidden rounded-xl p-3" style={{ backgroundColor: m.hero.bg_color }}>
          <div className="z-10 max-w-[60%] space-y-1 text-primary-foreground">
            {t(m.hero.heading, m.hero.heading_mr).trim() && <div className="text-sm font-bold leading-tight">{t(m.hero.heading, m.hero.heading_mr)}</div>}
            <div className="text-[11px] leading-tight opacity-90">{t(m.hero.subline, m.hero.subline_mr)}</div>
            <span className="inline-block rounded-full bg-background px-2 py-0.5 text-[10px] font-semibold text-foreground">{t(m.hero.button, m.hero.button_mr)}</span>
          </div>
          {m.hero.image_url && <img src={m.hero.image_url} alt="" className="absolute bottom-0 right-1 h-[125px] object-contain" />}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {m.cards.filter((c) => c.enabled).map((c, i) => (
            <div key={i} className="text-center">
              <div className="aspect-square overflow-hidden rounded-lg bg-muted">{c.image_url && <img src={c.image_url} alt="" className="h-full w-full object-cover" />}</div>
              <div className="mt-1 text-[10px] font-semibold leading-tight text-foreground">{t(c.title, c.title_mr)}</div>
              <div className="text-[9px] text-muted-foreground">{c.included.length} ✓ · {c.not_included.length} ✕</div>
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          {live.map((o) => {
            const x = m.options[o.price_option_id];
            const op = x?.original_price ?? o.strikethrough_price;
            return (
              <div key={o.price_option_id} className="flex items-center gap-2 rounded-lg border border-border p-1.5">
                <div className="h-8 w-8 overflow-hidden rounded bg-muted">{x?.image_url && <img src={x.image_url} alt="" className="h-full w-full object-cover" />}</div>
                <div className="flex-1 text-[11px] font-semibold text-foreground">{t(x?.name || o.label, x?.name_mr ?? "")}</div>
                {op != null && op > o.price && <span className="text-[10px] text-muted-foreground line-through">₹{op}</span>}
                <span className="text-[11px] font-bold text-foreground">₹{o.price}</span>
              </div>
            );
          })}
        </div>
        {card && (
          <div className="space-y-1 rounded-t-xl border border-border p-2 text-[10px]">
            <div className="font-bold text-foreground">{t(m.details.included_title, m.details.included_title_mr)}</div>
            {card.included.slice(0, 3).map((l, i) => <div key={i} className="text-muted-foreground">✓ {t(l.en, l.mr)}</div>)}
            <div className="pt-1 font-bold text-foreground">{t(m.details.excluded_title, m.details.excluded_title_mr)}</div>
            {card.not_included.slice(0, 3).map((l, i) => <div key={i} className="text-muted-foreground">✕ {t(l.en, l.mr)}</div>)}
            {t(m.details.note, m.details.note_mr).trim() && <div className="mt-1 rounded bg-muted px-2 py-1 text-foreground">{NOTE_ICONS[m.details.note_icon] ?? ""} {t(m.details.note, m.details.note_mr)}</div>}
            <div className="text-[8px] text-muted-foreground">{service === "wash" ? "Wash" : "Maid"} details sheet</div>
          </div>
        )}
      </div>
    </div>
  );
}
