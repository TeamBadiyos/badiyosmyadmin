export type ServiceKey = "clean" | "wash";
export type Line = { en: string; mr: string };
export type Hero = { heading: string; heading_mr: string; subline: string; subline_mr: string; button: string; button_mr: string; image_url: string | null; bg_color: string };
export type Card = { title: string; title_mr: string; image_url: string | null; included: Line[]; not_included: Line[]; enabled: boolean; price_option_id: string | null };
export type OptionExtra = { name: string; name_mr: string; image_url: string | null; original_price: number | null };
export type ServiceContent = { hero: Hero; cards: Card[]; options: Record<string, OptionExtra> };
export type LiveOption = { price_option_id: string; label: string; price: number; strikethrough_price: number | null; gst_rate: number };

const s = (v: unknown) => (typeof v === "string" ? v : "");
const lines = (v: unknown): Line[] => (Array.isArray(v) ? v.map((l) => ({ en: s(l?.en), mr: s(l?.mr) })) : []);

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
  return {
    hero: { heading: s(h.heading), heading_mr: s(h.heading_mr), subline: s(h.subline), subline_mr: s(h.subline_mr), button: s(h.button) || "Book Now", button_mr: s(h.button_mr), image_url: h.image_url || null, bg_color: s(h.bg_color) || (key === "wash" ? "#222831" : "#00B97A") },
    cards, options,
  };
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
  return null;
}
