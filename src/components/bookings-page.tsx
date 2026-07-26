import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  BOOKING_STATUSES,
  listBookings,
  listZoneOptions,
  type BookingRow,
  type BookingStatus,
} from "@/lib/bookings.functions";

type StaffRole = "super_admin" | "ops_manager" | "area_partner";

const PAGE_SIZE = 25;

const STATUS_STYLES: Record<BookingStatus, string> = {
  confirmed: "bg-blue-50 text-blue-700",
  accepted: "bg-primary-tint text-primary",
  expert_assigned: "bg-amber-50 text-amber-700",

  in_progress: "bg-indigo-50 text-indigo-700",
  completed: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-muted text-muted-foreground",
  rejected: "bg-red-50 text-red-700",
};

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export type BookingsInitialFilters = {
  status?: string;
  from?: string;
  to?: string;
};

export function BookingsPage({
  role,
  onSelect,
  initialFilters,
}: {
  role: StaffRole | null;
  onSelect?: (bookingId: string) => void;
  initialFilters?: BookingsInitialFilters;
}) {
  const [status, setStatus] = useState<string>(initialFilters?.status ?? "");
  const [zoneId, setZoneId] = useState<string>("");
  const [from, setFrom] = useState<string>(initialFilters?.from ?? "");
  const [to, setTo] = useState<string>(initialFilters?.to ?? "");
  const [page, setPage] = useState<number>(1);
  const [includeDeleted, setIncludeDeleted] = useState<boolean>(false);

  const fetchBookings = useServerFn(listBookings);
  const fetchZones = useServerFn(listZoneOptions);

  const { data: zones = [] } = useQuery({
    queryKey: ["bookings", "zone-options"],
    queryFn: () => fetchZones(),
    staleTime: 60_000,
  });

  const filters = useMemo(() => {
    const activePreset = status === "active";
    return {
      status: activePreset ? null : status || null,
      statuses: activePreset ? ["expert_assigned", "in_progress"] : null,
      zoneId: zoneId || null,
      from: from || null,
      to: to || null,
      page,
      pageSize: PAGE_SIZE,
      includeDeleted: includeDeleted && role === "super_admin",
    };
  }, [status, zoneId, from, to, page, includeDeleted, role]);

  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["bookings", "list", filters],
    queryFn: () => fetchBookings({ data: filters }),
    staleTime: 15_000,
  });

  // Realtime: any change to bookings invalidates the list.
  useEffect(() => {
    const channel = supabase
      .channel("bookings-list")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookings" },
        () => queryClient.invalidateQueries({ queryKey: ["bookings", "list"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function updateFilter(fn: () => void) {
    fn();
    setPage(1);
  }

  const showZoneFilter = role !== "area_partner";

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-[18px] p-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Status
          </label>
          <select
            value={status}
            onChange={(e) => updateFilter(() => setStatus(e.target.value))}
            className="h-10 px-3 rounded-[12px] border border-border bg-card text-[13px] min-w-[160px]"
          >
            <option value="">All statuses</option>
            {BOOKING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>

        {showZoneFilter && (
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Zone
            </label>
            <select
              value={zoneId}
              onChange={(e) => updateFilter(() => setZoneId(e.target.value))}
              className="h-10 px-3 rounded-[12px] border border-border bg-card text-[13px] min-w-[180px]"
            >
              <option value="">All zones</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            From
          </label>
          <input
            type="date"
            value={from}
            onChange={(e) => updateFilter(() => setFrom(e.target.value))}
            className="h-10 px-3 rounded-[12px] border border-border bg-card text-[13px]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            To
          </label>
          <input
            type="date"
            value={to}
            onChange={(e) => updateFilter(() => setTo(e.target.value))}
            className="h-10 px-3 rounded-[12px] border border-border bg-card text-[13px]"
          />
        </div>

        {(status || zoneId || from || to) && (
          <button
            onClick={() =>
              updateFilter(() => {
                setStatus("");
                setZoneId("");
                setFrom("");
                setTo("");
              })
            }
            className="h-10 px-4 rounded-[12px] border border-border text-[13px] font-semibold text-muted-foreground hover:bg-muted"
          >
            Clear
          </button>
        )}

        {role === "super_admin" && (
          <label className="flex items-center gap-2 h-10 px-3 rounded-[12px] border border-border text-[13px] font-semibold text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeDeleted}
              onChange={(e) => updateFilter(() => setIncludeDeleted(e.target.checked))}
              className="accent-primary"
            />
            Show deleted
          </label>
        )}

        <div className="ml-auto text-[12px] text-muted-foreground self-center">
          {isLoading ? "Loading…" : `${total} booking${total === 1 ? "" : "s"}`}
        </div>
      </div>


      <div className="bg-card border border-border rounded-[18px] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Customer</th>
                <th className="text-left px-4 py-3">Service / Slot</th>
                <th className="text-left px-4 py-3">Zone</th>
                <th className="text-left px-4 py-3">Expert</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Payment</th>
                <th className="text-left px-4 py-3">Placed</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {isError && !isLoading && (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-destructive">
                    Failed to load bookings.
                  </td>
                </tr>
              )}
              {!isLoading && !isError && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-muted-foreground">
                    No bookings match these filters.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <BookingRowItem key={r.id} row={r} onSelect={onSelect} />
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-border text-[12px] text-muted-foreground">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isLoading}
              className="h-9 w-9 inline-flex items-center justify-center rounded-[12px] border border-border disabled:opacity-40 hover:bg-muted"
              aria-label="Previous page"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || isLoading}
              className="h-9 w-9 inline-flex items-center justify-center rounded-[12px] border border-border disabled:opacity-40 hover:bg-muted"
              aria-label="Next page"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BookingRowItem({
  row,
  onSelect,
}: {
  row: BookingRow;
  onSelect?: (bookingId: string) => void;
}) {
  return (
    <tr
      onClick={() => onSelect?.(row.id)}
      className={`border-t border-border hover:bg-muted/40 cursor-pointer ${row.deletedAt ? "opacity-60" : ""}`}
    >
      <td className="px-4 py-3 font-semibold text-foreground">
        <div className="flex items-center gap-2">
          <span>{row.customerName}</span>
          {row.deletedAt && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-red-50 text-red-700">
              Deleted
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        <div className="text-foreground">{row.serviceLabel ?? "—"}</div>
        <div className="text-[11px]">
          {row.scheduledDate ?? ""}
          {row.scheduledTimeSlot ? ` · ${row.scheduledTimeSlot}` : ""}
        </div>
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {row.zoneName ?? <span className="italic">—</span>}
      </td>
      <td className="px-4 py-3">
        {row.assignedExpertName ? (
          <span className="text-foreground">{row.assignedExpertName}</span>
        ) : (
          <span className="text-muted-foreground italic">Unassigned</span>
        )}
      </td>
      <td className="px-4 py-3">
        <span
          className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide ${STATUS_STYLES[row.status] ?? "bg-muted text-muted-foreground"}`}
        >
          {row.status.replace("_", " ")}
        </span>
      </td>
      <td className="px-4 py-3">
        <span
          className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide ${row.paid ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"}`}
        >
          {row.paid ? "Paid" : "Unpaid"}
        </span>
      </td>
      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
        {fmtDateTime(row.createdAt)}
      </td>
    </tr>
  );
}
