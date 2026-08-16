import { createFileRoute } from "@tanstack/react-router";
import { OG_IMAGE, SITE_URL } from "@/lib/brand";
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
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:url", content: `${SITE_URL}/refund-policy` },
      { property: "og:image", content: OG_IMAGE },
      { name: "twitter:image", content: OG_IMAGE },
    ],
    links: [{ rel: "canonical", href: `${SITE_URL}/refund-policy` }],
  }),
  component: () => (
    <LegalPageView slug="refund-policy" fallbackTitle="Refund & Cancellation Policy" />
  ),
});
