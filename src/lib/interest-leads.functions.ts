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

export type ContactLead = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  area: string;
  status: string;
  created_at: string;
};

export type LeadStatus = "new" | "contacted" | "converted" | "rejected";

export const getInterestLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{
      business: BusinessLead[];
      city: CityLead[];
      partner: ContactLead[];
      expert: ContactLead[];
    }> => {
      const db = context.supabase;
      const [biz, city, expert] = await Promise.all([
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
        db
          .from("expert_leads")
          .select("id, name, phone, email, area, status, created_at")
          .order("created_at", { ascending: false })
          .limit(500),
      ]);
      if (biz.error) throw new Error(biz.error.message);
      if (city.error) throw new Error(city.error.message);
      if (expert.error) throw new Error(expert.error.message);
      return {
        business: (biz.data ?? []) as BusinessLead[],
        city: (city.data ?? []) as CityLead[],
        partner: [] as ContactLead[],
        expert: (expert.data ?? []) as ContactLead[],
      };
    },
  );

export const setLeadStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { kind: "area_partner" | "expert"; id: string; status: LeadStatus }) => {
    if (input.kind !== "area_partner" && input.kind !== "expert") throw new Error("Invalid lead type.");
    if (!input.id) throw new Error("Lead is required.");
    if (!["new", "contacted", "converted", "rejected"].includes(input.status))
      throw new Error("Invalid status.");
    return input;
  })
  .handler(async ({ context, data }): Promise<boolean> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (context.supabase as any).rpc("staff_set_lead_status", {
      _kind: data.kind,
      _lead_id: data.id,
      _status: data.status,
    });
    if (error) throw new Error(error.message);
    return true;
  });
