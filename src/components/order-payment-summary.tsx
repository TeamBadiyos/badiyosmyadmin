type OrderPaymentSummaryProps = {
  paid: number;
  base?: number | null;
  coupon?: number | null;
  gst?: number | null;
  delivery?: number | null;
  className?: string;
};

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export function OrderPaymentSummary({
  paid,
  base,
  coupon,
  gst,
  delivery,
  className = "",
}: OrderPaymentSummaryProps) {
  const parts = [
    base && base > 0 ? `Base ${inr.format(base)}` : null,
    coupon && coupon > 0 ? `Coupon −${inr.format(coupon)}` : null,
    gst && gst > 0 ? `GST ${inr.format(gst)}` : null,
    delivery && delivery > 0 ? `Delivery ${inr.format(delivery)}` : null,
  ].filter((part): part is string => Boolean(part));

  return (
    <p className={`flex flex-wrap items-baseline gap-x-1.5 ${className}`}>
      <span className="text-[13px] font-bold text-foreground whitespace-nowrap">Paid {inr.format(Math.max(0, paid))}</span>
      {parts.length > 0 ? (
        <span className="text-[11px] leading-4 text-muted-foreground">· {parts.join(" · ")}</span>
      ) : null}
    </p>
  );
}