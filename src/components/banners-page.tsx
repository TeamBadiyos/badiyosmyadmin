import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowDown, ArrowUp, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CATALOG_BUCKET, catalogImageUrl } from "@/lib/catalog-images";
import {
  listBanners, saveBanner, setBannerActive, moveBanner, deleteBanner,
  BANNER_TABS, BANNER_LINKS, type Banner, type BannerInput,
} from "@/lib/banners.functions";
import { FilterBar, FilterField, filterSelectCls, filterInputCls, tableCls, countLabel } from "@/components/section-chrome";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const TAB_LABEL: Record<string, string> = { all: "All tabs", clean: "Clean", store: "Store", food: "Food", parcel: "Parcel", rewards: "Rewards" };
const LINK_LABEL: Record<string, string> = { none: "None", service: "Service", store: "Store / restaurant", coupon: "Coupon", lucky_draw: "Lucky Draw" };
const TARGET_HINT: Record<string, string> = { service: "Service key, e.g. maid", store: "Store or restaurant ID", coupon: "Coupon code", lucky_draw: "Lucky Draw campaign ID (optional)" };

const empty: BannerInput = { title: "", image_path: "", app_tab: "all", link_type: "none", link_target: null, city_id: null, starts_at: null, ends_at: null, is_active: true };

function status(b: Banner) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  if (!b.is_active) return "Off";
  if (b.starts_at && b.starts_at > today) return "Scheduled";
  if (b.ends_at && b.ends_at < today) return "Ended";
  return "Live";
}

