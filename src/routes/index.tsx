import { createFileRoute, redirect } from "@tanstack/react-router";

// Entry route: always try the app; the `_authenticated` gate bounces
// unauthenticated users to /auth.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});
