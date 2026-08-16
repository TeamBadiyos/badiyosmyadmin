import { createFileRoute } from "@tanstack/react-router";
import { OG_IMAGE, SITE_URL } from "@/lib/brand";
import { LegalPageView } from "@/components/marketing/legal-page-view";

export const Route = createFileRoute("/privacy-policy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Badiyos" },
      {
        name: "description",
        content:
          "How Badiyos collects, uses, shares and protects your personal information across our website and apps.",
      },
      { property: "og:title", content: "Privacy Policy — Badiyos" },
      { property: "og:description", content: "How Badiyos handles and protects your data." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:url", content: `${SITE_URL}/privacy-policy` },
      { property: "og:image", content: OG_IMAGE },
      { name: "twitter:image", content: OG_IMAGE },
    ],
    links: [{ rel: "canonical", href: `${SITE_URL}/privacy-policy` }],
  }),
  component: () => <LegalPageView slug="privacy-policy" fallbackTitle="Privacy Policy" />,
});
