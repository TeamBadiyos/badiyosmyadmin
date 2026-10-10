import { useEffect, useMemo, useRef, useState } from "react";
import { SortFilterHeader, SortFilterReset, useSortFilter, type SortFilterColumn } from "@/components/table-sort-filter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Dices, Download, Pencil, Plus, Trash2, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  deleteLuckyCampaign,
  deleteLuckyPrize,
  getLuckyCampaignDetail,
  listLuckyCampaigns,
  publishLuckyWinners,
  resetLuckyDraw,
  runLuckyDraw,
  saveLuckyCampaign,
  saveLuckyPrize,
  type LuckyCampaign,
  type LuckyPrize,
} from "@/lib/lucky-draw.functions";
import { LuckyMediaUpload } from "@/components/lucky-media-upload";

const toLocalInput = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
};
const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("en-IN") : "—");
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

type CampaignForm = {
  title: string;
  description: string;
  banner_url: string;
  start_at: string;
  end_at: string;
  enrolment_target: number;
  is_active: boolean;
  show_enrolled_count: boolean;
  show_leaderboard: boolean;
  referral_bonus_enabled: boolean;
  leaderboard_rewards_enabled: boolean;
  leaderboard_top_ranks: number;
};

const emptyCampaign: CampaignForm = {
  title: "",
  description: "",
  banner_url: "",
  start_at: "",
  end_at: "",
  enrolment_target: 1000,
  is_active: false,
  show_enrolled_count: true,
  show_leaderboard: true,
  referral_bonus_enabled: true,
  leaderboard_rewards_enabled: true,
  leaderboard_top_ranks: 10,
};

