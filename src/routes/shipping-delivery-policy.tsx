import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/shipping-delivery-policy")({
  beforeLoad: () => {
    throw redirect({ to: "/shipping-policy" });
  },
});
