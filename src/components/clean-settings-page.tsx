import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, MessageSquare, ListChecks, UserCog } from "lucide-react";
import { toast } from "sonner";
import { useCity } from "@/lib/city-scope";
import { ServiceHoursPanel } from "@/components/ops-panels";
import { BookingRulesPanel, ExpertRulesPanel } from "@/components/booking-timings-tab";
import { CapacityMessagesPage } from "@/components/capacity-messages-page";
import { CancelPolicyEditor } from "@/components/cancel-rules";
import { getLastSlotGap, setLastSlotGap, type CapGroup } from "@/lib/booking-settings.functions";

const SECTIONS = [
  { key: "timings", label: "Timings", icon: CalendarClock, help: "Opening hours, weekly off, holidays and closing for today." },
  { key: "booking", label: "Booking rules", icon: ListChecks, help: "How slots, dispatch and auto-cancel work." },
  { key: "expert", label: "Expert rules", icon: UserCog, help: "Deadlines and reminders for the assigned expert." },
  { key: "messages", label: "Customer messages", icon: MessageSquare, help: "What customers see when slots are full or busy." },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];

function LastSlotGapRow({ group }: { group: CapGroup }) {
  const { cityId } = useCity();
  const qc = useQueryClient();
  const getFn = useServerFn(getLastSlotGap);
  const setFn = useServerFn(setLastSlotGap);
  const q = useQuery({ queryKey: ["last-slot-gap", group, cityId], queryFn: () => getFn({ data: { group, cityId } }) });
  const [v, setV] = useState<string | null>(null);
  const val = v ?? (q.data ? String(q.data.minutes) : "");
  const mut = useMutation({
    mutationFn: () => setFn({ data: { group, minutes: Number(v), cityId } }),
    onSuccess: () => { toast.success("Saved"); setV(null); qc.invalidateQueries({ queryKey: ["last-slot-gap"] }); qc.invalidateQueries({ queryKey: ["slot-cap"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-[12px] border border-border px-4 py-3">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-foreground">Last slot before closing</p>
        <p className="text-[12px] text-muted-foreground">The last slot starts this many minutes before closing time.</p>
      </div>
      <div className="flex items-center gap-2">
        <input type="number" min={0} max={600} value={val} onChange={(e) => setV(e.target.value)} aria-label="Last slot before closing"
          className="h-10 w-24 rounded-[10px] border border-border bg-card px-3 text-[14px] text-foreground" />
        <span className="text-[12px] text-muted-foreground">min</span>
        <button disabled={v == null || v === "" || mut.isPending || q.data?.canEdit === false} onClick={() => mut.mutate()}
          className="h-10 rounded-[10px] bg-primary px-4 text-[13px] font-bold text-primary-foreground disabled:opacity-50">Save</button>
      </div>
    </div>
  );
}

export function CleanSettingsPage({ group }: { group: CapGroup }) {
  const [sec, setSec] = useState<SectionKey>("timings");
  const cur = SECTIONS.find((s) => s.key === sec)!;
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start">
      <nav className="flex gap-2 overflow-x-auto md:w-52 md:shrink-0 md:flex-col md:gap-1 md:overflow-visible">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const on = s.key === sec;
          return (
            <button key={s.key} type="button" onClick={() => setSec(s.key)}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-[10px] px-3 py-2 text-left text-[13px] font-semibold ${on ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted border border-border md:border-transparent"}`}>
              <Icon size={15} /> {s.label}
            </button>
          );
        })}
      </nav>
      <div className="min-w-0 max-w-3xl flex-1 space-y-4">
        <div>
          <h2 className="text-[17px] font-bold text-foreground">{cur.label}</h2>
          <p className="text-[12px] text-muted-foreground">{cur.help}</p>
        </div>
        {sec === "timings" ? (
          <ServiceHoursPanel key={group} serviceKey={group} title="Opening hours" afterHours={<LastSlotGapRow group={group} />} />
        ) : sec === "booking" ? (
          <BookingRulesPanel group={group} />
        ) : sec === "expert" ? (
          <ExpertRulesPanel />
        ) : (
          <div className="space-y-4"><CapacityMessagesPage /><CancelPolicyEditor key={group} group={group} /></div>
        )}
      </div>
    </div>
  );
}
