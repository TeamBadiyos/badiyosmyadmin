// Chrome / desktop notifications + a short chime for the Command Center.
const PREF_KEY = "cc-browser-notify";

export function notifySupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notifyEnabled() {
  if (!notifySupported()) return false;
  return Notification.permission === "granted" && localStorage.getItem(PREF_KEY) !== "off";
}

export async function enableNotify(): Promise<boolean> {
  if (!notifySupported()) return false;
  const p = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (p === "granted") localStorage.setItem(PREF_KEY, "on");
  return p === "granted";
}

export function disableNotify() {
  localStorage.setItem(PREF_KEY, "off");
}

let audioCtx: AudioContext | null = null;
export function playChime() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx ?? new Ctx();
    const ctx = audioCtx;
    [880, 1320].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq;
      o.type = "sine";
      const t = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.4);
    });
  } catch {
    /* ignore */
  }
}

export function showBrowserNotification(
  title: string,
  body: string,
  tag: string,
  onClick?: () => void,
) {
  playChime();
  if (!notifyEnabled()) return;
  try {
    const n = new Notification(title, { body, tag, icon: "/favicon.png" });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
  } catch {
    /* some mobile browsers only allow service-worker notifications */
  }
}
