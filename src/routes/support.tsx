import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, ChevronDown } from "lucide-react";
import { MarketingShell } from "@/components/marketing/shell";
import { submitSupportInquiry } from "@/lib/public-leads.functions";

export const Route = createFileRoute("/support")({
  head: () => ({
    meta: [
      { title: "Support — Badiyos" },
      {
        name: "description",
        content:
          "Questions about a Badiyos booking, payment, or your account? Send us a message and our team will get back to you.",
      },
      { property: "og:title", content: "Support — Badiyos" },
      { property: "og:description", content: "Get help with your Badiyos bookings and account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SupportPage,
});

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "How do I book a service?",
    a: "Download the Badiyos app, choose the service you need, pick a time slot, and pay online. A verified expert will be assigned to you.",
  },
  {
    q: "Can I cancel or reschedule a booking?",
    a: "Yes. You can cancel or reschedule from the app before your expert has been dispatched. Reach out to support if you need help.",
  },
  {
    q: "How do payments work?",
    a: "All payments are handled securely online at the time of booking. You'll get an in-app receipt for every service.",
  },
  {
    q: "How do you verify Home Experts?",
    a: "Every Home Expert on Badiyos goes through document verification, background checks, and ongoing quality reviews.",
  },
];

function SupportPage() {
  return (
    <MarketingShell>
      <section className="max-w-4xl mx-auto px-5 sm:px-8 pt-14 pb-6 sm:pt-20">
        <p className="text-[12px] font-bold uppercase tracking-widest text-primary">Support</p>
        <h1 className="mt-2 text-[32px] sm:text-[44px] font-bold text-foreground tracking-tight">
          We're here to help
        </h1>
        <p className="mt-4 text-[16px] text-muted-foreground max-w-2xl">
          Browse common questions below, or send us a message and we'll get back to you.
        </p>
      </section>

      <section className="max-w-4xl mx-auto px-5 sm:px-8 pb-8">
        <h2 className="text-[20px] font-bold text-foreground mb-4">Frequently asked</h2>
        <div className="bg-card rounded-[18px] border border-border divide-y divide-border">
          {FAQ.map((item) => (
            <FaqItem key={item.q} q={item.q} a={item.a} />
          ))}
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-5 sm:px-8 pb-20">
        <h2 className="text-[20px] font-bold text-foreground mb-4">Send us a message</h2>
        <SupportForm />
      </section>
    </MarketingShell>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 text-left px-6 py-5 hover:bg-muted/40 transition"
      >
        <span className="text-[15px] font-semibold text-foreground">{q}</span>
        <ChevronDown
          size={18}
          className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <p className="px-6 pb-5 text-[14px] text-muted-foreground -mt-1">{a}</p>}
    </div>
  );
}

function SupportForm() {
  const submitFn = useServerFn(submitSupportInquiry);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [message, setMessage] = useState("");
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
          contact: contact.trim(),
          message: message.trim(),
        },
      });
      setDone(true);
    } catch {
      setError("Please check your details and try again.");
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
        <h3 className="text-[20px] font-bold text-foreground">Message received</h3>
        <p className="mt-2 text-[15px] text-muted-foreground">
          Thanks for reaching out. We'll get back to you shortly.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-card rounded-[18px] border border-border p-6 sm:p-8 space-y-4"
    >
      <label className="block">
        <span className="block text-[13px] font-semibold text-foreground mb-1.5">
          Name <span className="text-primary">*</span>
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={100}
          autoComplete="name"
          className="w-full h-[52px] px-4 rounded-[14px] border border-border bg-card text-[15px] focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
        />
      </label>
      <label className="block">
        <span className="block text-[13px] font-semibold text-foreground mb-1.5">
          Phone or email <span className="text-primary">*</span>
        </span>
        <input
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          required
          maxLength={255}
          placeholder="+91 98765 43210 or you@example.com"
          className="w-full h-[52px] px-4 rounded-[14px] border border-border bg-card text-[15px] focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
        />
      </label>
      <label className="block">
        <span className="block text-[13px] font-semibold text-foreground mb-1.5">
          How can we help? <span className="text-primary">*</span>
        </span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
          maxLength={2000}
          rows={5}
          className="w-full px-4 py-3 rounded-[14px] border border-border bg-card text-[15px] focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary resize-y"
        />
      </label>
      {error && <p className="text-[13px] text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="w-full h-[52px] rounded-[14px] bg-primary text-white font-bold text-[15px] disabled:opacity-60 hover:brightness-95 transition"
      >
        {submitting ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
