import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/myadmin")({
  beforeLoad: () => {
    throw redirect({ to: "/auth" });
  },
});
