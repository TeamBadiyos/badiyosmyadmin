import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { BellRing, Plus, X, MessageSquareWarning, Timer } from "lucide-react";
import {
  getDispatchConfigs,
  updateDispatchConfig,
  listDispatchAlertEvents,
  type DispatchConfig,
} from "@/lib/dispatch-alerts.functions";

function CityCard({ cfg, onSaved }: { cfg: DispatchConfig; onSaved: () => void }) {
  const save = useServerFn(updateDispatchConfig);
  const [minutes, setMinutes] = useState(
    Math.round(cfg.no_accept_alert_threshold_seconds / 60).toString(),
  );
  const [windowMin, setWindowMin] = useState(cfg.almost_available_window_minutes.toString());
  const [template, setTemplate] = useState(cfg.aisensy_template_name ?? "");
  const [numbers, setNumbers] = useState<string[]>(cfg.ops_alert_whatsapp_numbers ?? []);
  const [newNumber, setNewNumber] = useState("");
  const [busy, setBusy] = useState(false);

  async function saveAll() {
    const mins = parseInt(minutes, 10);
    const win = parseInt(windowMin, 10);
    if (!mins || mins < 1 || mins > 60) {
      toast.error("No-accept threshold must be 1–60 minutes");
      return;
    }
    if (!win || win < 1 || win > 120) {
      toast.error("Almost-available window must be 1–120 minutes");
      return;
    }
    setBusy(true);
    try {
      await save({
        data: {
          id: cfg.id,
          no_accept_alert_threshold_seconds: mins * 60,
          almost_available_window_minutes: win,
          aisensy_template_name: template.trim() || null,
          ops_alert_whatsapp_numbers: numbers,
        },
      });
      toast.success(`Saved dispatch alerts for ${cfg.city}`);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[16px] border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <BellRing size={16} className="text-primary" />
        <h3 className="text-[15px] font-bold text-foreground">{cfg.city}</h3>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-[12px] font-semibold text-muted-foreground">
            No-accept alert threshold (minutes)
          </span>
          <input
            type="number"
            min={1}
            max={60}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            className="mt-1 w-full rounded-[10px] border border-border bg-background px-3 py-2 text-[13px] text-foreground"
          />
        </label>
        <label className="block">
          <span className="text-[12px] font-semibold text-muted-foreground">
            "Almost available" window (minutes)
          </span>
          <input
            type="number"
            min={1}
            max={120}
            value={windowMin}
            onChange={(e) => setWindowMin(e.target.value)}
            className="mt-1 w-full rounded-[10px] border border-border bg-background px-3 py-2 text-[13px] text-foreground"
          />
        </label>
      </div>

      <label className="mt-4 block">
        <span className="text-[12px] font-semibold text-muted-foreground">
          AiSensy template name (plain text — fill in when the template is ready)
        </span>
        <input
          type="text"
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          placeholder="e.g. ops_dispatch_alert"
          className="mt-1 w-full rounded-[10px] border border-border bg-background px-3 py-2 text-[13px] text-foreground"
        />
      </label>

      <div className="mt-4">
        <span className="text-[12px] font-semibold text-muted-foreground">
          WhatsApp numbers receiving ops alerts
        </span>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {numbers.map((n) => (
            <span
              key={n}
              className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[12px] font-semibold text-primary"
            >
              {n}
              <button
                onClick={() => setNumbers(numbers.filter((x) => x !== n))}
                aria-label={`Remove ${n}`}
                className="text-primary/60 hover:text-primary"
              >
                <X size={12} />
              </button>
            </span>
          ))}
          {numbers.length === 0 && (
            <span className="text-[12px] text-muted-foreground">No numbers yet</span>
          )}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            type="tel"
            value={newNumber}
            onChange={(e) => setNewNumber(e.target.value)}
            placeholder="+91…"
            className="flex-1 rounded-[10px] border border-border bg-background px-3 py-2 text-[13px] text-foreground"
          />
          <button
            onClick={() => {
              const v = newNumber.trim();
              if (!v) return;
              if (numbers.includes(v)) return;
              if (numbers.length >= 10) {
                toast.error("Maximum 10 numbers");
                return;
              }
              setNumbers([...numbers, v]);
              setNewNumber("");
            }}
            className="flex items-center gap-1 rounded-[10px] bg-primary px-3 py-2 text-[12px] font-bold text-primary-foreground"
          >
            <Plus size={13} /> Add
          </button>
        </div>
      </div>

      <button
        onClick={saveAll}
        disabled={busy}
        className="mt-5 rounded-[10px] bg-primary px-4 py-2 text-[13px] font-bold text-primary-foreground disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

export function DispatchAlertsPage() {
  const queryClient = useQueryClient();
  const fetchConfigs = useServerFn(getDispatchConfigs);
  const fetchEvents = useServerFn(listDispatchAlertEvents);

  const { data: configs } = useQuery({
    queryKey: ["dispatch", "configs"],
    queryFn: () => fetchConfigs(),
  });
  const { data: events } = useQuery({
    queryKey: ["dispatch", "alert-events"],
    queryFn: () => fetchEvents(),
    refetchInterval: 60_000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["dispatch"] });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-[17px] font-bold text-foreground">Dispatch Alerts</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Get alerted in the notification bell (and on WhatsApp, once AiSensy is live) when a
          booking waits too long for an expert. WhatsApp sending is currently a placeholder — events
          are logged, nothing is delivered yet.
        </p>
      </div>

      {(configs ?? []).map((c) => (
        <CityCard key={c.id} cfg={c} onSaved={refresh} />
      ))}

      <div className="rounded-[16px] border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <Timer size={16} className="text-primary" />
          <h3 className="text-[15px] font-bold text-foreground">Recent alerts</h3>
        </div>
        {(events ?? []).length === 0 && (
          <p className="mt-3 text-[13px] text-muted-foreground">No alerts triggered yet.</p>
        )}
        <div className="mt-3 divide-y divide-border">
          {(events ?? []).map((e) => (
            <div key={e.id} className="flex items-center gap-3 py-2.5">
              <MessageSquareWarning
                size={15}
                className={e.alert_type === "zero_capacity" ? "text-amber-600" : "text-destructive"}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-foreground">
                  {e.alert_type === "no_accept" ? "No expert accepted" : "Zero capacity"}
                  {e.service_label ? ` — ${e.service_label}` : ""}
                </p>
                <p className="text-[12px] text-muted-foreground">
                  {e.city ?? "Unknown city"} ·{" "}
                  {new Date(e.triggered_at).toLocaleString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · WhatsApp {e.whatsapp_sent ? "processed" : "pending"}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
