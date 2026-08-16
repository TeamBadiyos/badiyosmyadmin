import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type LegalPage = {
  id: string;
  slug: string;
  title: string;
  content: string;
  effectiveDate: string | null;
  lastUpdatedAt: string;
  isActive: boolean;
};

export const LEGAL_SLUGS = [
  { slug: "privacy-policy", label: "Privacy Policy", path: "/privacy-policy" },
  { slug: "terms", label: "Terms & Conditions", path: "/terms" },
  { slug: "refund-policy", label: "Refund & Cancellation Policy", path: "/refund-policy" },
  { slug: "shipping-policy", label: "Shipping & Delivery Policy", path: "/shipping-policy" },
] as const;

type Row = {
  id: string;
  slug: string;
  title: string;
  content: string;
  effective_date: string | null;
  last_updated_at: string;
  is_active: boolean;
};

function mapRow(r: Row): LegalPage {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    content: r.content,
    effectiveDate: r.effective_date,
    lastUpdatedAt: r.last_updated_at,
    isActive: r.is_active,
  };
}

const SELECT = "id, slug, title, content, effective_date, last_updated_at, is_active";

/**
 * Public read: fetch one active legal page by slug.
 * Sibling apps (Customer / Partner / Merchant) can do the same query directly
 * with the anon key:
 *   supabase.from("legal_pages")
 *     .select("slug,title,content,effective_date,last_updated_at")
 *     .eq("slug", slug).eq("is_active", true).maybeSingle()
 */
export const getLegalPage = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) => z.object({ slug: z.string().min(1).max(60) }).parse(raw))
  .handler(async ({ data }): Promise<LegalPage | null> => {
    const { createClient } = await import("@supabase/supabase-js");
    const db = createClient(
      process.env["VITE_SUPABASE_URL"]!,
      process.env["VITE_SUPABASE_PUBLISHABLE_KEY"]!,
      { auth: { persistSession: false } },
    );
    const { data: row, error } = await db
      .from("legal_pages")
      .select(SELECT)
      .eq("slug", data.slug)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row ? mapRow(row as Row) : null;
  });

export const listLegalPages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LegalPage[]> => {
    const { data, error } = await context.supabase
      .from("legal_pages")
      .select(SELECT)
      .order("slug", { ascending: true });
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map(mapRow);
  });

const saveSchema = z.object({
  slug: z.string().min(1).max(60),
  title: z.string().trim().min(2).max(200),
  content: z.string().min(1).max(200000),
  effective_date: z.string().max(20).optional().nullable(),
  is_active: z.boolean().optional(),
});

export const saveLegalPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => saveSchema.parse(raw))
  .handler(async ({ data, context }): Promise<string> => {
    const { data: id, error } = await context.supabase.rpc("staff_upsert_legal_page", {
      _payload: {
        slug: data.slug,
        title: data.title,
        content: data.content,
        effective_date: data.effective_date ?? null,
        is_active: data.is_active ?? true,
      },
    });
    if (error) throw new Error(error.message);
    return id as string;
  });
