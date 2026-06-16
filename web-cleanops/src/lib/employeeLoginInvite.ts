import { requestPasswordReset } from "@/lib/authSupabase";
import { createSupabaseUser } from "@/lib/adminCreateUser";

/**
 * Shared helper for emailing employee login access without ever handling raw
 * passwords. It reuses the two existing, safe mechanisms:
 *
 *   - `reset`  → the employee already has a login, so we trigger Supabase Auth's
 *     password-recovery email (the standard reset-token flow).
 *   - `invite` → the employee has no login yet, so we create/connect login
 *     access via the `admin-create-user` Edge Function in invite mode, which
 *     emails a welcome/set-password link (the invitee chooses their own
 *     password; no credentials are ever emailed in plaintext).
 *
 * Never throws — failures are returned as `{ ok: false, error }` so callers can
 * surface a clear message instead of silently failing.
 */

export type LoginEmailMode = "reset" | "invite";

export interface SendLoginEmailInput {
  email: string;
  fullName: string | null;
  /** Company the employee belongs to (null only for super_admin). */
  companyId: string | null;
  /** Whether the employee already has a linked login account. */
  hasLogin: boolean;
}

export interface SendLoginEmailResult {
  ok: boolean;
  mode: LoginEmailMode;
  error?: string;
}

/** Returns the browser origin plus the given auth route, or undefined outside the browser. */
function authRedirectUrl(path: "/reset-password" | "/accept-invite"): string | undefined {
  return typeof window !== "undefined" ? `${window.location.origin}${path}` : undefined;
}

/** Redirect URL for password-recovery emails only. */
export function passwordRecoveryRedirectUrl(): string | undefined {
  return authRedirectUrl("/reset-password");
}

/** Redirect URL for invite/activation emails only. */
export function inviteRedirectUrl(): string | undefined {
  return authRedirectUrl("/accept-invite");
}

export async function sendEmployeeLoginEmail(
  input: SendLoginEmailInput,
): Promise<SendLoginEmailResult> {
  const email = input.email.trim();
  const mode: LoginEmailMode = input.hasLogin ? "reset" : "invite";

  if (!email) {
    return {
      ok: false,
      mode,
      error: "An email address is required to send login details.",
    };
  }

  if (input.hasLogin) {
    const res = await requestPasswordReset(email, passwordRecoveryRedirectUrl());
    return {
      ok: res.sent,
      mode: "reset",
      error: res.sent
        ? undefined
        : res.error ?? "Could not send the password reset email.",
    };
  }

  // No linked login yet — create/connect login access via the existing invite
  // path, which emails a welcome/set-password link.
  const res = await createSupabaseUser({
    email,
    baseRole: "employee",
    companyId: input.companyId,
    fullName: input.fullName,
    redirectTo: inviteRedirectUrl(),
  });
  return {
    ok: res.ok,
    mode: "invite",
    error: res.ok ? undefined : res.error ?? "Could not create login access.",
  };
}
