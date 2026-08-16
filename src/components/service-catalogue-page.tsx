import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Pencil,
  Plus,
  Trash2,
  X,
  ChevronRight,
  ChevronDown,
  Upload,
  Layers,
} from "lucide-react";
import { toast } from "sonner";
import {
  listCatalogueTree,
  upsertCategory,
  setCategoryActive,
  upsertService,
  deleteService,
  upsertPriceOption,
  deletePriceOption,
  PRICING_TYPES,
  type CatalogueCategory,
  type CataloguePriceOption,
  type CatalogueSegment,
  type CatalogueService,
  type PricingType,
} from "@/lib/catalogue.functions";
import { ServiceImage, uploadServiceImage } from "@/components/service-image";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const PRICING_LABELS: Record<PricingType, string> = {
  duration: "Duration-based",
  flat: "Flat price",
  quantity: "Quantity-based",
};

export function ServiceCataloguePage() {
  const fetchTree = useServerFn(listCatalogueTree);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["catalogue", "tree"],
    queryFn: () => fetchTree(),
    staleTime: 15_000,
  });

  const segments = data?.segments ?? [];
  const categories = data?.categories ?? [];
  const services = data?.services ?? [];
  const priceOptions = data?.priceOptions ?? [];

  const [openSegments, setOpenSegments] = useState<Record<string, boolean>>({});
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});
  const [categoryModal, setCategoryModal] = useState<
    { segment: CatalogueSegment; category: CatalogueCategory | null } | null
  >(null);
  const [serviceModal, setServiceModal] = useState<
    { category: CatalogueCategory; service: CatalogueService | null } | null
  >(null);
  const [optionModal, setOptionModal] = useState<
    { service: CatalogueService; option: CataloguePriceOption | null } | null
  >(null);

  const catsBySegment = useMemo(() => {
    const m = new Map<string, CatalogueCategory[]>();
    for (const c of categories) {
      const list = m.get(c.segment_id) ?? [];
      list.push(c);
      m.set(c.segment_id, list);
    }
    return m;
  }, [categories]);

  const servicesByCategory = useMemo(() => {
    const m = new Map<string, CatalogueService[]>();
    for (const s of services) {
      const list = m.get(s.category_id) ?? [];
      list.push(s);
      m.set(s.category_id, list);
    }
    return m;
  }, [services]);

  const optionsByService = useMemo(() => {
    const m = new Map<string, CataloguePriceOption[]>();
    for (const o of priceOptions) {
      const list = m.get(o.service_id) ?? [];
      list.push(o);
      m.set(o.service_id, list);
    }
    return m;
  }, [priceOptions]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-6">
      <div className="space-y-4 min-w-0">
        <p className="text-[14px] text-muted-foreground">
          Segment → Category → Service → Price options. Pricing can be
          duration-based, flat, or quantity-based per service.
        </p>

        {isLoading && (
          <p className="text-[13px] text-muted-foreground text-center py-10">Loading…</p>
        )}
        {isError && (
          <p className="text-[13px] text-destructive text-center py-10">
            {(error as Error)?.message ?? "Failed to load catalogue."}
          </p>
        )}

        {segments.map((seg) => {
          const open = openSegments[seg.id] ?? true;
          const cats = catsBySegment.get(seg.id) ?? [];
          return (
            <section
              key={seg.id}
              className="bg-card border border-border rounded-[18px] overflow-hidden"
            >
              <header className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border">
                <button
                  onClick={() => setOpenSegments((s) => ({ ...s, [seg.id]: !open }))}
                  className="inline-flex items-center gap-2 text-left"
                >
                  {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <Layers size={16} className="text-primary" />
                  <span className="text-[15px] font-bold text-foreground">{seg.name}</span>
                  {!seg.is_active && (
                    <span className="text-[11px] font-bold uppercase text-muted-foreground">
                      inactive
                    </span>
                  )}
                  <span className="text-[12px] text-muted-foreground">
                    {cats.length} categor{cats.length === 1 ? "y" : "ies"}
                  </span>
                </button>
                <button
                  onClick={() => setCategoryModal({ segment: seg, category: null })}
                  className="h-9 px-3 rounded-[12px] bg-primary text-primary-foreground text-[13px] font-bold inline-flex items-center gap-1"
                >
                  <Plus size={14} /> Category
                </button>
              </header>

              {open && (
                <div className="divide-y divide-border">
                  {cats.length === 0 && (
                    <p className="text-[13px] text-muted-foreground px-5 py-6">
                      No categories yet.
                    </p>
                  )}
                  {cats.map((cat) => {
                    const catOpen = openCategories[cat.id] ?? true;
                    const svcs = servicesByCategory.get(cat.id) ?? [];
                    return (
                      <div key={cat.id} className="px-5 py-3">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <button
                            onClick={() =>
                              setOpenCategories((s) => ({ ...s, [cat.id]: !catOpen }))
                            }
                            className="inline-flex items-center gap-2"
                          >
                            {catOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            <span className="text-[14px] font-semibold text-foreground">
                              {cat.name}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                cat.is_active
                                  ? "bg-primary-tint text-primary"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {cat.is_active ? "active" : "inactive"}
                            </span>
                            <span className="text-[12px] text-muted-foreground">
                              {svcs.length} service{svcs.length === 1 ? "" : "s"}
                            </span>
                          </button>
                          <div className="flex gap-2">
                            <button
                              onClick={() =>
                                setCategoryModal({ segment: seg, category: cat })
                              }
                              className="h-8 px-3 rounded-[10px] border border-border text-[12px] font-semibold inline-flex items-center gap-1 hover:bg-muted"
                            >
                              <Pencil size={12} /> Edit
                            </button>
                            <button
                              onClick={() => setServiceModal({ category: cat, service: null })}
                              className="h-8 px-3 rounded-[10px] border border-border text-[12px] font-semibold inline-flex items-center gap-1 hover:bg-muted"
                            >
                              <Plus size={12} /> Service
                            </button>
                          </div>
                        </div>

                        {catOpen && (
                          <div className="mt-3 space-y-3 pl-6">
                            {svcs.length === 0 && (
                              <p className="text-[12px] text-muted-foreground">
                                No services yet.
                              </p>
                            )}
                            {svcs.map((svc) => (
                              <ServiceRow
                                key={svc.id}
                                service={svc}
                                options={optionsByService.get(svc.id) ?? []}
                                onEdit={() =>
                                  setServiceModal({ category: cat, service: svc })
                                }
                                onAddOption={() =>
                                  setOptionModal({ service: svc, option: null })
                                }
                                onEditOption={(o) =>
                                  setOptionModal({ service: svc, option: o })
                                }
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <PreviewPane
        segments={segments}
        categories={categories}
        services={services}
        options={priceOptions}
      />

      {categoryModal && (
        <CategoryModal
          segment={categoryModal.segment}
          category={categoryModal.category}
          onClose={() => setCategoryModal(null)}
        />
      )}
      {serviceModal && (
        <ServiceModal
          category={serviceModal.category}
          service={serviceModal.service}
          onClose={() => setServiceModal(null)}
        />
      )}
      {optionModal && (
        <PriceOptionModal
          service={optionModal.service}
          option={optionModal.option}
          onClose={() => setOptionModal(null)}
        />
      )}
    </div>
  );
}

function ServiceRow({
  service,
  options,
  onEdit,
  onAddOption,
  onEditOption,
}: {
  service: CatalogueService;
  options: CataloguePriceOption[];
  onEdit: () => void;
  onAddOption: () => void;
  onEditOption: (o: CataloguePriceOption) => void;
}) {
  const queryClient = useQueryClient();
  const removeService = useServerFn(deleteService);
  const removeOption = useServerFn(deletePriceOption);

  const delService = useMutation({
    mutationFn: (id: string) => removeService({ data: { id } }),
    onSuccess: () => {
      toast.success("Service deleted");
      queryClient.invalidateQueries({ queryKey: ["catalogue"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });
  const delOption = useMutation({
    mutationFn: (id: string) => removeOption({ data: { id } }),
    onSuccess: () => {
      toast.success("Price option deleted");
      queryClient.invalidateQueries({ queryKey: ["catalogue"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  return (
    <div className="border border-border rounded-[14px] p-3">
      <div className="flex items-start gap-3">
        <ServiceImage
          path={service.image_url}
          alt={service.name}
          className="h-14 w-14 rounded-[12px] shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[14px] font-semibold text-foreground truncate">
              {service.name}
            </p>
            <span className="px-2 py-0.5 rounded-full bg-muted text-[10px] font-bold uppercase text-muted-foreground">
              {PRICING_LABELS[service.pricing_type]}
            </span>
            {!service.is_active && (
              <span className="text-[10px] font-bold uppercase text-muted-foreground">
                inactive
              </span>
            )}
          </div>
          <div className="mt-2 space-y-1">
            {options.length === 0 && (
              <p className="text-[12px] text-muted-foreground">No price options yet.</p>
            )}
            {options.map((o) => (
              <div
                key={o.id}
                className="flex items-center gap-2 text-[13px] flex-wrap"
              >
                <span className="font-medium text-foreground">{o.label}</span>
                {o.duration_minutes != null && (
                  <span className="text-[12px] text-muted-foreground">
                    {o.duration_minutes} min
                  </span>
                )}
                {o.unit_label && (
                  <span className="text-[12px] text-muted-foreground">{o.unit_label}</span>
                )}
                <span className="font-semibold">{inr.format(o.customer_price)}</span>
                {o.strikethrough_price != null && (
                  <span className="text-[12px] text-muted-foreground line-through">
                    {inr.format(o.strikethrough_price)}
                  </span>
                )}
                <span className="text-[11px] text-muted-foreground">
                  E {o.expert_payout != null ? inr.format(o.expert_payout) : "—"} · P{" "}
                  {o.partner_commission != null ? inr.format(o.partner_commission) : "—"} · HQ{" "}
                  {o.hq_share != null ? inr.format(o.hq_share) : "—"}
                </span>
                <button
                  onClick={() => onEditOption(o)}
                  className="h-7 px-2 rounded-[8px] border border-border text-[11px] font-semibold hover:bg-muted"
                >
                  Edit
                </button>
                <button
                  aria-label={`Delete ${o.label}`}
                  onClick={() => {
                    if (window.confirm(`Permanently delete "${o.label}"?`))
                      delOption.mutate(o.id);
                  }}
                  className="h-7 w-7 rounded-[8px] border border-border text-destructive inline-flex items-center justify-center hover:bg-destructive/10"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          <button
            onClick={onEdit}
            className="h-8 px-3 rounded-[10px] border border-border text-[12px] font-semibold inline-flex items-center gap-1 hover:bg-muted"
          >
            <Pencil size={12} /> Edit
          </button>
          <button
            onClick={onAddOption}
            className="h-8 px-3 rounded-[10px] border border-border text-[12px] font-semibold inline-flex items-center gap-1 hover:bg-muted"
          >
            <Plus size={12} /> Price
          </button>
          <button
            aria-label={`Delete ${service.name}`}
            onClick={() => {
              if (
                window.confirm(
                  `This will permanently delete "${service.name}" and its price options. Continue?`,
                )
              )
                delService.mutate(service.id);
            }}
            className="h-8 px-3 rounded-[10px] border border-border text-destructive text-[12px] inline-flex items-center justify-center hover:bg-destructive/10"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
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
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-[18px] w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <header className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h3 className="text-[15px] font-bold text-foreground">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground">
            <X size={18} />
          </button>
        </header>
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[12px] font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full h-10 px-3 rounded-[12px] border border-border bg-background text-[14px] text-foreground";

function CategoryModal({
  segment,
  category,
  onClose,
}: {
  segment: CatalogueSegment;
  category: CatalogueCategory | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const save = useServerFn(upsertCategory);
  const toggle = useServerFn(setCategoryActive);
  const [name, setName] = useState(category?.name ?? "");
  const [rank, setRank] = useState(String(category?.rank ?? 0));
  const [active, setActive] = useState(category?.is_active ?? true);

  const mutation = useMutation({
    mutationFn: async () => {
      await save({
        data: {
          id: category?.id ?? null,
          segment_id: segment.id,
          name,
          rank: Number(rank) || 0,
          is_active: active,
        },
      });
      if (category) await toggle({ data: { id: category.id, active } });
    },
    onSuccess: () => {
      toast.success(category ? "Category updated" : "Category created");
      queryClient.invalidateQueries({ queryKey: ["catalogue"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  return (
    <Modal title={category ? "Edit category" : `New category in ${segment.name}`} onClose={onClose}>
      <Field label="Name">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Display order">
        <input
          className={inputCls}
          value={rank}
          inputMode="numeric"
          onChange={(e) => setRank(e.target.value)}
        />
      </Field>
      <label className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Active
      </label>
      <button
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
        className="h-10 w-full rounded-[12px] bg-primary text-primary-foreground font-bold text-[14px] disabled:opacity-50"
      >
        {mutation.isPending ? "Saving…" : "Save category"}
      </button>
    </Modal>
  );
}

function ServiceModal({
  category,
  service,
  onClose,
}: {
  category: CatalogueCategory;
  service: CatalogueService | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const save = useServerFn(upsertService);
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(service?.name ?? "");
  const [pricingType, setPricingType] = useState<PricingType>(
    service?.pricing_type ?? "duration",
  );
  const [order, setOrder] = useState(String(service?.display_order ?? 0));
  const [active, setActive] = useState(service?.is_active ?? true);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  function pickFile(f: File | null) {
    setFile(f);
    setPreviewUrl(f ? URL.createObjectURL(f) : null);
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await save({
        data: {
          id: service?.id ?? null,
          category_id: category.id,
          name,
          image_url: service?.image_url ?? null,
          pricing_type: pricingType,
          display_order: Number(order) || 0,
          is_active: active,
        },
      });
      if (file) {
        const path = await uploadServiceImage(res.id, file);
        await save({
          data: {
            id: res.id,
            category_id: category.id,
            name,
            image_url: path,
            pricing_type: pricingType,
            display_order: Number(order) || 0,
            is_active: active,
          },
        });
      }
    },
    onSuccess: () => {
      toast.success(service ? "Service updated" : "Service created");
      queryClient.invalidateQueries({ queryKey: ["catalogue"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  return (
    <Modal title={service ? "Edit service" : `New service in ${category.name}`} onClose={onClose}>
      <Field label="Name">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>

      <div className="space-y-1">
        <span className="text-[12px] font-semibold text-muted-foreground">Image</span>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) pickFile(f);
          }}
          onClick={() => fileRef.current?.click()}
          className="border border-dashed border-border rounded-[14px] p-4 flex items-center gap-3 cursor-pointer hover:bg-muted/40"
        >
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="Preview"
              className="h-16 w-16 rounded-[12px] object-cover"
            />
          ) : (
            <ServiceImage
              path={service?.image_url ?? null}
              alt={service?.name ?? "Service"}
              className="h-16 w-16 rounded-[12px]"
            />
          )}
          <span className="text-[12px] text-muted-foreground inline-flex items-center gap-1">
            <Upload size={14} /> Drop an image or click to choose (square crop, compressed)
          </span>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
      </div>

      <Field label="Pricing type">
        <select
          className={inputCls}
          value={pricingType}
          onChange={(e) => setPricingType(e.target.value as PricingType)}
        >
          {PRICING_TYPES.map((t) => (
            <option key={t} value={t}>
              {PRICING_LABELS[t]}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Display order">
        <input
          className={inputCls}
          value={order}
          inputMode="numeric"
          onChange={(e) => setOrder(e.target.value)}
        />
      </Field>

      <label className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Active
      </label>

      <button
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
        className="h-10 w-full rounded-[12px] bg-primary text-primary-foreground font-bold text-[14px] disabled:opacity-50"
      >
        {mutation.isPending ? "Saving…" : "Save service"}
      </button>
    </Modal>
  );
}

function PriceOptionModal({
  service,
  option,
  onClose,
}: {
  service: CatalogueService;
  option: CataloguePriceOption | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const save = useServerFn(upsertPriceOption);
  const [label, setLabel] = useState(option?.label ?? "");
  const [minutes, setMinutes] = useState(
    option?.duration_minutes != null ? String(option.duration_minutes) : "",
  );
  const [unit, setUnit] = useState(option?.unit_label ?? "");
  const [price, setPrice] = useState(option ? String(option.customer_price) : "");
  const [wasPrice, setWasPrice] = useState(
    option?.strikethrough_price != null ? String(option.strikethrough_price) : "",
  );
  const [expert, setExpert] = useState(
    option?.expert_payout != null ? String(option.expert_payout) : "",
  );
  const [partner, setPartner] = useState(
    option?.partner_commission != null ? String(option.partner_commission) : "",
  );
  const [hq, setHq] = useState(option?.hq_share != null ? String(option.hq_share) : "");
  const [order, setOrder] = useState(String(option?.display_order ?? 0));
  const [active, setActive] = useState(option?.is_active ?? true);

  const optNum = (v: string) => (v.trim() === "" ? null : Number(v));

  const mutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          id: option?.id ?? null,
          service_id: service.id,
          label,
          duration_minutes:
            service.pricing_type === "duration" ? optNum(minutes) : null,
          unit_label: service.pricing_type === "quantity" ? unit : null,
          customer_price: Number(price) || 0,
          strikethrough_price: optNum(wasPrice),
          expert_payout: optNum(expert),
          partner_commission: optNum(partner),
          hq_share: optNum(hq),
          display_order: Number(order) || 0,
          is_active: active,
        },
      }),
    onSuccess: () => {
      toast.success(option ? "Price option updated" : "Price option added");
      queryClient.invalidateQueries({ queryKey: ["catalogue"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  return (
    <Modal
      title={`${option ? "Edit" : "New"} price option · ${PRICING_LABELS[service.pricing_type]}`}
      onClose={onClose}
    >
      <Field
        label={
          service.pricing_type === "duration"
            ? "Label (e.g. 1 Hour)"
            : service.pricing_type === "quantity"
              ? "Label (e.g. Per Room)"
              : "Label (e.g. Basic Wash)"
        }
      >
        <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} />
      </Field>

      {service.pricing_type === "duration" && (
        <Field label="Duration minutes">
          <input
            className={inputCls}
            value={minutes}
            inputMode="numeric"
            onChange={(e) => setMinutes(e.target.value)}
          />
        </Field>
      )}
      {service.pricing_type === "quantity" && (
        <Field label="Unit label (e.g. per room)">
          <input className={inputCls} value={unit} onChange={(e) => setUnit(e.target.value)} />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Customer price">
          <input
            className={inputCls}
            value={price}
            inputMode="decimal"
            onChange={(e) => setPrice(e.target.value)}
          />
        </Field>
        <Field label="Was price (optional)">
          <input
            className={inputCls}
            value={wasPrice}
            inputMode="decimal"
            onChange={(e) => setWasPrice(e.target.value)}
          />
        </Field>
        <Field label="Expert payout">
          <input
            className={inputCls}
            value={expert}
            inputMode="decimal"
            onChange={(e) => setExpert(e.target.value)}
          />
        </Field>
        <Field label="Partner commission">
          <input
            className={inputCls}
            value={partner}
            inputMode="decimal"
            onChange={(e) => setPartner(e.target.value)}
          />
        </Field>
        <Field label="HQ share">
          <input
            className={inputCls}
            value={hq}
            inputMode="decimal"
            onChange={(e) => setHq(e.target.value)}
          />
        </Field>
        <Field label="Display order">
          <input
            className={inputCls}
            value={order}
            inputMode="numeric"
            onChange={(e) => setOrder(e.target.value)}
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Active
      </label>

      <button
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
        className="h-10 w-full rounded-[12px] bg-primary text-primary-foreground font-bold text-[14px] disabled:opacity-50"
      >
        {mutation.isPending ? "Saving…" : "Save price option"}
      </button>
    </Modal>
  );
}

function PreviewPane({
  segments,
  categories,
  services,
  options,
}: {
  segments: CatalogueSegment[];
  categories: CatalogueCategory[];
  services: CatalogueService[];
  options: CataloguePriceOption[];
}) {
  const activeSegments = segments.filter((s) => s.is_active);
  const [selected, setSelected] = useState<string | null>(null);
  const segId = selected ?? activeSegments[0]?.id ?? null;
  const cats = categories.filter((c) => c.is_active && c.segment_id === segId);

  return (
    <aside className="xl:sticky xl:top-6 h-fit bg-card border border-border rounded-[18px] p-4 space-y-4">
      <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">
        Live preview
      </h3>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {activeSegments.map((s) => (
          <button
            key={s.id}
            onClick={() => setSelected(s.id)}
            className={`shrink-0 h-9 px-3 rounded-full text-[12px] font-bold ${
              s.id === segId
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {s.short_name || s.name}
          </button>
        ))}
        {activeSegments.length === 0 && (
          <p className="text-[12px] text-muted-foreground">No active segments.</p>
        )}
      </div>

      <div className="space-y-4">
        {cats.length === 0 && (
          <p className="text-[12px] text-muted-foreground">No active categories.</p>
        )}
        {cats.map((cat) => {
          const svcs = services.filter((s) => s.is_active && s.category_id === cat.id);
          return (
            <div key={cat.id} className="space-y-2">
              <p className="text-[13px] font-bold text-foreground">{cat.name}</p>
              {svcs.length === 0 && (
                <p className="text-[12px] text-muted-foreground">No active services.</p>
              )}
              <div className="grid grid-cols-2 gap-2">
                {svcs.map((svc) => {
                  const opts = options
                    .filter((o) => o.is_active && o.service_id === svc.id)
                    .sort((a, b) => a.display_order - b.display_order);
                  const first = opts[0];
                  return (
                    <div
                      key={svc.id}
                      className="border border-border rounded-[14px] overflow-hidden"
                    >
                      <ServiceImage
                        path={svc.image_url}
                        alt={svc.name}
                        className="w-full aspect-square"
                      />
                      <div className="p-2">
                        <p className="text-[12px] font-semibold text-foreground truncate">
                          {svc.name}
                        </p>
                        {first ? (
                          <p className="text-[12px] text-foreground">
                            <span className="font-bold">{inr.format(first.customer_price)}</span>
                            {first.strikethrough_price != null && (
                              <span className="ml-1 text-muted-foreground line-through">
                                {inr.format(first.strikethrough_price)}
                              </span>
                            )}
                            {first.unit_label && (
                              <span className="ml-1 text-muted-foreground">
                                {first.unit_label}
                              </span>
                            )}
                          </p>
                        ) : (
                          <p className="text-[11px] text-muted-foreground">No price set</p>
                        )}
                        {opts.length > 1 && (
                          <p className="text-[11px] text-muted-foreground">
                            {opts.length} options
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
