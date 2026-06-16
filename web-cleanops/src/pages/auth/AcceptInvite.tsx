import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, Lock } from "lucide-react";

import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { hasInviteSession, isSupabaseAuthEnabled, updatePassword } from "@/lib/authSupabase";

type VerifyState = "verifying" | "valid" | "invalid";

/** Dedicated Supabase invite acceptance flow. */
export default function AcceptInvite() {
  const { completeOnboardingLogin } = useApp();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [password, setPassword] = useState<string>("");
  const [confirm, setConfirm] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [verifyState, setVerifyState] = useState<VerifyState>(
    isSupabaseAuthEnabled ? "verifying" : "invalid",
  );

  useEffect(() => {
    if (!isSupabaseAuthEnabled) return;
    let active = true;
    void hasInviteSession().then(({ valid }) => {
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
    const { updated, error: updateError } = await updatePassword(password);
    if (!updated) {
      setLoading(false);
      setError(
        updateError
          ? "This invite is invalid, expired, or has already been used. Please ask an admin to send a new invite."
          : "Unable to activate your account. Please try again.",
      );
      return;
    }

    const user = await completeOnboardingLogin();
    setLoading(false);

    if (user) {
      toast({
        title: "Account activated",
        description: "Your password is set and you're signed in.",
      });
      navigate("/dashboard", { replace: true });
      return;
    }

    toast({
      title: "Account activated",
      description: "Your password is set. Please sign in to continue.",
    });
    navigate("/login?invite=accepted", { replace: true });
  };

  if (verifyState === "verifying") {
    return (
      <AuthShell
        title="Verifying your invite"
        subtitle="Hang tight while we confirm your invitation link."
      >
        <div className="flex flex-col items-center justify-center gap-3 py-6 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm">Verifying your invite…</p>
        </div>
      </AuthShell>
    );
  }

  if (verifyState === "invalid") {
    return (
      <AuthShell
        title="Invite link problem"
        subtitle="We couldn't verify this invitation link."
        footer={
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
          >
            <ArrowLeft className="h-4 w-4" /> Back to sign in
          </Link>
        }
      >
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10">
            <AlertCircle className="h-5 w-5 text-destructive" />
          </div>
          <p className="text-sm text-muted-foreground">
            This invite may be expired, invalid, or already used. Ask an admin to send a new invite.
          </p>
          <Button asChild variant="outline" className="mt-1">
            <Link to="/login">Go to sign in</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Activate your account"
      subtitle="Create your password to finish accepting your CleanOps invite."
      footer={
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Back to sign in
        </Link>
      }
    >
      <div className="mb-5 flex items-start gap-3 rounded-xl border border-primary/15 bg-primary/5 p-3.5 text-sm text-muted-foreground">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p>
          Your invite is verified. Set a password now; you should not need to use Forgot password.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="password">Create password</Label>
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
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create password and activate"}
        </Button>
      </form>
    </AuthShell>
  );
}
