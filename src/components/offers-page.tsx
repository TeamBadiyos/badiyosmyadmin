import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Pencil, Pause, Play, Send, X } from "lucide-react";
import {
  getOffersAccess,
  listCoupons,
  saveCoupon,
  setCouponActive,
  listCouponRedemptions,
  listMilestones,
  listMilestoneAwards,
  saveMilestone,
  setMilestoneActive,
  listCampaigns,
  listCampaignDeliveries,
  previewCampaignAudience,
  listCampaignCities,
  searchCampaignCustomers,
  saveCampaign,
  sendCampaign,
  type CouponRow,
  type MilestoneRow,
  type CampaignRow,
  type CampaignCustomer,
} from "@/lib/offers.functions";

type Tab = "coupons" | "milestones" | "campaigns";

const DISCOUNT_TYPES = [
  { value: "flat", label: "Flat ₹" },
  { value: "percent", label: "Percent %" },
  { value: "free_minutes", label: "Free minutes" },
] as const;

function discountLabel(type: string, value: number, max: number | null) {
  if (type === "percent") return `${value}%${max ? ` (max ₹${max})` : ""}`;
  if (type === "free_minutes") return `${value} min free`;
  return `₹${value}`;
}

function fmtDate(v: string | null) {
  return v ? new Date(v).toLocaleDateString("en-IN") : "—";
}

const inputCls =
  "h-10 w-full px-3 rounded-[12px] border border-border bg-card text-[13px] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
const labelCls =
  "text-[11px] font-bold uppercase tracking-wide text-muted-foreground";
const primaryBtn =
  "h-10 px-4 rounded-[12px] bg-primary text-primary-foreground font-semibold text-[13px] inline-flex items-center gap-2 disabled:opacity-60";
const ghostBtn =
  "h-9 px-3 rounded-[12px] border border-border font-semibold text-[13px] inline-flex items-center gap-1 hover:bg-muted";

