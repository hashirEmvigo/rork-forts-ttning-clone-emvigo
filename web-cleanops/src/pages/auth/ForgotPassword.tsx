import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Loader2, Mail } from "lucide-react";

import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApp } from "@/context/AppContext";
import { isSupabaseAuthEnabled, requestPasswordReset } from "@/lib/authSupabase";

export default function ForgotPassword() {
  const { requestReset } = useApp();
  const [email, setEmail] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [sent, setSent] = useState<boolean>(false);
  const [token, setToken] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // When Supabase Auth is enabled, send a real recovery email through
    // Supabase (Custom SMTP). The link returns the user to /reset-password,
    // where a recovery session lets them set a new password.
    if (isSupabaseAuthEnabled) {
      const { error } = await requestPasswordReset(email);
      if (error) {
        // Log for diagnostics, but never surface to the user — a generic
        // success message must show regardless so account existence stays hidden.
        // eslint-disable-next-line no-console
        console.warn("[auth.requestReset] Supabase recovery email request failed", {
          error,
        });
      }
      setToken(null);
      setLoading(false);
      // Always confirm to avoid leaking which emails exist.
      setSent(true);
      return;
    }

    // Legacy localStorage demo flow (Supabase Auth disabled).
    setTimeout(() => {
      const result = requestReset(email);
      setLoading(false);
      setToken(result);
      // Always confirm to avoid leaking which emails exist.
      setSent(true);
    }, 500);
  };

  if (sent) {
    return (
      <AuthShell
        title="Check your inbox"
        subtitle="If an account exists for that email, we've sent reset instructions."
        footer={
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
          >
            <ArrowLeft className="h-4 w-4" /> Back to sign in
          </Link>
        }
      >
        <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-card p-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <p className="text-sm text-muted-foreground">
            We've sent a secure link to <span className="font-medium text-foreground">{email}</span>.
          </p>
          {token ? (
            <Link
              to={`/reset-password?token=${token}`}
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Open reset link (demo)
            </Link>
          ) : null}
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter the email linked to your account and we'll send a reset link."
      footer={
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Back to sign in
        </Link>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.io"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-9"
              required
            />
          </div>
        </div>
        <Button type="submit" className="w-full" size="lg" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send reset link"}
        </Button>
      </form>
    </AuthShell>
  );
}
