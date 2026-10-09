// Shared Razorpay settlement sync used by the manual "Sync now" button and
// the nightly 12:00 AM IST cron hook. Amounts from Razorpay are in paise.
type Admin = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const r = (p: unknown) => Math.round(Number(p ?? 0)) / 100;

function auth() {
  const id = (process.env["RAZORPAY_KEY_ID"] ?? "").trim();
  const secret = (process.env["RAZORPAY_KEY_SECRET"] ?? "").trim();
  if (!id || !secret) throw new Error("Razorpay keys missing");
  return "Basic " + btoa(`${id}:${secret}`);
}

async function rz(path: string) {
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    headers: { Authorization: auth() },
  });
  if (!res.ok) throw new Error(`Razorpay ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Returns the payer contact phone for a Razorpay payment or refund id. */
export async function razorpayContact(entityId: string): Promise<string | null> {
  try {
    let pid = entityId;
    if (entityId.startsWith("rfnd_")) pid = (await rz(`/refunds/${entityId}`)).payment_id ?? "";
    if (!pid) return null;
    return (await rz(`/payments/${pid}`)).contact ?? null;
  } catch { return null; }
}

export async function syncRazorpaySettlements(
  admin: Admin,
  trigger: "manual" | "nightly",
  days = 7,
) {
  try {
    const to = Math.floor(Date.now() / 1000);
    const from = to - days * 86400;
    let skip = 0;
    let count = 0;
    const dates = new Set<string>();
    for (;;) {
      const page = await rz(`/settlements?from=${from}&to=${to}&count=100&skip=${skip}`);
      const items = (page.items ?? []) as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (!items.length) break;
      const rows = items.map((s) => {
        const amount = r(s.amount), fees = r(s.fees), tax = r(s.tax);
        const at = s.created_at ? new Date(s.created_at * 1000) : null;
        if (at) dates.add(new Date(at.getTime() + 19800000).toISOString().slice(0, 10));
        return {
          id: s.id, amount, fees, tax, gross_amount: +(amount + fees).toFixed(2),
          status: s.status ?? null, utr: s.utr ?? null,
          settled_at: at?.toISOString() ?? null, synced_at: new Date().toISOString(),
        };
      });
      const { error } = await admin.from("gateway_settlements").upsert(rows, { onConflict: "id" });
      if (error) throw new Error(error.message);
      count += rows.length;
      if (items.length < 100) break;
      skip += 100;
    }
    // Per-payment breakdown via the combined recon report, per IST day.
    for (const d of dates) {
      const [y, m, dd] = d.split("-").map(Number);
      let skip2 = 0;
      for (;;) {
        const rec = await rz(`/settlements/recon/combined?year=${y}&month=${m}&day=${dd}&count=1000&skip=${skip2}`);
        const items = (rec.items ?? []) as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
        const rows = items
          .filter((i) => i.settlement_id && i.entity_id)
          .map((i) => ({
            id: `${i.settlement_id}:${i.entity_id}:${i.type}`,
            settlement_id: i.settlement_id, entity_id: i.entity_id, type: i.type ?? null,
            amount: r(i.amount), fee: r(i.fee), tax: r(i.tax), credit: r(i.credit), debit: r(i.debit),
            order_id: i.order_id ?? null, description: i.description ?? null,
            txn_at: i.created_at ? new Date(i.created_at * 1000).toISOString() : null,
          }));
        if (rows.length) {
          const ids = new Set((await admin.from("gateway_settlements").select("id").in("id", [...new Set(rows.map((x) => x.settlement_id))])).data?.map((x: { id: string }) => x.id) ?? []);
          const ok = rows.filter((x) => ids.has(x.settlement_id));
          if (ok.length) await admin.from("gateway_settlement_items").upsert(ok, { onConflict: "id" });
        }
        if (items.length < 1000) break;
        skip2 += 1000;
      }
    }
    await admin.from("gateway_sync_log").insert({ trigger, ok: true, settlements_synced: count });
    return { ok: true, count };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[razorpay-settlements] sync failed", msg);
    await admin.from("gateway_sync_log").insert({ trigger, ok: false, error: msg.slice(0, 500) });
    return { ok: false, count: 0, error: msg };
  }
}
