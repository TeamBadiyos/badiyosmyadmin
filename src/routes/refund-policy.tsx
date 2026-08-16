import { createFileRoute } from "@tanstack/react-router";
import { LegalPageView } from "@/components/marketing/legal-page-view";

export const Route = createFileRoute("/refund-policy")({
  head: () => ({
    meta: [
      { title: "Refund & Cancellation Policy — Badiyos" },
      {
        name: "description",
        content:
          "How cancellations, cancellation fees and refunds work for Badiyos bookings, including timelines.",
      },
      { property: "og:title", content: "Refund & Cancellation Policy — Badiyos" },
      {
        property: "og:description",
        content: "Cancellation fees and refund timelines for Badiyos bookings.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <LegalPageView slug="refund-policy" fallbackTitle="Refund & Cancellation Policy" />
  ),
});
