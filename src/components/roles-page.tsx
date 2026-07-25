import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, X, Check, ShieldCheck, RefreshCw, Copy } from "lucide-react";
import {
  listStaffUsers,
  createStaffUser,
  updateStaffUser,
  type StaffUserRow,
  type StaffRole,
  type StaffStatus,
} from "@/lib/staff.functions";
import { listZones } from "@/lib/zones.functions";

function randomPassword(len = 14) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const arr = new Uint32Array(len);
  (globalThis.crypto ?? window.crypto).getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join("");
}

function roleLabel(r: StaffRole) {
  return r === "super_admin" ? "Super Admin" : r === "ops_manager" ? "Ops Manager" : "Area Partner";
}

function roleBadgeClass(r: StaffRole) {
  if (r === "super_admin") return "bg-primary/15 text-primary";
  if (r === "ops_manager") return "bg-info/15 text-info";
  return "bg-warning/15 text-warning";
}

export function RolesPage() {
  const fetchStaff = useServerFn(listStaffUsers);
  const { data = [], isLoading, isError } = useQuery({
    queryKey: ["staff-users", "list"],
    queryFn: () => fetchStaff(),
    staleTime: 15_000,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<StaffUserRow | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-[14px] text-muted-foreground">
          <ShieldCheck size={16} className="text-primary" />
          Manage staff accounts and their roles.
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="h-[52px] px-5 rounded-[14px] bg-primary text-white text-[14px] font-bold inline-flex items-center gap-2 hover:opacity-95"
        >
          <Plus size={18} />
          Add Staff User
        </button>
      </div>

      <div className="bg-card border border-border rounded-[18px] overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_130px_minmax(0,1fr)_100px_140px_90px] gap-4 px-6 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <span>Name</span>
          <span>Email</span>
          <span>Role</span>
          <span>Zone</span>
          <span>Status</span>
          <span>Created</span>
          <span></span>
        </div>

        {isLoading && (
          <p className="text-[13px] text-muted-foreground text-center py-10">Loading…</p>
        )}
        {isError && (
          <p className="text-[13px] text-destructive text-center py-10">Failed to load.</p>
        )}
        {!isLoading && !isError && data.length === 0 && (
          <p className="text-[13px] text-muted-foreground text-center py-10">No staff yet.</p>
        )}

        {data.map((u) => (
          <div
            key={u.id}
            className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_130px_minmax(0,1fr)_100px_140px_90px] gap-4 items-center px-6 py-4 border-b border-border last:border-b-0 text-[14px]"
          >
            <span className="font-semibold text-foreground truncate">
              {u.name}
              {u.isSelf && (
                <span className="ml-2 text-[11px] text-muted-foreground font-normal">(you)</span>
              )}
            </span>
            <span className="text-muted-foreground truncate">{u.email}</span>
            <span>
              <span
                className={`inline-flex px-2 py-1 rounded-full text-[11px] font-bold ${roleBadgeClass(u.role)}`}
              >
                {roleLabel(u.role)}
              </span>
            </span>
            <span className="text-muted-foreground truncate">
              {u.role === "area_partner" ? u.zoneName ?? "—" : "—"}
            </span>
            <span>
              <span
                className={`inline-flex px-2 py-1 rounded-full text-[11px] font-bold ${
                  u.status === "active"
                    ? "bg-success/15 text-success"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {u.status}
              </span>
            </span>
            <span className="text-muted-foreground text-[13px]">
              {new Date(u.createdAt).toLocaleDateString()}
            </span>
            <button
              onClick={() => setEditing(u)}
              className="h-9 px-3 rounded-[10px] border border-border text-[13px] font-semibold hover:bg-muted"
            >
              Edit
            </button>
          </div>
        ))}
      </div>

      {createOpen && <CreateModal onClose={() => setCreateOpen(false)} />}
      {editing && <EditModal user={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CreateModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const fetchZones = useServerFn(listZones);
  const create = useServerFn(createStaffUser);

  const { data: zones = [] } = useQuery({
    queryKey: ["zones", "list"],
    queryFn: () => fetchZones(),
    staleTime: 30_000,
  });

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"ops_manager" | "area_partner">("ops_manager");
  const [zoneId, setZoneId] = useState<string>("");
  const [password, setPassword] = useState(() => randomPassword());
  const [error, setError] = useState<string | null>(null);
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const mutation = useMutation({
    mutationFn: (payload: {
      name: string;
      email: string;
      role: "ops_manager" | "area_partner";
      zone_id: string | null;
      password: string;
    }) => create({ data: payload }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-users"] });
      setCreatedPassword(password);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-card rounded-[24px] w-full max-w-md p-6 space-y-5">
        <div className="flex items-start justify-between">
          <h2 className="text-[18px] font-bold text-foreground">
            {createdPassword ? "Staff user created" : "Add Staff User"}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center"
          >
            <X size={16} />
          </button>
        </div>

        {createdPassword ? (
          <div className="space-y-4">
            <p className="text-[13px] text-muted-foreground">
              Share this temporary password with the new user. It won't be shown again.
            </p>
            <div className="flex items-center gap-2 border border-border rounded-[14px] px-3 py-3 bg-muted/40">
              <code className="flex-1 text-[14px] font-mono font-semibold text-foreground break-all">
                {createdPassword}
              </code>
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(createdPassword);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="h-9 px-3 rounded-[10px] bg-primary text-white text-[12px] font-bold inline-flex items-center gap-1"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <button
              onClick={onClose}
              className="h-[52px] w-full rounded-[14px] bg-primary text-white font-bold"
            >
              Done
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              mutation.mutate({
                name: name.trim(),
                email: email.trim(),
                role,
                zone_id: role === "area_partner" ? zoneId || null : null,
                password,
              });
            }}
            className="space-y-4"
          >
            <Field label="Name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full h-[46px] px-3 rounded-[14px] border border-border bg-background text-[14px]"
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full h-[46px] px-3 rounded-[14px] border border-border bg-background text-[14px]"
              />
            </Field>
            <Field label="Role">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as "ops_manager" | "area_partner")}
                className="w-full h-[46px] px-3 rounded-[14px] border border-border bg-background text-[14px]"
              >
                <option value="ops_manager">Ops Manager</option>
                <option value="area_partner">Area Partner</option>
              </select>
            </Field>
            {role === "area_partner" && (
              <Field label="Zone">
                <select
                  value={zoneId}
                  onChange={(e) => setZoneId(e.target.value)}
                  required
                  className="w-full h-[46px] px-3 rounded-[14px] border border-border bg-background text-[14px]"
                >
                  <option value="">Select zone…</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name} — {z.city}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Temporary Password">
              <div className="flex gap-2">
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  required
                  className="flex-1 h-[46px] px-3 rounded-[14px] border border-border bg-background text-[14px] font-mono"
                />
                <button
                  type="button"
                  onClick={() => setPassword(randomPassword())}
                  className="h-[46px] px-3 rounded-[14px] border border-border text-[13px] font-semibold inline-flex items-center gap-1 hover:bg-muted"
                >
                  <RefreshCw size={14} />
                  Generate
                </button>
              </div>
            </Field>

            {error && <p className="text-[13px] text-destructive">{error}</p>}

            <button
              type="submit"
              disabled={mutation.isPending}
              className="h-[52px] w-full rounded-[14px] bg-primary text-white font-bold disabled:opacity-60"
            >
              {mutation.isPending ? "Creating…" : "Create Staff User"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function EditModal({ user, onClose }: { user: StaffUserRow; onClose: () => void }) {
  const qc = useQueryClient();
  const fetchZones = useServerFn(listZones);
  const update = useServerFn(updateStaffUser);
  const { data: zones = [] } = useQuery({
    queryKey: ["zones", "list"],
    queryFn: () => fetchZones(),
    staleTime: 30_000,
  });

  const [role, setRole] = useState<StaffRole>(user.role);
  const [zoneId, setZoneId] = useState<string>(user.zoneId ?? "");
  const [status, setStatus] = useState<StaffStatus>(user.status);
  const [error, setError] = useState<string | null>(null);

  const selfRoleLocked = user.isSelf;
  const selfDeactivateLocked = user.isSelf;

  const mutation = useMutation({
    mutationFn: () =>
      update({
        data: {
          id: user.id,
          role,
          zone_id: role === "area_partner" ? zoneId || null : null,
          status,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-users"] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const roleOptions = useMemo(() => {
    if (user.role === "super_admin") return ["super_admin"] as StaffRole[];
    return ["ops_manager", "area_partner"] as StaffRole[];
  }, [user.role]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-card rounded-[24px] w-full max-w-md p-6 space-y-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[18px] font-bold text-foreground">Edit Staff User</h2>
            <p className="text-[13px] text-muted-foreground mt-1">{user.name} · {user.email}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center"
          >
            <X size={16} />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <Field label="Role">
            <select
              value={role}
              disabled={selfRoleLocked || user.role === "super_admin"}
              onChange={(e) => setRole(e.target.value as StaffRole)}
              className="w-full h-[46px] px-3 rounded-[14px] border border-border bg-background text-[14px] disabled:opacity-60"
            >
              {roleOptions.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
            {(selfRoleLocked || user.role === "super_admin") && (
              <p className="text-[12px] text-muted-foreground mt-1">
                {user.role === "super_admin"
                  ? "Super Admin role is protected and cannot be changed here."
                  : "You cannot change your own role."}
              </p>
            )}
          </Field>

          {role === "area_partner" && (
            <Field label="Zone">
              <select
                value={zoneId}
                onChange={(e) => setZoneId(e.target.value)}
                required
                className="w-full h-[46px] px-3 rounded-[14px] border border-border bg-background text-[14px]"
              >
                <option value="">Select zone…</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name} — {z.city}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="Status">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as StaffStatus)}
              className="w-full h-[46px] px-3 rounded-[14px] border border-border bg-background text-[14px]"
            >
              <option value="active">Active</option>
              <option value="inactive" disabled={selfDeactivateLocked}>
                Inactive{selfDeactivateLocked ? " (cannot deactivate self)" : ""}
              </option>
            </select>
          </Field>

          {error && <p className="text-[13px] text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={mutation.isPending}
            className="h-[52px] w-full rounded-[14px] bg-primary text-white font-bold disabled:opacity-60"
          >
            {mutation.isPending ? "Saving…" : "Save Changes"}
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