export function LuckyDrawPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listLuckyCampaigns);
  const saveFn = useServerFn(saveLuckyCampaign);
  const delFn = useServerFn(deleteLuckyCampaign);
  const { data: campaigns = [], isLoading } = useQuery({ queryKey: ["lucky-campaigns"], queryFn: () => listFn() });
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; form: CampaignForm } | null>(null);

  const current = campaigns.find((c) => c.id === selected) ?? campaigns.find((c) => c.is_active) ?? campaigns[0];

  const save = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const f = editing.form;
      return saveFn({
        data: {
          id: editing.id,
          payload: {
            ...f,
            start_at: f.start_at ? new Date(f.start_at).toISOString() : null,
            end_at: f.end_at ? new Date(f.end_at).toISOString() : null,
          },
        },
      });
    },
    onSuccess: (id) => {
      toast.success("Campaign saved");
      setEditing(null);
      if (id) setSelected(id);
      qc.invalidateQueries({ queryKey: ["lucky-campaigns"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Campaign deleted");
      setSelected(null);
      qc.invalidateQueries({ queryKey: ["lucky-campaigns"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const openEdit = (c?: LuckyCampaign) =>
    setEditing({
      id: c?.id ?? null,
      form: c
        ? {
            title: c.title,
            description: c.description ?? "",
            banner_url: c.banner_url ?? "",
            start_at: toLocalInput(c.start_at),
            end_at: toLocalInput(c.end_at),
            enrolment_target: c.enrolment_target,
            is_active: c.is_active,
            show_enrolled_count: c.show_enrolled_count,
            show_leaderboard: c.show_leaderboard,
            referral_bonus_enabled: c.referral_bonus_enabled,
            leaderboard_rewards_enabled: c.leaderboard_rewards_enabled,
            leaderboard_top_ranks: c.leaderboard_top_ranks,
          }
        : { ...emptyCampaign },
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <Dices className="h-5 w-5 text-primary" /> Lucky Draw
          </h2>
          <p className="text-sm text-muted-foreground">Campaigns, prizes, enrolments and the draw. Super Admin only.</p>
        </div>
        <Button onClick={() => openEdit()}>
          <Plus className="mr-1 h-4 w-4" /> New campaign
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : campaigns.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">No campaigns yet.</CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {campaigns.map((c) => (
              <Button
                key={c.id}
                size="sm"
                variant={current?.id === c.id ? "default" : "outline"}
                onClick={() => setSelected(c.id)}
              >
                {c.title}
                {c.is_active && <Badge className="ml-2" variant="secondary">Active</Badge>}
              </Button>
            ))}
          </div>
          {current && (
            <CampaignDetail
              campaign={current}
              onEdit={() => openEdit(current)}
              onDelete={() => {
                if (confirm(`Delete "${current.title}"?`)) remove.mutate(current.id);
              }}
            />
          )}
        </>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit campaign" : "New campaign"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <CampaignFormFields form={editing.form} onChange={(form) => setEditing({ ...editing, form })} />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CampaignFormFields({ form, onChange }: { form: CampaignForm; onChange: (f: CampaignForm) => void }) {
  const set = <K extends keyof CampaignForm>(k: K, v: CampaignForm[K]) => onChange({ ...form, [k]: v });
  const toggles: Array<[keyof CampaignForm, string]> = [
    ["is_active", "Active (only one campaign can be active)"],
    ["show_enrolled_count", "Show enrolled count to customers"],
    ["show_leaderboard", "Show leaderboard"],
    ["referral_bonus_enabled", "Referral bonus entries (+1 per valid referral)"],
    ["leaderboard_rewards_enabled", "Leaderboard rewards"],
  ];
  return (
    <div className="space-y-3">
      <div>
        <Label>Title</Label>
        <Input value={form.title} onChange={(e) => set("title", e.target.value)} />
      </div>
      <div>
        <Label>Description</Label>
        <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} />
      </div>
      <LuckyMediaUpload label="Banner image" kind="banner" value={form.banner_url} onChange={(u) => set("banner_url", u)} />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Start</Label>
          <Input type="datetime-local" value={form.start_at} onChange={(e) => set("start_at", e.target.value)} />
        </div>
        <div>
          <Label>End (draw)</Label>
          <Input type="datetime-local" value={form.end_at} onChange={(e) => set("end_at", e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Enrolment target</Label>
          <Input
            type="number"
            value={form.enrolment_target}
            onChange={(e) => set("enrolment_target", Number(e.target.value))}
          />
        </div>
        <div>
          <Label>Top rewarded ranks</Label>
          <Input
            type="number"
            value={form.leaderboard_top_ranks}
            onChange={(e) => set("leaderboard_top_ranks", Number(e.target.value))}
          />
        </div>
      </div>
      {toggles.map(([k, label]) => (
        <div key={k} className="flex items-center justify-between rounded-md border p-2">
          <span className="text-sm">{label}</span>
          <Switch checked={Boolean(form[k])} onCheckedChange={(v) => set(k, v as never)} />
        </div>
      ))}
    </div>
  );
}

function CampaignDetail({
  campaign,
  onEdit,
  onDelete,
}: {
  campaign: LuckyCampaign;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const qc = useQueryClient();
  const detailFn = useServerFn(getLuckyCampaignDetail);
  const runFn = useServerFn(runLuckyDraw);
  const resetFn = useServerFn(resetLuckyDraw);
  const pubFn = useServerFn(publishLuckyWinners);
  const { data, isLoading } = useQuery({
    queryKey: ["lucky-detail", campaign.id],
    queryFn: () => detailFn({ data: { id: campaign.id } }),
    refetchInterval: 30_000,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["lucky-detail", campaign.id] });
    qc.invalidateQueries({ queryKey: ["lucky-campaigns"] });
  };

  const enrolled = data?.overview.enrolled ?? 0;
  const pct = campaign.enrolment_target > 0 ? Math.min(100, (enrolled / campaign.enrolment_target) * 100) : 0;
  const ended = new Date(campaign.end_at).getTime() <= Date.now();
  const canRun = !campaign.draw_executed_at && (ended || (campaign.enrolment_target > 0 && enrolled >= campaign.enrolment_target));

  const run = useMutation({
    mutationFn: () => runFn({ data: { id: campaign.id } }),
    onSuccess: (r) => {
      toast.success(`Draw done: ${r.lucky_winners} lucky + ${r.leaderboard_winners} leaderboard winners`);
      refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const reset = useMutation({
    mutationFn: (reason: string) => resetFn({ data: { id: campaign.id, reason } }),
    onSuccess: () => {
      toast.success("Draw reset");
      refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const publish = useMutation({
    mutationFn: (published: boolean) => pubFn({ data: { id: campaign.id, published } }),
    onSuccess: () => refresh(),
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6 md:flex-row">
          {campaign.banner_url && (
            <img src={campaign.banner_url} alt={campaign.title} className="h-32 w-full rounded-md object-cover md:w-56" />
          )}
          <div className="flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold">{campaign.title}</h3>
              <Badge variant={campaign.is_active ? "default" : "outline"}>{campaign.is_active ? "Active" : "Inactive"}</Badge>
              {campaign.draw_executed_at && <Badge variant="secondary">Draw done</Badge>}
            </div>
            {campaign.description && <p className="text-sm text-muted-foreground">{campaign.description}</p>}
            <p className="text-xs text-muted-foreground">
              {fmt(campaign.start_at)} → {fmt(campaign.end_at)}
            </p>
          </div>
          <div className="flex gap-2 md:flex-col">
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Pencil className="mr-1 h-4 w-4" /> Edit
            </Button>
            <Button size="sm" variant="outline" onClick={onDelete}>
              <Trash2 className="mr-1 h-4 w-4" /> Delete
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Enrolled" value={enrolled.toLocaleString("en-IN")} />
        <Kpi label="Target" value={`${pct.toFixed(1)}% of ${campaign.enrolment_target}`} />
        <Kpi label="Total entries" value={(data?.overview.total_entries ?? 0).toLocaleString("en-IN")} />
        <Kpi label="Draw" value={campaign.draw_executed_at ? fmt(campaign.draw_executed_at) : canRun ? "Ready" : "Not yet"} />
      </div>

      <Tabs defaultValue="prizes">
        <TabsList>
          <TabsTrigger value="prizes">Prizes</TabsTrigger>
          <TabsTrigger value="enrolments">Enrolments</TabsTrigger>
          <TabsTrigger value="draw">Draw & Winners</TabsTrigger>
        </TabsList>
        <TabsContent value="prizes" className="space-y-4">
          {isLoading ? null : (
            <>
              <PrizeList campaignId={campaign.id} type="lucky_draw" prizes={data?.prizes ?? []} onChanged={refresh} />
              <PrizeList campaignId={campaign.id} type="leaderboard" prizes={data?.prizes ?? []} onChanged={refresh} />
            </>
          )}
        </TabsContent>
        <TabsContent value="enrolments">
          <EnrolmentsTable rows={data?.overview.enrolments ?? []} title={campaign.title} />
        </TabsContent>
        <TabsContent value="draw" className="space-y-4">
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 pt-6">
              <Button
                disabled={!canRun || run.isPending}
                onClick={() => {
                  if (confirm("Run the lucky draw now? This can only be done once.")) run.mutate();
                }}
              >
                <Dices className="mr-1 h-4 w-4" /> {run.isPending ? "Running…" : "Run Lucky Draw"}
              </Button>
              {campaign.draw_executed_at && (
                <Button
                  variant="outline"
                  onClick={() => {
                    const r = prompt("Reason for resetting the draw?");
                    if (r) reset.mutate(r);
                  }}
                >
                  Reset draw
                </Button>
              )}
              <div className="flex items-center gap-2">
                <Switch
                  checked={campaign.winners_published}
                  disabled={!campaign.draw_executed_at}
                  onCheckedChange={(v) => publish.mutate(v)}
                />
                <span className="text-sm">Publish winners</span>
              </div>
              {!canRun && !campaign.draw_executed_at && (
                <span className="text-xs text-muted-foreground">Enabled after end date or once target is reached.</span>
              )}
              {campaign.draw_seed && (
                <span className="text-xs text-muted-foreground">Seed: {campaign.draw_seed}</span>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Trophy className="h-4 w-4 text-primary" /> Winners
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {(data?.overview.winners ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No winners yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="py-1">Type</th>
                      <th>Prize</th>
                      <th>Winner</th>
                      <th>Phone</th>
                      <th>Entry No.</th>
                      <th>Rank</th>
                      <th>Entries</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data!.overview.winners.map((w) => (
                      <tr key={w.id} className="border-t">
                        <td className="py-1">{w.prize_type === "lucky_draw" ? "Lucky draw" : "Leaderboard"}</td>
                        <td>{w.prize_name ?? "—"}{w.prize_value ? ` (₹${w.prize_value})` : ""}</td>
                        <td>{w.full_name ?? "—"}</td>
                        <td>{w.phone ?? "—"}</td>
                        <td>{w.entry_no ?? "—"}</td>
                        <td>{w.rank ?? "—"}</td>
                        <td>{w.entries ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

type PrizeForm = { name: string; photo_url: string; value_inr: number; quantity: number; sort_no: number; rank_from: number; rank_to: number };

function PrizeList({
  campaignId,
  type,
  prizes,
  onChanged,
}: {
  campaignId: string;
  type: "lucky_draw" | "leaderboard";
  prizes: LuckyPrize[];
  onChanged: () => void;
}) {
  const saveFn = useServerFn(saveLuckyPrize);
  const delFn = useServerFn(deleteLuckyPrize);
  const [edit, setEdit] = useState<{ id: string | null; f: PrizeForm } | null>(null);
  const list = prizes.filter((p) => p.prize_type === type);
  const save = useMutation({
    mutationFn: () => saveFn({ data: { id: edit!.id, campaignId, payload: { ...edit!.f, prize_type: type } } }),
    onSuccess: () => {
      setEdit(null);
      onChanged();
      toast.success("Prize saved");
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: onChanged,
    onError: (e) => toast.error(errMsg(e)),
  });
  const isLb = type === "leaderboard";
  const field = (k: keyof PrizeForm, label: string, num = true) => (
    <div>
      <Label>{label}</Label>
      <Input
        type={num ? "number" : "text"}
        value={edit!.f[k]}
        onChange={(e) => setEdit({ ...edit!, f: { ...edit!.f, [k]: num ? Number(e.target.value) : e.target.value } })}
      />
    </div>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{isLb ? "Leaderboard prizes" : "Lucky Draw prizes"}</CardTitle>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            setEdit({ id: null, f: { name: "", photo_url: "", value_inr: 0, quantity: 1, sort_no: list.length + 1, rank_from: 1, rank_to: 1 } })
          }
        >
          <Plus className="mr-1 h-4 w-4" /> Add
        </Button>
      </CardHeader>
      <CardContent>
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">No prizes.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((p) => (
              <div key={p.id} className="flex gap-3 rounded-md border p-2">
                {p.photo_url ? (
                  <img src={p.photo_url} alt={p.name} className="h-14 w-14 rounded object-cover" />
                ) : (
                  <div className="h-14 w-14 rounded bg-muted" />
                )}
                <div className="flex-1 text-sm">
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    ₹{p.value_inr} · Qty {p.quantity} · Sort {p.sort_no}
                    {isLb && ` · Rank ${p.rank_from}–${p.rank_to}`}
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() =>
                      setEdit({
                        id: p.id,
                        f: {
                          name: p.name,
                          photo_url: p.photo_url ?? "",
                          value_inr: Number(p.value_inr),
                          quantity: p.quantity,
                          sort_no: p.sort_no,
                          rank_from: p.rank_from ?? 1,
                          rank_to: p.rank_to ?? 1,
                        },
                      })
                    }
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => confirm(`Delete ${p.name}?`) && del.mutate(p.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{edit?.id ? "Edit prize" : "Add prize"}</DialogTitle>
          </DialogHeader>
          {edit && (
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2">{field("name", "Name", false)}</div>
              <div className="col-span-2">
                <LuckyMediaUpload label="Photo" kind="prize" value={String(edit.f.photo_url ?? "")} onChange={(u) => setEdit({ ...edit, f: { ...edit.f, photo_url: u } })} />
              </div>
              {field("value_inr", "Value (₹)")}
              {field("sort_no", "Sort No.")}
              {isLb ? (
                <>
                  {field("rank_from", "Rank from")}
                  {field("rank_to", "Rank to")}
                </>
              ) : (
                field("quantity", "Quantity")
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

type FlatTicketRow = {
  r: { entry_no: string; full_name: string | null; phone: string | null; referrals: number; entries: number; rank: number; enrolled_at: string; tickets?: string[] };
  ticket: string;
  first: boolean;
};

function EnrolmentsTable({
  rows,
  title,
}: {
  rows: Array<{ entry_no: string; full_name: string | null; phone: string | null; referrals: number; entries: number; rank: number; enrolled_at: string; tickets?: string[] }>;
  title: string;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      [r.full_name, r.phone, r.entry_no, ...(r.tickets ?? [])].some((v) => (v ?? "").toLowerCase().includes(s)),
    );
  }, [rows, q]);

  const flat = useMemo<FlatTicketRow[]>(
    () =>
      filtered.flatMap((r) => {
        const ts = r.tickets?.length ? r.tickets : [r.entry_no];
        const ordered = [r.entry_no, ...ts.filter((t) => t !== r.entry_no)];
        return ordered.map((t) => ({ r, ticket: t, first: t === r.entry_no }));
      }),
    [filtered],
  );

  const columns = useMemo<SortFilterColumn<FlatTicketRow>[]>(
    () => [
      { key: "ticket", label: "Ticket No", value: (x) => x.ticket },
      { key: "name", label: "Full name", value: (x) => x.r.full_name },
      { key: "phone", label: "Phone", value: (x) => x.r.phone },
      { key: "type", label: "Type", value: (x) => (x.first ? "Signup" : "Ref bonus") },
      { key: "referrals", label: "Referrals", value: (x) => (x.first ? x.r.referrals : null), type: "number" },
      { key: "entries", label: "Entries", value: (x) => (x.first ? x.r.entries : null), type: "number" },
      { key: "enrolled", label: "Enrolled at", value: (x) => (x.first ? x.r.enrolled_at : null), display: (x) => (x.first ? fmt(x.r.enrolled_at) : "—") },
    ],
    [],
  );

  const sf = useSortFilter(flat, columns);
  // Default view: highest referrals on top.
  const defaultApplied = useRef(false);
  useEffect(() => {
    if (!defaultApplied.current) {
      defaultApplied.current = true;
      sf.headerProps("referrals").setSort({ key: "referrals", dir: "desc" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sorted = sf.rows;
  const display = useMemo(() => sorted.map((x, i) => ({ ...x, serial: i + 1 })), [sorted]);

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      ["#", "Ticket No", "Full name", "Phone", "Type", "Referrals", "Entries", "Enrolled at"].join(","),
      ...display.map(({ r, ticket, first, serial }) =>
        [serial, ticket, r.full_name, r.phone, first ? "Signup" : "Ref bonus", first ? r.referrals : "", first ? r.entries : "", first ? fmt(r.enrolled_at) : ""].map(esc).join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${title.replace(/\W+/g, "-")}-enrolments.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap gap-2">
          <Input className="max-w-xs" placeholder="Search name, phone, ticket no." value={q} onChange={(e) => setQ(e.target.value)} />
          <Button variant="outline" onClick={exportCsv}>
            <Download className="mr-1 h-4 w-4" /> CSV
          </Button>
          <SortFilterReset api={sf} />
          <span className="self-center text-xs text-muted-foreground">{filtered.length} customers · {sorted.length} tickets</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1">#</th>
                {columns.map((c) => (
                  <th key={c.key}>
                    <SortFilterHeader {...sf.headerProps(c.key)} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {display.slice(0, 1000).map(({ r, ticket, first, serial }) => (
                <tr key={ticket} className="border-t">
                  <td className="py-1">{serial}</td>
                  <td className="py-1 font-mono">{ticket}</td>
                  <td>{r.full_name ?? "—"}</td>
                  <td>{r.phone ?? "—"}</td>
                  <td>
                    <Badge variant={first ? "secondary" : "outline"}>{first ? "Signup" : "Ref bonus"}</Badge>
                  </td>
                  <td>{first ? r.referrals : ""}</td>
                  <td>{first ? r.entries : ""}</td>
                  <td>{first ? fmt(r.enrolled_at) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
