import { createFileRoute } from "@tanstack/react-router";
import { LegalPageView } from "@/components/marketing/legal-page-view";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms & Conditions — Badiyos" },
      {
        name: "description",
        content:
          "The terms that govern your use of the Badiyos platform, bookings, payments and services.",
      },
      { property: "og:title", content: "Terms & Conditions — Badiyos" },
      { property: "og:description", content: "Terms governing use of the Badiyos platform." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <LegalPageView slug="terms" fallbackTitle="Terms & Conditions" />,
});
