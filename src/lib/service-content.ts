export type ServiceKey = "clean" | "wash";
export type Line = { en: string; mr: string };
export type Hero = { heading: string; heading_mr: string; subline: string; subline_mr: string; button: string; button_mr: string; image_url: string | null; bg_color: string; card_title: string; card_title_mr: string };
export type Card = { title: string; title_mr: string; image_url: string | null; included: Line[]; not_included: Line[]; enabled: boolean; price_option_id: string | null };
export type OptionExtra = { name: string; name_mr: string; image_url: string | null; original_price: number | null };
export type Details = { included_title: string; included_title_mr: string; excluded_title: string; excluded_title_mr: string; note: string; note_mr: string; note_icon: string };
export type Banner = { image_url: string | null; title: string; title_mr: string; subline: string; subline_mr: string };
export type BannerState = "open_free" | "open_busy" | "closed" | "holiday";
export type BannerText = { title: string; title_mr: string; subline: string; subline_mr: string };
export type Slab = { from: string; to: string; label: string; image_url: string | null; text_color: "light" | "dark" };
export type Campaign = Banner & { enabled: boolean; link: string; starts_at: string; ends_at: string };
export type ServiceContent = { hero: Hero; cards: Card[]; options: Record<string, OptionExtra>; details: Details; banner: { slabs: Slab[]; texts: Record<BannerState, BannerText> }; campaign: Campaign };
export type LiveOption = { price_option_id: string; label: string; price: number; strikethrough_price: number | null; gst_rate: number };

export const BANNER_STATES: { key: BannerState; label: string }[] = [
  { key: "open_free", label: "Open, expert free" },
  { key: "open_busy", label: "Open, busy" },
  { key: "closed", label: "Closed" },
  { key: "holiday", label: "Holiday" },
];
export const PLACEHOLDERS = ["greeting", "name", "open_time", "day", "next_slot"] as const;
export const NOTE_ICONS: Record<string, string> = { supplies: "🧴", water: "💧", info: "ℹ️", clock: "⏰", star: "⭐", alert: "⚠️" };

export function defaultExtras(key: ServiceKey): Pick<ServiceContent, "details" | "banner" | "campaign"> {
  const w = key === "wash";
  return {
    details: {
      included_title: "The expert will do", included_title_mr: "एक्सपर्ट हे करेल",
      excluded_title: "Not included", excluded_title_mr: "यात समाविष्ट नाही",
      note: w ? "Please keep water and parking access ready" : "Please keep cleaning supplies ready at home",
      note_mr: w ? "कृपया पाणी आणि पार्किंगची सोय तयार ठेवा" : "कृपया घरी स्वच्छतेचे साहित्य तयार ठेवा",
      note_icon: w ? "water" : "supplies",
    },
    banner: {
      slabs: [
        { from: "05:00", to: "10:00", label: "Sunrise", image_url: null, text_color: "light" },
        { from: "10:00", to: "17:00", label: "Day", image_url: null, text_color: "dark" },
        { from: "17:00", to: "19:00", label: "Evening", image_url: null, text_color: "light" },
        { from: "19:00", to: "05:00", label: "Night", image_url: null, text_color: "light" },
      ],
      texts: {
        open_free: { title: "{greeting}, {name} 👋", title_mr: "{greeting}, {name} 👋", subline: w ? "⚡ Washer available now" : "⚡ Maid available now", subline_mr: w ? "⚡ वॉशर आता उपलब्ध" : "⚡ मावशी आता उपलब्ध" },
        open_busy: { title: "Busy right now ⏳", title_mr: "सध्या सर्व व्यस्त ⏳", subline: "Next free slot {next_slot}", subline_mr: "पुढील स्लॉट {next_slot}" },
        closed: { title: "{greeting}", title_mr: "{greeting}", subline: "Book now · slots open {day} at {open_time}", subline_mr: "आत्ताच बुक करा · स्लॉट {day} {open_time} पासून" },
        holiday: { title: "Holiday today 🎉", title_mr: "आज सुट्टी 🎉", subline: "Back {day} at {open_time} · book now", subline_mr: "{day} {open_time} पासून परत · आत्ताच बुक करा" },
      },
    },
    campaign: { enabled: false, image_url: null, title: "", title_mr: "", subline: "", subline_mr: "", link: "", starts_at: "", ends_at: "" },
  };
}

