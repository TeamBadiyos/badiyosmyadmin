import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ImageIcon, Lock, Plus, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { catalogImageUrl } from "@/lib/catalog-images";
import { useCity } from "@/lib/city-scope";
import {
  listCategories, saveCategory, reorderCategories, deleteCategory, copyDefaultCategories,
  listUnmappedProductLabels, applyProductCategoryMap, type CatKind,
} from "@/lib/categories.functions";
import { CategorySuggestionsChip } from "@/components/category-suggestions";

const err = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

/** Square 200×200 WebP. */
async function toSquareWebp(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height);
  const c = document.createElement("canvas"); c.width = 200; c.height = 200;
  c.getContext("2d")!.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 200, 200);
  return await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Image failed"))), "image/webp", 0.85));
}
async function upload(file: File, kind: CatKind) {
  const blob = await toSquareWebp(file);
  const path = `_categories/${kind}/${crypto.randomUUID()}.webp`;
  const { error } = await supabase.storage.from("catalog-images").upload(path, blob, { contentType: "image/webp" });
  if (error) throw new Error(error.message);
  return path;
}

function Icon({ path, fallback }: { path?: string | null; fallback?: string | null }) {
  const u = catalogImageUrl(path) ?? (fallback && /^https?:/.test(fallback) ? fallback : null);
  return u ? <img src={u} alt="" className="h-10 w-10 rounded-md object-cover" />
    : <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-muted-foreground"><ImageIcon size={16} /></div>;
}

export function CategoryManager({ kind, title, help, usedLabel, role }: { kind: CatKind; title: string; help: string; usedLabel: string; role: string }) {
  const qc = useQueryClient();
  const { cityId } = useCity();
  const city = cityId && cityId !== "all" ? cityId : null;
  const listFn = useServerFn(listCategories);
  const saveFn = useServerFn(saveCategory);
  const reFn = useServerFn(reorderCategories);
  const delFn = useServerFn(deleteCategory);
  const copyFn = useServerFn(copyDefaultCategories);
  const key = ["categories", kind, city];
  const r = useQuery({ queryKey: key, queryFn: () => listFn({ data: { kind, cityId: city } }) });
  const [rows, setRows] = useState<any[]>([]);
  const [edit, setEdit] = useState<any | null>(null);
  const [del, setDel] = useState<any | null>(null);
  useEffect(() => setRows(r.data?.rows ?? []), [r.data]);
  const canEdit = role === "super_admin";
  const inv = () => qc.invalidateQueries({ queryKey: ["categories", kind] });
  const save = useMutation({ mutationFn: (v: any) => saveFn({ data: { kind, cityId: r.data?.hasCityList ? city : null, ...v } }), onSuccess: () => { toast.success("Saved"); setEdit(null); inv(); }, onError: (e) => toast.error(err(e)) });
  const reorder = useMutation({ mutationFn: (ids: string[]) => reFn({ data: { kind, ids } }), onSuccess: inv, onError: (e) => toast.error(err(e)) });
  const copy = useMutation({ mutationFn: () => copyFn({ data: { kind, cityId: city! } }), onSuccess: () => { toast.success("City list created"); inv(); }, onError: (e) => toast.error(err(e)) });
  const move = (i: number, d: -1 | 1) => {
    const j = i + d; const list = rows.filter((x) => !x.is_other);
    if (j < 0 || j >= list.length) return;
    const n = [...list]; [n[i], n[j]] = [n[j], n[i]];
    setRows([...n, ...rows.filter((x) => x.is_other)]); reorder.mutate(n.map((x) => x.id));
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">{help}</p>
          <p className="text-xs text-muted-foreground">Showing: {r.data?.hasCityList ? "this city's own list" : "Default list"} · Customer App shows only categories with at least one live {usedLabel}.</p>
        </div>
        {kind !== "store_type" && !canEdit && role === "ops_manager" && <CategorySuggestionsChip kind={kind} canAct upload={upload} />}
        {canEdit && (
          <div className="flex gap-2">
            {kind !== "store_type" && <CategorySuggestionsChip kind={kind} canAct upload={upload} />}
            {city && r.data && !r.data.hasCityList && <Button size="sm" variant="outline" disabled={copy.isPending} onClick={() => copy.mutate()}>Make a list for this city</Button>}
            <Button size="sm" onClick={() => setEdit({ is_active: true })}><Plus size={14} /> Add category</Button>
          </div>
        )}
      </div>
      <div className="rounded-lg border bg-card divide-y">
        {r.isLoading && <p className="p-3 text-sm text-muted-foreground">Loading…</p>}
        {rows.map((c, i) => (
          <div key={c.id} className="flex items-center gap-3 p-2">
            <Icon path={c.image_path} fallback={c.icon_url} />
            <div className="min-w-0 flex-1">
              <p className={`truncate text-sm font-medium ${c.is_active ? "" : "text-muted-foreground line-through"}`}>{c.name} <span className="text-muted-foreground">/ {c.name_mr ?? "—"}</span></p>
              <p className="text-xs text-muted-foreground">{c.used} {usedLabel}{c.used === 1 ? "" : "s"}</p>
            </div>
            {canEdit && (c.is_other ? <span className="flex items-center gap-1 text-xs text-muted-foreground"><Lock size={12} /> Always last</span> : <>
              <Switch checked={c.is_active} onCheckedChange={(v) => save.mutate({ id: c.id, name: c.name, name_mr: c.name_mr ?? c.name, image_path: c.image_path, is_active: v })} />
              <span className="inline-flex">
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Move up" onClick={() => move(i, -1)}><ArrowUp size={14} /></Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Move down" onClick={() => move(i, 1)}><ArrowDown size={14} /></Button>
              </span>
              <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Delete" onClick={() => setDel(c)}><Trash2 size={14} /></Button>
            </>)}
            {canEdit && <Button size="sm" variant="ghost" onClick={() => setEdit(c)}>Edit</Button>}
          </div>
        ))}
      </div>
      {!canEdit && <p className="text-xs text-muted-foreground">Only super admin can change categories.</p>}
      {edit && <Editor kind={kind} c={edit} busy={save.isPending} onClose={() => setEdit(null)} onSave={(v) => save.mutate(v)} />}
      {del && <DeleteSheet kind={kind} c={del} others={rows.filter((x) => x.id !== del.id)} usedLabel={usedLabel}
        onClose={() => setDel(null)}
        onDone={async (moveTo) => { try { await delFn({ data: { kind, id: del.id, moveTo } }); toast.success("Deleted"); setDel(null); inv(); } catch (e) { toast.error(err(e)); } }} />}
    </div>
  );
}

