import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

// Auth gate for the whole admin shell.
// ssr:false because Supabase stores the session in localStorage — the server
// cannot read it, so gating server-side would loop on hard refresh.
export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth" });
    }

    // Must be a currently-active staff_users row (RLS allows self-read).
    const { data: staff, error: staffError } = await supabase
      .from("staff_users")
      .select("id, name, role, status")
      .eq("auth_user_id", data.user.id)
      .maybeSingle();

    if (staffError || !staff || staff.status !== "active") {
      await supabase.auth.signOut();
      throw redirect({ to: "/auth" });
    }

    return { staff };
  },
  component: () => <Outlet />,
});