export function OffersPage() {
  const [tab, setTab] = useState<Tab>("coupons");
  const fetchAccess = useServerFn(getOffersAccess);
  const { data: access } = useQuery({
    queryKey: ["offers", "access"],
    queryFn: () => fetchAccess(),
    staleTime: 60_000,
  });
  const canWrite = access?.canWrite ?? false;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["coupons", "Coupons"],
            ["milestones", "Referral Rewards"],
            ["campaigns", "Campaigns"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`h-10 px-4 rounded-[12px] text-[13px] font-semibold border transition-colors ${
              tab === key
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {!canWrite && access && (
        <p className="text-[12px] text-muted-foreground">
          You have view-only access to offers and campaigns.
        </p>
      )}

      {tab === "coupons" && <CouponsTab canWrite={canWrite} />}
      {tab === "milestones" && <MilestonesTab canWrite={canWrite} />}
      {tab === "campaigns" && (
        <CampaignsTab
          canWrite={canWrite}
          role={access?.role ?? null}
          city={access?.city ?? null}
        />
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- coupons */

function CouponsTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<CouponRow | "new" | null>(null);
  const [detail, setDetail] = useState<CouponRow | null>(null);
  const [search, setSearch] = useState("");

  const fetchList = useServerFn(listCoupons);
  const toggle = useServerFn(setCouponActive);

  const { data = [], isLoading } = useQuery({
    queryKey: ["offers", "coupons"],
    queryFn: () => fetchList(),
  });

  const toggleMut = useMutation({
    mutationFn: (v: { id: string; active: boolean }) => toggle({ data: v }),
    onSuccess: () => {
      toast.success("Coupon updated");
      qc.invalidateQueries({ queryKey: ["offers", "coupons"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = useMemo(
    () =>
      data.filter((c) =>
        search.trim()
          ? `${c.code} ${c.title}`.toLowerCase().includes(search.trim().toLowerCase())
          : true,
      ),
    [data, search],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search code or title"
          className={`${inputCls} max-w-[280px]`}
        />
        {canWrite && (
          <button className={primaryBtn} onClick={() => setEditing("new")}>
            <Plus size={16} /> New coupon
          </button>
        )}
      </div>

      <div className="bg-card border border-border rounded-[18px] overflow-x-auto">
        <div className="min-w-[900px]">
          <div className="grid grid-cols-[minmax(0,1.3fr)_140px_120px_180px_110px_150px] gap-4 px-6 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <span>Code</span>
            <span>Discount</span>
            <span>Used / limit</span>
            <span>Validity</span>
            <span>Status</span>
            <span className="text-right">Actions</span>
          </div>
          {isLoading && (
            <p className="text-[13px] text-muted-foreground text-center py-10">Loading…</p>
          )}
          {!isLoading && rows.length === 0 && (
            <p className="text-[13px] text-muted-foreground text-center py-10">No coupons yet.</p>
          )}
          {rows.map((c) => (
            <div
              key={c.id}
              className="grid grid-cols-[minmax(0,1.3fr)_140px_120px_180px_110px_150px] gap-4 items-center px-6 py-3 border-b border-border last:border-b-0 text-[14px]"
            >
              <button
                className="text-left min-w-0"
                onClick={() => setDetail(c)}
                title="View redemptions"
              >
                <p className="font-bold text-foreground truncate">{c.code}</p>
                <p className="text-[12px] text-muted-foreground truncate">
                  {c.title}
                  {c.audience === "referral_reward" ? " · referral reward only" : ""}
                </p>
              </button>
              <span>{discountLabel(c.discount_type, c.discount_value, c.max_discount)}</span>
              <span>
                {c.used_count} / {c.total_usage_limit ?? "∞"}
              </span>
              <span className="text-[12px] text-muted-foreground">
                {fmtDate(c.valid_from)} → {fmtDate(c.valid_until)}
              </span>
              <span>
                <span
                  className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-bold uppercase ${
                    c.is_active
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {c.is_active ? "Active" : "Paused"}
                </span>
              </span>
              <div className="flex justify-end gap-2">
                {canWrite && (
                  <>
                    <button className={ghostBtn} onClick={() => setEditing(c)}>
                      <Pencil size={14} />
                    </button>
                    <button
                      className={ghostBtn}
                      disabled={toggleMut.isPending}
                      onClick={() => toggleMut.mutate({ id: c.id, active: !c.is_active })}
                    >
                      {c.is_active ? <Pause size={14} /> : <Play size={14} />}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {editing && (
        <CouponModal
          coupon={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {detail && <RedemptionsModal coupon={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function CouponModal({ coupon, onClose }: { coupon: CouponRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const save = useServerFn(saveCoupon);
  const [form, setForm] = useState({
    code: coupon?.code ?? "",
    title: coupon?.title ?? "",
    description: coupon?.description ?? "",
    discount_type: (coupon?.discount_type ?? "flat") as CouponRow["discount_type"],
    discount_value: String(coupon?.discount_value ?? ""),
    max_discount: coupon?.max_discount != null ? String(coupon.max_discount) : "",
    min_order_amount: String(coupon?.min_order_amount ?? 0),
    valid_from: coupon?.valid_from ? coupon.valid_from.slice(0, 10) : "",
    valid_until: coupon?.valid_until ? coupon.valid_until.slice(0, 10) : "",
    total_usage_limit: coupon?.total_usage_limit != null ? String(coupon.total_usage_limit) : "",
    per_user_limit: String(coupon?.per_user_limit ?? 1),
    audience: (coupon?.audience === "referral_reward" ? "referral_reward" : "all") as
      | "all"
      | "referral_reward",
  });

  const mut = useMutation({
    mutationFn: () =>
      save({
        data: {
          id: coupon?.id ?? null,
          code: form.code,
          title: form.title,
          description: form.description || null,
          discount_type: form.discount_type,
          discount_value: Number(form.discount_value),
          max_discount: form.max_discount ? Number(form.max_discount) : null,
          min_order_amount: Number(form.min_order_amount || 0),
          valid_from: form.valid_from ? new Date(form.valid_from).toISOString() : null,
          valid_until: form.valid_until
            ? new Date(`${form.valid_until}T23:59:59`).toISOString()
            : null,
          total_usage_limit: form.total_usage_limit ? Number(form.total_usage_limit) : null,
          per_user_limit: Number(form.per_user_limit || 1),
          audience: form.audience,
        },
      }),
    onSuccess: () => {
      toast.success(coupon ? "Coupon updated" : "Coupon created");
      qc.invalidateQueries({ queryKey: ["offers", "coupons"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Modal title={coupon ? `Edit ${coupon.code}` : "New coupon"} onClose={onClose}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Code">
          <input
            className={inputCls}
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
          />
        </Field>
        <Field label="Title">
          <input
            className={inputCls}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </Field>
        <Field label="Discount type">
          <select
            className={inputCls}
            value={form.discount_type}
            onChange={(e) =>
              setForm({ ...form, discount_type: e.target.value as CouponRow["discount_type"] })
            }
          >
            {DISCOUNT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Discount value">
          <input
            className={inputCls}
            type="number"
            value={form.discount_value}
            onChange={(e) => setForm({ ...form, discount_value: e.target.value })}
          />
        </Field>
        <Field label="Max discount (₹)">
          <input
            className={inputCls}
            type="number"
            value={form.max_discount}
            onChange={(e) => setForm({ ...form, max_discount: e.target.value })}
          />
        </Field>
        <Field label="Min order (₹)">
          <input
            className={inputCls}
            type="number"
            value={form.min_order_amount}
            onChange={(e) => setForm({ ...form, min_order_amount: e.target.value })}
          />
        </Field>
        <Field label="Valid from">
          <input
            className={inputCls}
            type="date"
            value={form.valid_from}
            onChange={(e) => setForm({ ...form, valid_from: e.target.value })}
          />
        </Field>
        <Field label="Valid until">
          <input
            className={inputCls}
            type="date"
            value={form.valid_until}
            onChange={(e) => setForm({ ...form, valid_until: e.target.value })}
          />
        </Field>
        <Field label="Total usage limit">
          <input
            className={inputCls}
            type="number"
            placeholder="Unlimited"
            value={form.total_usage_limit}
            onChange={(e) => setForm({ ...form, total_usage_limit: e.target.value })}
          />
        </Field>
        <Field label="Per-customer limit">
          <input
            className={inputCls}
            type="number"
            value={form.per_user_limit}
            onChange={(e) => setForm({ ...form, per_user_limit: e.target.value })}
          />
        </Field>
        <Field label="Audience">
          <select
            className={inputCls}
            value={form.audience}
            onChange={(e) =>
              setForm({ ...form, audience: e.target.value as "all" | "referral_reward" })
            }
          >
            <option value="all">All customers</option>
            <option value="referral_reward">Referral reward only</option>
          </select>
        </Field>
        <Field label="Description">
          <input
            className={inputCls}
            value={form.description ?? ""}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
      </div>

      <div className="flex justify-end gap-2 pt-5">
        <button className={ghostBtn} onClick={onClose}>
          Cancel
        </button>
        <button className={primaryBtn} disabled={mut.isPending} onClick={() => mut.mutate()}>
          {mut.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}

function RedemptionsModal({ coupon, onClose }: { coupon: CouponRow; onClose: () => void }) {
  const fetchRows = useServerFn(listCouponRedemptions);
  const { data = [], isLoading } = useQuery({
    queryKey: ["offers", "redemptions", coupon.id],
    queryFn: () => fetchRows({ data: { couponId: coupon.id } }),
  });

  return (
    <Modal title={`${coupon.code} · redemptions`} onClose={onClose}>
      {isLoading && <p className="text-[13px] text-muted-foreground py-6">Loading…</p>}
      {!isLoading && data.length === 0 && (
        <p className="text-[13px] text-muted-foreground py-6">No redemptions yet.</p>
      )}
      <div className="divide-y divide-border">
        {data.map((r) => (
          <div key={r.id} className="py-3 flex items-center justify-between gap-4 text-[13px]">
            <div className="min-w-0">
              <p className="font-semibold truncate">{r.user_name ?? "—"}</p>
              <p className="text-[12px] text-muted-foreground truncate">
                {r.user_phone ?? ""} · {r.booking_id ? `Booking ${r.booking_id.slice(0, 8)}` : "No booking"}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="font-bold">₹{r.discount_amount} saved</p>
              <p className="text-[11px] text-muted-foreground">
                on ₹{r.base_amount} · {r.status} · {fmtDate(r.created_at)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------- milestones */

function MilestonesTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<MilestoneRow | "new" | null>(null);
  const [detail, setDetail] = useState<MilestoneRow | null>(null);

  const fetchList = useServerFn(listMilestones);
  const toggle = useServerFn(setMilestoneActive);

  const { data = [], isLoading } = useQuery({
    queryKey: ["offers", "milestones"],
    queryFn: () => fetchList(),
  });

  const toggleMut = useMutation({
    mutationFn: (v: { id: string; active: boolean }) => toggle({ data: v }),
    onSuccess: () => {
      toast.success("Milestone updated");
      qc.invalidateQueries({ queryKey: ["offers", "milestones"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">
          Each customer can earn a milestone only once.
        </p>
        {canWrite && (
          <button className={primaryBtn} onClick={() => setEditing("new")}>
            <Plus size={16} /> New milestone
          </button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {isLoading && <p className="text-[13px] text-muted-foreground">Loading…</p>}
        {!isLoading && data.length === 0 && (
          <p className="text-[13px] text-muted-foreground">No milestones yet.</p>
        )}
        {data.map((m) => (
          <div key={m.id} className="bg-card border border-border rounded-[18px] p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold text-foreground truncate">{m.name}</p>
                <p className="text-[12px] text-muted-foreground">
                  {m.required_referrals} qualified referrals
                </p>
              </div>
              <span
                className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-bold uppercase ${
                  m.is_active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                }`}
              >
                {m.is_active ? "Active" : "Paused"}
              </span>
            </div>
            <p className="text-[13px]">
              Reward:{" "}
              <span className="font-semibold">
                {discountLabel(
                  m.reward_discount_type,
                  m.reward_discount_value,
                  m.reward_max_discount,
                )}
              </span>{" "}
              · valid {m.reward_validity_days} days
            </p>
            <button
              className="text-[13px] font-semibold text-primary"
              onClick={() => setDetail(m)}
            >
              {m.earned_count} customers earned
            </button>
            {canWrite && (
              <div className="flex gap-2 pt-1">
                <button className={ghostBtn} onClick={() => setEditing(m)}>
                  <Pencil size={14} /> Edit
                </button>
                <button
                  className={ghostBtn}
                  onClick={() => toggleMut.mutate({ id: m.id, active: !m.is_active })}
                >
                  {m.is_active ? <Pause size={14} /> : <Play size={14} />}
                  {m.is_active ? "Pause" : "Resume"}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {editing && (
        <MilestoneModal
          milestone={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {detail && <MilestoneAwardsModal milestone={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function MilestoneModal({
  milestone,
  onClose,
}: {
  milestone: MilestoneRow | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const save = useServerFn(saveMilestone);
  const [form, setForm] = useState({
    name: milestone?.name ?? "",
    description: milestone?.description ?? "",
    required_referrals: String(milestone?.required_referrals ?? 5),
    reward_discount_type: (milestone?.reward_discount_type ?? "flat") as
      MilestoneRow["reward_discount_type"],
    reward_discount_value: String(milestone?.reward_discount_value ?? ""),
    reward_max_discount:
      milestone?.reward_max_discount != null ? String(milestone.reward_max_discount) : "",
    reward_min_order_amount: String(milestone?.reward_min_order_amount ?? 0),
    reward_validity_days: String(milestone?.reward_validity_days ?? 30),
  });

  const mut = useMutation({
    mutationFn: () =>
      save({
        data: {
          id: milestone?.id ?? null,
          name: form.name,
          description: form.description || null,
          required_referrals: Number(form.required_referrals),
          reward_discount_type: form.reward_discount_type,
          reward_discount_value: Number(form.reward_discount_value),
          reward_max_discount: form.reward_max_discount
            ? Number(form.reward_max_discount)
            : null,
          reward_min_order_amount: Number(form.reward_min_order_amount || 0),
          reward_validity_days: Number(form.reward_validity_days || 30),
        },
      }),
    onSuccess: () => {
      toast.success(milestone ? "Milestone updated" : "Milestone created");
      qc.invalidateQueries({ queryKey: ["offers", "milestones"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Modal title={milestone ? "Edit milestone" : "New milestone"} onClose={onClose}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Name">
          <input
            className={inputCls}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label="Qualified referrals needed">
          <input
            className={inputCls}
            type="number"
            value={form.required_referrals}
            onChange={(e) => setForm({ ...form, required_referrals: e.target.value })}
          />
        </Field>
        <Field label="Reward type">
          <select
            className={inputCls}
            value={form.reward_discount_type}
            onChange={(e) =>
              setForm({
                ...form,
                reward_discount_type: e.target.value as MilestoneRow["reward_discount_type"],
              })
            }
          >
            {DISCOUNT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Reward value">
          <input
            className={inputCls}
            type="number"
            value={form.reward_discount_value}
            onChange={(e) => setForm({ ...form, reward_discount_value: e.target.value })}
          />
        </Field>
        <Field label="Max discount (₹)">
          <input
            className={inputCls}
            type="number"
            value={form.reward_max_discount}
            onChange={(e) => setForm({ ...form, reward_max_discount: e.target.value })}
          />
        </Field>
        <Field label="Min order (₹)">
          <input
            className={inputCls}
            type="number"
            value={form.reward_min_order_amount}
            onChange={(e) => setForm({ ...form, reward_min_order_amount: e.target.value })}
          />
        </Field>
        <Field label="Validity (days)">
          <input
            className={inputCls}
            type="number"
            value={form.reward_validity_days}
            onChange={(e) => setForm({ ...form, reward_validity_days: e.target.value })}
          />
        </Field>
        <Field label="Description">
          <input
            className={inputCls}
            value={form.description ?? ""}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2 pt-5">
        <button className={ghostBtn} onClick={onClose}>
          Cancel
        </button>
        <button className={primaryBtn} disabled={mut.isPending} onClick={() => mut.mutate()}>
          {mut.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}

function MilestoneAwardsModal({
  milestone,
  onClose,
}: {
  milestone: MilestoneRow;
  onClose: () => void;
}) {
  const fetchRows = useServerFn(listMilestoneAwards);
  const { data = [], isLoading } = useQuery({
    queryKey: ["offers", "milestone-awards", milestone.id],
    queryFn: () => fetchRows({ data: { programId: milestone.id } }),
  });

  return (
    <Modal title={`${milestone.name} · earners`} onClose={onClose}>
      {isLoading && <p className="text-[13px] text-muted-foreground py-6">Loading…</p>}
      {!isLoading && data.length === 0 && (
        <p className="text-[13px] text-muted-foreground py-6">Nobody has earned this yet.</p>
      )}
      <div className="divide-y divide-border">
        {data.map((a) => (
          <div key={a.id} className="py-3 flex items-center justify-between gap-4 text-[13px]">
            <div className="min-w-0">
              <p className="font-semibold truncate">{a.user_name ?? "—"}</p>
              <p className="text-[12px] text-muted-foreground truncate">{a.user_phone ?? ""}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="font-bold">{a.coupon_code ?? "—"}</p>
              <p className="text-[11px] text-muted-foreground">
                {a.referrals_at_award} referrals · {fmtDate(a.created_at)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------------- campaigns */

function CampaignsTab({
  canWrite,
  role,
  city,
}: {
  canWrite: boolean;
  role: string | null;
  city: string | null;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<CampaignRow | "new" | null>(null);
  const [detail, setDetail] = useState<CampaignRow | null>(null);
  const [confirmSend, setConfirmSend] = useState<CampaignRow | null>(null);

  const fetchList = useServerFn(listCampaigns);
  const send = useServerFn(sendCampaign);

  const { data = [], isLoading } = useQuery({
    queryKey: ["offers", "campaigns"],
    queryFn: () => fetchList(),
  });

  const sendMut = useMutation({
    mutationFn: (id: string) => send({ data: { id } }),
    onSuccess: (r) => {
      toast.success(`Campaign sent to ${r.sent} customers`);
      qc.invalidateQueries({ queryKey: ["offers", "campaigns"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[13px] text-muted-foreground">
          {role === "ops_manager"
            ? `You can send campaigns to ${city ?? "your assigned city"} only.`
            : "Scheduling is not enabled yet — campaigns are sent immediately."}
        </p>
        {canWrite && (
          <button className={primaryBtn} onClick={() => setEditing("new")}>
            <Plus size={16} /> New campaign
          </button>
        )}
      </div>

      <div className="bg-card border border-border rounded-[18px] overflow-x-auto">
        <div className="min-w-[860px]">
          <div className="grid grid-cols-[minmax(0,1.4fr)_140px_120px_150px_170px] gap-4 px-6 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <span>Campaign</span>
            <span>Audience</span>
            <span>Status</span>
            <span>Sent</span>
            <span className="text-right">Actions</span>
          </div>
          {isLoading && (
            <p className="text-[13px] text-muted-foreground text-center py-10">Loading…</p>
          )}
          {!isLoading && data.length === 0 && (
            <p className="text-[13px] text-muted-foreground text-center py-10">
              No campaigns yet.
            </p>
          )}
          {data.map((c) => (
            <div
              key={c.id}
              className="grid grid-cols-[minmax(0,1.4fr)_140px_120px_150px_170px] gap-4 items-center px-6 py-3 border-b border-border last:border-b-0 text-[14px]"
            >
              <button className="text-left min-w-0" onClick={() => setDetail(c)}>
                <p className="font-bold truncate">{c.title}</p>
                <p className="text-[12px] text-muted-foreground truncate">{c.body}</p>
              </button>
              <span className="text-[13px]">{c.audience === "all" ? "All customers" : c.audience}</span>
              <span>
                <span
                  className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-bold uppercase ${
                    c.status === "sent"
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {c.status}
                </span>
              </span>
              <span className="text-[12px] text-muted-foreground">
                {c.status === "sent"
                  ? `${c.delivered} delivered · ${c.failed} failed`
                  : "—"}
              </span>
              <div className="flex justify-end gap-2">
                {canWrite && c.status !== "sent" && (
                  <>
                    <button className={ghostBtn} onClick={() => setEditing(c)}>
                      <Pencil size={14} />
                    </button>
                    <button
                      className={primaryBtn}
                      disabled={sendMut.isPending}
                      onClick={() => setConfirmSend(c)}
                    >
                      <Send size={14} /> Send now
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {editing && (
        <CampaignModal
          campaign={editing === "new" ? null : editing}
          role={role}
          city={city}
          onClose={() => setEditing(null)}
        />
      )}
      {confirmSend && (
        <SendConfirmModal
          campaign={confirmSend}
          pending={sendMut.isPending}
          onClose={() => setConfirmSend(null)}
          onConfirm={() => {
            sendMut.mutate(confirmSend.id);
            setConfirmSend(null);
          }}
        />
      )}
      {detail && <DeliveriesModal campaign={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function CampaignModal({
  campaign,
  role,
  city,
  onClose,
}: {
  campaign: CampaignRow | null;
  role: string | null;
  city: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const save = useServerFn(saveCampaign);
  const fetchCities = useServerFn(listCampaignCities);
  const { data: cities = [] } = useQuery({
    queryKey: ["offers", "cities"],
    queryFn: () => fetchCities(),
    staleTime: 5 * 60_000,
  });

  const locked = role === "ops_manager";
  const [form, setForm] = useState({
    title: campaign?.title ?? "",
    body: campaign?.body ?? "",
    image_url: campaign?.image_url ?? "",
    deep_link: campaign?.deep_link ?? "",
    audience: campaign?.audience ?? (locked ? city ?? "" : "all"),
    show_in_offers: campaign?.show_in_offers ?? true,
  });

  const mut = useMutation({
    mutationFn: () =>
      save({
        data: {
          id: campaign?.id ?? null,
          title: form.title,
          body: form.body,
          image_url: form.image_url || null,
          deep_link: form.deep_link || null,
          audience: form.audience,
          show_in_offers: form.show_in_offers,
        },
      }),
    onSuccess: () => {
      toast.success(campaign ? "Campaign updated" : "Campaign created");
      qc.invalidateQueries({ queryKey: ["offers", "campaigns"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Modal title={campaign ? "Edit campaign" : "New campaign"} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Title">
          <input
            className={inputCls}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </Field>
        <Field label="Message">
          <textarea
            className={`${inputCls} h-24 py-2`}
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
          />
        </Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Image URL (optional)">
            <input
              className={inputCls}
              value={form.image_url ?? ""}
              onChange={(e) => setForm({ ...form, image_url: e.target.value })}
            />
          </Field>
          <Field label="Deep link (optional)">
            <input
              className={inputCls}
              placeholder="offers"
              value={form.deep_link ?? ""}
              onChange={(e) => setForm({ ...form, deep_link: e.target.value })}
            />
          </Field>
          <Field label="Audience">
            <select
              className={inputCls}
              value={form.audience}
              disabled={locked}
              onChange={(e) => setForm({ ...form, audience: e.target.value })}
            >
              {!locked && <option value="all">All customers</option>}
              {cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Show in customer Offers tab">
            <label className="flex items-center gap-2 h-10 text-[13px]">
              <input
                type="checkbox"
                checked={form.show_in_offers}
                onChange={(e) => setForm({ ...form, show_in_offers: e.target.checked })}
              />
              Publish in Offers
            </label>
          </Field>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-5">
        <button className={ghostBtn} onClick={onClose}>
          Cancel
        </button>
        <button className={primaryBtn} disabled={mut.isPending} onClick={() => mut.mutate()}>
          {mut.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}

function SendConfirmModal({
  campaign,
  pending,
  onClose,
  onConfirm,
}: {
  campaign: CampaignRow;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const preview = useServerFn(previewCampaignAudience);
  const { data, isLoading } = useQuery({
    queryKey: ["offers", "audience", campaign.audience],
    queryFn: () => preview({ data: { audience: campaign.audience } }),
  });

  return (
    <Modal title="Send this campaign?" onClose={onClose}>
      <div className="space-y-3 text-[13px]">
        <p className="text-muted-foreground">
          This sends an app notification to customers in{" "}
          <strong className="text-foreground">
            {campaign.audience === "all" ? "all cities" : campaign.audience}
          </strong>
          . It cannot be undone or edited afterwards.
        </p>
        {isLoading ? (
          <p className="text-muted-foreground">Checking audience…</p>
        ) : (
          data && (
            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                { l: "Customers", v: data.total },
                { l: "Can receive", v: data.reachable },
                { l: "No app", v: data.unreachable },
              ].map((c) => (
                <div key={c.l} className="border border-border rounded-[14px] py-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    {c.l}
                  </p>
                  <p className="text-[20px] font-bold">{c.v}</p>
                </div>
              ))}
            </div>
          )
        )}
        <p className="text-[12px] text-muted-foreground">
          Customers without the app installed are marked failed — they get nothing.
        </p>
      </div>
      <div className="flex justify-end gap-2 pt-5">
        <button className={ghostBtn} onClick={onClose}>
          Cancel
        </button>
        <button className={primaryBtn} disabled={pending} onClick={onConfirm}>
          <Send size={14} /> Send now
        </button>
      </div>
    </Modal>
  );
}

function DeliveriesModal({
  campaign,
  onClose,
}: {
  campaign: CampaignRow;
  onClose: () => void;
}) {
  const fetchRows = useServerFn(listCampaignDeliveries);
  const { data = [], isLoading } = useQuery({
    queryKey: ["offers", "deliveries", campaign.id],
    queryFn: () => fetchRows({ data: { campaignId: campaign.id } }),
    refetchInterval: 5000,
  });

  const counts = data.reduce(
    (acc, d) => {
      const k = d.status === "delivered" ? "delivered" : d.status === "failed" ? "failed" : "queued";
      acc[k] += 1;
      return acc;
    },
    { delivered: 0, failed: 0, queued: 0 },
  );

  const exportCsv = () => {
    const rows = [
      ["Name", "Phone", "Status", "Reason"],
      ...data.map((d) => [d.user_name ?? "", d.user_phone ?? "", d.status, d.error ?? ""]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `campaign-${campaign.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal title={`${campaign.title} · delivery`} onClose={onClose}>
      <div className="flex items-center justify-between gap-3 pb-3">
        <p className="text-[13px] text-muted-foreground">
          {campaign.status === "sent"
            ? `Sent ${fmtDate(campaign.sent_at)} · ${counts.delivered} delivered · ${counts.failed} failed${
                counts.queued ? ` · ${counts.queued} still sending` : ""
              }`
            : "Not sent yet."}
        </p>
        {data.length > 0 && (
          <button className={ghostBtn} onClick={exportCsv}>
            Export CSV
          </button>
        )}
      </div>
      <p className="text-[12px] text-muted-foreground pb-3">
        &ldquo;Delivered&rdquo; means Google accepted the notification for that phone.
      </p>
      {isLoading && <p className="text-[13px] text-muted-foreground py-6">Loading…</p>}
      <div className="divide-y divide-border max-h-[50vh] overflow-y-auto">
        {data.map((d) => (
          <div key={d.id} className="py-3 flex items-center justify-between gap-4 text-[13px]">
            <div className="min-w-0">
              <p className="font-semibold truncate">{d.user_name ?? "—"}</p>
              <p className="text-[12px] text-muted-foreground truncate">{d.user_phone ?? ""}</p>
            </div>
            <div className="text-right shrink-0 max-w-[55%]">
              <span
                className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-bold uppercase ${
                  d.status === "failed"
                    ? "bg-destructive/10 text-destructive"
                    : d.status === "delivered"
                      ? "bg-primary/10 text-primary"
                      : "bg-amber-100 text-amber-800"
                }`}
              >
                {d.status}
              </span>
              {d.error && (
                <p className="text-[11px] text-muted-foreground mt-1 break-words">{d.error}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------- shared */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className={labelCls}>{label}</span>
      {children}
    </label>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-card border border-border rounded-[18px] w-full max-w-[720px] my-8 p-6">
        <div className="flex items-center justify-between gap-4 pb-4">
          <h2 className="text-[17px] font-bold text-foreground">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