function Editor({ kind, c, busy, onClose, onSave }: { kind: CatKind; c: any; busy: boolean; onClose: () => void; onSave: (v: any) => void }) {
  const [name, setName] = useState(c.name ?? "");
  const [mr, setMr] = useState(c.name_mr ?? "");
  const [img, setImg] = useState<string | null>(c.image_path ?? null);
  const [active, setActive] = useState(c.is_active !== false);
  const [up, setUp] = useState(false);
  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader><SheetTitle>{c.id ? "Edit category" : "Add category"}</SheetTitle></SheetHeader>
        <div className="space-y-3 py-4">
          <div><Label>Name (English)</Label><Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>Name (मराठी)</Label><Input value={mr} maxLength={60} onChange={(e) => setMr(e.target.value)} /></div>
          <div className="flex items-center gap-3">
            <Icon path={img} fallback={c.icon_url} />
            <label className="inline-flex cursor-pointer items-center gap-1 text-sm text-primary"><Upload size={14} /> {up ? "Uploading…" : "Upload photo"}
              <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                const f = e.target.files?.[0]; if (!f) return; setUp(true);
                try { setImg(await upload(f, kind)); } catch (er) { toast.error(err(er)); } finally { setUp(false); }
              }} /></label>
            {img && <Button size="sm" variant="ghost" onClick={() => setImg(null)}>Remove</Button>}
          </div>
          <p className="text-xs text-muted-foreground">Square photo, saved as 200×200.</p>
          {!c.is_other && <div className="flex items-center justify-between"><Label>On</Label><Switch checked={active} onCheckedChange={setActive} /></div>}
        </div>
        <SheetFooter><Button variant="outline" onClick={onClose}>Close</Button>
          <Button disabled={busy || up} onClick={() => onSave({ id: c.id ?? null, name, name_mr: mr, image_path: img, is_active: active })}>Save</Button></SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function DeleteSheet({ c, others, usedLabel, onClose, onDone }: { kind: CatKind; c: any; others: any[]; usedLabel: string; onClose: () => void; onDone: (moveTo: string | null) => void }) {
  const [to, setTo] = useState("");
  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader><SheetTitle>Delete "{c.name}"</SheetTitle></SheetHeader>
        <div className="space-y-3 py-4 text-sm">
          {c.used > 0 ? <>
            <p>{c.used} {usedLabel}{c.used === 1 ? "" : "s"} use this category. Move them first:</p>
            <select className="w-full rounded-md border bg-background px-3 py-2" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Move to…</option>
              {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </> : <p>No {usedLabel}s use this category.</p>}
        </div>
        <SheetFooter><Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={c.used > 0 && !to} onClick={() => onDone(to || null)}>{c.used > 0 ? "Move and delete" : "Delete"}</Button></SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

const SUGGEST: Array<[RegExp, string]> = [
  [/namkeen|upvas|side dish|snack/i, "Snacks & Namkeen"], [/dispos|packag|cup|bowl|plate|container|cutlery|bag|biodegrad/i, "Packaging"],
  [/kitchen|storage|household|balcony|home &/i, "Home & Kitchen"], [/book|station/i, "Stationery"], [/temple|puja|pooja/i, "Puja Items"],
  [/grocery|atta|rice|dal/i, "Atta, Rice & Dal"], [/dairy|milk|bread|egg/i, "Dairy, Bread & Eggs"], [/beverage|tea|coffee/i, "Tea, Coffee & Drinks"],
  [/tissue|personal|hygiene/i, "Personal Care"], [/sweet|chocolate/i, "Sweets & Chocolates"],
];

/** Review screen: give store items without a shared category one, based on their section name. */
export function ProductCategoryReview({ role }: { role: string }) {
  const qc = useQueryClient();
  const { cityId } = useCity();
  const listFn = useServerFn(listUnmappedProductLabels);
  const catsFn = useServerFn(listCategories);
  const applyFn = useServerFn(applyProductCategoryMap);
  const labels = useQuery({ queryKey: ["categories", "unmapped"], queryFn: () => listFn() });
  const cats = useQuery({ queryKey: ["categories", "store_product", "all-default"], queryFn: () => catsFn({ data: { kind: "store_product", cityId: null } }) });
  const [pick, setPick] = useState<Record<string, string>>({});
  useEffect(() => {
    const rows = cats.data?.rows ?? []; if (!rows.length || !labels.data) return;
    const byName = (n: string) => rows.find((r: any) => r.name === n)?.id ?? "";
    const p: Record<string, string> = {};
    for (const l of labels.data) p[l.label] = byName(SUGGEST.find(([re]) => re.test(l.label))?.[1] ?? "Other");
    setPick(p);
  }, [cats.data, labels.data]);
  const apply = useMutation({
    mutationFn: () => applyFn({ data: { map: Object.entries(pick).map(([label, category_id]) => ({ label, category_id })) } }),
    onSuccess: (r) => { toast.success(`${r.updated} items updated`); qc.invalidateQueries({ queryKey: ["categories"] }); },
    onError: (e) => toast.error(err(e)),
  });
  void cityId;
  if (!labels.data?.length) return null;
  return (
    <div className="space-y-2 rounded-lg border bg-card p-3">
      <p className="font-semibold">Items without a product category</p>
      <p className="text-xs text-muted-foreground">Suggested from each store's own section name. Check or change, then apply.</p>
      <div className="divide-y">
        {labels.data.map((l) => (
          <div key={l.label} className="flex items-center gap-3 py-1.5 text-sm">
            <span className="flex-1">{l.label || "(no section)"} <span className="text-muted-foreground">· {l.count}</span></span>
            <select className="rounded-md border bg-background px-2 py-1 text-sm" value={pick[l.label] ?? ""} disabled={role !== "super_admin"}
              onChange={(e) => setPick({ ...pick, [l.label]: e.target.value })}>
              <option value="">Leave as is</option>
              {(cats.data?.rows ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        ))}
      </div>
      {role === "super_admin" && <Button size="sm" disabled={apply.isPending} onClick={() => apply.mutate()}>Apply</Button>}
    </div>
  );
}
