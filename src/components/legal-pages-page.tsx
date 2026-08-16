import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ExternalLink, Save } from "lucide-react";
import { listLegalPages, saveLegalPage, LEGAL_SLUGS } from "@/lib/legal.functions";
import { MarkdownView } from "@/components/markdown-view";

type StaffRole = "super_admin" | "ops_manager" | "area_partner";

export function LegalPagesPage({ role }: { role: StaffRole | null }) {
  const canEdit = role === "super_admin" || role === "ops_manager";
  const qc = useQueryClient();
  const list = useServerFn(listLegalPages);
  const save = useServerFn(saveLegalPage);

  const [slug, setSlug] = useState<string>(LEGAL_SLUGS[0].slug);
  const [title, setTitle] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: pages, isLoading } = useQuery({
    queryKey: ["legal-pages"],
    queryFn: () => list(),
    staleTime: 30_000,
  });

  const current = useMemo(() => pages?.find((p) => p.slug === slug) ?? null, [pages, slug]);

  useEffect(() => {
    setTitle(current?.title ?? LEGAL_SLUGS.find((s) => s.slug === slug)?.label ?? "");
    setEffectiveDate(current?.effectiveDate ?? "");
    setContent(current?.content ?? "");
  }, [current, slug]);

  async function handleSave() {
    if (!canEdit) return;
    setSaving(true);
    try {
      await save({
        data: {
          slug,
          title: title.trim(),
          content,
          effective_date: effectiveDate || null,
          is_active: true,
        },
      });
      await qc.invalidateQueries({ queryKey: ["legal-pages"] });
      toast.success("Legal page saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {LEGAL_SLUGS.map((s) => {
          const active = s.slug === slug;
          return (
            <button
              key={s.slug}
              onClick={() => setSlug(s.slug)}
              className={`px-4 py-2 rounded-full text-[13px] font-semibold border transition-colors ${
                active
                  ? "bg-primary text-white border-primary"
                  : "bg-card text-muted-foreground border-border hover:text-foreground"
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <p className="text-[14px] text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {/* Editor */}
          <div className="bg-card border border-border rounded-[18px] p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[15px] font-bold text-foreground">Editor</h2>
              <a
                href={LEGAL_SLUGS.find((s) => s.slug === slug)!.path}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-primary"
              >
                View live page <ExternalLink size={13} />
              </a>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="block text-[12px] font-semibold text-muted-foreground mb-1">Title</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={!canEdit}
                  className="w-full h-10 px-3 rounded-[10px] border border-border bg-background text-[14px] text-foreground"
                />
              </label>
              <label className="block">
                <span className="block text-[12px] font-semibold text-muted-foreground mb-1">
                  Effective date
                </span>
                <input
                  type="date"
                  value={effectiveDate ?? ""}
                  onChange={(e) => setEffectiveDate(e.target.value)}
                  disabled={!canEdit}
                  className="w-full h-10 px-3 rounded-[10px] border border-border bg-background text-[14px] text-foreground"
                />
              </label>
            </div>

            <label className="block">
              <span className="block text-[12px] font-semibold text-muted-foreground mb-1">
                Content (Markdown: # heading, - bullet, **bold**, &gt; note)
              </span>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                disabled={!canEdit}
                rows={24}
                className="w-full p-3 rounded-[12px] border border-border bg-background text-[13px] leading-6 font-mono text-foreground"
              />
            </label>

            <div className="flex items-center justify-between gap-3">
              <p className="text-[12px] text-muted-foreground">
                {current
                  ? `Last updated ${new Date(current.lastUpdatedAt).toLocaleString("en-IN")}`
                  : "Not created yet"}
              </p>
              <button
                onClick={handleSave}
                disabled={!canEdit || saving}
                className="inline-flex items-center gap-2 h-10 px-5 rounded-full bg-primary text-white text-[13px] font-bold disabled:opacity-50"
              >
                <Save size={15} />
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
            {!canEdit && (
              <p className="text-[12px] text-muted-foreground">
                You do not have permission to edit legal pages.
              </p>
            )}
          </div>

          {/* Preview */}
          <div className="bg-card border border-border rounded-[18px] p-6">
            <h2 className="text-[15px] font-bold text-foreground mb-4">Live preview</h2>
            <h3 className="text-[24px] font-bold tracking-tight text-foreground">{title}</h3>
            {effectiveDate && (
              <p className="mt-1 text-[12px] text-muted-foreground">
                Effective {new Date(effectiveDate).toLocaleDateString("en-IN", { dateStyle: "long" })}
              </p>
            )}
            <div className="mt-4">
              <MarkdownView source={content} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
