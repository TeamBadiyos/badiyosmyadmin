// CORS allowlist for the customer-facing Event Offer payment endpoints.
const ALLOWED = new Set([
  "https://user.badiyos.com",
  "https://badiyos.com",
  "capacitor://localhost",
  "https://localhost",
  "http://localhost",
]);

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") ?? "";
  const h: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (ALLOWED.has(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

export function preflight(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}
