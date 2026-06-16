import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, Lock, Mail } from "lucide-react";

import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApp } from "@/context/AppContext";
import { SSO_PROVIDERS } from "@/lib/authConfig";

export default function Login() {
  const { login } = useApp();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inviteAccepted = searchParams.get("invite") === "accepted";
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await login(email, password);
      if (result.ok) {
        navigate("/dashboard", { replace: true });
      } else {
        setError(result.error ?? "Unable to sign in.");
      }
    } catch {
      setError("Unable to sign in. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your CleanOps workspace."
      footer={
        <p className="text-center">
          Trouble signing in?{" "}
          <Link to="/forgot-password" className="font-medium text-primary hover:underline">
            Reset your password
          </Link>
        </p>
      }
    >
      {inviteAccepted ? (
        <div className="mb-4 rounded-lg border border-success/20 bg-success/10 px-3 py-2 text-sm text-success">
          Account activated. Sign in with the password you just created.
        </div>
      ) : null}

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

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              to="/forgot-password"
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Forgot?
            </Link>
          </div>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pl-9"
              required
            />
          </div>
        </div>

        {error ? (
          <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Button type="submit" className="w-full" size="lg" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="space-y-2.5">
        {SSO_PROVIDERS.map((provider) => (
          <button
            key={provider.id}
            type="button"
            disabled={!provider.enabled}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            {provider.label}
            {!provider.enabled ? (
              <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                Soon
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="mt-6 rounded-xl border border-dashed border-border bg-muted/40 p-3.5 text-xs leading-relaxed text-muted-foreground">
        <p className="font-medium text-foreground">Administrator sign-in</p>
        <p className="mt-1">
          Super Admin and Company Admin accounts now authenticate through Supabase
          Authentication. The legacy demo admin logins have been retired.
        </p>
        <p className="mt-1">
          If an admin account has not been provisioned in Supabase, contact a
          Super Admin.
        </p>
      </div>
    </AuthShell>
  );
}
