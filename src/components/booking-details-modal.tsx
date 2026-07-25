import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { X, Check, CircleDashed, CircleDot, XCircle, Ban, UserPlus, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import {
  getBookingDetails,
  updateBookingStatus,
  cancelBooking,
  reassignExpert,
  CANCELLATION_REASONS,
  STAFF_STATUS_TRANSITIONS,
  type BookingStatus,
  type CancellationReason,
} from "@/lib/bookings.functions";
import {
  assignExpertToBooking,
  listActiveExperts,
} from "@/lib/live-orders.functions";


type StaffRole = "super_admin" | "ops_manager" | "area_partner";

const TIMELINE: BookingStatus[] = [
  "confirmed",
  "accepted",
  "expert_assigned",
  "in_progress",
  "completed",
];

const STATUS_LABEL: Record<BookingStatus, string> = {
  confirmed: "Confirmed",
  accepted: "Accepted",
  expert_assigned: "Expert Assigned",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
  rejected: "Rejected",
};

const STATUS_STYLES: Record<BookingStatus, string> = {
  confirmed: "bg-blue-50 text-blue-700",
  accepted: "bg-primary-tint text-primary",
  expert_assigned: "bg-amber-50 text-amber-700",
  in_progress: "bg-indigo-50 text-indigo-700",
  completed: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-muted text-muted-foreground",
  rejected: "bg-red-50 text-red-700",
};


function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function BookingDetailsModal({
  bookingId,
  role,
  onClose,
}: {
  bookingId: string;
  role: StaffRole | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const fetchDetails = useServerFn(getBookingDetails);
  const updateStatus = useServerFn(updateBookingStatus);
  const cancelFn = useServerFn(cancelBooking);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["bookings", "details", bookingId],
    queryFn: () => fetchDetails({ data: { bookingId } }),
  });

  const canEdit = role === "super_admin" || role === "ops_manager";
  const nextOptions: BookingStatus[] = useMemo(
    () => (data ? STAFF_STATUS_TRANSITIONS[data.status] ?? [] : []),
    [data],
  );
  const [nextStatus, setNextStatus] = useState<BookingStatus | "">("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState<CancellationReason | "">("");

  const isTerminal =
    !!data && ["completed", "cancelled", "rejected"].includes(data.status);
  const canCancel = canEdit && !!data && !isTerminal;

  const mutation = useMutation({
    mutationFn: (payload: { newStatus: BookingStatus }) =>
      updateStatus({ data: { bookingId, newStatus: payload.newStatus } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bookings", "details", bookingId] });
      queryClient.invalidateQueries({ queryKey: ["bookings", "list"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "stats"] });
      setNextStatus("");
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "Failed to update status";
      if (/already been assigned|Invalid status transition|Booking not/i.test(msg)) {
        toast.error(msg, { description: "Refreshing to show the current state." });
        queryClient.invalidateQueries({ queryKey: ["bookings", "details", bookingId] });
        queryClient.invalidateQueries({ queryKey: ["bookings", "list"] });
        setNextStatus("");
      } else {
        toast.error(msg);
      }
    },
  });


  const cancelMutation = useMutation({
    mutationFn: (reason: CancellationReason) =>
      cancelFn({ data: { bookingId, reason } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bookings", "details", bookingId] });
      queryClient.invalidateQueries({ queryKey: ["bookings", "list"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "stats"] });
      setCancelOpen(false);
      setCancelReason("");
    },
  });

  // Expert assignment / reassignment
  const fetchExperts = useServerFn(listActiveExperts);
  const assignFn = useServerFn(assignExpertToBooking);
  const reassignFn = useServerFn(reassignExpert);

  const [selectedExpertId, setSelectedExpertId] = useState<string>("");
  const [expertSearch, setExpertSearch] = useState("");
  const [reassignOpen, setReassignOpen] = useState(false);

  const showAssign = !!data && data.status === "accepted" && canEdit;
  const canReassign =
    !!data && data.status === "expert_assigned" && canEdit;

  const expertsQuery = useQuery({
    queryKey: ["bookings", "assignable-experts", bookingId],
    queryFn: () => fetchExperts({ data: { bookingId } }),
    enabled: showAssign || reassignOpen,
  });
  const filteredExperts = useMemo(() => {
    const list = expertsQuery.data ?? [];
    const q = expertSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        (e.phone ?? "").toLowerCase().includes(q),
    );
  }, [expertsQuery.data, expertSearch]);

  const invalidateBooking = () => {
    queryClient.invalidateQueries({ queryKey: ["bookings", "details", bookingId] });
    queryClient.invalidateQueries({ queryKey: ["bookings", "list"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard", "stats"] });
  };

  const assignMutation = useMutation({
    mutationFn: (expertId: string) =>
      assignFn({ data: { bookingId, expertId } }),
    onSuccess: () => {
      toast.success("Expert assigned");
      setSelectedExpertId("");
      setExpertSearch("");
      invalidateBooking();
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "Failed to assign expert";
      toast.error(msg, { description: "Refreshing to show the current state." });
      invalidateBooking();
    },
  });

  const reassignMutation = useMutation({
    mutationFn: (newExpertId: string) =>
      reassignFn({ data: { bookingId, newExpertId } }),
    onSuccess: () => {
      toast.success("Expert reassigned");
      setSelectedExpertId("");
      setExpertSearch("");
      setReassignOpen(false);
      invalidateBooking();
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "Failed to reassign expert";
      toast.error(msg, { description: "Refreshing to show the current state." });
      invalidateBooking();
    },
  });


  const inr = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-0 sm:p-6 bg-foreground/50"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-card w-full sm:max-w-[820px] max-h-[100vh] sm:max-h-[92vh] sm:rounded-[24px] overflow-hidden shadow-xl flex flex-col"
      >
        <header className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Booking
            </p>
            <h2 className="text-[18px] font-bold text-foreground truncate">
              #{bookingId.slice(0, 8)}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted"
          >
            <X size={20} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {isLoading && (
            <p className="text-[14px] text-muted-foreground">Loading…</p>
          )}
          {isError && (
            <p className="text-[14px] text-destructive">
              {(error as Error)?.message ?? "Failed to load booking."}
            </p>
          )}
          {data && (
            <>
              {/* Status + timeline */}
              <section className="space-y-4">
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-flex items-center px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide ${STATUS_STYLES[data.status]}`}
                  >
                    {STATUS_LABEL[data.status]}
                  </span>
                  <span className="text-[12px] text-muted-foreground">
                    Created {fmtDateTime(data.createdAt)}
                  </span>
                </div>
                <Timeline current={data.status} />
              </section>

              {/* Grid */}
              <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card title="Customer">
                  <Field label="Name" value={data.customer.name ?? "—"} />
                  <Field label="Phone" value={data.customer.phone ?? "—"} mono />
                </Card>
                <Card title="Address">
                  {data.address ? (
                    <>
                      <Field label="Label" value={data.address.label ?? "—"} />
                      <Field
                        label="Full address"
                        value={data.address.fullAddress ?? "—"}
                      />
                      <Field
                        label="Area / City"
                        value={
                          [data.address.area, data.address.city]
                            .filter(Boolean)
                            .join(", ") || "—"
                        }
                      />
                    </>
                  ) : (
                    <p className="text-[13px] text-muted-foreground">
                      No address on booking.
                    </p>
                  )}
                </Card>
                <Card title="Service & Slot">
                  <Field label="Service" value={data.serviceLabel ?? "—"} />
                  <Field
                    label="Duration"
                    value={
                      data.serviceDurationMinutes
                        ? `${data.serviceDurationMinutes} min`
                        : "—"
                    }
                  />
                  <Field
                    label="Slot"
                    value={
                      [data.scheduledDate, data.scheduledTimeSlot]
                        .filter(Boolean)
                        .join(" · ") || "—"
                    }
                  />
                  <Field
                    label="Slot type"
                    value={data.slotType ?? "—"}
                  />
                </Card>
                <Card title="Payment">
                  <Field
                    label="Price"
                    value={data.price != null ? inr.format(data.price) : "—"}
                  />
                  <div className="flex items-center gap-2 py-1">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground w-28 shrink-0">
                      Status
                    </span>
                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide ${data.paid ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"}`}
                    >
                      {data.paid ? "Paid" : "Unpaid"}
                    </span>
                  </div>
                  <Field
                    label="Payment ID"
                    value={data.razorpayPaymentId ?? "—"}
                    mono
                  />
                  <Field
                    label="Order ID"
                    value={data.razorpayOrderId ?? "—"}
                    mono
                  />
                </Card>
                <Card title="Assigned Expert">
                  {data.expert.id ? (
                    <>
                      <Field label="Name" value={data.expert.name ?? "—"} />
                      <Field label="Phone" value={data.expert.phone ?? "—"} mono />
                      {canReassign && !reassignOpen && (
                        <button
                          onClick={() => setReassignOpen(true)}
                          className="mt-2 text-[12px] font-bold text-primary hover:underline inline-flex items-center gap-1"
                        >
                          <RefreshCw size={12} />
                          Reassign
                        </button>
                      )}
                    </>
                  ) : (
                    <p className="text-[13px] text-muted-foreground italic">
                      No expert assigned.
                    </p>
                  )}
                </Card>

                <Card title="Zone">
                  <Field label="Name" value={data.zone.name ?? "—"} />
                </Card>
              </section>

              {/* Assign / Reassign expert */}
              {(showAssign || (canReassign && reassignOpen)) && (
                <ExpertAssignSection
                  mode={showAssign ? "assign" : "reassign"}
                  experts={filteredExperts}
                  loading={expertsQuery.isLoading}
                  search={expertSearch}
                  onSearch={setExpertSearch}
                  selected={selectedExpertId}
                  onSelect={setSelectedExpertId}
                  pending={
                    showAssign
                      ? assignMutation.isPending
                      : reassignMutation.isPending
                  }
                  onConfirm={() => {
                    if (!selectedExpertId) return;
                    if (showAssign) assignMutation.mutate(selectedExpertId);
                    else reassignMutation.mutate(selectedExpertId);
                  }}
                  onCancel={
                    showAssign
                      ? undefined
                      : () => {
                          setReassignOpen(false);
                          setSelectedExpertId("");
                          setExpertSearch("");
                        }
                  }
                />
              )}

              {/* Update status */}
              {canEdit && (

                <section className="bg-background border border-border rounded-[18px] p-4">
                  <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground mb-3">
                    Update status
                  </h3>
                  {nextOptions.length === 0 ? (
                    <p className="text-[13px] text-muted-foreground">
                      This booking is in a terminal state.
                    </p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-3">
                      <select
                        value={nextStatus}
                        onChange={(e) =>
                          setNextStatus(e.target.value as BookingStatus | "")
                        }
                        className="h-11 px-3 rounded-[14px] border border-border bg-card text-[14px] min-w-[200px]"
                      >
                        <option value="">Select next status…</option>
                        {nextOptions.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABEL[s]}
                          </option>
                        ))}
                      </select>
                      <button
                        disabled={!nextStatus || mutation.isPending}
                        onClick={() =>
                          nextStatus &&
                          mutation.mutate({ newStatus: nextStatus })
                        }
                        className="h-11 px-5 rounded-[14px] bg-primary text-primary-foreground font-bold text-[14px] disabled:opacity-50 inline-flex items-center gap-2"
                      >
                        <Check size={16} />
                        {mutation.isPending ? "Updating…" : "Confirm"}
                      </button>
                      {mutation.isError && (
                        <span className="text-[12px] text-destructive">
                          {(mutation.error as Error)?.message ?? "Update failed"}
                        </span>
                      )}
                    </div>
                  )}
                </section>
              )}

              {/* Cancel booking */}
              {canCancel && (
                <section className="bg-background border border-border rounded-[18px] p-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">
                        Cancel booking
                      </h3>
                      <p className="text-[12px] text-muted-foreground mt-1">
                        Sets status to Cancelled and records a reason in the audit log.
                      </p>
                    </div>
                    {!cancelOpen && (
                      <button
                        onClick={() => setCancelOpen(true)}
                        className="h-11 px-4 rounded-[14px] border border-destructive text-destructive font-bold text-[14px] inline-flex items-center gap-2 hover:bg-red-50"
                      >
                        <Ban size={16} />
                        Cancel booking
                      </button>
                    )}
                  </div>
                  {cancelOpen && (
                    <div className="rounded-[14px] border border-border bg-card p-3 space-y-3">
                      <p className="text-[13px] text-foreground">
                        Select a reason to cancel this booking. This cannot be undone.
                      </p>
                      <div className="flex flex-wrap items-center gap-3">
                        <select
                          value={cancelReason}
                          onChange={(e) =>
                            setCancelReason(e.target.value as CancellationReason | "")
                          }
                          className="h-11 px-3 rounded-[14px] border border-border bg-card text-[14px] min-w-[220px]"
                        >
                          <option value="">Select reason…</option>
                          {CANCELLATION_REASONS.map((r) => (
                            <option key={r} value={r}>
                              {r.replace(/_/g, " ")}
                            </option>
                          ))}
                        </select>
                        <button
                          disabled={!cancelReason || cancelMutation.isPending}
                          onClick={() =>
                            cancelReason && cancelMutation.mutate(cancelReason)
                          }
                          className="h-11 px-5 rounded-[14px] bg-destructive text-white font-bold text-[14px] disabled:opacity-50 inline-flex items-center gap-2"
                        >
                          <Ban size={16} />
                          {cancelMutation.isPending ? "Cancelling…" : "Confirm cancel"}
                        </button>
                        <button
                          onClick={() => {
                            setCancelOpen(false);
                            setCancelReason("");
                          }}
                          className="h-11 px-4 rounded-[14px] border border-border text-foreground font-semibold text-[14px]"
                        >
                          Back
                        </button>
                      </div>
                      {cancelMutation.isError && (
                        <p className="text-[12px] text-destructive">
                          {(cancelMutation.error as Error)?.message ?? "Cancel failed"}
                        </p>
                      )}
                    </div>
                  )}
                </section>
              )}

              {data.status === "cancelled" && data.cancellationReason && (
                <section className="bg-red-50 border border-red-100 rounded-[18px] p-4">
                  <h3 className="text-[11px] font-bold uppercase tracking-wide text-red-700 mb-1">
                    Cancellation reason
                  </h3>
                  <p className="text-[14px] font-semibold text-red-700">
                    {data.cancellationReason.replace(/_/g, " ")}
                  </p>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-background border border-border rounded-[18px] p-4">
      <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
        {title}
      </h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-2 py-1">
      <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground w-28 shrink-0 pt-0.5">
        {label}
      </span>
      <span
        className={`text-[13px] text-foreground break-all ${mono ? "font-mono" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

function Timeline({ current }: { current: BookingStatus }) {
  const isTerminalBad = current === "cancelled" || current === "rejected";
  const currentIdxRaw = TIMELINE.indexOf(current);
  const currentIdx = currentIdxRaw === -1 ? -1 : currentIdxRaw;


  return (
    <ol className="flex items-center gap-1 overflow-x-auto">
      {TIMELINE.map((s, idx) => {
        const done = !isTerminalBad && idx < currentIdx;
        const active = !isTerminalBad && idx === currentIdx;
        const Icon = done ? Check : active ? CircleDot : CircleDashed;
        return (
          <li key={s} className="flex items-center gap-1 shrink-0">
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[12px] font-semibold ${
                active
                  ? "bg-primary-tint text-primary"
                  : done
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              <Icon size={14} />
              {STATUS_LABEL[s]}
            </div>
            {idx < TIMELINE.length - 1 && (
              <span className="w-4 h-px bg-border" />
            )}
          </li>
        );
      })}
      {isTerminalBad && (
        <li className="flex items-center gap-1 shrink-0 ml-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[12px] font-semibold bg-red-50 text-red-700">
            <XCircle size={14} />
            {STATUS_LABEL[current]}
          </div>
        </li>
      )}
    </ol>
  );
}

function ExpertAssignSection({
  mode,
  experts,
  loading,
  search,
  onSearch,
  selected,
  onSelect,
  pending,
  onConfirm,
  onCancel,
}: {
  mode: "assign" | "reassign";
  experts: Array<{ id: string; name: string; phone: string }>;
  loading: boolean;
  search: string;
  onSearch: (v: string) => void;
  selected: string;
  onSelect: (v: string) => void;
  pending: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
}) {
  const isReassign = mode === "reassign";
  return (
    <section
      className={`border rounded-[18px] p-4 ${
        isReassign
          ? "bg-amber-50/50 border-amber-200"
          : "bg-primary-tint/40 border-primary/20"
      }`}
    >
      <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground mb-3 inline-flex items-center gap-2">
        {isReassign ? <RefreshCw size={14} /> : <UserPlus size={14} />}
        {isReassign ? "Reassign expert" : "Assign expert"}
      </h3>
      <div className="space-y-3">
        <input
          type="text"
          placeholder="Search by name or phone…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="w-full h-11 px-3 rounded-[14px] border border-border bg-card text-[14px]"
        />
        <select
          value={selected}
          onChange={(e) => onSelect(e.target.value)}
          className="w-full h-11 px-3 rounded-[14px] border border-border bg-card text-[14px]"
        >
          <option value="">
            {loading
              ? "Loading experts…"
              : experts.length === 0
                ? "No active experts in this zone"
                : "Select expert…"}
          </option>
          {experts.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} — {e.phone}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap items-center gap-3">
          <button
            disabled={!selected || pending}
            onClick={onConfirm}
            className="h-11 px-5 rounded-[14px] bg-primary text-primary-foreground font-bold text-[14px] disabled:opacity-50 inline-flex items-center gap-2"
          >
            <Check size={16} />
            {pending ? "Saving…" : isReassign ? "Confirm reassignment" : "Confirm assignment"}
          </button>
          {onCancel && (
            <button
              onClick={onCancel}
              className="h-11 px-4 rounded-[14px] border border-border text-foreground font-semibold text-[14px]"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

