import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { toast } from "sonner";
import { Camera, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const Route = createFileRoute("/_authenticated/scan-redeem")({
  head: () => ({
    meta: [
      { title: "Scan & Redeem — Badiyos Command Center" },
      { name: "description", content: "Scan Spin & Win prize QR codes and redeem them at the gate." },
      { property: "og:title", content: "Scan & Redeem — Badiyos" },
      { property: "og:description", content: "Staff prize redemption scanner." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ScanRedeem,
});

type Check = {
  status: "valid" | "used" | "expired" | "not_found";
  code?: string; prize?: string; winner?: string; phone_masked?: string; won_at?: string;
  expires_at?: string; redeemed_at?: string; gate_label?: string; redeemed_by?: string;
};
const fmt = (v?: string | null) => (v ? new Date(v).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "");

function ScanRedeem() {
  const [gate, setGate] = useState("");
  const [code, setCode] = useState("");
  const [res, setRes] = useState<Check | null>(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => { setGate(localStorage.getItem("scan_gate") ?? ""); }, []);
  useEffect(() => { localStorage.setItem("scan_gate", gate); }, [gate]);

  const check = async (c: string) => {
    const v = c.trim().toUpperCase(); if (!v) return;
    setCode(v);
    const { data, error } = await db.rpc("staff_spin_scan_check", { _code: v });
    if (error) return toast.error(error.message);
    setRes(data as Check);
  };

  useEffect(() => {
    if (!scanning) return;
    let stream: MediaStream | null = null; let raf = 0; let stop = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current) return;
        video.current.srcObject = stream; await video.current.play();
        const tick = () => {
          if (stop) return;
          const v = video.current, cv = canvas.current;
          if (v && cv && v.readyState === v.HAVE_ENOUGH_DATA) {
            cv.width = v.videoWidth; cv.height = v.videoHeight;
            const ctx = cv.getContext("2d")!; ctx.drawImage(v, 0, 0);
            const img = ctx.getImageData(0, 0, cv.width, cv.height);
            const q = jsQR(img.data, img.width, img.height);
            if (q?.data) { setScanning(false); check(q.data); return; }
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch { toast.error("Camera not available — type the code instead"); setScanning(false); }
    })();
    return () => { stop = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, [scanning]);

  const redeem = async () => {
    setBusy(true);
    const { data, error } = await db.rpc("staff_spin_scan_redeem", { _code: code, _gate: gate });
    setBusy(false);
    if (error) return toast.error(error.message);
    if (data.ok) { toast.success("Redeemed"); check(code); } else setRes({ ...(res ?? {}), ...data });
  };

  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <h1 className="text-xl font-semibold">Scan & Redeem</h1>
      <Input placeholder="Gate / counter (e.g. Main Gate)" value={gate} onChange={(e) => setGate(e.target.value)} />
      {scanning ? (
        <div className="space-y-2">
          <video ref={video} className="w-full rounded-lg border" playsInline muted />
          <canvas ref={canvas} className="hidden" />
          <Button variant="outline" className="w-full" onClick={() => setScanning(false)}>Stop camera</Button>
        </div>
      ) : (
        <Button className="h-14 w-full text-base" onClick={() => { setRes(null); setScanning(true); }}><Camera className="mr-2 h-5 w-5" />Scan prize QR</Button>
      )}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); check(code); }}>
        <Input placeholder="Or type the code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        <Button type="submit" variant="secondary">Check</Button>
      </form>

      {res && (
        <div className={`space-y-2 rounded-xl border-2 p-4 ${res.status === "valid" ? "border-primary bg-primary/10" : "border-destructive bg-destructive/10"}`}>
          <div className="flex items-center gap-2 text-lg font-semibold">
            {res.status === "valid" && <><CheckCircle2 className="h-6 w-6 text-primary" />Valid</>}
            {res.status === "used" && <><XCircle className="h-6 w-6 text-destructive" />Already used</>}
            {res.status === "expired" && <><AlertTriangle className="h-6 w-6 text-destructive" />Expired</>}
            {res.status === "not_found" && <><XCircle className="h-6 w-6 text-destructive" />Not found</>}
          </div>
          {res.prize && <p className="text-base font-medium">{res.prize}</p>}
          {res.winner !== undefined && <p className="text-sm">{res.winner ?? "—"} · {res.phone_masked}</p>}
          {res.status === "used" && <p className="text-sm">Redeemed {fmt(res.redeemed_at)}{res.gate_label ? ` at ${res.gate_label}` : ""}{res.redeemed_by ? ` by ${res.redeemed_by}` : " (in app)"}</p>}
          {res.status === "expired" && <p className="text-sm">Expired {fmt(res.expires_at)}</p>}
          {res.status === "valid" && <Button className="h-12 w-full" disabled={busy} onClick={redeem}>Redeem</Button>}
        </div>
      )}
    </div>
  );
}