const s = (v: unknown) => (typeof v === "string" ? v : "");
const lines = (v: unknown): Line[] => (Array.isArray(v) ? v.map((l) => ({ en: s(l?.en), mr: s(l?.mr) })) : []);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pickStr = <T extends Record<string, unknown>>(d: T, src: any): T => {
  const out = { ...d } as Record<string, unknown>;
  for (const k of Object.keys(d)) if (src && k in src && src[k] != null) out[k] = typeof d[k] === "boolean" ? src[k] === true : typeof d[k] === "string" ? s(src[k]) : src[k] || null;
  return out as T;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeServiceContent(p: any, key: ServiceKey): ServiceContent {
  const h = p?.hero ?? {};
  const cards: Card[] = [0, 1, 2].map((i) => {
    const c = Array.isArray(p?.cards) ? p.cards[i] ?? {} : {};
    return { title: s(c.title), title_mr: s(c.title_mr), image_url: c.image_url || null, included: lines(c.included), not_included: lines(c.not_included), enabled: c.enabled !== false, price_option_id: c.price_option_id || null };
  });
  const options: Record<string, OptionExtra> = {};
  for (const [id, o] of Object.entries((p?.options ?? {}) as Record<string, any>)) // eslint-disable-line @typescript-eslint/no-explicit-any
    options[id] = { name: s(o?.name), name_mr: s(o?.name_mr), image_url: o?.image_url || null, original_price: o?.original_price == null || o.original_price === "" ? null : Number(o.original_price) };
  const d = defaultExtras(key);
  const texts = {} as Record<BannerState, BannerText>;
  const oldMap: Record<BannerState, string | null> = { open_free: "open_available", open_busy: "open_busy", closed: null, holiday: "holiday" };
  const nb = p?.banner;
  for (const { key: b } of BANNER_STATES) texts[b] = pickStr(d.banner.texts[b], nb ? nb.texts?.[b] : oldMap[b] ? p?.banners?.[oldMap[b]!] : undefined);
  const T = /^([01]\d|2[0-3]):[0-5]\d$/;
  const slabs: Slab[] = Array.isArray(nb?.slabs)
    ? nb.slabs.map((x: any) => ({ from: T.test(s(x?.from)) ? s(x.from) : "00:00", to: T.test(s(x?.to)) ? s(x.to) : "00:00", label: s(x?.label), image_url: x?.image_url || null, text_color: x?.text_color === "dark" ? "dark" : "light" })) // eslint-disable-line @typescript-eslint/no-explicit-any
    : d.banner.slabs.map((x, i) => ({ ...x, image_url: (i === 0 ? p?.banners?.closed_morning?.image_url : i === 1 ? p?.banners?.open_available?.image_url : i === 3 ? p?.banners?.closed_evening?.image_url : null) || null }));
  return {
    hero: { heading: s(h.heading), heading_mr: s(h.heading_mr), subline: s(h.subline), subline_mr: s(h.subline_mr), button: s(h.button) || "Book Now", button_mr: s(h.button_mr), image_url: h.image_url || null, bg_color: s(h.bg_color) || (key === "wash" ? "#222831" : "#00B97A"), card_title: s(h.card_title) || (key === "wash" ? "Car Wash" : "Maid"), card_title_mr: s(h.card_title_mr) || (key === "wash" ? "कार वॉश" : "मेड") },
    cards, options,
    details: pickStr(d.details, p?.details),
    banner: { slabs, texts },
    campaign: pickStr(d.campaign, p?.campaign),
  };
}

export function badPlaceholder(text: string): string | null {
  for (const m of text.matchAll(/\{([^}]*)\}/g)) if (!(PLACEHOLDERS as readonly string[]).includes(m[1])) return m[1];
  return null;
}

