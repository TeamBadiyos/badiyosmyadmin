import { createFileRoute } from "@tanstack/react-router";
import { OG_IMAGE, SITE_URL } from "@/lib/brand";
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
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:url", content: `${SITE_URL}/terms` },
      { property: "og:image", content: OG_IMAGE },
      { name: "twitter:image", content: OG_IMAGE },
    ],
    links: [{ rel: "canonical", href: `${SITE_URL}/terms` }],
  }),
  component: () => <LegalPageView slug="terms" fallbackTitle="Terms & Conditions" />,
});
