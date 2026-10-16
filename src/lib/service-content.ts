export type ServiceKey = "clean" | "wash";
export type Line = { en: string; mr: string };
export type Hero = { heading: string; heading_mr: string; subline: string; subline_mr: string; button: string; button_mr: string; image_url: string | null; bg_color: string };
export type Card = { title: string; title_mr: string; image_url: string | null; included: Line[]; not_included: Line[]; enabled: boolean; price_option_id: string | null };
export type OptionExtra = { name: string; name_mr: string; image_url: string | null; original_price: number | null };
export type Details = { included_title: string; included_title_mr: string; excluded_title: string; excluded_title_mr: string; note: string; note_mr: string; note_icon: string };
export type Banner = { image_url: string | null; title: string; title_mr: string; subline: string; subline_mr: string };
export type BannerState = "open_available" | "open_busy" | "closed_evening" | "closed_morning" | "holiday";
export type Campaign = Banner & { enabled: boolean; link: string; starts_at: string; ends_at: string };
export type ServiceContent = { hero: Hero; cards: Card[]; options: Record<string, OptionExtra>; details: Details; banners: Record<BannerState, Banner>; campaign: Campaign };
export type LiveOption = { price_option_id: string; label: string; price: number; strikethrough_price: number | null; gst_rate: number };

export const BANNER_STATES: { key: BannerState; label: string }[] = [
  { key: "open_available", label: "Open, available" },
  { key: "open_busy", label: "Open, busy" },
  { key: "closed_evening", label: "Closed, evening" },
  { key: "closed_morning", label: "Closed, early morning" },
  { key: "holiday", label: "Holiday" },
];
export const PLACEHOLDERS = ["greeting", "name", "open_time", "day", "next_slot"] as const;
export const NOTE_ICONS: Record<string, string> = { supplies: "🧴", water: "💧", info: "ℹ️", clock: "⏰", star: "⭐", alert: "⚠️" };

export function defaultExtras(key: ServiceKey): Pick<ServiceContent, "details" | "banners" | "campaign"> {
  const w = key === "wash";
  return {
    details: {
      included_title: "The expert will do", included_title_mr: "एक्सपर्ट हे करेल",
      excluded_title: "Not included", excluded_title_mr: "यात समाविष्ट नाही",
      note: w ? "Please keep water and parking access ready" : "Please keep cleaning supplies ready at home",
      note_mr: w ? "कृपया पाणी आणि पार्किंगची सोय तयार ठेवा" : "कृपया घरी स्वच्छतेचे साहित्य तयार ठेवा",
      note_icon: w ? "water" : "supplies",
    },
    banners: {
      open_available: { image_url: null, title: "{greeting}, {name} 👋", title_mr: "{greeting}, {name} 👋", subline: w ? "⚡ Washer available now" : "⚡ Maid available now", subline_mr: w ? "⚡ वॉशर आता उपलब्ध" : "⚡ मावशी आता उपलब्ध" },
      open_busy: { image_url: null, title: "All experts are busy", title_mr: "सर्व एक्सपर्ट व्यस्त आहेत", subline: "Next slot {next_slot}", subline_mr: "पुढील स्लॉट {next_slot}" },
      closed_evening: { image_url: null, title: "Closed for today 🌙", title_mr: "आजसाठी बंद 🌙", subline: "Book for tomorrow · slots open {day} {open_time}", subline_mr: "उद्यासाठी बुक करा · स्लॉट {day} {open_time} ला सुरू" },
      closed_morning: { image_url: null, title: "Good morning ☀️", title_mr: "सुप्रभात ☀️", subline: "Today's slots open at {open_time} · book now", subline_mr: "आजचे स्लॉट {open_time} ला सुरू · आता बुक करा" },
      holiday: { image_url: null, title: "Holiday today", title_mr: "आज सुट्टी", subline: "Back {day}", subline_mr: "{day} ला परत" },
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
  const banners = {} as Record<BannerState, Banner>;
  for (const { key: b } of BANNER_STATES) banners[b] = pickStr(d.banners[b], p?.banners?.[b]);
  return {
    hero: { heading: s(h.heading), heading_mr: s(h.heading_mr), subline: s(h.subline), subline_mr: s(h.subline_mr), button: s(h.button) || "Book Now", button_mr: s(h.button_mr), image_url: h.image_url || null, bg_color: s(h.bg_color) || (key === "wash" ? "#222831" : "#00B97A") },
    cards, options,
    details: pickStr(d.details, p?.details),
    banners,
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
  if (m.cards.length !== 3) return "Exactly 3 cards are required";
  if (m.cards.some((c) => !c.title.trim())) return "Each card needs an English title";
  if (m.cards.some((c) => [...c.included, ...c.not_included].some((l) => !l.en.trim()))) return "Each list line needs English text";
  for (const o of live) {
    const op = m.options[o.price_option_id]?.original_price;
    if (op != null && op <= o.price) return `Original price for ${o.label} must be higher than ₹${o.price}`;
  }
  if (!m.details.included_title.trim() || !m.details.excluded_title.trim()) return "Details sheet section titles (English) are required";
  for (const { key, label } of BANNER_STATES) {
    const b = m.banners[key];
    if (!b.title.trim()) return `Banner "${label}" needs an English title`;
    for (const t of [b.title, b.title_mr, b.subline, b.subline_mr]) { const bad = badPlaceholder(t); if (bad != null) return `Banner "${label}" has unknown placeholder {${bad}}`; }
  }
  const c = m.campaign;
  for (const t of [c.title, c.title_mr, c.subline, c.subline_mr]) { const bad = badPlaceholder(t); if (bad != null) return `Campaign has unknown placeholder {${bad}}`; }
  if (c.enabled) {
    if (!c.title.trim()) return "Campaign needs an English title";
    if (!c.starts_at || !c.ends_at) return "Campaign needs a start and end date";
    if (new Date(c.ends_at) <= new Date(c.starts_at)) return "Campaign end must be after start";
  }
  return null;
}
