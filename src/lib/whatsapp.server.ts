// Ops WhatsApp sender (AiSensy).
//
// AiSensy is NOT live yet — this is a placeholder that logs the intended
// message and recipients. To go live, implement the AiSensy API call inside
// `deliverViaAiSensy` below; every caller stays unchanged.
//
// Server-only: never import this from components or *.functions.ts at module
// scope.

export type OpsWhatsAppMessage = {
  numbers: string[];
  template: string | null;
  params: Record<string, string>;
};

export async function sendOpsWhatsApp(msg: OpsWhatsAppMessage): Promise<{ ok: boolean }> {
  if (!msg.numbers.length) {
    console.info("[whatsapp:placeholder] no ops numbers configured; skipping", {
      template: msg.template,
      params: msg.params,
    });
    return { ok: false };
  }

  console.info("[whatsapp:placeholder] would send ops alert", {
    to: msg.numbers,
    template: msg.template ?? "(template not set)",
    params: msg.params,
  });

  return deliverViaAiSensy(msg);
}

// One-line swap point: replace the body of this function with the real
// AiSensy campaign API call (fetch to https://backend.aisensy.com/...) once
// the account and template are live. Reads AISENSY_API_KEY from process.env
// inside the function when implemented.
async function deliverViaAiSensy(_msg: OpsWhatsAppMessage): Promise<{ ok: boolean }> {
  return { ok: true }; // placeholder: treated as "sent" so events don't pile up
}
