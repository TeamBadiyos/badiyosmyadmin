import { createFileRoute } from "@tanstack/react-router";
import { OG_IMAGE, SITE_URL } from "@/lib/brand";
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
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:url", content: `${SITE_URL}/shipping-policy` },
      { property: "og:image", content: OG_IMAGE },
      { name: "twitter:image", content: OG_IMAGE },
    ],
    links: [{ rel: "canonical", href: `${SITE_URL}/shipping-policy` }],
  }),
  component: () => (
    <LegalPageView slug="shipping-policy" fallbackTitle="Shipping & Delivery Policy" />
  ),
});
