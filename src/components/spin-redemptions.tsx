import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type Row = {
  id: string; winner: string | null; phone: string; phone_masked: string; prize: string; code: string;
  status: "won" | "pending_undo" | "redeemed" | "expired"; won_at: string; redeemed_at: string | null;
  method: string | null; gate: string | null; staff: string | null; reason: string | null;
};
const fmt = (v?: string | null) => (v ? new Date(v).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "");
const LABEL = { won: "Won", pending_undo: "Redeeming", redeemed: "Redeemed", expired: "Expired" } as const;

export function SpinRedemptions({ eventId, name, onClose }: { eventId: string; name: string; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [mark, setMark] = useState<Row | null>(null);
  const [reason, setReason] = useState(""); const [gate, setGate] = useState("");
  const data = useQuery({
    queryKey: ["spin-redemptions", eventId], refetchInterval: 10000,
    queryFn: async () => {
      const { data, error } = await db.rpc("staff_spin_redemptions", { _event_id: eventId });
      if (error) throw error;
      return data as { stock: number; unlimited: boolean; rows: Row[] };
    },
  });
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await db.rpc("staff_spin_mark_redeemed", { _draw_id: mark!.id, _reason: reason, _gate: gate });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Marked redeemed"); setMark(null); setReason(""); data.refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = data.data?.rows ?? [];
  const digits = q.replace(/\D/g, "");
  const list = rows.filter((r) => !q || (digits && r.phone.includes(digits)) || (r.winner ?? "").toLowerCase().includes(q.toLowerCase()) || r.code?.includes(q.toUpperCase()));
  const won = rows.length, redeemed = rows.filter((r) => r.status === "redeemed").length;
  const expired = rows.filter((r) => r.status === "expired").length;
  const by = (r: Row) => r.method === "app" ? "Customer app" : [r.staff, r.gate].filter(Boolean).join(" · ");
  const csv = () => {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = rows.map((r) => [r.winner, r.phone, r.prize, r.code, LABEL[r.status], fmt(r.won_at), fmt(r.redeemed_at), by(r), r.reason].map(esc).join(","));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([["Winner,Phone,Prize,Code,Status,Won (IST),Redeemed (IST),By / gate,Reason", ...lines].join("\n")], { type: "text/csv" }));
    a.download = `spin-redemptions-${name.replace(/\W+/g, "-")}.csv`; a.click();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader><DialogTitle>Redemptions — {name}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-4 gap-2 text-center">
          {[["Stock", data.data?.unlimited ? "∞" : data.data?.stock], ["Won", won], ["Redeemed", redeemed], ["Pending", won - redeemed - expired]].map(([l, v]) => (
            <div key={l as string} className="rounded-md border p-2"><div className="text-lg font-semibold">{v ?? "—"}</div><div className="text-xs text-muted-foreground">{l}</div></div>
          ))}
        </div>
        <div className="flex gap-2">
          <Input placeholder="Search phone, name or code" value={q} onChange={(e) => setQ(e.target.value)} />
          <Button variant="outline" onClick={csv}><Download className="mr-1 h-4 w-4" />CSV</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="p-2">Winner</th><th>Prize</th><th>Status</th><th>Won</th><th>Redeemed</th><th>Staff / gate</th><th /></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{r.winner ?? "—"}<div className="text-xs text-muted-foreground">{r.phone_masked} · {r.code}</div></td>
                  <td>{r.prize}</td>
                  <td><Badge variant={r.status === "redeemed" ? "default" : r.status === "expired" ? "destructive" : "secondary"}>{LABEL[r.status]}</Badge></td>
                  <td className="text-xs">{fmt(r.won_at)}</td>
                  <td className="text-xs">{fmt(r.redeemed_at)}</td>
                  <td className="text-xs">{by(r)}{r.reason ? <div className="text-muted-foreground">Manual: {r.reason}</div> : null}</td>
                  <td>{r.status === "won" || r.status === "expired" ? <Button size="sm" variant="outline" onClick={() => setMark(r)}>Mark redeemed</Button> : null}</td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">No prizes won yet.</td></tr>}
            </tbody>
          </table>
        </div>
        {mark && (
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-medium">Mark {mark.prize} for {mark.winner ?? mark.phone_masked} as redeemed</p>
            <Input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Input placeholder="Gate / counter" value={gate} onChange={(e) => setGate(e.target.value)} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setMark(null)}>Cancel</Button>
              <Button disabled={reason.trim().length < 3 || save.isPending} onClick={() => save.mutate()}>Confirm</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
