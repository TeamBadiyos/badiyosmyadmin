import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, X } from "lucide-react";
import {
  submitBusinessInterest,
  submitCityInterest,
} from "@/lib/marketing-leads.functions";

export const INTEREST_CATEGORIES = [
  "Plumber",
  "Electrician",
  "AC Cleaning & Repair",
  "Pest Control",
  "Carpenter",
  "Car & Bike Wash",
  "Laundry",
  "Grocery",
  "Vegetables & Fruits",
  "Local Business (shop)",
  "Other",
] as const;

const PHONE_RE = /^[6-9]\d{9}$/;

function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-6">
      <div className="absolute inset-0 bg-foreground/50 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full sm:max-w-[460px] bg-card rounded-t-[24px] sm:rounded-[24px] border border-border shadow-2xl p-6 sm:p-8 max-h-[92vh] overflow-y-auto modal-pop"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 w-9 h-9 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground"
        >
          <X size={18} />
        </button>
        <h3 className="text-[20px] font-bold text-foreground pr-8">{title}</h3>
        {subtitle && <p className="mt-1.5 text-[13px] text-muted-foreground">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

function Done({ text }: { text: string }) {
  return (
    <div className="text-center py-4">
      <div className="w-14 h-14 rounded-full bg-primary-tint text-primary flex items-center justify-center mx-auto mb-4">
        <CheckCircle2 size={28} />
      </div>
      <p className="text-[17px] font-bold text-foreground">Thank you!</p>
      <p className="mt-2 text-[14px] text-muted-foreground">{text}</p>
    </div>
  );
}

const inputCls =
  "w-full h-[50px] px-4 rounded-[14px] border border-border bg-background text-[15px] focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary";
const labelCls = "block text-[13px] font-semibold text-foreground mb-1.5";
const btnCls =
  "w-full h-[52px] rounded-[14px] bg-primary text-white font-bold text-[15px] disabled:opacity-60 hover:brightness-95 transition";

export function BusinessInterestDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const submit = useServerFn(submitBusinessInterest);
  const [businessName, setBusinessName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const p = phone.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
    if (!PHONE_RE.test(p)) {
      setError("Enter a valid 10-digit Indian mobile number.");
      return;
    }
    if (!category) {
      setError("Please choose what you're interested in.");
      return;
    }
    setBusy(true);
    try {
      await submit({
        data: {
          businessName: businessName.trim() || undefined,
          ownerName: ownerName.trim(),
          phone: p,
          category,
        },
      });
      setDone(true);
    } catch {
      setError("Could not submit right now. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Show your interest"
      subtitle="Tell us about your service or shop and we'll notify you first when we open up your category."
    >
      {done ? (
        <Done text="We've noted your interest. Our team will reach out when we launch your category in Latur." />
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className={labelCls}>Business / service name</span>
            <input
              className={inputCls}
              value={businessName}
              maxLength={140}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="e.g. Sharma Electricals"
            />
          </label>
          <label className="block">
            <span className={labelCls}>
              Owner name<span className="text-primary"> *</span>
            </span>
            <input
              className={inputCls}
              value={ownerName}
              required
              maxLength={100}
              autoComplete="name"
              onChange={(e) => setOwnerName(e.target.value)}
            />
          </label>
          <label className="block">
            <span className={labelCls}>
              Phone number<span className="text-primary"> *</span>
            </span>
            <input
              className={inputCls}
              value={phone}
              required
              inputMode="numeric"
              maxLength={15}
              autoComplete="tel"
              onChange={(e) => setPhone(e.target.value)}
              placeholder="98765 43210"
            />
          </label>
          <label className="block">
            <span className={labelCls}>
              What are you interested in?<span className="text-primary"> *</span>
            </span>
            <select
              className={inputCls}
              value={category}
              required
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">Select a category</option>
              {INTEREST_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          {error && <p className="text-[13px] text-destructive">{error}</p>}
          <button type="submit" disabled={busy} className={btnCls}>
            {busy ? "Submitting…" : "Submit interest"}
          </button>
        </form>
      )}
    </Modal>
  );
}

export function CityInterestDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const submit = useServerFn(submitCityInterest);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const p = phone.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
    if (!PHONE_RE.test(p)) {
      setError("Enter a valid 10-digit Indian mobile number.");
      return;
    }
    setBusy(true);
    try {
      await submit({ data: { name: name.trim(), phone: p, city: city.trim() } });
      setDone(true);
    } catch {
      setError("Could not submit right now. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Get notified in your city"
      subtitle="We're starting in Latur. Leave your details and we'll tell you the day we reach you."
    >
      {done ? (
        <Done text="You're on the list. We'll message you as soon as Badiyos launches in your city." />
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className={labelCls}>
              Your name<span className="text-primary"> *</span>
            </span>
            <input
              className={inputCls}
              value={name}
              required
              maxLength={100}
              autoComplete="name"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block">
            <span className={labelCls}>
              Phone number<span className="text-primary"> *</span>
            </span>
            <input
              className={inputCls}
              value={phone}
              required
              inputMode="numeric"
              maxLength={15}
              autoComplete="tel"
              onChange={(e) => setPhone(e.target.value)}
              placeholder="98765 43210"
            />
          </label>
          <label className="block">
            <span className={labelCls}>
              Your city<span className="text-primary"> *</span>
            </span>
            <input
              className={inputCls}
              value={city}
              required
              maxLength={100}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g. Nanded"
            />
          </label>
          {error && <p className="text-[13px] text-destructive">{error}</p>}
          <button type="submit" disabled={busy} className={btnCls}>
            {busy ? "Submitting…" : "Notify me"}
          </button>
        </form>
      )}
    </Modal>
  );
}
