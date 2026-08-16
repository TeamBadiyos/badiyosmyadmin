import { createFileRoute } from "@tanstack/react-router";
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
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <LegalPageView slug="privacy-policy" fallbackTitle="Privacy Policy" />,
});
