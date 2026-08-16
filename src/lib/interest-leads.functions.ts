import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type BusinessLead = {
  id: string;
  business_name: string | null;
  owner_name: string;
  phone: string;
  category_interested: string;
  city: string;
  created_at: string;
};

export type CityLead = {
  id: string;
  name: string;
  phone: string;
  city: string;
  created_at: string;
};

export const getInterestLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ business: BusinessLead[]; city: CityLead[] }> => {
    const db = context.supabase;
    const [biz, city] = await Promise.all([
      db
        .from("business_interest_leads")
        .select("id, business_name, owner_name, phone, category_interested, city, created_at")
        .order("created_at", { ascending: false })
        .limit(500),
      db
        .from("city_interest_leads")
        .select("id, name, phone, city, created_at")
        .order("created_at", { ascending: false })
        .limit(500),
    ]);
    if (biz.error) throw new Error(biz.error.message);
    if (city.error) throw new Error(city.error.message);
    return {
      business: (biz.data ?? []) as BusinessLead[],
      city: (city.data ?? []) as CityLead[],
    };
  });
