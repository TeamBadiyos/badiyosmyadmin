import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Smartphone, Trash2, ShieldCheck, Archive } from "lucide-react";
import { MarketingShell } from "@/components/marketing/shell";
import { OG_IMAGE, SITE_URL } from "@/lib/brand";
import { submitAccountDeletionRequest } from "@/lib/account-deletion.functions";

export const Route = createFileRoute("/delete-account")({
  head: () => ({
    meta: [
      { title: "Delete Your Account — Badiyos" },
      {
        name: "description",
        content:
          "Request deletion of your Badiyos account and personal data. Delete from inside the app, or submit a request here if you no longer have the app installed.",
      },
      { property: "og:title", content: "Delete Your Account — Badiyos" },
      {
        property: "og:description",
        content: "How to delete your Badiyos account and what data is removed or retained.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:url", content: `${SITE_URL}/delete-account` },
      { property: "og:image", content: OG_IMAGE },
      { name: "twitter:image", content: OG_IMAGE },
    ],
    links: [{ rel: "canonical", href: `${SITE_URL}/delete-account` }],
  }),
  component: DeleteAccountPage,
});

function DeleteAccountPage() {
  return (
    <MarketingShell>
      <section className="max-w-3xl mx-auto px-5 sm:px-8 pt-14 pb-6 sm:pt-20">
        <p className="text-[12px] font-bold uppercase tracking-widest text-primary">
          Account &amp; data
        </p>
        <h1 className="mt-2 text-[32px] sm:text-[44px] font-bold text-foreground tracking-tight">
          Delete your Badiyos account
        </h1>
        <p className="mt-4 text-[16px] text-muted-foreground">
          You can delete your Badiyos account and personal data at any time. The fastest way is from
          inside the app. If you no longer have the app, use the request form below and our team
          will process it for you.
        </p>
      </section>

      <section className="max-w-3xl mx-auto px-5 sm:px-8 pb-8">
        <div className="bg-card rounded-[18px] border border-border p-6 sm:p-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-primary-tint text-primary flex items-center justify-center">
              <Smartphone size={20} />
            </div>
            <h2 className="text-[20px] font-bold text-foreground">If you have the app installed</h2>
          </div>
          <ol className="space-y-3 text-[15px] text-muted-foreground list-decimal pl-5">
            <li>Open the Badiyos app and sign in with your registered phone number.</li>
            <li>
              Go to <span className="font-semibold text-foreground">Profile</span> →{" "}
              <span className="font-semibold text-foreground">Settings</span> →{" "}
              <span className="font-semibold text-foreground">Delete Account</span>.
            </li>
            <li>Confirm the deletion. Your account is closed immediately.</li>
          </ol>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-5 sm:px-8 pb-8">
        <h2 className="text-[20px] font-bold text-foreground mb-4">What happens to your data</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="bg-card rounded-[18px] border border-border p-6">
            <div className="flex items-center gap-2 mb-3">
              <Trash2 size={18} className="text-primary" />
              <h3 className="text-[15px] font-bold text-foreground">Deleted permanently</h3>
            </div>
            <ul className="space-y-2 text-[14px] text-muted-foreground list-disc pl-5">
              <li>Your name, email address and phone number</li>
              <li>Profile photo and saved addresses</li>
              <li>Saved locations, landmark photos and preferences</li>
              <li>App login access — you can no longer sign in</li>
              <li>Notification tokens and device sessions</li>
            </ul>
          </div>
          <div className="bg-card rounded-[18px] border border-border p-6">
            <div className="flex items-center gap-2 mb-3">
              <Archive size={18} className="text-muted-foreground" />
              <h3 className="text-[15px] font-bold text-foreground">Retained, but anonymised</h3>
            </div>
            <ul className="space-y-2 text-[14px] text-muted-foreground list-disc pl-5">
              <li>Booking and service history, with your personal details removed</li>
              <li>Payment, invoice and refund records</li>
            </ul>
            <p className="mt-3 text-[13px] text-muted-foreground">
              These records are kept only to meet Indian accounting, tax and audit requirements. They
              can no longer be linked back to you.
            </p>
          </div>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-5 sm:px-8 pb-20">
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck size={18} className="text-primary" />
          <h2 className="text-[20px] font-bold text-foreground">
            Request deletion without the app
          </h2>
        </div>
        <p className="text-[14px] text-muted-foreground mb-4">
          Because we can't verify your identity here the way the app does, your request goes to our
          team for manual review. We may contact you on the number below to confirm before deleting.
          Requests are usually processed within 7 working days.
        </p>
        <DeletionForm />
      </section>
    </MarketingShell>
  );
}

const ACCOUNT_TYPES = [
  { key: "customer", label: "Customer" },
  { key: "expert", label: "Expert (Partner)" },
  { key: "merchant", label: "Merchant (Shop owner)" },
] as const;

type AccountTypeKey = (typeof ACCOUNT_TYPES)[number]["key"];

function DeletionForm() {
  const submitFn = useServerFn(submitAccountDeletionRequest);
  const [accountType, setAccountType] = useState<AccountTypeKey | null>(null);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await submitFn({
        data: { phone: phone.trim(), email: email.trim(), reason: reason.trim() },
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
        <h3 className="text-[20px] font-bold text-foreground">Request received</h3>
        <p className="mt-2 text-[15px] text-muted-foreground">
          Our team will verify and process your deletion request. We'll reach out on your registered
          number if we need to confirm anything.
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
          Registered phone number <span className="text-primary">*</span>
        </span>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
          maxLength={20}
          inputMode="tel"
          autoComplete="tel"
          placeholder="+91 98765 43210"
          className="w-full h-[52px] px-4 rounded-[14px] border border-border bg-card text-[15px] focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
        />
      </label>
      <label className="block">
        <span className="block text-[13px] font-semibold text-foreground mb-1.5">
          Email (optional)
        </span>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxLength={255}
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          className="w-full h-[52px] px-4 rounded-[14px] border border-border bg-card text-[15px] focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
        />
      </label>
      <label className="block">
        <span className="block text-[13px] font-semibold text-foreground mb-1.5">
          Reason (optional)
        </span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={1000}
          rows={4}
          className="w-full px-4 py-3 rounded-[14px] border border-border bg-card text-[15px] focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary resize-y"
        />
      </label>
      <label className="flex items-start gap-3 text-[13px] text-muted-foreground">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 w-4 h-4 accent-[var(--color-primary)]"
        />
        <span>
          I understand my personal details will be permanently deleted and that anonymised booking
          and payment records will be retained for accounting purposes.
        </span>
      </label>
      {error && <p className="text-[13px] text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={submitting || !confirmed}
        className="w-full h-[52px] rounded-[14px] bg-primary text-white font-bold text-[15px] disabled:opacity-60 hover:brightness-95 transition"
      >
        {submitting ? "Sending…" : "Submit deletion request"}
      </button>
    </form>
  );
}
