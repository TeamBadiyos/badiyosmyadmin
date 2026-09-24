import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ChevronDown, Info, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { CapacityMessagesPage } from "@/components/capacity-messages-page";
import {
  ServiceStatusCard,
  ServiceStatusSection,
} from "@/components/courier/service-status-section";
import {
  ServiceHoursEditor,
  ServicePreviewTable,
} from "@/components/courier/service-hours-section";
import { getCourierAccess, listServiceFlags } from "@/lib/courier.functions";
import { listServiceControl } from "@/lib/service-control.functions";
import { listSegments, setSegmentActive, type Segment } from "@/lib/segments.functions";

type ServicesTab = "controls" | "capacity";

const SERVICE_ORDER = ["clean", "store", "courier"] as const;
const SEGMENT_SLUG_BY_SERVICE: Partial<Record<(typeof SERVICE_ORDER)[number], string>> = {
  clean: "clean",
  store: "store",
};

function Toggle({
  on,
  disabled,
  label,
  onChange,
}: {
  on: boolean;
  disabled: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
        on ? "bg-primary" : "bg-border"
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-all ${
          on ? "left-[22px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

export function ServicesPage() {
  const queryClient = useQueryClient();
  const fetchAccess = useServerFn(getCourierAccess);
  const fetchFlags = useServerFn(listServiceFlags);
  const fetchControl = useServerFn(listServiceControl);
  const fetchSegments = useServerFn(listSegments);
  const toggleSegment = useServerFn(setSegmentActive);

  const [tab, setTab] = useState<ServicesTab>("controls");
  const [city, setCity] = useState("Latur");
  const [openService, setOpenService] = useState<string | null>("clean");
  const [busySegment, setBusySegment] = useState<string | null>(null);

  const accessQuery = useQuery({
    queryKey: ["services", "access"],
    queryFn: () => fetchAccess(),
    retry: false,
  });
  const flagsQuery = useQuery({
    queryKey: ["services", "flags"],
    queryFn: () => fetchFlags(),
  });
  const controlQuery = useQuery({
    queryKey: ["services", "control"],
    queryFn: () => fetchControl(),
  });
  const segmentsQuery = useQuery({
    queryKey: ["services", "segments"],
    queryFn: () => fetchSegments(),
  });

  const cities = useMemo(
    () => Array.from(new Set((controlQuery.data?.flags ?? []).map((flag) => flag.city))).sort(),
    [controlQuery.data?.flags],
  );
  const activeCity = cities.includes(city) ? city : (cities[0] ?? city);
  const cityFlags = (controlQuery.data?.flags ?? [])
    .filter((flag) => flag.city === activeCity)
    .sort(
      (a, b) =>
        SERVICE_ORDER.indexOf(a.service_key as (typeof SERVICE_ORDER)[number]) -
        SERVICE_ORDER.indexOf(b.service_key as (typeof SERVICE_ORDER)[number]),
    );
  const activeOrdersByKey = new Map(
    (flagsQuery.data ?? [])
      .filter((flag) => flag.city === activeCity)
      .map((flag) => [flag.service_key, flag.activeOrders]),
  );
  const segmentsBySlug = new Map(
    (segmentsQuery.data ?? []).map((segment) => [segment.slug, segment]),
  );
  const canWrite = Boolean(accessQuery.data?.canWrite && controlQuery.data?.canWrite);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["services"] });
    queryClient.invalidateQueries({ queryKey: ["segments"] });
    queryClient.invalidateQueries({ queryKey: ["courier"] });
  }

  async function setShown(segment: Segment, active: boolean) {
    setBusySegment(segment.id);
    try {
      await toggleSegment({ data: { id: segment.id, active } });
      toast.success(active ? "Service shown in app" : "Service hidden from app");
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Update failed");
    } finally {
      setBusySegment(null);
    }
  }

  if (accessQuery.isLoading || controlQuery.isLoading || flagsQuery.isLoading) {
    return <p className="text-[13px] text-muted-foreground">Loading services…</p>;
  }
  if (accessQuery.isError || controlQuery.isError || !accessQuery.data || !controlQuery.data) {
    return <p className="text-[13px] text-muted-foreground">You do not have access to service controls.</p>;
  }

  return (
    <div className="space-y-5">
      {!canWrite ? (
        <div className="rounded-[12px] border border-border bg-muted px-4 py-2 text-[12px] text-muted-foreground">
          Read-only access — only a super admin can change service settings.
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {([
            ["controls", "Service Controls"],
            ["capacity", "Capacity Messages"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-[10px] px-3.5 py-2 text-[12px] font-semibold ${
                tab === key
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-foreground hover:bg-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "controls" ? (
          <label className="flex items-center gap-2 text-[12px] font-semibold text-muted-foreground">
            City
            <select
              value={activeCity}
              onChange={(event) => {
                setCity(event.target.value);
                setOpenService(null);
              }}
              className="rounded-[10px] border border-border bg-card px-3 py-2 text-[13px] text-foreground"
            >
              {cities.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {tab === "capacity" ? <CapacityMessagesPage /> : null}

      {tab === "controls" ? (
        <>
          <div className="space-y-3">
            {cityFlags.map((flag) => {
              const serviceKey = flag.service_key as (typeof SERVICE_ORDER)[number];
              const segmentSlug = SEGMENT_SLUG_BY_SERVICE[serviceKey];
              const segment = segmentSlug ? segmentsBySlug.get(segmentSlug) : undefined;
              const showInApp = serviceKey === "courier" ? null : (segment?.is_active ?? false);
              const statusLive = (flag.status || "live") === "live";
              const warning =
                showInApp === false && statusLive
                  ? "Customers cannot see this service in the app"
                  : showInApp === true && !statusLive
                    ? "Visible in app but not taking orders"
                    : null;
              const expanded = openService === flag.service_key;

              return (
                <section key={flag.id} className="overflow-hidden rounded-[16px] border border-border bg-card">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setOpenService(expanded ? null : flag.service_key)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <SlidersHorizontal size={16} className="shrink-0 text-primary" />
                      <span className="text-[15px] font-bold text-foreground">{flag.label ?? flag.service_key}</span>
                      <span className="rounded-full bg-info/10 px-2 py-0.5 text-[11px] font-semibold text-info">
                        {flag.city}
                      </span>
                      <ChevronDown
                        size={16}
                        className={`ml-auto shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
                      />
                    </button>
                    {serviceKey === "courier" ? (
                      <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                        <Info size={13} /> Opens from the Send Parcel button
                      </span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-semibold text-foreground">Show in app</span>
                        <Toggle
                          on={Boolean(segment?.is_active)}
                          disabled={!canWrite || !segment || busySegment === segment.id}
                          label={`Show ${flag.label ?? flag.service_key} in app`}
                          onChange={(next) => {
                            if (segment) void setShown(segment, next);
                          }}
                        />
                      </div>
                    )}
                  </div>

                  {warning ? (
                    <div className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-[12px] font-semibold text-foreground">
                      <AlertTriangle size={14} className="shrink-0 text-warning" />
                      {warning}
                    </div>
                  ) : null}

                  {expanded ? (
                    <div className="space-y-4 p-4">
                      <ServiceStatusCard
                        flag={flag}
                        canWrite={canWrite}
                        activeOrders={activeOrdersByKey.get(flag.service_key) ?? 0}
                        onSaved={refresh}
                      />
                      <div className="rounded-[16px] border border-border bg-card p-4">
                        <ServiceHoursEditor
                          flag={flag}
                          hours={controlQuery.data.hours}
                          holidays={controlQuery.data.holidays}
                          canWrite={canWrite}
                          onSaved={refresh}
                        />
                      </div>
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>

          <ServiceStatusSection
            flags={cityFlags}
            canWrite={canWrite}
            activeOrdersByKey={activeOrdersByKey}
            undo={controlQuery.data.undo}
            onSaved={refresh}
            showRows={false}
          />
          <ServicePreviewTable canWrite={canWrite} />
        </>
      ) : null}
    </div>
  );
}