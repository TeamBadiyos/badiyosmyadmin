import { DateInput } from "@/components/date-input";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  X,
  Check,
  CircleDashed,
  CircleDot,
  XCircle,
  Ban,
  RefreshCw,
  Pencil,
  Trash2,
  AlertTriangle,
  IndianRupee,
  MoreHorizontal,
  Phone,
  MessageCircle,
  UserPlus,
  Send,
  ListChecks,
  CalendarClock,
  Repeat,
  Timer,
} from "lucide-react";
import { CustomerBlock, MapActionBar, ActionBar, ActionBtn, HistorySection, TimerRow, PanelSection, MoreMenu, fmtPhone, PhaseBanner, waitText } from "@/components/detail-panel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

import {
  getBookingDetails,
  updateBookingStatus,
  cancelBooking,
  refundBooking,
  reassignExpert,
  editBooking,
  softDeleteBooking,
  setBookingStaffNote,
  listServiceDurations,
  listBookingCustomerAddresses,
  rescheduleBooking,
  adjustBookingTime,
  ADJUST_REASONS,
  CANCELLATION_REASONS,
  STAFF_STATUS_TRANSITIONS,
  type BookingStatus,
  type CancellationReason,
} from "@/lib/bookings.functions";

import {
  assignExpertToBooking,
  acceptPendingBooking,
  listActiveExperts,
} from "@/lib/live-orders.functions";

import { LiveTrackingMap } from "@/components/live-tracking-map";
import { ShareLocationIcons } from "@/components/share-location";
import { ServiceTimerCard } from "@/components/service-timer";
import { JobLocationDialog } from "@/components/job-location-dialog";
import { ExpertHandoverPanel } from "@/components/expert-handover-panel";
import { TransferWorkPanel } from "@/components/transfer-work-panel";



type StaffRole = "super_admin" | "ops_manager" | "area_partner" | "finance";

const TIMELINE: BookingStatus[] = [
  "confirmed",
  "accepted",
  "expert_assigned",
  "on_the_way",
  "arrived",
  "in_progress",
  "completed",
];

const STATUS_LABEL: Record<BookingStatus, string> = {
  confirmed: "Confirmed",
  accepted: "Accepted",
  expert_assigned: "Expert Assigned",
  on_the_way: "On the way",
  arrived: "Arrived",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
  rejected: "Rejected",
};

const STATUS_STYLES: Record<BookingStatus, string> = {
  confirmed: "bg-blue-50 text-blue-700",
  accepted: "bg-primary-tint text-primary",
  expert_assigned: "bg-amber-50 text-amber-700",
  on_the_way: "bg-amber-50 text-amber-700",
  arrived: "bg-amber-50 text-amber-700",
  in_progress: "bg-indigo-50 text-indigo-700",
  completed: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-muted text-muted-foreground",
  rejected: "bg-red-50 text-red-700",
};


