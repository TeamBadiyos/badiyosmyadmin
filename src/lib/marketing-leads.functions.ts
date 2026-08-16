import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

/** Anon-key client: inserts go through the public INSERT policy, never service role. */
function publicClient() {
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  return createClient<Database>(process.env["SUPABASE_URL"]!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) {
          h.delete("Authorization");
        }
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

const indianPhone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s\-()]/g, "").replace(/^\+?91/, ""))
  .refine((v) => /^[6-9]\d{9}$/.test(v), "Enter a valid 10-digit Indian mobile number");

const businessSchema = z.object({
  businessName: z.string().trim().max(140).optional().or(z.literal("").transform(() => undefined)),
  ownerName: z.string().trim().min(2, "Owner name is required").max(100),
  phone: indianPhone,
  category: z.string().trim().min(2, "Please pick a category").max(80),
});

const citySchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(100),
  phone: indianPhone,
  city: z.string().trim().min(2, "City is required").max(100),
});

export type BusinessInterestInput = z.input<typeof businessSchema>;
export type CityInterestInput = z.input<typeof citySchema>;

export const submitBusinessInterest = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => businessSchema.parse(raw))
  .handler(async ({ data }) => {
    const { error } = await publicClient().from("business_interest_leads").insert({
      business_name: data.businessName ?? null,
      owner_name: data.ownerName,
      phone: data.phone,
      category_interested: data.category,
    });
    if (error) throw new Error("Could not submit right now. Please try again.");
    return { ok: true as const };
  });

export const submitCityInterest = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => citySchema.parse(raw))
  .handler(async ({ data }) => {
    const { error } = await publicClient().from("city_interest_leads").insert({
      name: data.name,
      phone: data.phone,
      city: data.city,
    });
    if (error) throw new Error("Could not submit right now. Please try again.");
    return { ok: true as const };
  });
