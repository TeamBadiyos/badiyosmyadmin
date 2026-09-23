import { getMapsBrowserKey } from "@/lib/zones.functions";

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    google?: any;
    __badiyosInitMap?: () => void;
  }
}

// Loads the Maps JS API once, using the project's own browser key fetched
// from the server (never hardcoded). Shared by zones and live tracking.
let mapsLoadPromise: Promise<void> | null = null;

export function loadGoogleMaps(): Promise<void> {
  if (typeof window !== "undefined" && window.google?.maps) {
    return Promise.resolve();
  }
  if (mapsLoadPromise) return mapsLoadPromise;
  mapsLoadPromise = (async () => {
    const key = await getMapsBrowserKey();
    if (window.google?.maps) return;
    await new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(
        'script[data-badiyos-gmaps="1"]',
      );
      if (existing) {
        const iv = window.setInterval(() => {
          if (window.google?.maps) {
            window.clearInterval(iv);
            resolve();
          }
        }, 100);
        return;
      }
      window.__badiyosInitMap = () => resolve();
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&loading=async&callback=__badiyosInitMap`;
      script.async = true;
      script.defer = true;
      script.dataset.badiyosGmaps = "1";
      script.onerror = () => reject(new Error("Failed to load Google Maps."));
      document.head.appendChild(script);
    });
  })().catch((err) => {
    mapsLoadPromise = null;
    throw err;
  });
  return mapsLoadPromise;
}
