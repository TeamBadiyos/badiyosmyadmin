import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/refund-cancellation-policy")({
  beforeLoad: () => {
    throw redirect({ to: "/refund-policy" });
  },
});
