/**
 * Shared brand + contact constants for the public marketing site.
 */

// TODO(badiyos): confirm the official WhatsApp support number (AiSensy line).
// Digits only, with country code, no "+" — used to build wa.me links.
export const SUPPORT_WHATSAPP_NUMBER = "919000000000";

export const SUPPORT_WHATSAPP_MESSAGE =
  "Hi Badiyos! I'd like to know more about your home services.";

export function whatsappLink(message: string = SUPPORT_WHATSAPP_MESSAGE) {
  return `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

export const SITE_URL = "https://badiyos.com";
export const OG_IMAGE = `${SITE_URL}/og-badiyos.jpg`;

export const LEGAL_ENTITY_NAME = "badiyos Private Limited";
// TODO(badiyos): add CIN (company registration number) here once available.
export const LEGAL_ENTITY_CIN: string | null = null;

export const MERCHANT_PORTAL_URL = "https://merchant.badiyos.com";
