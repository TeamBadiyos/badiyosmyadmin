import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { exampleLine, type DeliveryRate } from "@/lib/delivery-rate";

export type DeliveryRateDraft = { baseFare: string; includedKm: string; perKm: string; minFare: string; platformFee: string; riderSharePct: string };

const FIELDS: Array<[string, keyof DeliveryRateDraft]> = [
  ["Base fare ₹", "baseFare"],
  ["Included km", "includedKm"],
  ["Per km ₹ (after included km)", "perKm"],
  ["Min fare ₹", "minFare"],
  ["Platform fee ₹", "platformFee"],
  ["Rider share %", "riderSharePct"],
];

export const toRate = (d: DeliveryRateDraft): DeliveryRate => ({
  baseFare: Number(d.baseFare || 0), includedKm: Number(d.includedKm || 0), perKm: Number(d.perKm || 0),
  minFare: Number(d.minFare || 0), platformFee: Number(d.platformFee || 0), riderSharePct: Number(d.riderSharePct || 0),
});

/** One identical Delivery rate row for Store, Food and Parcel. */
export function DeliveryRateFields({ vehicle, value, onChange, disabled, vehicleSlot }: {
  vehicle?: string; value: DeliveryRateDraft; onChange: (v: DeliveryRateDraft) => void; disabled?: boolean; vehicleSlot?: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div><Label>Vehicle</Label>{vehicleSlot ?? <Input value={vehicle ?? "Bike"} disabled />}</div>
        {FIELDS.map(([label, k]) => (
          <div key={k}>
            <Label>{label}</Label>
            <Input type="number" min={0} disabled={disabled} value={value[k]} onChange={(e) => onChange({ ...value, [k]: e.target.value })} />
          </div>
        ))}
      </div>
      <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">{exampleLine(5, toRate(value))}</p>
    </div>
  );
}
