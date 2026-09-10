import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { listCustomers, getCustomerProfile, type CustomerRow } from "@/lib/users.functions";

const PAGE_SIZE = 25;

function inr(n: number) {
  return `₹${Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function UsersPage({ onSelectBooking }: { onSelectBooking?: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [sort, setSort] = useState<"recent" | "spend">("recent");
  const [selected, setSelected] = useState<string | null>(null);

  const fetchCustomers = useServerFn(listCustomers);

  const filters = useMemo(
    () => ({ search: query || null, page, pageSize: PAGE_SIZE, includeDeleted, sort }),
    [query, page, includeDeleted, sort],
  );

  const { data, isLoading, isError } = useQuery({
    queryKey: ["customers", "list", filters],
    queryFn: () => fetchCustomers({ data: filters }),
    staleTime: 20_000,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-[18px] p-4 flex flex-wrap items-end gap-3">
        <form
          className="flex flex-col gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(search.trim());
            setPage(1);
          }}
        >
          <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Search
          </label>
          <div className="flex gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, phone or email"
              className="h-10 px-3 rounded-[12px] border border-border bg-card text-[13px] min-w-[240px]"
            />
            <button
              type="submit"
              className="h-10 px-4 rounded-[12px] bg-primary text-primary-foreground text-[13px] font-semibold"
            >
              Search
            </button>
          </div>
        </form>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Sort
          </label>
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as "recent" | "spend");
              setPage(1);
            }}
            className="h-10 px-3 rounded-[12px] border border-border bg-card text-[13px]"
          >
            <option value="recent">Newest first</option>
            <option value="spend">Highest spend (this page)</option>
          </select>
        </div>

        <label className="flex items-center gap-2 h-10 px-3 rounded-[12px] border border-border text-[13px] font-semibold text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeDeleted}
            onChange={(e) => {
              setIncludeDeleted(e.target.checked);
              setPage(1);
            }}
            className="accent-primary"
          />
          Include deleted
        </label>

        <div className="ml-auto text-[12px] text-muted-foreground self-center">
          {isLoading ? "Loading…" : `${total} user${total === 1 ? "" : "s"}`}
        </div>
      </div>

      <div className="bg-card border border-border rounded-[18px] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Phone</th>
                <th className="text-left px-4 py-3">Email</th>
                <th className="text-left px-4 py-3">Location</th>
                <th className="text-left px-4 py-3">Bookings</th>
                <th className="text-left px-4 py-3">Spend</th>
                <th className="text-left px-4 py-3">Referrals</th>
                <th className="text-left px-4 py-3">Joined</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {isError && !isLoading && (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-destructive">
                    Failed to load users.
                  </td>
                </tr>
              )}
              {!isLoading && !isError && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-muted-foreground">
                    No users found.
                  </td>
                </tr>
              )}
              {rows.map((r: CustomerRow) => (
                <tr
                  key={r.id}
                  onClick={() => setSelected(r.id)}
                  className={`border-t border-border hover:bg-muted/40 cursor-pointer ${r.deleted_at ? "opacity-60" : ""}`}
                >
                  <td className="px-4 py-3 font-semibold text-foreground">
                    <div className="flex items-center gap-2">
                      <span>{r.full_name ?? "—"}</span>
                      {r.deleted_at && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-red-50 text-red-700">
                          Deleted
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{r.phone ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.email ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {[r.area, r.city].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="px-4 py-3">{r.bookings_count}</td>
                  <td className="px-4 py-3">{inr(r.total_spend)}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {r.successful_referrals} · {r.total_coins_earned} coins
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {fmtDate(r.created_at)}
                  </td>
                </tr>
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

      {selected && (
        <CustomerProfileModal
          userId={selected}
          onClose={() => setSelected(null)}
          onSelectBooking={onSelectBooking}
        />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="border border-border rounded-[14px] overflow-hidden">{children}</div>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="px-4 py-6 text-center text-[13px] text-muted-foreground">{label}</div>;
}

function CustomerProfileModal({
  userId,
  onClose,
  onSelectBooking,
}: {
  userId: string;
  onClose: () => void;
  onSelectBooking?: (id: string) => void;
}) {
  const fetchProfile = useServerFn(getCustomerProfile);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["customers", "profile", userId],
    queryFn: () => fetchProfile({ data: { userId } }),
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-card border border-border rounded-[18px] w-full max-w-4xl my-6">
        <div className="flex items-start justify-between p-5 border-b border-border">
          <div>
            <h2 className="text-[18px] font-bold text-foreground">
              {data?.user.full_name ?? "Customer profile"}
            </h2>
            <p className="text-[13px] text-muted-foreground">
              {[data?.user.phone, data?.user.email].filter(Boolean).join(" · ") || "—"}
            </p>
            {data && (
              <p className="text-[12px] text-muted-foreground mt-1">
                Joined {fmtDate(data.user.created_at)}
                {data.user.referral_code ? ` · Code ${data.user.referral_code}` : ""}
                {data.user.preferred_language ? ` · ${data.user.preferred_language}` : ""}
                {data.user.deleted_at ? " · Account deleted" : ""}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="h-9 w-9 inline-flex items-center justify-center rounded-[12px] border border-border hover:bg-muted"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {isLoading && <p className="text-[13px] text-muted-foreground">Loading profile…</p>}
          {isError && <p className="text-[13px] text-destructive">Failed to load this profile.</p>}

          {data && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { label: "Bookings", value: String(data.stats.bookings) },
                  { label: "Completed", value: String(data.stats.completed) },
                  { label: "Cancelled", value: String(data.stats.cancelled) },
                  { label: "Lifetime spend", value: inr(data.stats.lifetime_spend) },
                  {
                    label: "Avg rating",
                    value: data.stats.avg_rating ? data.stats.avg_rating.toFixed(1) : "—",
                  },
                  { label: "Coin balance", value: String(data.stats.coin_balance) },
                ].map((s) => (
                  <div key={s.label} className="border border-border rounded-[14px] p-3">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      {s.label}
                    </div>
                    <div className="text-[18px] font-bold text-foreground mt-1">{s.value}</div>
                  </div>
                ))}
              </div>

              <Section title="Addresses">
                {data.addresses.length === 0 ? (
                  <Empty label="No saved addresses." />
                ) : (
                  <ul className="divide-y divide-border">
                    {data.addresses.map((a) => (
                      <li key={a.id} className="px-4 py-3 text-[13px]">
                        <div className="font-semibold text-foreground">
                          {a.label ?? "Address"}
                          {a.is_default && (
                            <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-primary">
                              Default
                            </span>
                          )}
                        </div>
                        <div className="text-muted-foreground">{a.full_address}</div>
                        <div className="text-[12px] text-muted-foreground">
                          {[a.area, a.city].filter(Boolean).join(", ")}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="Bookings">
                {data.bookings.length === 0 ? (
                  <Empty label="No bookings yet." />
                ) : (
                  <table className="w-full text-[13px]">
                    <thead className="bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="text-left px-4 py-2">Placed</th>
                        <th className="text-left px-4 py-2">Service</th>
                        <th className="text-left px-4 py-2">Expert</th>
                        <th className="text-left px-4 py-2">Status</th>
                        <th className="text-left px-4 py-2">Payment</th>
                        <th className="text-left px-4 py-2">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.bookings.map((b) => (
                        <tr
                          key={b.id}
                          onClick={() => onSelectBooking?.(b.id)}
                          className="border-t border-border hover:bg-muted/40 cursor-pointer"
                        >
                          <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                            {fmtDate(b.created_at)}
                          </td>
                          <td className="px-4 py-2">
                            {b.service_label ?? "—"}
                            <div className="text-[11px] text-muted-foreground">
                              {b.scheduled_date ?? ""}
                              {b.scheduled_time_slot ? ` · ${b.scheduled_time_slot}` : ""}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">
                            {b.expert_name ?? "—"}
                          </td>
                          <td className="px-4 py-2">{b.status.replace("_", " ")}</td>
                          <td className="px-4 py-2 text-muted-foreground">
                            {b.paid ? "paid" : "unpaid"}
                          </td>
                          <td className="px-4 py-2">{inr(b.price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Section>

              <Section title="Wallet & coins ledger">
                {data.wallet.length === 0 ? (
                  <Empty label="No wallet activity." />
                ) : (
                  <ul className="divide-y divide-border">
                    {data.wallet.map((w) => (
                      <li key={w.id} className="px-4 py-2 flex items-center justify-between text-[13px]">
                        <div>
                          <div className="text-foreground">{w.description}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {fmtDate(w.created_at)} · {w.type}
                          </div>
                        </div>
                        <span
                          className={
                            w.type === "debit" ? "text-destructive font-semibold" : "text-emerald-700 font-semibold"
                          }
                        >
                          {w.type === "debit" ? "-" : "+"}
                          {w.amount}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="Referrals">
                {data.referrals.length === 0 ? (
                  <Empty label="No referrals." />
                ) : (
                  <ul className="divide-y divide-border">
                    {data.referrals.map((r) => (
                      <li key={r.id} className="px-4 py-2 text-[13px] flex items-center justify-between">
                        <div>
                          <div className="text-foreground">
                            {r.direction === "made" ? "Referred" : "Referred by"}{" "}
                            {r.counterpart_name ?? r.counterpart_phone ?? "Unknown"}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {fmtDate(r.created_at)} · {r.status}
                          </div>
                        </div>
                        <span className="text-muted-foreground">{r.reward_amount} coins</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="Support tickets">
                {data.tickets.length === 0 ? (
                  <Empty label="No support tickets." />
                ) : (
                  <ul className="divide-y divide-border">
                    {data.tickets.map((t) => (
                      <li key={t.id} className="px-4 py-2 text-[13px]">
                        <div className="text-foreground">{t.message}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {fmtDate(t.created_at)} · {t.source} · {t.status}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {data.deletionRequests.length > 0 && (
                <Section title="Deletion requests">
                  <ul className="divide-y divide-border">
                    {data.deletionRequests.map((d) => (
                      <li key={d.id} className="px-4 py-2 text-[13px]">
                        <div className="text-foreground">{d.reason ?? "No reason given"}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {fmtDate(d.created_at)} · {d.status}
                        </div>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
