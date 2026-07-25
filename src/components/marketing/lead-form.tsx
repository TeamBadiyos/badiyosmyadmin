import { useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2 } from "lucide-react";
import {
  submitAreaPartnerLead,
  submitExpertLead,
} from "@/lib/public-leads.functions";

type Kind = "area_partner" | "expert";

export function LeadForm({ kind }: { kind: Kind }) {
  const submitFn = useServerFn(kind === "area_partner" ? submitAreaPartnerLead : submitExpertLead);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [area, setArea] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await submitFn({
        data: {
          name: name.trim(),
          phone: phone.trim(),
          area: area.trim(),
          email: email.trim() || undefined,
        },
      });
      setDone(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      setError(msg.includes("valid") || msg.includes("invalid") ? msg : "Please check your details and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="bg-card rounded-[18px] border border-border p-8 text-center">
        <div className="w-14 h-14 rounded-full bg-primary-tint text-primary flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 size={28} />
        </div>
        <h3 className="text-[20px] font-bold text-foreground">Thank you!</h3>
        <p className="mt-2 text-[15px] text-muted-foreground">
          We've received your details. Our team will reach out to you soon.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-card rounded-[18px] border border-border p-6 sm:p-8 space-y-4"
    >
      <Field label="Full name" value={name} onChange={setName} required maxLength={100} autoComplete="name" />
      <Field
        label="Phone number"
        type="tel"
        value={phone}
        onChange={setPhone}
        required
        maxLength={20}
        autoComplete="tel"
        placeholder="+91 98765 43210"
      />
      <Field
        label="City / Area you're interested in"
        value={area}
        onChange={setArea}
        required
        maxLength={120}
        placeholder="e.g. Latur, Pune West"
      />
      <Field
        label="Email (optional)"
        type="email"
        value={email}
        onChange={setEmail}
        maxLength={255}
        autoComplete="email"
      />
      {error && <p className="text-[13px] text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="w-full h-[52px] rounded-[14px] bg-primary text-white font-bold text-[15px] disabled:opacity-60 hover:brightness-95 transition"
      >
        {submitting ? "Submitting…" : "Submit"}
      </button>
      <p className="text-[12px] text-muted-foreground text-center">
        By submitting, you agree to be contacted by the Badiyo team.
      </p>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
  maxLength,
  autoComplete,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  maxLength?: number;
  autoComplete?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[13px] font-semibold text-foreground mb-1.5">
        {label}
        {required && <span className="text-primary"> *</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        maxLength={maxLength}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="w-full h-[52px] px-4 rounded-[14px] border border-border bg-card text-[15px] focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
      />
    </label>
  );
}