function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
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
  const refundFn = useServerFn(refundBooking);

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
  const [cancelRefund, setCancelRefund] = useState(true);
  const [refundConfirm, setRefundConfirm] = useState(false);
  const [cancelDest, setCancelDest] = useState<"original" | "wallet">("original");
  const [panel, setPanel] = useState<null | "status" | "reschedule" | "handover">(null);
  const [showIds, setShowIds] = useState(false);

  const isDeleted = !!data?.deletedAt;
  const isTerminal =
    !!data && ["completed", "cancelled", "rejected"].includes(data.status);
  const canCancel = canEdit && !!data && !isTerminal && !isDeleted;
  const canEditFields = canEdit && !!data && !isTerminal && !isDeleted;
  const canDelete = role === "super_admin" && !!data && !isDeleted;
  const refundableAmount = data?.totalAmount ?? data?.price ?? 0;
  const canRefund =
    !!data &&
    !!data.razorpayPaymentId &&
    data.paymentStatus !== "refunded" &&
    refundableAmount > 0;

  const mutation = useMutation({
    mutationFn: (payload: { newStatus: BookingStatus }) =>
      updateStatus({ data: { bookingId, newStatus: payload.newStatus } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bookings", "details", bookingId] });
      queryClient.invalidateQueries({ queryKey: ["bookings", "list"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "stats"] });
      setNextStatus("");
      setPanel(null);
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


  const refreshAfterMoney = () => {
    queryClient.invalidateQueries({ queryKey: ["bookings", "details", bookingId] });
    queryClient.invalidateQueries({ queryKey: ["bookings", "list"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard", "stats"] });
  };

  const cancelMutation = useMutation({
    mutationFn: (payload: { reason: CancellationReason; refund: boolean }) =>
      cancelFn({ data: { bookingId, reason: payload.reason, refund: payload.refund, destination: cancelDest } }),
    onSuccess: (res) => {
      refreshAfterMoney();
      setCancelOpen(false);
      setCancelReason("");
      const r = res?.refund;
      if (!r?.attempted) {
        toast.success("Booking cancelled");
      } else if (r.ok) {
        toast.success(`Booking cancelled and ₹${r.amount} refunded`);
      } else {
        toast.error("Booking cancelled, but the refund did not go through", {
          description: r.message ?? undefined,
        });
      }
    },
  });

  const refundMutation = useMutation({
    mutationFn: () => refundFn({ data: { bookingId } }),
    onSuccess: (r) => {
      refreshAfterMoney();
      setRefundConfirm(false);
      if (r.ok && r.attempted) {
        toast.success(`₹${r.amount} refunded to the customer`);
      } else if (r.ok) {
        toast.info(r.message ?? "Already refunded");
      } else {
        toast.error("Refund did not go through", {
          description: r.message ?? undefined,
        });
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Refund failed");
    },
  });


  // Edit
  const editFn = useServerFn(editBooking);
  const deleteFn = useServerFn(softDeleteBooking);
  const fetchDurations = useServerFn(listServiceDurations);
  const fetchAddresses = useServerFn(listBookingCustomerAddresses);

  const [editOpen, setEditOpen] = useState(false);
  const [locOpen, setLocOpen] = useState(false);
  const [editDuration, setEditDuration] = useState<number | "">("");
  const [editPrice, setEditPrice] = useState<string>("");
  const [editAddressId, setEditAddressId] = useState<string>("");
  const [editSlot, setEditSlot] = useState<string>("");
  const [editDate, setEditDate] = useState<string>("");

  const durationsQuery = useQuery({
    queryKey: ["service-durations"],
    queryFn: () => fetchDurations(),
    enabled: editOpen,
  });
  const addressesQuery = useQuery({
    queryKey: ["bookings", "customer-addresses", bookingId],
    queryFn: () => fetchAddresses({ data: { bookingId } }),
    enabled: editOpen,
  });

  useEffect(() => {
    if (editOpen && data) {
      setEditDuration(data.serviceDurationMinutes ?? "");
      setEditPrice(data.price != null ? String(data.price) : "");
      setEditAddressId(data.addressId ?? "");
      setEditSlot(data.scheduledTimeSlot ?? "");
      setEditDate(data.scheduledDate ?? "");
    }
  }, [editOpen, data]);

  const editMutation = useMutation({
    mutationFn: (payload: {
      serviceDurationMinutes?: number | null;
      price?: number | null;
      addressId?: string | null;
      scheduledDate?: string | null;
      scheduledTimeSlot?: string | null;
    }) => editFn({ data: { bookingId, ...payload } }),
    onSuccess: () => {
      toast.success("Booking updated");
      queryClient.invalidateQueries({ queryKey: ["bookings", "details", bookingId] });
      queryClient.invalidateQueries({ queryKey: ["bookings", "list"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "stats"] });
      setEditOpen(false);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to update booking");
    },
  });

  // Delete
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState("");
  const [deleteReason, setDeleteReason] = useState("");

  const shortId = data ? data.id.slice(0, 8) : "";

  const deleteMutation = useMutation({
    mutationFn: () => deleteFn({ data: { bookingId, reason: deleteReason.trim() } }),
    onSuccess: () => {
      toast.success("Booking deleted");
      queryClient.invalidateQueries({ queryKey: ["bookings", "details", bookingId] });
      queryClient.invalidateQueries({ queryKey: ["bookings", "list"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "stats"] });
      setDeleteOpen(false);
      onClose();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to delete booking");
    },
  });

  const priceMismatchWarning = useMemo(() => {
    if (!editOpen || !durationsQuery.data || editDuration === "") return null;
    const d = durationsQuery.data.find((x) => x.durationMinutes === editDuration);
    if (!d) return null;
    const enteredPrice = Number(editPrice);
    if (!Number.isFinite(enteredPrice)) return null;
    if (Math.abs(enteredPrice - d.price) > 0.01) {
      return `Warning: catalogue price for ${d.durationLabel} is ₹${d.price.toFixed(0)}.`;
    }
    return null;
  }, [editOpen, durationsQuery.data, editDuration, editPrice]);


  // Reschedule: moves order back to Scheduled Orders with a new date/slot.
  const rescheduleFn = useServerFn(rescheduleBooking);
  const canReschedule =
    !!data &&
    canEditFields &&
    (role === "super_admin" || role === "ops_manager") &&
    ["confirmed", "accepted", "expert_assigned", "on_the_way", "arrived"].includes(data.status) &&
    !data.startedAt;
  const rescheduleMutation = useMutation({
    mutationFn: (v: { date: string; slot: string; reason: string }) =>
      rescheduleFn({ data: { bookingId, ...v } }),
    onSuccess: () => {
      toast.success("Booking rescheduled", { description: "Moved to Scheduled Orders." });
      queryClient.invalidateQueries({ queryKey: ["bookings", "details", bookingId] });
      queryClient.invalidateQueries({ queryKey: ["bookings", "list"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "stats"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Reschedule failed"),
  });
  const shootFn = useServerFn(acceptPendingBooking);
  const shootMutation = useMutation({
    mutationFn: () => shootFn({ data: { bookingId } }),
    onSuccess: () => {
      toast.success("Order shot to experts · moved to Needs Expert");
      queryClient.invalidateQueries({ queryKey: ["bookings", "details", bookingId] });
      queryClient.invalidateQueries({ queryKey: ["pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "stats"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });


  // Expert assignment / reassignment
  const fetchExperts = useServerFn(listActiveExperts);
  const assignFn = useServerFn(assignExpertToBooking);
  const reassignFn = useServerFn(reassignExpert);

  const [selectedExpertId, setSelectedExpertId] = useState<string>("");
  const [expertSearch, setExpertSearch] = useState("");
  const [reassignOpen, setReassignOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);

  const isAP = role === "area_partner";
  const showAssign = !!data && data.status === "accepted" && (canEdit || isAP);
  const canReassign =
    !!data &&
    ["expert_assigned", "on_the_way", "arrived"].includes(data.status) &&
    (canEdit || isAP);
  const [apLocOpen, setApLocOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);

  const expertsQuery = useQuery({
    queryKey: ["bookings", "assignable-experts", bookingId],
    queryFn: async () =>
      Promise.race([
        fetchExperts({ data: { bookingId } }),
        new Promise<never>((_, reject) =>
          window.setTimeout(
            () => reject(new Error("Request timed out after 10s")),
            10_000,
          ),
        ),
      ]),
    enabled: assignOpen || reassignOpen,
    retry: 1,
    retryDelay: 500,
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

  const isWash = /wash/i.test(data?.serviceLabel ?? "");
  const canAdjust = canEdit && !!data && !isDeleted && ["expert_assigned", "on_the_way", "arrived", "in_progress"].includes(data.status);
  const canHandover = canEdit && !!data && !!data.expert.id && ["expert_assigned", "on_the_way", "arrived", "in_progress"].includes(data.status);
  const totalMinutes = (data?.serviceDurationMinutes ?? 0) + (data?.extensionMinutes ?? 0) + (data?.adjustMinutes ?? 0);
  const openPanel = (p: typeof panel) => { setPanel((cur) => (cur === p ? null : p)); };
  void isWash;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-0 sm:p-6 bg-foreground/50"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-card w-full sm:max-w-[880px] h-[100dvh] sm:h-auto max-h-[100dvh] sm:max-h-[94dvh] sm:rounded-[24px] overflow-hidden shadow-xl flex flex-col"
      >
        <header className="px-4 sm:px-5 pt-4 pb-3 border-b border-border shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-[20px] font-bold tracking-tight text-foreground">
                  {data?.bookingNumber ?? `#${bookingId.slice(0, 8)}`}
                </h2>
                {data && (
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold ${STATUS_STYLES[data.status]}`}>
                    {STATUS_LABEL[data.status]}
                  </span>
                )}
              </div>
              {data && (
                <>
                  <p className="mt-0.5 text-[13px] text-foreground">
                    <span className="font-semibold">{data.serviceLabel ?? (/wash|car|bike/i.test(data.serviceLabel ?? "") ? "Clean Auto" : "Clean Home")}</span>
                    <span className="text-muted-foreground"> · </span>
                    <span className="font-semibold">{inr.format((data.totalAmount ?? data.price ?? 0) + data.extensionAmount)}</span>
                    {data.paymentStatus === "paid" && <span className="ml-1 text-[12px] font-semibold text-emerald-700">Paid</span>}
                  </p>
                  <p className="text-[12px] text-muted-foreground truncate">
                    {[
                      (data.slotType ?? "").toLowerCase() === "now" && !data.scheduledDate
                        ? "Book Now"
                        : data.scheduledDate
                          ? `${new Date(`${data.scheduledDate}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}${data.scheduledTimeSlot ? `, ${data.scheduledTimeSlot}` : ""}`
                          : null,
                      data.zone.name,
                    ].filter(Boolean).join(" · ")}
                  </p>
                </>
              )}
            </div>
            <button onClick={onClose} aria-label="Close" className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted">
              <X size={18} />
            </button>
          </div>
          {data && (
            data.status === "in_progress" && data.startedAt && totalMinutes > 0
              ? <TimerRow startedAt={data.startedAt} totalMinutes={totalMinutes} />
              : data.status === "cancelled" || data.status === "rejected"
                ? <PhaseBanner phase="bad" title={STATUS_LABEL[data.status]} />
                : data.status === "completed"
                  ? <PhaseBanner phase="done" title="✓ Completed" detail={data.expert.name ? `by ${data.expert.name}` : null} />
                  : !data.expert.id
                    ? <PhaseBanner phase="assign" title={data.status === "confirmed" ? "Scheduled · not sent to experts yet" : "Needs expert · searching"} detail={data.status === "confirmed" ? null : `Waiting ${waitText(data.createdAt)}`} />
                    : <PhaseBanner phase="assigned" title={`${STATUS_LABEL[data.status]} · ${data.expert.name ?? "Expert"}`}
                        steps={[{ key: "expert_assigned", label: "Assigned" }, { key: "on_the_way", label: "On the way" }, { key: "arrived", label: "Arrived" }, { key: "in_progress", label: "Started" }]}
                        current={data.status === "accepted" ? "expert_assigned" : data.status} />
          )}
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-5 pt-3 pb-16 sm:pb-4 space-y-3">
          {isLoading && <p className="text-[14px] text-muted-foreground">Loading…</p>}
          {isError && (
            <p className="text-[14px] text-destructive">{(error as Error)?.message ?? "Failed to load booking."}</p>
          )}
          {data && (
            <>
              <CustomerBlock
                name={data.customer.name}
                phone={data.customer.phone}
                masked={isAP}
                bookingCount={data.customerStats.bookingCount}
                avgRatingGiven={data.customerStats.avgRatingGiven}
                address={data.address}
                contact={isAP ? null : data.customer.phone ? <ContactButtons phone={data.customer.phone} /> : null}
              />

              <div>
                <LiveTrackingMap kind="booking" id={bookingId} panel />
                <MapActionBar
                  kind="booking"
                  id={bookingId}
                  onUpdatePin={canEditFields ? () => setLocOpen(true) : undefined}
                  onEditAddress={canEditFields ? () => { setPanel(null); setEditOpen(true); } : undefined}
                />
                {locOpen && (
                  <JobLocationDialog bookingId={bookingId} initial={data.address} onClose={() => setLocOpen(false)} />
                )}
              </div>

              <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-3 min-w-0">
                  <div id="bdm-expert">
                    <PanelSection title="Assigned expert">
                      {data.expert.id ? (
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[14px] font-semibold text-foreground truncate">{data.expert.name ?? "—"}</p>
                            <p className="text-[12px] text-muted-foreground">{fmtPhone(data.expert.phone)}</p>
                          </div>
                          {data.expert.phone && <ContactButtons phone={data.expert.phone} whatsapp={false} />}
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[13px] text-muted-foreground italic">Not assigned</p>
                          {showAssign && !assignOpen && (
                            <ActionBtn variant="normal" icon={<UserPlus size={13} />} onClick={() => setAssignOpen(true)}>Assign</ActionBtn>
                          )}
                        </div>
                      )}
                      {((showAssign && assignOpen) || (canReassign && reassignOpen)) && (
                        <NearestList
                          experts={filteredExperts}
                          loading={expertsQuery.isLoading}
                          error={expertsQuery.isError ? (expertsQuery.error instanceof Error ? expertsQuery.error.message : "Couldn't load experts") : null}
                          onRetry={() => expertsQuery.refetch()}
                          search={expertSearch}
                          onSearch={setExpertSearch}
                          pending={showAssign ? assignMutation.isPending : reassignMutation.isPending}
                          onPick={(id) => (showAssign ? assignMutation.mutate(id) : reassignMutation.mutate(id))}
                          onCancel={() => { setAssignOpen(false); setReassignOpen(false); setExpertSearch(""); }}
                        />
                      )}
                    </PanelSection>
                  </div>

                  <PanelSection
                    title="Payment"
                    right={(data.razorpayPaymentId || data.razorpayOrderId) ? (
                      <button type="button" onClick={() => setShowIds((v) => !v)} className="text-[11px] font-semibold text-muted-foreground hover:text-foreground">
                        IDs {showIds ? "▾" : "▸"}
                      </button>
                    ) : null}
                  >
                    <PayRow label="Price" value={data.price != null ? inr.format(data.price) : "—"} />
                    {data.gstAmount > 0 && <PayRow label={`GST${data.gstPercent ? ` (${data.gstPercent}%)` : ""}`} value={inr.format(data.gstAmount)} />}
                    {data.discountAmount > 0 && <PayRow label={`Coupon${data.couponCode ? ` ${data.couponCode}` : ""}`} value={`− ${inr.format(data.discountAmount)}`} />}
                    {data.extensionAmount > 0 && <PayRow label={`Extra time (${data.extensionMinutes} min)`} value={inr.format(data.extensionAmount)} />}
                    <PayRow bold label="Total" value={inr.format((data.totalAmount ?? data.price ?? 0) + data.extensionAmount)} />
                    <p className="pt-1 text-[12px] text-muted-foreground">
                      <span className={`mr-1 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${
                        data.paymentStatus === "paid" ? "bg-emerald-50 text-emerald-700"
                        : data.paymentStatus === "refunded" ? "bg-amber-50 text-amber-700" : "bg-muted text-muted-foreground"}`}>
                        {data.paymentStatus}
                      </span>
                      {data.razorpayPaymentId ? "Online (Razorpay)" : "—"}
                      {data.extensions.some((e) => e.approvalStatus === "pending") && <span className="ml-1 font-bold text-amber-700">· Extra time awaiting payment</span>}
                    </p>
                    {data.adjustments.some((a) => a.refundStatus === "due") && (
                      <p className="text-[12px] font-semibold text-amber-700">
                        Refund due for shorter job: {inr.format(data.adjustments.filter((a) => a.refundStatus === "due").reduce((x, a) => x + a.customerAmount, 0))}
                      </p>
                    )}
                    {showIds && (
                      <p className="text-[11px] font-mono text-muted-foreground break-all">
                        Payment {data.razorpayPaymentId ?? "—"} · Order {data.razorpayOrderId ?? "—"}
                      </p>
                    )}
                  </PanelSection>

                  {data.rating != null && (
                    <PanelSection title="Customer rating">
                      <p className="text-[14px] font-bold text-foreground">
                        <span className="text-warning">{"★".repeat(Math.round(data.rating))}</span>
                        <span className="text-muted-foreground">{"★".repeat(Math.max(0, 5 - Math.round(data.rating)))}</span>
                        <span className="ml-2 text-[13px]">{data.rating}/5</span>
                      </p>
                      {data.reviewText && <p className="text-[12px] text-muted-foreground">“{data.reviewText}”</p>}
                    </PanelSection>
                  )}
                </div>
                <div className="min-w-0">
                  {data.customerNote && (
                    <div className="mb-3 rounded-[14px] border border-border bg-muted/40 p-3">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Customer note</p>
                      <p className="mt-1 whitespace-pre-wrap text-[13px] text-foreground">{data.customerNote}</p>
                    </div>
                  )}
                  {data.refundDestination && (
                    <div className="mb-3 rounded-[14px] border border-border p-3 text-[13px]">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Refund</p>
                      <p className="mt-1 text-foreground">
                        To {data.refundDestination === "wallet" ? "badiyos Wallet" : "original payment method"}
                        {data.refundWalletAmount ? ` · ₹${data.refundWalletAmount} to wallet` : ""}
                        {data.cancellationFee ? ` · fee ₹${data.cancellationFee}` : ""}
                      </p>
                    </div>
                  )}
                  <StaffNoteCard bookingId={data.id} initial={data.staffNote} />
                </div>
              </section>

              {canEdit && !isDeleted && (
                <ActionBar
                  primary={
                    data.status === "confirmed" && !data.expert.id ? (
                      <ActionBtn variant="primary" icon={<Send size={14} />} disabled={shootMutation.isPending}
                        onClick={() => { if (confirm("Send this booking to experts now (Needs Expert)?")) shootMutation.mutate(); }}>
                        Send to experts now
                      </ActionBtn>
                    ) : !showAssign && nextOptions.length > 0 && nextOptions[0] !== "cancelled" ? (
                      <ActionBtn variant="primary" icon={<Check size={14} />} disabled={mutation.isPending}
                        onClick={() => { if (confirm(`Mark ${STATUS_LABEL[nextOptions[0]]}?`)) mutation.mutate({ newStatus: nextOptions[0] }); }}>
                        {mutation.isPending ? "Saving…" : `Mark ${STATUS_LABEL[nextOptions[0]].toLowerCase()}`}
                      </ActionBtn>
                    ) : undefined
                  }
                  normal={
                    <>
                      {showAssign && <ActionBtn icon={<UserPlus size={13} />} onClick={() => setAssignOpen(true)}>Assign</ActionBtn>}
                      {canAdjust && <ActionBtn icon={<Timer size={13} />} onClick={() => setAdjustOpen(true)}>Adjust time</ActionBtn>}
                      {nextOptions.length > 0 && <ActionBtn icon={<ListChecks size={13} />} onClick={() => openPanel("status")}>Change status</ActionBtn>}
                    </>
                  }
                  danger={
                    <MoreMenu
                      items={[
                        ...(canReassign ? [{ label: "Reassign", icon: <RefreshCw size={14} />, onClick: () => setReassignOpen(true) }] : []),
                        ...(canReschedule ? [{ label: "Reschedule", icon: <CalendarClock size={14} />, onClick: () => openPanel("reschedule") }] : []),
                        ...(canHandover ? [{ label: "Handover", icon: <Repeat size={14} />, onClick: () => openPanel("handover") }] : []),
                        ...(canEditFields ? [{ label: "Edit booking", icon: <Pencil size={14} />, onClick: () => { setPanel(null); setEditOpen((v) => !v); } }] : []),
                        ...(canRefund && isTerminal ? [{ label: "Refund", icon: <IndianRupee size={14} />, onClick: () => setRefundConfirm(true), danger: true }] : []),
                        ...(canCancel ? [{ label: "Cancel booking", icon: <Ban size={14} />, onClick: () => setCancelOpen(true), danger: true }] : []),
                        ...(canDelete ? [{ label: "Delete", icon: <Trash2 size={14} />, onClick: () => setDeleteOpen(true), danger: true }] : []),
                      ]}
                    />
                  }
                />
              )}
              {isAP && !isDeleted && (
                <ActionBar
                  normal={
                    <>
                      {showAssign && <ActionBtn icon={<UserPlus size={13} />} onClick={() => setAssignOpen(true)}>Assign</ActionBtn>}
                      {canReassign && <ActionBtn icon={<RefreshCw size={13} />} onClick={() => setReassignOpen(true)}>Reassign</ActionBtn>}
                      {!isTerminal && <ActionBtn icon={<Pencil size={13} />} onClick={() => setApLocOpen(true)}>Update location</ActionBtn>}
                      <ActionBtn icon={<Send size={13} />} onClick={() => setConnectOpen(true)}>Connect via badiyos</ActionBtn>
                    </>
                  }
                />
              )}
              {apLocOpen && data && <ApLocationDialog bookingId={bookingId} onClose={() => setApLocOpen(false)} onDone={() => { setApLocOpen(false); invalidateBooking(); }} />}
              {connectOpen && <ApConnectDialog bookingId={bookingId} onClose={() => setConnectOpen(false)} />}
              {!canEdit && !isAP && <p className="text-[12px] text-muted-foreground">Only super admin or ops manager can change this booking.</p>}

              {adjustOpen && (
                <AdjustTimeDialog
                  bookingId={bookingId}
                  price={data.price ?? 0}
                  baseMinutes={data.serviceDurationMinutes ?? 60}
                  currentMinutes={totalMinutes}
                  paidOnline={!!data.razorpayPaymentId}
                  onClose={() => setAdjustOpen(false)}
                  onDone={() => { setAdjustOpen(false); invalidateBooking(); queryClient.invalidateQueries({ queryKey: ["pipeline"] }); }}
                />
              )}

              {canHandover && panel === "handover" && (
                <>
                  <ExpertHandoverPanel
                    bookingId={bookingId}
                    status={data.status}
                    startedAt={data.startedAt ?? null}
                    durationMinutes={data.serviceDurationMinutes ?? null}
                    currentExpertName={data.expert.name ?? null}
                    canEdit={canEdit}
                  />
                  <TransferWorkPanel
                    bookingId={bookingId}
                    status={data.status}
                    currentExpertId={data.expert.id ?? null}
                    currentExpertName={data.expert.name ?? null}
                    canEdit={canEdit}
                  />
                </>
              )}

              {canReschedule && panel === "reschedule" && (
                <RescheduleSection
                  currentDate={data.scheduledDate}
                  currentSlot={data.scheduledTimeSlot}
                  hasExpert={!!data.expert.id}
                  pending={rescheduleMutation.isPending}
                  onSubmit={(v) => { rescheduleMutation.mutate(v); setPanel(null); }}
                />
              )}

              {/* Update status */}

              {canEdit && panel === "status" && (

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

              {/* Edit booking */}
              {canEdit && editOpen && (
                <section className="bg-background border border-border rounded-[18px] p-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">
                        Edit booking
                      </h3>
                      <p className="text-[12px] text-muted-foreground mt-1">
                        {canEditFields
                          ? "Update service duration, price, address, or scheduled slot."
                          : isDeleted
                            ? "This booking has been deleted and is read-only."
                            : "Completed or cancelled bookings are read-only."}
                      </p>
                    </div>
                    {!editOpen && canEditFields && (
                      <button
                        onClick={() => setEditOpen(true)}
                        className="h-11 px-4 rounded-[14px] border border-border text-foreground font-bold text-[14px] inline-flex items-center gap-2 hover:bg-muted"
                      >
                        <Pencil size={16} />
                        Edit
                      </button>
                    )}
                  </div>
                  {editOpen && canEditFields && (
                    <div className="rounded-[14px] border border-border bg-card p-4 space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="text-[12px] font-semibold text-muted-foreground">
                          Service duration
                          <select
                            value={editDuration === "" ? "" : String(editDuration)}
                            onChange={(e) => {
                              const v = e.target.value ? Number(e.target.value) : "";
                              setEditDuration(v);
                              const opt = durationsQuery.data?.find(
                                (d) => d.durationMinutes === v,
                              );
                              if (opt) setEditPrice(String(opt.price));
                            }}
                            className="mt-1 h-11 w-full px-3 rounded-[14px] border border-border bg-card text-[14px] text-foreground font-normal"
                          >
                            <option value="">Select duration…</option>
                            {(durationsQuery.data ?? []).map((d) => (
                              <option key={d.durationMinutes} value={d.durationMinutes}>
                                {d.durationLabel} — ₹{d.price.toFixed(0)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-[12px] font-semibold text-muted-foreground">
                          Price (₹)
                          <input
                            type="number"
                            step="0.01"
                            value={editPrice}
                            onChange={(e) => setEditPrice(e.target.value)}
                            className="mt-1 h-11 w-full px-3 rounded-[14px] border border-border bg-card text-[14px] text-foreground font-normal"
                          />
                        </label>
                        <label className="text-[12px] font-semibold text-muted-foreground">
                          Address
                          <select
                            value={editAddressId}
                            onChange={(e) => setEditAddressId(e.target.value)}
                            className="mt-1 h-11 w-full px-3 rounded-[14px] border border-border bg-card text-[14px] text-foreground font-normal"
                          >
                            <option value="">— none —</option>
                            {(addressesQuery.data ?? []).map((a) => (
                              <option key={a.id} value={a.id}>
                                {(a.label ? `${a.label} — ` : "") + a.fullAddress}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-[12px] font-semibold text-muted-foreground">
                          Scheduled date
                          <DateInput
                            
                            value={editDate}
                            onChange={(e) => setEditDate(e.target.value)}
                            className="mt-1 h-11 w-full px-3 rounded-[14px] border border-border bg-card text-[14px] text-foreground font-normal"
                          />
                        </label>
                        <label className="text-[12px] font-semibold text-muted-foreground sm:col-span-2">
                          Scheduled time slot
                          <input
                            type="text"
                            placeholder="e.g. 10:00–11:00"
                            value={editSlot}
                            onChange={(e) => setEditSlot(e.target.value)}
                            className="mt-1 h-11 w-full px-3 rounded-[14px] border border-border bg-card text-[14px] text-foreground font-normal"
                          />
                        </label>
                      </div>
                      {priceMismatchWarning && (
                        <p className="text-[12px] text-amber-600 inline-flex items-center gap-2">
                          <AlertTriangle size={14} />
                          {priceMismatchWarning}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          disabled={editMutation.isPending}
                          onClick={() => {
                            const priceNum = editPrice === "" ? null : Number(editPrice);
                            editMutation.mutate({
                              serviceDurationMinutes:
                                editDuration === "" ? null : editDuration,
                              price:
                                priceNum != null && Number.isFinite(priceNum)
                                  ? priceNum
                                  : null,
                              addressId: editAddressId || null,
                              scheduledDate: editDate || null,
                              scheduledTimeSlot: editSlot || null,
                            });
                          }}
                          className="h-11 px-5 rounded-[14px] bg-primary text-primary-foreground font-bold text-[14px] disabled:opacity-50 inline-flex items-center gap-2"
                        >
                          <Check size={16} />
                          {editMutation.isPending ? "Saving…" : "Save changes"}
                        </button>
                        <button
                          onClick={() => setEditOpen(false)}
                          className="h-11 px-4 rounded-[14px] border border-border text-foreground font-semibold text-[14px]"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* Delete booking (super_admin only) */}
              {canDelete && deleteOpen && (
                <section className="bg-background border border-red-200 rounded-[18px] p-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <h3 className="text-[13px] font-bold uppercase tracking-wide text-red-700">
                        Delete booking
                      </h3>
                      <p className="text-[12px] text-muted-foreground mt-1">
                        Soft-delete: hides the booking from lists and reports. Financial and audit history is preserved.
                      </p>
                    </div>
                    {!deleteOpen && (
                      <button
                        onClick={() => setDeleteOpen(true)}
                        className="h-11 px-4 rounded-[14px] border border-destructive text-destructive font-bold text-[14px] inline-flex items-center gap-2 hover:bg-red-50"
                      >
                        <Trash2 size={16} />
                        Delete booking
                      </button>
                    )}
                  </div>
                  {deleteOpen && (
                    <div className="rounded-[14px] border border-red-200 bg-red-50/40 p-4 space-y-3">
                      <p className="text-[13px] text-foreground">
                        Type the short booking ID <span className="font-mono font-bold">{shortId}</span> to confirm.
                      </p>
                      <input
                        value={deleteConfirmId}
                        onChange={(e) => setDeleteConfirmId(e.target.value)}
                        placeholder={shortId}
                        className="h-11 w-full px-3 rounded-[14px] border border-border bg-card text-[14px] font-mono"
                      />
                      <label className="block text-[12px] font-semibold text-muted-foreground">
                        Reason (required)
                        <textarea
                          value={deleteReason}
                          onChange={(e) => setDeleteReason(e.target.value)}
                          rows={3}
                          className="mt-1 w-full px-3 py-2 rounded-[14px] border border-border bg-card text-[14px] text-foreground font-normal"
                        />
                      </label>
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          disabled={
                            deleteConfirmId.trim() !== shortId ||
                            !deleteReason.trim() ||
                            deleteMutation.isPending
                          }
                          onClick={() => deleteMutation.mutate()}
                          className="h-11 px-5 rounded-[14px] bg-destructive text-white font-bold text-[14px] disabled:opacity-50 inline-flex items-center gap-2"
                        >
                          <Trash2 size={16} />
                          {deleteMutation.isPending ? "Deleting…" : "Confirm delete"}
                        </button>
                        <button
                          onClick={() => {
                            setDeleteOpen(false);
                            setDeleteConfirmId("");
                            setDeleteReason("");
                          }}
                          className="h-11 px-4 rounded-[14px] border border-border text-foreground font-semibold text-[14px]"
                        >
                          Back
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* Cancel booking */}
              {canCancel && cancelOpen && (
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

                      {canRefund && (
                        <div className="rounded-[14px] border border-border bg-muted/40 p-3 space-y-2">
                          <p className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
                            Refund
                          </p>
                          <label className="flex items-start gap-2 text-[13px] text-foreground">
                            <input
                              type="radio"
                              className="mt-1"
                              checked={cancelRefund}
                              onChange={() => setCancelRefund(true)}
                            />
                            <span>
                              Refund the full amount (₹{refundableAmount}) to the customer now
                            </span>
                          </label>
                          <label className="flex items-start gap-2 text-[13px] text-foreground">
                            <input
                              type="radio"
                              className="mt-1"
                              checked={!cancelRefund}
                              onChange={() => setCancelRefund(false)}
                            />
                            <span>Do not refund</span>
                          </label>
                          {cancelRefund && (
                            <div className="ml-6 flex flex-wrap gap-2 text-[12px]">
                              <span className="text-muted-foreground">Refund to:</span>
                              {(["original", "wallet"] as const).map((d) => (
                                <label key={d} className="flex items-center gap-1">
                                  <input type="radio" checked={cancelDest === d} onChange={() => setCancelDest(d)} />
                                  {d === "original" ? "Original payment method (5–7 working days)" : "badiyos Wallet (instant)"}
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          disabled={!cancelReason || cancelMutation.isPending}
                          onClick={() =>
                            cancelReason &&
                            cancelMutation.mutate({
                              reason: cancelReason,
                              refund: canRefund && cancelRefund,
                            })
                          }
                          className="h-11 px-5 rounded-[14px] bg-destructive text-white font-bold text-[14px] disabled:opacity-50 inline-flex items-center gap-2"
                        >
                          <Ban size={16} />
                          {cancelMutation.isPending
                            ? "Cancelling…"
                            : canRefund && cancelRefund
                              ? `Cancel & refund ₹${refundableAmount}`
                              : "Confirm cancel"}
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

              {/* Issue refund on an already-cancelled booking */}
              {canEdit && isTerminal && canRefund && refundConfirm && (
                <section className="bg-background border border-border rounded-[18px] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">
                        Issue refund
                      </h3>
                      <p className="text-[12px] text-muted-foreground mt-1">
                        ₹{refundableAmount} was paid online and has not been refunded yet.
                        The money goes back to the customer's original payment method.
                      </p>
                      {data.refundStatus === "failed" && (
                        <p className="text-[12px] text-destructive mt-1">
                          A previous refund attempt failed.
                        </p>
                      )}
                    </div>
                    {!refundConfirm && (
                      <button
                        onClick={() => setRefundConfirm(true)}
                        className="h-11 px-4 rounded-[14px] bg-primary text-primary-foreground font-bold text-[14px] inline-flex items-center gap-2 whitespace-nowrap"
                      >
                        <IndianRupee size={16} />
                        Refund ₹{refundableAmount}
                      </button>
                    )}
                  </div>
                  {refundConfirm && (
                    <div className="mt-3 rounded-[14px] border border-border bg-card p-3 space-y-3">
                      <p className="text-[13px] text-foreground">
                        Refund ₹{refundableAmount} to {data.customer.name || "the customer"}?
                        This cannot be undone.
                      </p>
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          disabled={refundMutation.isPending}
                          onClick={() => refundMutation.mutate()}
                          className="h-11 px-5 rounded-[14px] bg-primary text-primary-foreground font-bold text-[14px] disabled:opacity-50"
                        >
                          {refundMutation.isPending
                            ? "Refunding…"
                            : `Yes, refund ₹${refundableAmount}`}
                        </button>
                        <button
                          onClick={() => setRefundConfirm(false)}
                          className="h-11 px-4 rounded-[14px] border border-border text-foreground font-semibold text-[14px]"
                        >
                          Back
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {data.paymentStatus === "refunded" && (
                <section className="bg-background border border-border rounded-[18px] p-4">
                  <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1">
                    Refunded
                  </h3>
                  <p className="text-[14px] font-semibold text-foreground">
                    ₹{data.refundAmount ?? 0}
                    {data.refundId ? ` · ${data.refundId}` : ""}
                  </p>
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


              <HistorySection items={data.history} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PayRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-2 text-[13px] ${bold ? "font-bold text-foreground border-t border-border pt-1" : "text-foreground"}`}>
      <span className={bold ? "" : "text-muted-foreground"}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function AdjustTimeDialog({
  bookingId, price, baseMinutes, currentMinutes, paidOnline, onClose, onDone,
}: {
  bookingId: string; price: number; baseMinutes: number; currentMinutes: number; paidOnline: boolean;
  onClose: () => void; onDone: () => void;
}) {
  const adjust = useServerFn(adjustBookingTime);
  const [dir, setDir] = useState<"increase" | "decrease">("increase");
  const [mins, setMins] = useState("30");
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState("");
  const [money, setMoney] = useState<"charge" | "no_charge" | "refund" | "no_refund">("charge");
  useEffect(() => { setMoney(dir === "increase" ? "charge" : paidOnline ? "refund" : "no_refund"); }, [dir, paidOnline]);
  const m = Math.max(0, Math.round(Number(mins) || 0));
  const amount = Math.round((price / Math.max(baseMinutes, 1)) * m);
  const after = currentMinutes + (dir === "increase" ? m : -m);
  const mutation = useMutation({
    mutationFn: () => adjust({ data: { bookingId, deltaMinutes: dir === "increase" ? m : -m, reason, note: note.trim() || null, moneyMode: money } }),
    onSuccess: (r) => {
      toast.success(
        money === "charge" ? `Extra time of ₹${r.customer_amount} sent to the customer to pay`
        : money === "refund" ? `Time reduced · refund of ₹${r.customer_amount} marked due`
        : "Job time updated",
      );
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not adjust time"),
  });
  const radio = (v: typeof money, label: string, hint: string) => (
    <label className="flex items-start gap-2 text-[13px] text-foreground">
      <input type="radio" className="mt-1" checked={money === v} onChange={() => setMoney(v)} />
      <span>{label}<span className="block text-[11px] text-muted-foreground">{hint}</span></span>
    </label>
  );
  return (
    <section className="rounded-[14px] border border-border bg-background p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-bold text-foreground">Adjust time</h3>
        <button onClick={onClose} className="text-[12px] font-semibold text-muted-foreground">Close</button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {(["increase", "decrease"] as const).map((d) => (
          <button key={d} type="button" onClick={() => setDir(d)}
            className={`h-8 px-3 rounded-full border text-[12px] font-bold ${dir === d ? "bg-primary text-primary-foreground border-primary" : "border-border"}`}>
            {d === "increase" ? "+ Increase" : "− Decrease"}
          </button>
        ))}
        <input type="number" min={5} step={5} value={mins} onChange={(e) => setMins(e.target.value)}
          className="h-8 w-24 rounded-full border border-border bg-card px-3 text-[13px]" />
        <span className="text-[12px] text-muted-foreground">minutes · job becomes {after} min</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <select value={reason} onChange={(e) => setReason(e.target.value)} className="h-9 rounded-[10px] border border-border bg-card px-2 text-[13px]">
          <option value="">Reason (required)…</option>
          {ADJUST_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={reason === "Other" ? "Note (required)" : "Note (optional)"}
          className="h-9 rounded-[10px] border border-border bg-card px-3 text-[13px]" />
      </div>
      <div className="space-y-1.5">
        {dir === "increase" ? (
          <>
            {radio("charge", `Charge customer ₹${amount}`, "Sent to the customer to pay in the app; time and expert pay apply once paid.")}
            {radio("no_charge", "No charge", "Expert's pay increases for the extra time.")}
          </>
        ) : (
          <>
            {paidOnline && radio("refund", `Refund the difference ₹${amount}`, "Marked as refund due; expert's pay reduces.")}
            {radio("no_refund", "No refund", "Expert's pay reduces for the shorter job.")}
          </>
        )}
      </div>
      <div className="flex gap-2">
        <button type="button" disabled={!m || !reason || (reason === "Other" && !note.trim()) || after < 15 || mutation.isPending}
          onClick={() => mutation.mutate()}
          className="h-9 px-4 rounded-full bg-primary text-primary-foreground text-[13px] font-bold disabled:opacity-50">
          {mutation.isPending ? "Saving…" : "Save time change"}
        </button>
        <button type="button" onClick={onClose} className="h-9 px-4 rounded-full border border-border text-[13px] font-semibold">Back</button>
      </div>
    </section>
  );
}

function StaffNoteCard({ bookingId, initial }: { bookingId: string; initial: string | null }) {
  const qc = useQueryClient();
  const save = useServerFn(setBookingStaffNote);
  const [text, setText] = useState(initial ?? "");
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(initial ?? "");
  }, [initial, editing]);
  const m = useMutation({
    mutationFn: (note: string) => save({ data: { bookingId, note } }),
    onSuccess: (_d, note) => {
      toast.success(note.trim() ? "Note saved" : "Note removed");
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["pipeline", "board"] });
    },
    onError: (e: Error) => toast.error(e.message || "Could not save note"),
  });
  return (
    <Card title="Staff note (internal only)">
      {editing || !initial ? (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setEditing(true);
            }}
            maxLength={500}
            rows={3}
            placeholder="E.g. Customer called — gate bell kharab hai, aane se pehle call karein"
            className="w-full rounded-[10px] border border-input bg-background px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">{text.length}/500 · Customer/expert ko nahi dikhega</span>
            <div className="flex gap-2">
              {initial && (
                <button type="button" onClick={() => { setEditing(false); setText(initial); }} className="rounded-[8px] border border-border px-3 py-1.5 text-[12px] font-semibold">
                  Cancel
                </button>
              )}
              <button
                type="button"
                disabled={m.isPending || !text.trim() || text.trim() === (initial ?? "")}
                onClick={() => m.mutate(text)}
                className="rounded-[8px] bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-foreground disabled:opacity-50"
              >
                {m.isPending ? "Saving…" : "Save note"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="whitespace-pre-wrap rounded-[10px] border border-warning/50 bg-warning/15 px-3 py-2 text-[13px] text-foreground">
            {initial}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 rounded-[8px] border border-border px-3 py-1.5 text-[12px] font-semibold">
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
            <button
              type="button"
              disabled={m.isPending}
              onClick={() => { if (confirm("Remove this note?")) m.mutate(""); }}
              className="inline-flex items-center gap-1 rounded-[8px] border border-destructive/50 px-3 py-1.5 text-[12px] font-semibold text-destructive disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-background border border-border rounded-[14px] px-3 py-2.5">
      <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">
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
    <ol className="flex items-center gap-0.5 w-full min-w-0">
      {TIMELINE.map((s, idx) => {
        const done = !isTerminalBad && idx < currentIdx;
        const active = !isTerminalBad && idx === currentIdx;
        const Icon = done ? Check : active ? CircleDot : CircleDashed;
        return (
          <li key={s} className="flex items-center gap-0.5 min-w-0 flex-1 last:flex-none">
            <div
              title={STATUS_LABEL[s]}
              className={`flex items-center gap-1 px-1.5 py-1 rounded-full text-[11px] font-semibold min-w-0 ${
                active
                  ? "bg-primary-tint text-primary"
                  : done
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              <Icon size={12} className="shrink-0" />
              <span className="truncate">{STATUS_LABEL[s]}</span>
            </div>
            {idx < TIMELINE.length - 1 && (
              <span className="flex-1 min-w-[4px] h-px bg-border" />
            )}
          </li>
        );
      })}
      {isTerminalBad && (
        <li className="flex items-center gap-1 shrink-0 ml-1">
          <div className="flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold bg-red-50 text-red-700">
            <XCircle size={12} />
            {STATUS_LABEL[current]}
          </div>
        </li>
      )}
    </ol>
  );
}

const RESCHEDULE_SLOTS = Array.from({ length: 27 }, (_, i) => {
  const m = 7 * 60 + i * 30; // 7:00 AM … 8:00 PM, every 30 min
  const fmt = (x: number) => {
    const h = Math.floor(x / 60) % 24, mi = x % 60;
    return `${h % 12 === 0 ? 12 : h % 12}${mi ? `:${String(mi).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
  };
  return `${fmt(m)} (${fmt(m)} – ${fmt(m + 60)})`;
});

function ymdLocal(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function slotStartHour(slot: string): number | null {
  const m = slot.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === "PM") h += 12;
  return h + Number(m[2] ?? 0) / 60;
}

function RescheduleSection({
  currentDate,
  currentSlot,
  hasExpert,
  pending,
  onSubmit,
}: {
  currentDate: string | null;
  currentSlot: string | null;
  hasExpert: boolean;
  pending: boolean;
  onSubmit: (v: { date: string; slot: string; reason: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [slot, setSlot] = useState("");
  const [reason, setReason] = useState("");

  const today = new Date();
  const quick = [0, 1, 2].map((n) => {
    const d = new Date(today);
    d.setDate(today.getDate() + n);
    return {
      value: ymdLocal(d),
      label: n === 0 ? "Today" : n === 1 ? "Tomorrow" : d.toLocaleDateString([], { weekday: "short", day: "2-digit", month: "short" }),
    };
  });
  const isToday = date === ymdLocal(today);
  const nowHour = today.getHours() + today.getMinutes() / 60;

  const close = () => {
    setOpen(false);
    setDate("");
    setSlot("");
    setReason("");
  };

  return (
    <section className="bg-background border border-border rounded-[18px] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">
            Reschedule
          </h3>
          <p className="text-[12px] text-muted-foreground mt-1">
            Now: {currentDate ?? "ASAP"}
            {currentSlot ? ` · ${currentSlot}` : ""}. Order moves to Scheduled Orders.
          </p>
        </div>
        {!open && (
          <button
            onClick={() => setOpen(true)}
            className="h-11 px-4 rounded-[14px] border border-border text-foreground font-bold text-[14px] inline-flex items-center gap-2 hover:bg-muted"
          >
            <RefreshCw size={16} />
            Reschedule
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 rounded-[14px] border border-border bg-card p-4 space-y-4">
          <div>
            <p className="text-[12px] font-semibold text-muted-foreground mb-2">Date</p>
            <div className="flex flex-wrap items-center gap-2">
              {quick.map((q) => (
                <button
                  key={q.value}
                  type="button"
                  onClick={() => {
                    setDate(q.value);
                    setSlot("");
                  }}
                  className={`h-10 px-4 rounded-full border text-[13px] font-bold ${
                    date === q.value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  {q.label}
                </button>
              ))}
              <DateInput
                
                min={ymdLocal(today)}
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setSlot("");
                }}
                className="h-10 px-3 rounded-full border border-border bg-card text-[13px]"
              />
            </div>
          </div>

          {date && (
            <div>
              <p className="text-[12px] font-semibold text-muted-foreground mb-2">Time slot</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {RESCHEDULE_SLOTS.map((s) => {
                  const h = slotStartHour(s) ?? 0;
                  const past = isToday && h <= nowHour;
                  return (
                    <button
                      key={s}
                      type="button"
                      disabled={past}
                      onClick={() => setSlot(s)}
                      className={`h-10 px-2 rounded-[12px] border text-[12px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed ${
                        slot === s
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border hover:bg-muted"
                      }`}
                    >
                      {s.split(" (")[0]} – {s.split("– ")[1]?.replace(")", "")}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <label className="block text-[12px] font-semibold text-muted-foreground">
            Reason (optional)
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Customer called, wants tomorrow"
              className="mt-1 h-11 w-full px-3 rounded-[14px] border border-border bg-card text-[14px] text-foreground font-normal"
            />
          </label>

          {hasExpert && (
            <p className="text-[12px] text-warning-foreground bg-warning/20 border border-warning/40 rounded-[12px] px-3 py-2 inline-flex items-center gap-2">
              <AlertTriangle size={14} />
              Assigned expert will be removed and notified. Order will dispatch again at the new time.
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              disabled={!date || !slot || pending}
              onClick={() => onSubmit({ date, slot, reason })}
              className="h-11 px-5 rounded-[14px] bg-primary text-primary-foreground font-bold text-[14px] disabled:opacity-50 inline-flex items-center gap-2"
            >
              <Check size={16} />
              {pending ? "Saving…" : "Confirm reschedule"}
            </button>
            <button
              onClick={close}
              className="h-11 px-4 rounded-[14px] border border-border font-bold text-[14px] hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function ContactButtons({ phone, whatsapp = true }: { phone: string; whatsapp?: boolean }) {
  const digits = phone.replace(/\D/g, "");
  const wa = digits.length === 10 ? `91${digits}` : digits;
  const cls = "w-8 h-8 rounded-full border border-border inline-flex items-center justify-center text-primary hover:bg-muted";
  return (
    <span className="flex items-center gap-1.5 shrink-0">
      <a href={`tel:${phone}`} aria-label="Call" title="Call" className={cls}><Phone size={14} /></a>
      {whatsapp && (
        <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" aria-label="WhatsApp" title="WhatsApp" className={cls}>
          <MessageCircle size={14} />
        </a>
      )}
    </span>
  );
}

/** Nearest-first assign list (same as the board card popover), one click assigns. */
function NearestList({
  experts, loading, error, onRetry, search, onSearch, pending, onPick, onCancel,
}: {
  experts: Array<{ id: string; name: string; phone: string; distanceKm?: number | null; busy?: boolean }>;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  search: string;
  onSearch: (v: string) => void;
  pending: boolean;
  onPick: (id: string) => void;
  onCancel?: () => void;
}) {
  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <input type="text" placeholder="Search name or phone…" value={search} onChange={(e) => onSearch(e.target.value)}
          className="flex-1 h-8 px-3 rounded-full border border-border bg-card text-[12px]" />
        {onCancel && <button onClick={onCancel} className="text-[12px] font-semibold text-muted-foreground">Cancel</button>}
      </div>
      {error ? (
        <p className="text-[12px] text-destructive">{error} <button onClick={onRetry} className="underline font-semibold">Retry</button></p>
      ) : loading ? (
        <p className="text-[12px] text-muted-foreground">Loading experts…</p>
      ) : experts.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">No free experts right now.</p>
      ) : (
        <div className="max-h-48 overflow-y-auto divide-y divide-border rounded-[10px] border border-border">
          {experts.map((e) => (
            <button key={e.id} type="button" disabled={pending}
              onClick={() => { if (confirm(e.busy ? "Expert is on another job — assign anyway?" : `Assign ${e.name}?`)) onPick(e.id); }}
              className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-muted disabled:opacity-50">
              <span className="text-[13px] font-semibold text-foreground truncate">{e.name}</span>
              <span className="shrink-0 flex items-center gap-1.5 text-[11px]">
                <span className="text-muted-foreground">{e.distanceKm != null ? `${e.distanceKm.toFixed(1)} km` : "— km"}</span>
                <span className={`rounded-full px-1.5 py-0.5 font-bold ${e.busy ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}>{e.busy ? "Busy" : "Free"}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}


function ApLocationDialog({ bookingId, onClose, onDone }: { bookingId: string; onClose: () => void; onDone: () => void }) {
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [address, setAddress] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    const la = Number(lat), lo = Number(lng);
    if (!lat || !lng || !Number.isFinite(la) || !Number.isFinite(lo)) return toast.error("Enter a valid pin (latitude and longitude)");
    if (!reason.trim()) return toast.error("Reason is required");
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)("staff_update_booking_location", { _booking_id: bookingId, _lat: la, _lng: lo, _address: address.trim() || null, _reason: reason.trim() });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Location updated");
    onDone();
  }
  const inp = "w-full h-9 rounded-md border border-input bg-background px-2 text-sm";
  return (
    <div className="rounded-[14px] border border-border bg-card p-3 space-y-2">
      <p className="text-[13px] font-bold text-foreground">Update job location</p>
      <div className="grid grid-cols-2 gap-2">
        <input className={inp} placeholder="Latitude" value={lat} onChange={(e) => setLat(e.target.value)} aria-label="Latitude" />
        <input className={inp} placeholder="Longitude" value={lng} onChange={(e) => setLng(e.target.value)} aria-label="Longitude" />
      </div>
      <button type="button" className="text-[12px] font-semibold underline text-foreground" onClick={() => navigator.geolocation?.getCurrentPosition((p) => { setLat(String(p.coords.latitude)); setLng(String(p.coords.longitude)); }, () => toast.error("Could not read your location"))}>Use my location</button>
      <input className={inp} placeholder="Address (optional)" value={address} onChange={(e) => setAddress(e.target.value)} aria-label="Address" />
      <input className={inp} placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
      <div className="flex gap-2 justify-end">
        <ActionBtn onClick={onClose}>Cancel</ActionBtn>
        <ActionBtn variant="primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save location"}</ActionBtn>
      </div>
    </div>
  );
}

function ApConnectDialog({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  async function send() {
    if (!reason.trim()) return toast.error("Tell badiyos why the customer should be called");
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)("staff_connect_via_badiyos", { _booking_id: bookingId, _reason: reason.trim() });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("badiyos support will call the customer");
    onClose();
  }
  return (
    <div className="rounded-[14px] border border-border bg-card p-3 space-y-2">
      <p className="text-[13px] font-bold text-foreground">Connect via badiyos</p>
      <p className="text-[12px] text-muted-foreground">badiyos support calls the customer for you. The customer's number stays hidden.</p>
      <input className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm" placeholder="What should support tell the customer?" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
      <div className="flex gap-2 justify-end">
        <ActionBtn onClick={onClose}>Cancel</ActionBtn>
        <ActionBtn variant="primary" disabled={busy} onClick={send}>{busy ? "Sending…" : "Request call"}</ActionBtn>
      </div>
    </div>
  );
}