export function validateServiceContent(m: ServiceContent, live: LiveOption[]): string | null {
  if (!/^#[0-9a-f]{6}$/i.test(m.hero.bg_color)) return "Background colour must look like #00B97A";
  if (!m.hero.subline.trim()) return "Sub-line (English) is required";
  if (!m.hero.button.trim()) return "Button text (English) is required";
  if (!m.hero.card_title.trim()) return "Card title (English) is required";
  if (m.cards.length !== 3) return "Exactly 3 cards are required";
  if (m.cards.some((c) => !c.title.trim())) return "Each card needs an English title";
  if (m.cards.some((c) => [...c.included, ...c.not_included].some((l) => !l.en.trim()))) return "Each list line needs English text";
  for (const o of live) {
    const op = m.options[o.price_option_id]?.original_price;
    if (op != null && op <= o.price) return `Original price for ${o.label} must be higher than ₹${o.price}`;
  }
  if (!m.details.included_title.trim() || !m.details.excluded_title.trim()) return "Details sheet section titles (English) are required";
  for (const { key, label } of BANNER_STATES) {
    const b = m.banner.texts[key];
    if (!b.title.trim()) return `Banner "${label}" needs an English title`;
    for (const t of [b.title, b.title_mr, b.subline, b.subline_mr]) { const bad = badPlaceholder(t); if (bad != null) return `Banner "${label}" has unknown placeholder {${bad}}`; }
  }
  const sl = slabError(m.banner.slabs); if (sl) return sl;
  const c = m.campaign;
  for (const t of [c.title, c.title_mr, c.subline, c.subline_mr]) { const bad = badPlaceholder(t); if (bad != null) return `Campaign has unknown placeholder {${bad}}`; }
  if (c.enabled) {
    if (!c.title.trim()) return "Campaign needs an English title";
    if (!c.starts_at || !c.ends_at) return "Campaign needs a start and end date";
    if (new Date(c.ends_at) <= new Date(c.starts_at)) return "Campaign end must be after start";
  }
  return null;
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fmt = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
function slabMinutes(x: Slab): number[] { const out: number[] = []; for (let i = toMin(x.from); i !== toMin(x.to); i = (i + 1) % 1440) out.push(i); return out; }

export function slabError(slabs: Slab[]): string | null {
  if (slabs.length > 12) return "Up to 12 time slabs";
  const T = /^([01]\d|2[0-3]):[0-5]\d$/;
  const used = new Set<number>();
  for (const x of slabs) {
    if (!T.test(x.from) || !T.test(x.to)) return "Slab times must look like 05:00";
    if (x.from === x.to) return `Slab ${x.from} has the same start and end`;
    for (const i of slabMinutes(x)) { if (used.has(i)) return `Banner time slabs overlap at ${fmt(i)}`; used.add(i); }
  }
  return null;
}

/** Uncovered time ranges, e.g. ["02:00–05:00"]. */
export function uncoveredRanges(slabs: Slab[]): string[] {
  const used = new Set<number>(); for (const x of slabs) if (x.from !== x.to) slabMinutes(x).forEach((i) => used.add(i));
  if (used.size === 0) return ["00:00–24:00"];
  if (used.size >= 1440) return [];
  let start = 0; while (!used.has(start)) start++;
  const out: string[] = []; let gap: number | null = null;
  for (let k = 1; k <= 1440; k++) { const i = (start + k) % 1440;
    if (!used.has(i)) { if (gap == null) gap = i; } else if (gap != null) { out.push(`${fmt(gap)}–${fmt(i)}`); gap = null; } }
  return out;
}

export function slabAt(slabs: Slab[], time: string): Slab | null {
  const t = toMin(time); return slabs.find((x) => slabMinutes(x).includes(t)) ?? null;
}
