import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { PinMap } from "@/components/customer-address-editor";
import { saveTrainingAddress, type TrainingAddress } from "@/lib/training.functions";

const inputCls = "w-full h-10 px-3 rounded-[10px] border border-border bg-card text-[13px] text-foreground";
const labelCls = "text-[11px] font-bold uppercase tracking-wide text-muted-foreground";

/** Editable address + map pin. Used for the saved setting and the create-order form. */
export function TrainingAddressFields({
  value,
  onChange,
}: {
  value: TrainingAddress;
  onChange: (v: TrainingAddress) => void;
}) {
  const set = (patch: Partial<TrainingAddress>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3">
      <label className="block space-y-1">
        <span className={labelCls}>Address</span>
        <input className={inputCls} value={value.full_address} onChange={(e) => set({ full_address: e.target.value })} />
      </label>
      <div className="grid grid-cols-3 gap-2">
        <label className="block space-y-1">
          <span className={labelCls}>Area</span>
          <input className={inputCls} value={value.area ?? ""} onChange={(e) => set({ area: e.target.value || null })} />
        </label>
        <label className="block space-y-1">
          <span className={labelCls}>City</span>
          <input className={inputCls} value={value.city ?? ""} onChange={(e) => set({ city: e.target.value || null })} />
        </label>
        <label className="block space-y-1">
          <span className={labelCls}>Pincode</span>
          <input className={inputCls} value={value.pincode ?? ""} onChange={(e) => set({ pincode: e.target.value || null })} />
        </label>
      </div>
      <PinMap lat={value.latitude} lng={value.longitude} onPick={(p) => set({ latitude: p.lat, longitude: p.lng })} />
      <p className="text-[11px] text-muted-foreground">Drag the pin or tap the map to set the exact spot.</p>
    </div>
  );
}

export function TrainingAddressCard({ initial, canEdit }: { initial: TrainingAddress; canEdit: boolean }) {
  const qc = useQueryClient();
  const save = useServerFn(saveTrainingAddress);
  const [val, setVal] = useState(initial);
  useEffect(() => setVal(initial), [initial]);
  const mut = useMutation({
    mutationFn: () => save({ data: val }),
    onSuccess: () => {
      toast.success("Training address saved");
      qc.invalidateQueries({ queryKey: ["training"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save. Please try again."),
  });
  return (
    <div className="bg-card border border-border rounded-[18px] p-4 space-y-3">
      <div>
        <h3 className="text-[15px] font-bold">Training address</h3>
        <p className="text-[12px] text-muted-foreground">Default address for new training orders.</p>
      </div>
      {canEdit ? (
        <>
          <TrainingAddressFields value={val} onChange={setVal} />
          <button
            disabled={mut.isPending || !val.full_address.trim()}
            onClick={() => mut.mutate()}
            className="h-10 px-4 rounded-[10px] bg-primary text-primary-foreground text-[13px] font-bold disabled:opacity-50"
          >
            {mut.isPending ? "Saving…" : "Save address"}
          </button>
        </>
      ) : (
        <p className="text-[13px]">{initial.full_address || "Not set"}</p>
      )}
    </div>
  );
}
