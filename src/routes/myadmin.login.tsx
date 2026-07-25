import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/myadmin/login")({
  beforeLoad: () => {
    throw redirect({ to: "/auth" });
  },
});
