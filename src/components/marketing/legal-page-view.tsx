import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MarketingShell } from "@/components/marketing/shell";
import { MarkdownView } from "@/components/markdown-view";
import { getLegalPage } from "@/lib/legal.functions";

export function LegalPageView({ slug, fallbackTitle }: { slug: string; fallbackTitle: string }) {
  const fetchPage = useServerFn(getLegalPage);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["legal-page", slug],
    queryFn: () => fetchPage({ data: { slug } }),
    staleTime: 60_000,
  });

  return (
    <MarketingShell>
      <article className="max-w-3xl mx-auto px-5 sm:px-8 pt-14 pb-20 sm:pt-20">
        <h1 className="text-[32px] sm:text-[42px] font-bold text-foreground tracking-tight">
          {data?.title ?? fallbackTitle}
        </h1>
        {data?.effectiveDate && (
          <p className="mt-3 text-[13px] text-muted-foreground">
            Effective{" "}
            {new Date(data.effectiveDate).toLocaleDateString("en-IN", { dateStyle: "long" })}
            {" · "}Last updated{" "}
            {new Date(data.lastUpdatedAt).toLocaleDateString("en-IN", { dateStyle: "long" })}
          </p>
        )}
        <div className="mt-8">
          {isLoading ? (
            <p className="text-[15px] text-muted-foreground">Loading…</p>
          ) : isError ? (
            <p className="text-[15px] text-muted-foreground">
              We couldn't load this page right now. Please try again shortly.
            </p>
          ) : !data ? (
            <p className="text-[15px] text-muted-foreground">This policy is not published yet.</p>
          ) : (
            <MarkdownView source={data.content.replace(/^# .*$\n?/m, "")} />
          )}
        </div>
      </article>
    </MarketingShell>
  );
}
