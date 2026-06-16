import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AlertCircle, ArrowLeft, Loader2, Lock } from "lucide-react";

import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { hasRecoverySession, isSupabaseAuthEnabled, updatePassword } from "@/lib/authSupabase";
import {
  describeSupabaseAuthLinkError,
  readSupabaseAuthLinkError,
} from "@/lib/authUrlError";
import { classifyPasswordUpdateError } from "@/lib/authPasswordError";

/** Lifecycle of the recovery-link check shown before the new-password form. */
type VerifyState = "verifying" | "valid" | "invalid";

export default function ResetPassword() {
  const { resetPassword, completeOnboardingLogin } = useApp();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState<string>("");
  const [confirm, setConfirm] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);

  // When Supabase Auth is enabled, verify the recovery session established by
  // the email link before showing the new-password form. With the legacy demo
  // flow there is no session to verify, so we go straight to the form.
  const [verifyState, setVerifyState] = useState<VerifyState>(
    isSupabaseAuthEnabled ? "verifying" : "valid",
  );
  // The exact reason shown on the "invalid" screen. Defaults to the generic
  // message and is replaced with Supabase's real reason when the email link
  // itself carries a failure (used/expired link).
  const [invalidReason, setInvalidReason] = useState<string>(
    "This password reset link is invalid or has expired.",
  );

  useEffect(() => {
    if (!isSupabaseAuthEnabled) return;
    let active = true;

    // 1) If GoTrue redirected here with an explicit failure (e.g. the single-use
    //    link was already consumed or expired), it returns NO session — only an
    //    `#error=...&error_code=otp_expired` hash. Surface that real reason
    //    instead of waiting for a session that will never arrive.
    const linkError = readSupabaseAuthLinkError();
    if (linkError) {
      setInvalidReason(describeSupabaseAuthLinkError(linkError, "recovery"));
      setVerifyState("invalid");
      return;
    }

    // 2) Otherwise verify the recovery session established from the URL token.
    void hasRecoverySession().then(({ valid }) => {
      if (!active) return;
      setVerifyState(valid ? "valid" : "invalid");
    });
    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);

    // When Supabase Auth is enabled, the recovery email link establishes a
    // temporary recovery session; set the new password through Supabase Auth.
    if (isSupabaseAuthEnabled) {
      const { updated, error: updateError, code: updateCode } = await updatePassword(password);
      if (updated) {
        // The recovery session is now a full authenticated session. Sign the
        // user straight into the app (admins and invited employees alike) and
        // drop them on the start page — no second trip through /login.
        const user = await completeOnboardingLogin();
        setLoading(false);
        if (user) {
          toast({
            title: "You're all set",
            description: "Your password is set and you're signed in.",
          });
          navigate("/dashboard", { replace: true });
        } else {
          // Password saved, but the session couldn't be hydrated (e.g. inactive
          // account). Fall back to the normal sign-in gate.
          toast({
            title: "Password set",
            description: "You can now sign in with your new password.",
          });
          navigate("/login", { replace: true });
        }
      } else {
        setLoading(false);
        // Distinguish a rejected PASSWORD (same as old, too weak, invalid) from a
        // dead recovery LINK/session. Only the latter should send the user back
        // to request a new link; password problems keep them on the form so they
        // can simply choose a different password.
        const classified = classifyPasswordUpdateError({
          message: updateError,
          code: updateCode,
        });
        if (classified.kind === "link") {
          setInvalidReason(classified.message);
          setVerifyState("invalid");
        } else {
          setError(classified.message);
        }
      }
      return;
    }

    // Legacy localStorage demo flow (Supabase Auth disabled).
    setTimeout(() => {
      const ok = resetPassword(token, password);
      setLoading(false);
      if (ok) {
        toast({ title: "Password updated", description: "You can now sign in with your new password." });
        navigate("/login", { replace: true });
      } else {
        setError("This reset link is invalid or has expired.");
      }
    }, 500);
  };

  if (verifyState === "verifying") {
    return (
      <AuthShell
        title="Verifying your reset link"
        subtitle="Hang tight while we confirm your password reset link."
      >
        <div className="flex flex-col items-center justify-center gap-3 py-6 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm">Verifying your reset link…</p>
        </div>
      </AuthShell>
    );
  }

  if (verifyState === "invalid") {
    return (
      <AuthShell
        title="Reset link problem"
        subtitle="We couldn't verify this password reset link."
        footer={
          <Link
            to="/forgot-password"
            className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
          >
            <ArrowLeft className="h-4 w-4" /> Request a new link
          </Link>
        }
      >
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10">
            <AlertCircle className="h-5 w-5 text-destructive" />
          </div>
          <p className="text-sm text-muted-foreground">{invalidReason}</p>
          <Button asChild variant="outline" className="mt-1">
            <Link to="/forgot-password">Request a new reset link</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Set a strong password to secure your account."
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
          <Label htmlFor="password">New password</Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pl-9"
              required
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm">Confirm password</Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
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
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Update password"}
        </Button>
      </form>
    </AuthShell>
  );
}
