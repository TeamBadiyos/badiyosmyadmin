import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const nameSchema = z.string().trim().min(2, "Name is too short").max(100);
const phoneSchema = z
  .string()
  .trim()
  .min(7, "Phone number is too short")
  .max(20, "Phone number is too long")
  .regex(/^[+0-9\s\-()]+$/, "Phone number is invalid");
const areaSchema = z.string().trim().min(2, "Area is required").max(120);
const emailOptionalSchema = z
  .string()
  .trim()
  .max(255)
  .email("Invalid email")
  .optional()
  .or(z.literal("").transform(() => undefined));

const leadSchema = z.object({
  name: nameSchema,
  phone: phoneSchema,
  area: areaSchema,
  email: emailOptionalSchema,
});

const inquirySchema = z.object({
  name: nameSchema,
  contact: z.string().trim().min(5, "Enter a phone or email").max(255),
  message: z.string().trim().min(5, "Message is too short").max(2000),
});

export type LeadInput = z.infer<typeof leadSchema>;
export type InquiryInput = z.infer<typeof inquirySchema>;

export const submitAreaPartnerLead = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => leadSchema.parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("area_partner_leads").insert({
      name: data.name,
      phone: data.phone,
      area: data.area,
      email: data.email ?? null,
    });
    if (error) throw new Error("Could not submit right now. Please try again.");
    return { ok: true as const };
  });

export const submitExpertLead = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => leadSchema.parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("expert_leads").insert({
      name: data.name,
      phone: data.phone,
      area: data.area,
      email: data.email ?? null,
    });
    if (error) throw new Error("Could not submit right now. Please try again.");
    return { ok: true as const };
  });

export const submitSupportInquiry = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => inquirySchema.parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("support_inquiries").insert({
      name: data.name,
      contact: data.contact,
      message: data.message,
    });
    if (error) throw new Error("Could not submit right now. Please try again.");
    return { ok: true as const };
  });
