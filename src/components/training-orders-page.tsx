import { DateInput } from "@/components/date-input";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  createTrainingOrder,
  deleteTrainingOrders,
  getTrainingSetup,
  listTrainingOrders,
  type TrainingAddress,
  type TrainingOrder,
} from "@/lib/training.functions";
import { StoreTrainingPanel } from "@/components/store-training-panel";
import { TrainingAddressCard, TrainingAddressFields } from "@/components/training-address-card";

const inputCls = "w-full h-10 px-3 rounded-[10px] border border-border bg-card text-[13px] text-foreground";
const labelCls = "text-[11px] font-bold uppercase tracking-wide text-muted-foreground";

const SLOT_HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18];
function hourLabel(h: number) {
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh} ${h < 12 ? "AM" : "PM"}`;
}
const SLOTS = SLOT_HOURS.map((h) => `${hourLabel(h)} (${hourLabel(h)} – ${hourLabel(h + 1)})`);

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const STATUS_STYLE: Record<string, string> = {
  completed: "bg-primary/10 text-primary",
  cancelled: "bg-destructive/10 text-destructive",
  in_progress: "bg-primary/15 text-primary",
};

export function TrainingOrdersPage() {
  const qc = useQueryClient();
  const fetchSetup = useServerFn(getTrainingSetup);
  const fetchOrders = useServerFn(listTrainingOrders);
  const setupQ = useQuery({ queryKey: ["training", "setup"], queryFn: () => fetchSetup() });
  const ordersQ = useQuery({
    queryKey: ["training", "orders"],
    queryFn: () => fetchOrders(),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    const ch = supabase
      .channel(`training-orders-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, (p) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const row = (p.new ?? p.old) as any;
        if (!row || row.is_training === undefined || row.is_training) {
          qc.invalidateQueries({ queryKey: ["training", "orders"] });
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const role = setupQ.data?.role ?? null;
  const isSuper = role === "super_admin";
  const canCreate = role === "super_admin" || role === "ops_manager";
  const orders = ordersQ.data ?? [];

  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<TrainingOrder | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [delReq, setDelReq] = useState<
    { kind: "ids"; ids: string[] } | { kind: "clear"; from: string; to: string; expertId: string } | null
  >(null);
  const [clearOpen, setClearOpen] = useState(false);

  useEffect(() => {
    if (createdId) {
      const f = orders.find((o) => o.id === createdId);
      if (f) setCreated(f);
    }
  }, [createdId, orders]);

  useEffect(() => {
    setSelected((s) => new Set([...s].filter((id) => orders.some((o) => o.id === id))));
  }, [orders]);

  const allChecked = orders.length > 0 && selected.size === orders.length;

  return (
    <div className="space-y-6">
      <StoreTrainingPanel />
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[14px] text-muted-foreground">
          Practice orders for experts in Training mode. These never show on other screens.
        </p>
        <div className="flex gap-2 flex-wrap">
          {isSuper && selected.size > 0 && (
            <button
              onClick={() => setDelReq({ kind: "ids", ids: [...selected] })}
              className="h-11 px-4 rounded-[12px] border border-destructive/50 text-destructive text-[13px] font-bold"
            >
              Delete selected ({selected.size})
            </button>
          )}
          {isSuper && (
            <button
              onClick={() => setClearOpen(true)}
              className="h-11 px-4 rounded-[12px] border border-border bg-card text-[13px] font-bold"
            >
              Clear training data
            </button>
          )}
          {canCreate && (
            <button
              onClick={() => setCreateOpen(true)}
              className="h-11 px-4 rounded-[12px] bg-primary text-primary-foreground text-[13px] font-bold inline-flex items-center gap-2"
            >
              <Plus size={16} /> Create Training Order
            </button>
          )}
        </div>
      </div>

      <div className="bg-card border border-border rounded-[18px] overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr className="text-left">
              {isSuper && (
                <th className="px-3 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={() => setSelected(allChecked ? new Set() : new Set(orders.map((o) => o.id)))}
                    aria-label="Select all"
                  />
                </th>
              )}
              <th className="px-3 py-3">Order #</th>
              <th className="px-3 py-3">Expert</th>
              <th className="px-3 py-3">Service</th>
              <th className="px-3 py-3">Date & slot</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Start OTP</th>
              <th className="px-3 py-3">End OTP</th>
              <th className="px-3 py-3">Created</th>
              {isSuper && <th className="px-3 py-3" />}
            </tr>
          </thead>
          <tbody>
            {ordersQ.isLoading && (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
            )}
            {ordersQ.isError && (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-destructive">
                {ordersQ.error instanceof Error ? ordersQ.error.message : "Couldn't load training orders."}
              </td></tr>
            )}
            {!ordersQ.isLoading && !ordersQ.isError && orders.length === 0 && (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">No training orders yet.</td></tr>
            )}
            {orders.map((o) => (
              <tr key={o.id} className="border-t border-border">
                {isSuper && (
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(o.id)}
                      onChange={() =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (n.has(o.id)) n.delete(o.id);
                          else n.add(o.id);
                          return n;
                        })
                      }
                      aria-label="Select order"
                    />
                  </td>
                )}
                <td className="px-3 py-3 font-mono">#{o.id.slice(0, 6)}</td>
                <td className="px-3 py-3">
                  {o.expertName ?? (
                    <span className="px-2 py-0.5 rounded-full bg-warning/20 text-[11px] font-bold">Broadcasting</span>
                  )}
                </td>
                <td className="px-3 py-3">{o.serviceLabel ?? "—"}</td>
                <td className="px-3 py-3">
                  {o.scheduledDate
                    ? new Date(o.scheduledDate).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Kolkata" })
                    : "Now"}
                  {o.scheduledTimeSlot ? ` · ${o.scheduledTimeSlot}` : ""}
                </td>
                <td className="px-3 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold capitalize ${STATUS_STYLE[o.status] ?? "bg-muted text-foreground"}`}>
                    {o.status.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="px-3 py-3 font-mono font-bold text-[15px]">{o.startOtp ?? "—"}</td>
                <td className="px-3 py-3 font-mono font-bold text-[15px]">{o.endOtp ?? "—"}</td>
                <td className="px-3 py-3 text-muted-foreground whitespace-nowrap">
                  {new Date(o.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })}
                </td>
                {isSuper && (
                  <td className="px-3 py-3">
                    <button
                      onClick={() => setDelReq({ kind: "ids", ids: [o.id] })}
                      className="p-2 rounded-[8px] text-destructive hover:bg-destructive/10"
                      aria-label="Delete training order"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {setupQ.data && <TrainingAddressCard initial={setupQ.data.address} canEdit={isSuper} />}

      {createOpen && setupQ.data && (
        <CreateDialog
          setup={setupQ.data}
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => {
            setCreateOpen(false);
            setCreated(null);
            setCreatedId(id ?? "__pending");
            qc.invalidateQueries({ queryKey: ["training", "orders"] });
          }}
        />
      )}

      {createdId && (
        <Modal title="Training order created" onClose={() => { setCreatedId(null); setCreated(null); }}>
          {created ? (
            <div className="space-y-3">
              <p className="text-[13px]">
                Order <b className="font-mono">#{created.id.slice(0, 6)}</b> · {created.serviceLabel} ·{" "}
                {created.expertName ?? "Broadcasting"}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <OtpBox label="Start OTP" value={created.startOtp} />
                <OtpBox label="End OTP" value={created.endOtp} />
              </div>
              <p className="text-[12px] text-muted-foreground">Give these OTPs to the expert during training.</p>
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              Order created. Its OTPs will appear in the table as soon as they are ready.
            </p>
          )}
        </Modal>
      )}

      {clearOpen && (
        <ClearDialog
          experts={setupQ.data?.experts ?? []}
          orders={orders}
          onClose={() => setClearOpen(false)}
          onNext={(f) => {
            setClearOpen(false);
            setDelReq({ kind: "clear", ...f });
          }}
        />
      )}

      {delReq && (
        <DeleteConfirm
          req={delReq}
          orders={orders}
          onClose={() => setDelReq(null)}
          onDone={(n) => {
            setDelReq(null);
            setSelected(new Set());
            toast.success(`${n} training order${n === 1 ? "" : "s"} deleted`);
            qc.invalidateQueries({ queryKey: ["training", "orders"] });
          }}
        />
      )}
    </div>
  );
}

function OtpBox({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-[12px] border border-border p-3 text-center">
      <p className={labelCls}>{label}</p>
      <p className="font-mono text-[24px] font-bold tracking-widest">{value ?? "—"}</p>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-foreground/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card rounded-[18px] border border-border w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-[16px] font-bold">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-muted"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function CreateDialog({
  setup,
  onClose,
  onCreated,
}: {
  setup: { address: TrainingAddress; options: { id: string; label: string }[]; experts: { id: string; name: string }[] };
  onClose: () => void;
  onCreated: (id: string | null) => void;
}) {
  const create = useServerFn(createTrainingOrder);
  const [optionId, setOptionId] = useState("");
  const [date, setDate] = useState(todayIso());
  const [slot, setSlot] = useState("");
  const [address, setAddress] = useState<TrainingAddress>(setup.address);
  const [expertId, setExpertId] = useState("");
  const mut = useMutation({
    mutationFn: () =>
      create({
        data: {
          priceOptionId: optionId,
          scheduledDate: slot ? date : null,
          scheduledTimeSlot: slot || null,
          address,
          expertId: expertId || null,
        },
      }),
    onSuccess: (r) => onCreated(r.bookingId),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't create the order. Please try again."),
  });
  return (
    <Modal title="Create Training Order" onClose={() => !mut.isPending && onClose()}>
      <label className="block space-y-1">
        <span className={labelCls}>Service</span>
        <select className={inputCls} value={optionId} onChange={(e) => setOptionId(e.target.value)}>
          <option value="">Choose a service</option>
          {setup.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1">
          <span className={labelCls}>Date</span>
          <DateInput  className={inputCls} value={date} min={todayIso()} onChange={(e) => setDate(e.target.value)} disabled={!slot} />
        </label>
        <label className="block space-y-1">
          <span className={labelCls}>Slot</span>
          <select className={inputCls} value={slot} onChange={(e) => setSlot(e.target.value)}>
            <option value="">Now (no slot)</option>
            {SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>
      <TrainingAddressFields value={address} onChange={setAddress} />
      <label className="block space-y-1">
        <span className={labelCls}>Assign to</span>
        <select className={inputCls} value={expertId} onChange={(e) => setExpertId(e.target.value)}>
          <option value="">Broadcast to all training experts</option>
          {setup.experts.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        {setup.experts.length === 0 && (
          <span className="text-[11px] text-muted-foreground">No experts are in Training mode right now.</span>
        )}
      </label>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} disabled={mut.isPending} className="h-10 px-4 rounded-[10px] border border-border text-[13px] font-bold">Cancel</button>
        <button
          onClick={() => mut.mutate()}
          disabled={mut.isPending || !optionId || !address.full_address.trim()}
          className="h-10 px-4 rounded-[10px] bg-primary text-primary-foreground text-[13px] font-bold disabled:opacity-50"
        >
          {mut.isPending ? "Creating…" : "Create order"}
        </button>
      </div>
    </Modal>
  );
}

function matchesClear(o: TrainingOrder, f: { from: string; to: string; expertId: string }) {
  const d = o.createdAt.slice(0, 10);
  if (f.from && d < f.from) return false;
  if (f.to && d > f.to) return false;
  if (f.expertId && o.expertId !== f.expertId) return false;
  return true;
}

function ClearDialog({
  experts,
  orders,
  onClose,
  onNext,
}: {
  experts: { id: string; name: string }[];
  orders: TrainingOrder[];
  onClose: () => void;
  onNext: (f: { from: string; to: string; expertId: string }) => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [expertId, setExpertId] = useState("");
  const count = useMemo(() => orders.filter((o) => matchesClear(o, { from, to, expertId })).length, [orders, from, to, expertId]);
  return (
    <Modal title="Clear training data" onClose={onClose}>
      <p className="text-[13px] text-muted-foreground">Leave filters empty to clear all training orders.</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1">
          <span className={labelCls}>From</span>
          <DateInput  className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className={labelCls}>To</span>
          <DateInput  className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <label className="block space-y-1">
        <span className={labelCls}>Expert</span>
        <select className={inputCls} value={expertId} onChange={(e) => setExpertId(e.target.value)}>
          <option value="">All experts</option>
          {experts.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </label>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="h-10 px-4 rounded-[10px] border border-border text-[13px] font-bold">Cancel</button>
        <button
          disabled={count === 0}
          onClick={() => onNext({ from, to, expertId })}
          className="h-10 px-4 rounded-[10px] bg-destructive text-destructive-foreground text-[13px] font-bold disabled:opacity-50"
        >
          Continue ({count})
        </button>
      </div>
    </Modal>
  );
}

function DeleteConfirm({
  req,
  orders,
  onClose,
  onDone,
}: {
  req: { kind: "ids"; ids: string[] } | { kind: "clear"; from: string; to: string; expertId: string };
  orders: TrainingOrder[];
  onClose: () => void;
  onDone: (n: number) => void;
}) {
  const del = useServerFn(deleteTrainingOrders);
  const [typed, setTyped] = useState("");
  const count = req.kind === "ids" ? req.ids.length : orders.filter((o) => matchesClear(o, req)).length;
  const mut = useMutation({
    mutationFn: () =>
      del({
        data:
          req.kind === "ids"
            ? { ids: req.ids }
            : { from: req.from || null, to: req.to || null, expertId: req.expertId || null },
      }),
    onSuccess: (r) => onDone(r.deleted ?? count),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't delete. Please try again."),
  });
  return (
    <Modal title="Delete training orders?" onClose={() => !mut.isPending && onClose()}>
      <p className="text-[14px]">
        <b>{count}</b> training order{count === 1 ? "" : "s"} will be permanently deleted.
      </p>
      <label className="block space-y-1">
        <span className={labelCls}>Type DELETE to confirm</span>
        <input className={inputCls} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="DELETE" autoFocus />
      </label>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} disabled={mut.isPending} className="h-10 px-4 rounded-[10px] border border-border text-[13px] font-bold">Cancel</button>
        <button
          disabled={typed !== "DELETE" || mut.isPending || count === 0}
          onClick={() => mut.mutate()}
          className="h-10 px-4 rounded-[10px] bg-destructive text-destructive-foreground text-[13px] font-bold disabled:opacity-50"
        >
          {mut.isPending ? "Deleting…" : `Delete ${count}`}
        </button>
      </div>
    </Modal>
  );
}