export function BannersPage() {
  const qc = useQueryClient();
  const list = useServerFn(listBanners);
  const save = useServerFn(saveBanner);
  const setActive = useServerFn(setBannerActive);
  const move = useServerFn(moveBanner);
  const del = useServerFn(deleteBanner);
  const q = useQuery({ queryKey: ["app-banners"], queryFn: () => list() });
  const [tab, setTab] = useState("any");
  const [edit, setEdit] = useState<BannerInput | null>(null);
  const [uploading, setUploading] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["app-banners"] });
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const cities = q.data?.cities ?? [];
  const cityName = (id: string | null) => (id ? cities.find((c) => c.id === id)?.city ?? cities.find((c) => c.id === id)?.name ?? "—" : "All cities");
  const rows = (q.data?.banners ?? []).filter((b) => tab === "any" || b.app_tab === tab);

  async function upload(file: File) {
    if (file.size > 10 * 1024 * 1024) return toast.error("Max 10 MB");
    setUploading(true);
    const path = `banners/${Date.now()}-${file.name.replace(/[^a-z0-9.\-_]/gi, "_")}`;
    const { error } = await supabase.storage.from(CATALOG_BUCKET).upload(path, file, { upsert: false, contentType: file.type });
    setUploading(false);
    if (error) return toast.error(error.message);
    setEdit((e) => (e ? { ...e, image_path: path } : e));
  }

  async function submit() {
    if (!edit) return;
    try {
      await save({ data: edit });
      toast.success("Banner saved");
      setEdit(null);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <FilterBar count={countLabel(rows.length, "banner")}>
        <FilterField label="App tab">
          <select className={filterSelectCls} value={tab} onChange={(e) => setTab(e.target.value)}>
            <option value="any">All app tabs</option>
            {BANNER_TABS.map((t) => <option key={t} value={t}>{TAB_LABEL[t]}</option>)}
          </select>
        </FilterField>
        <Button onClick={() => setEdit({ ...empty })} className="self-end"><Plus className="h-4 w-4 mr-1" />New banner</Button>
      </FilterBar>

      <div className={tableCls.wrap}>
        <div className={tableCls.scroll}>
          <table className={tableCls.table}>
            <thead className={tableCls.thead}>
              <tr>
                <th className={tableCls.th}>Order</th><th className={tableCls.th}>Image</th><th className={tableCls.th}>Title</th>
                <th className={tableCls.th}>App tab</th><th className={tableCls.th}>Link</th><th className={tableCls.th}>City</th>
                <th className={tableCls.th}>Dates</th><th className={tableCls.th}>Status</th><th className={tableCls.th}>Active</th><th className={tableCls.th} />
              </tr>
            </thead>
            <tbody>
              {q.isLoading && <tr><td className={tableCls.td} colSpan={10}>Loading…</td></tr>}
              {!q.isLoading && rows.length === 0 && <tr><td className={tableCls.td + " text-muted-foreground"} colSpan={10}>No banners yet.</td></tr>}
              {rows.map((b, i) => (
                <tr key={b.id} className="border-t border-border">
                  <td className={tableCls.td}>
                    <div className="flex gap-1">
                      <button aria-label="Move up" disabled={i === 0 || tab !== "any"} className="p-1 rounded hover:bg-muted disabled:opacity-30" onClick={() => run.mutate(() => move({ data: { id: b.id, dir: -1 } }))}><ArrowUp className="h-4 w-4" /></button>
                      <button aria-label="Move down" disabled={i === rows.length - 1 || tab !== "any"} className="p-1 rounded hover:bg-muted disabled:opacity-30" onClick={() => run.mutate(() => move({ data: { id: b.id, dir: 1 } }))}><ArrowDown className="h-4 w-4" /></button>
                    </div>
                  </td>
                  <td className={tableCls.td}><img src={catalogImageUrl(b.image_path) ?? ""} alt="" className="h-10 w-20 object-cover rounded-md bg-muted" /></td>
                  <td className={tableCls.td + " font-semibold"}>{b.title}</td>
                  <td className={tableCls.td}>{TAB_LABEL[b.app_tab]}</td>
                  <td className={tableCls.td}>{LINK_LABEL[b.link_type]}{b.link_target ? ` · ${b.link_target}` : ""}</td>
                  <td className={tableCls.td}>{cityName(b.city_id)}</td>
                  <td className={tableCls.td + " whitespace-nowrap"}>{b.starts_at ?? "Any"} → {b.ends_at ?? "No end"}</td>
                  <td className={tableCls.td}>{status(b)}</td>
                  <td className={tableCls.td}><Switch checked={b.is_active} onCheckedChange={(v) => run.mutate(() => setActive({ data: { id: b.id, active: v } }))} /></td>
                  <td className={tableCls.td}>
                    <div className="flex gap-1">
                      <button aria-label="Edit" className="p-1 rounded hover:bg-muted" onClick={() => setEdit({ ...b })}><Pencil className="h-4 w-4" /></button>
                      <button aria-label="Delete" className="p-1 rounded hover:bg-muted text-destructive" onClick={() => confirm(`Delete "${b.title}"?`) && run.mutate(() => del({ data: { id: b.id } }))}><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Sheet open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader><SheetTitle>{edit?.id ? "Edit banner" : "New banner"}</SheetTitle></SheetHeader>
          {edit && (
            <div className="space-y-4 mt-4">
              <FilterField label="Image (JPG/PNG/WebP, 1200×500, max 10 MB)">
                {edit.image_path && <img src={catalogImageUrl(edit.image_path) ?? ""} alt="" className="w-full aspect-[12/5] object-cover rounded-lg bg-muted" />}
                <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} className="text-[13px]" />
                {uploading && <span className="text-[12px] text-muted-foreground">Uploading…</span>}
              </FilterField>
              <FilterField label="Title">
                <input className={filterInputCls} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
              </FilterField>
              <FilterField label="App tab">
                <select className={filterSelectCls} value={edit.app_tab} onChange={(e) => setEdit({ ...edit, app_tab: e.target.value as Banner["app_tab"] })}>
                  {BANNER_TABS.map((t) => <option key={t} value={t}>{TAB_LABEL[t]}</option>)}
                </select>
              </FilterField>
              <FilterField label="Link to">
                <select className={filterSelectCls} value={edit.link_type} onChange={(e) => setEdit({ ...edit, link_type: e.target.value as Banner["link_type"], link_target: null })}>
                  {BANNER_LINKS.map((t) => <option key={t} value={t}>{LINK_LABEL[t]}</option>)}
                </select>
              </FilterField>
              {edit.link_type !== "none" && (
                <FilterField label="Link target">
                  <input className={filterInputCls} placeholder={TARGET_HINT[edit.link_type]} value={edit.link_target ?? ""} onChange={(e) => setEdit({ ...edit, link_target: e.target.value })} />
                </FilterField>
              )}
              <FilterField label="City">
                <select className={filterSelectCls} value={edit.city_id ?? ""} onChange={(e) => setEdit({ ...edit, city_id: e.target.value || null })}>
                  <option value="">All cities</option>
                  {cities.map((c) => <option key={c.id} value={c.id}>{c.city} · {c.name}</option>)}
                </select>
              </FilterField>
              <div className="grid grid-cols-2 gap-3">
                <FilterField label="Start date"><input type="date" className={filterInputCls} value={edit.starts_at ?? ""} onChange={(e) => setEdit({ ...edit, starts_at: e.target.value || null })} /></FilterField>
                <FilterField label="End date"><input type="date" className={filterInputCls} value={edit.ends_at ?? ""} onChange={(e) => setEdit({ ...edit, ends_at: e.target.value || null })} /></FilterField>
              </div>
              <label className="flex items-center gap-2 text-[13px]"><Switch checked={edit.is_active} onCheckedChange={(v) => setEdit({ ...edit, is_active: v })} />Active</label>
              <Button className="w-full" disabled={uploading} onClick={submit}>Save banner</Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
