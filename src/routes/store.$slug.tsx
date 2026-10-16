import { createFileRoute, notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Clock, Download, MapPin, Smartphone, Star, Store } from "lucide-react";
import { getPublicStorePage } from "@/lib/public-store.functions";
import { PLAY_STORE_URL } from "@/lib/playstore.functions";
import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/badiyos-wordmark-green.png.asset.json";

const PKG = "com.badiyos.customer";

export const Route = createFileRoute("/store/$slug")({
  loader: async ({ params }) => {
    const s = await getPublicStorePage({ data: { slug: params.slug } });
    if (!s) throw notFound();
    return s;
  },
  head: ({ loaderData: s, params }) => {
    const title = s ? `${s.name}${s.area ? ` · ${s.area}` : ""} — order on badiyos` : "Store — badiyos";
    const desc = s ? `Order from ${s.name}${s.type ? ` (${s.type})` : ""} on badiyos. Fast delivery to your door.` : "Order from local stores on badiyos.";
    const url = `https://badiyos.com/store/${params.slug}`;
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:type", content: "website" },
        { property: "og:url", content: url },
        { name: "twitter:card", content: s?.photo ? "summary_large_image" : "summary" },
        ...(s?.photo ? [{ property: "og:image", content: s.photo }, { name: "twitter:image", content: s.photo }] : []),
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: StorePage,
  notFoundComponent: () => (
    <Shell>
      <div className="rounded-3xl bg-card p-8 text-center shadow-sm">
        <Store className="mx-auto h-10 w-10 text-muted-foreground" />
        <h1 className="mt-3 text-lg font-bold text-foreground">Store not found</h1>
        <p className="mt-1 text-sm text-muted-foreground">This link may be old or the store is not live.</p>
        <a href={PLAY_STORE_URL} className="mt-6 block rounded-2xl bg-primary py-3.5 text-sm font-bold text-primary-foreground">Download badiyos</a>
      </div>
    </Shell>
  ),
  errorComponent: () => (
    <Shell><p className="text-center text-sm text-muted-foreground">Could not load this store. Please try again.</p></Shell>
  ),
});

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-muted/40 px-4 py-6">
      <div className="mx-auto w-full max-w-md">
        <img src={logo.url} alt="badiyos" className="mx-auto mb-5 h-7 w-auto" />
        {children}
        <p className="mt-6 text-center text-xs text-muted-foreground">badiyos — har ghar ka apna saathi</p>
      </div>
    </main>
  );
}

function StorePage() {
  const s = Route.useLoaderData();
  const [imgOk, setImgOk] = useState(true);

  // Count this visit for the merchant's Insights (tagged as a link visit).
  useEffect(() => {
    try {
      const k = "badiyos.linkVisitor";
      let id = localStorage.getItem(k);
      if (!id) { id = crypto.randomUUID(); localStorage.setItem(k, id); }
      void supabase.rpc("record_merchant_store_visit", { _merchant_id: s.id, _session_id: `link:${id}` });
    } catch { /* analytics never breaks the page */ }
  }, [s.id]);

  const appLink = `https://user.badiyos.com/store/${encodeURIComponent(s.slug)}`;
  const openApp = () => {
    if (/android/i.test(navigator.userAgent)) {
      window.location.href = `intent://user.badiyos.com/store/${encodeURIComponent(s.slug)}#Intent;scheme=https;package=${PKG};S.browser_fallback_url=${encodeURIComponent(PLAY_STORE_URL)};end`;
    } else {
      window.location.href = appLink;
    }
  };

  return (
    <Shell>
      <article className="overflow-hidden rounded-3xl bg-card shadow-sm">
        <div className="relative aspect-[16/10] bg-muted">
          {s.photo && imgOk ? (
            <img src={s.photo} alt={s.name} onError={() => setImgOk(false)} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center"><Store className="h-14 w-14 text-muted-foreground" /></div>
          )}
          <span className={`absolute left-3 top-3 rounded-full px-3 py-1 text-xs font-bold shadow ${s.openNow ? "bg-primary text-primary-foreground" : "bg-destructive text-destructive-foreground"}`}>
            {s.openNow ? "Open now" : "Closed"}
          </span>
        </div>
        <div className="space-y-3 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-extrabold leading-tight text-foreground">{s.name}</h1>
              {s.type && <p className="mt-0.5 text-sm font-medium text-primary">{s.type}</p>}
            </div>
            {s.rating != null && (
              <div className="flex shrink-0 items-center gap-1 rounded-xl bg-primary/10 px-2.5 py-1 text-sm font-bold text-primary">
                <Star className="h-4 w-4 fill-current" /> {s.rating.toFixed(1)}
                <span className="text-xs font-medium text-muted-foreground">({s.ratingCount})</span>
              </div>
            )}
          </div>
          {s.area && <p className="flex items-center gap-2 text-sm text-muted-foreground"><MapPin className="h-4 w-4 shrink-0" /> {s.area}</p>}
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4 shrink-0" /> Today: {s.todayHours ?? "Hours not set"}
          </p>
        </div>
      </article>

      <div className="mt-5 space-y-3">
        <button type="button" onClick={openApp} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 text-base font-bold text-primary-foreground shadow-sm active:scale-[0.99]">
          <Smartphone className="h-5 w-5" /> Open in badiyos app
        </button>
        <a href={PLAY_STORE_URL} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-card py-4 text-base font-bold text-foreground active:scale-[0.99]">
          <Download className="h-5 w-5" /> Download badiyos
        </a>
      </div>
    </Shell>
  );
}
