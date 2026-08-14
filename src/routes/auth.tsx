import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import badiyoLogo from "@/assets/badiyos-wordmark-green.png.asset.json";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — Badiyos Command Center" },
      { name: "description", content: "Sign in to the Badiyos Command Center." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError || !data.user) {
      setSubmitting(false);
      setError("Invalid email or password");
      return;
    }

    // Verify the signed-in user has an active staff_users row (RLS allows self-read).
    const { data: staff, error: staffError } = await supabase
      .from("staff_users")
      .select("id, status")
      .eq("auth_user_id", data.user.id)
      .maybeSingle();

    if (staffError || !staff || staff.status !== "active") {
      await supabase.auth.signOut();
      setSubmitting(false);
      setError("You do not have access to this panel");
      return;
    }

    navigate({ to: "/dashboard", replace: true });
  }

  return (
    <main className="min-h-screen w-full bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-[420px] bg-card rounded-[18px] border border-border p-8 sm:p-10">
        <div className="flex justify-center mb-8">
          <img src={badiyoLogo.url} alt="Badiyos" className="h-10 w-auto" />
        </div>
        <h1 className="text-[22px] font-bold text-foreground text-center">Welcome back</h1>
        <p className="text-sm text-muted-foreground text-center mt-1">
          Sign in to the Command Center
        </p>

        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          <Field
            label="Email"
            type="email"
            placeholder="you@badiyos.com"
            value={email}
            onChange={setEmail}
            autoComplete="email"
            required
          />
          <Field
            label="Password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            required
          />

          <button
            type="submit"
            disabled={submitting}
            className="w-full h-[52px] rounded-[14px] bg-primary text-primary-foreground font-bold text-[15px] transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {submitting ? "Signing in…" : "Log In"}
          </button>

          {error ? (
            <p className="text-sm text-destructive text-center" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      </div>
    </main>
  );
}

function Field({
  label,
  type,
  placeholder,
  value,
  onChange,
  autoComplete,
  required,
}: {
  label: string;
  type: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[13px] font-semibold text-foreground mb-2">{label}</span>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required={required}
        className="w-full h-[52px] px-4 rounded-[14px] border border-border bg-card text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
      />
    </label>
  );
}
