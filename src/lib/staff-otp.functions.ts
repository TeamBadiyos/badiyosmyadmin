import { createServerFn } from "@tanstack/react-start";

// Public by design (used before sign-in). Only active Ops Managers / Area Partners
// whose phone is saved in Team can get or use a code; super admin keeps email + password.

const digitsOf = (p: string) => String(p ?? "").replace(/\D/g, "").slice(-10);
const GENERIC = "If this number belongs to an active team member, a WhatsApp code has been sent.";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findStaff(admin: any, d: string) {
  const { data } = await admin.from("staff_users").select("id, auth_user_id, role, status, phone").not("phone", "is", null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).find((s) => digitsOf(s.phone) === d && s.status === "active" && (s.role === "ops_manager" || s.role === "area_partner")) ?? null;
}

export const requestStaffOtp = createServerFn({ method: "POST" })
  .inputValidator((i: { phone: string }) => {
    const d = digitsOf(i?.phone);
    if (!/^[6-9]\d{9}$/.test(d)) throw new Error("Enter a valid 10-digit mobile number");
    return { d };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const staff = await findStaff(admin, data.d);
    if (!staff) return { ok: true, message: GENERIC };
    // Rate limit: 5 codes per hour per number.
    const { data: rl } = await admin.from("staff_login_otps").select("*").eq("phone", data.d).maybeSingle();
    const now = Date.now();
    const fresh = !rl || now - new Date(rl.window_start).getTime() > 3600e3;
    if (!fresh && rl.sent_count >= 5) return { ok: false, message: "Too many codes. Try again in an hour." };
    await admin.from("staff_login_otps").upsert({
      phone: data.d, code_hash: "edge", expires_at: new Date(now + 10 * 60e3).toISOString(), attempts: 0,
      sent_count: fresh ? 1 : rl.sent_count + 1, window_start: fresh ? new Date(now).toISOString() : rl.window_start,
    });
    const res = await fetch(`${process.env["SUPABASE_URL"]}/functions/v1/send-otp`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: data.d }),
    });
    if (!res.ok) { console.error("send-otp failed", res.status, await res.text().catch(() => "")); return { ok: false, message: "Could not send the code. Try again." }; }
    return { ok: true, message: GENERIC };
  });

export const verifyStaffOtp = createServerFn({ method: "POST" })
  .inputValidator((i: { phone: string; code: string }) => {
    const d = digitsOf(i?.phone); const code = String(i?.code ?? "").replace(/\D/g, "");
    if (d.length !== 10 || code.length < 4 || code.length > 6) throw new Error("Enter the code");
    return { d, code };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const fail = { ok: false as const, message: "Wrong or expired code" };
    const staff = await findStaff(admin, data.d);
    if (!staff?.auth_user_id) return fail;
    const { data: rl } = await admin.from("staff_login_otps").select("*").eq("phone", data.d).maybeSingle();
    if (!rl || new Date(rl.expires_at).getTime() < Date.now()) return fail;
    if (rl.attempts >= 5) return { ok: false as const, message: "Too many wrong tries. Request a new code." };
    const { data: otp } = await admin.from("otp_codes").select("id, code")
      .eq("phone", `+91${data.d}`).eq("is_verified", false).gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!otp || String(otp.code) !== data.code) {
      await admin.from("staff_login_otps").update({ attempts: rl.attempts + 1 }).eq("phone", data.d);
      return fail;
    }
    await admin.from("otp_codes").update({ is_verified: true }).eq("id", otp.id);
    await admin.from("staff_login_otps").delete().eq("phone", data.d);
    const { data: u } = await admin.auth.admin.getUserById(staff.auth_user_id);
    const email = u?.user?.email;
    if (!email) return { ok: false as const, message: "This login has no email set. Ask super admin." };
    const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (error || !link?.properties?.hashed_token) return { ok: false as const, message: "Could not sign in. Try again." };
    await admin.from("audit_logs").insert({ actor_id: staff.auth_user_id, action: "staff_otp_login", target_table: "staff_users", target_id: staff.id, after_state: { role: staff.role } });
    return { ok: true as const, tokenHash: link.properties.hashed_token };
  });
