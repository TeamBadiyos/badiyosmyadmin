import { createFileRoute } from "@tanstack/react-router";
import { LegalPageView } from "@/components/marketing/legal-page-view";

export const Route = createFileRoute("/shipping-policy")({
  head: () => ({
    meta: [
      { title: "Shipping & Delivery Policy — Badiyos" },
      {
        name: "description",
        content:
          "How Badiyos service visits and, in future, product deliveries are scheduled, charged and delivered.",
      },
      { property: "og:title", content: "Shipping & Delivery Policy — Badiyos" },
      {
        property: "og:description",
        content: "Delivery timelines, charges and serviceable areas for Badiyos.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <LegalPageView slug="shipping-policy" fallbackTitle="Shipping & Delivery Policy" />
  ),
});
