/**
 * Classifies why a Supabase password update failed so the admin
 * password-recovery (and invite-acceptance) UI can show an accurate,
 * actionable message instead of always blaming the email link.
 *
 * Background: `supabase.auth.updateUser({ password })` is the final step of the
 * recovery and invite flows. It can fail for two very different reasons that
 * previously collapsed into a single misleading message ("this link is invalid
 * or has expired"):
 *
 *   1. The NEW PASSWORD was rejected — it matches the current password
 *      (`same_password`), is too weak (`weak_password`), or otherwise failed
 *      validation (`validation_failed`). The recovery link is perfectly fine;
 *      the user just needs to pick a different password and stay on the form.
 *   2. The RECOVERY SESSION/TOKEN is genuinely gone — expired, missing, or
 *      revoked (`session_not_found`, `otp_expired`, …). Only here should we tell
 *      the user the link is dead and to request a new one.
 *
 * Supabase recommends identifying errors by the stable `error.code` rather than
 * by matching the human-readable (localised, changeable) message. We therefore
 * branch on the code first and fall back to message matching only when no code
 * is present (older errors, network errors, the dormant-layer reason string).
 *
 * This module is PURE and READ-ONLY: it performs no I/O and never touches
 * Supabase, so it is trivially unit-testable and safe to call from any view. It
 * is scoped to the admin recovery/invite flow and does not affect Employee or
 * Customer auth.
 */

/** Coarse bucket the UI branches on. */
export type PasswordUpdateErrorKind = "password" | "link" | "unknown";

/** The classification result: a bucket plus a ready-to-render sentence. */
export interface ClassifiedPasswordUpdateError {
  kind: PasswordUpdateErrorKind;
  /** Concise, user-facing message describing the problem and the next step. */
  message: string;
}

/** The raw failure detail returned by {@link updatePassword}. */
export interface PasswordUpdateFailure {
  /** Human-readable message from Supabase (or the dormant-layer reason). */
  message: string | null;
  /** Stable Supabase `AuthError.code`, when present. */
  code?: string | null;
}

/** User-facing copy — exported so views and tests share one source of truth. */
export const PASSWORD_UPDATE_MESSAGES = {
  samePassword: "Your new password must be different from your current password.",
  weakPassword:
    "That password is too weak. Please choose a stronger one with a mix of letters, numbers, and symbols.",
  shortPassword: "That password is too short. Please use at least 6 characters.",
  genericPassword: "That password can't be used. Please choose a different one.",
  link: "Your reset link has expired or is no longer valid. Please request a new one below.",
  unknown: "We couldn't update your password. Please try again.",
} as const;

/** Supabase `AuthError.code`s that mean the SUBMITTED PASSWORD was rejected. */
const SAME_PASSWORD_CODE = "same_password";
const WEAK_PASSWORD_CODE = "weak_password";
const SHORT_PASSWORD_CODE = "password_too_short";
const VALIDATION_FAILED_CODE = "validation_failed";

/** Supabase `AuthError.code`s that mean the RECOVERY SESSION/TOKEN is gone. */
const LINK_ERROR_CODES: ReadonlySet<string> = new Set([
  "session_not_found",
  "session_expired",
  "refresh_token_not_found",
  "refresh_token_already_used",
  "otp_expired",
  "bad_jwt",
  "no_authorization",
  "user_not_found",
  "flow_state_not_found",
  "flow_state_expired",
]);

/** Message fragments (lower-case) that signal "same as current password". */
const SAME_PASSWORD_PATTERNS: readonly string[] = [
  "different from the old",
  "different from the current",
  "different from your current",
  "should be different",
  "must be different",
];

/** Message fragments that signal "too short / below minimum length". */
const SHORT_PASSWORD_PATTERNS: readonly string[] = [
  "at least",
  "too short",
  "minimum length",
  "minimum of",
];

/** Message fragments that signal "too weak / leaked / easy to guess". */
const WEAK_PASSWORD_PATTERNS: readonly string[] = [
  "too weak",
  "weak password",
  "strength",
  "known to be",
  "pwned",
  "compromised",
  "easy to guess",
  "leaked",
];

/** Message fragments that signal a dead/expired/missing session or token. */
const LINK_PATTERNS: readonly string[] = [
  "session",
  "jwt",
  "token",
  "expired",
  "not authenticated",
  "auth session missing",
  "invalid claim",
  "sub claim",
  "user not found",
  "not logged in",
  "unauthorized",
];

function normalize(value: string | null | undefined): string {
  return (value ?? "").toString().trim().toLowerCase();
}

function includesAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

/**
 * Maps a Supabase password-update failure to a UI bucket + message.
 *
 * Order matters: password-specific rejections are checked first because the
 * link is fine in those cases. Only when nothing password-related matches do we
 * consider session/token failures, then fall back to a safe retry message.
 */
export function classifyPasswordUpdateError(
  failure: PasswordUpdateFailure | null | undefined,
): ClassifiedPasswordUpdateError {
  const code = normalize(failure?.code);
  const haystack = `${code} ${normalize(failure?.message)}`;

  // 1) Password rejected — keep the user on the form to choose another one.
  if (code === SAME_PASSWORD_CODE || includesAny(haystack, SAME_PASSWORD_PATTERNS)) {
    return { kind: "password", message: PASSWORD_UPDATE_MESSAGES.samePassword };
  }
  if (code === SHORT_PASSWORD_CODE || includesAny(haystack, SHORT_PASSWORD_PATTERNS)) {
    return { kind: "password", message: PASSWORD_UPDATE_MESSAGES.shortPassword };
  }
  if (code === WEAK_PASSWORD_CODE || includesAny(haystack, WEAK_PASSWORD_PATTERNS)) {
    return { kind: "password", message: PASSWORD_UPDATE_MESSAGES.weakPassword };
  }
  if (code === VALIDATION_FAILED_CODE) {
    return { kind: "password", message: PASSWORD_UPDATE_MESSAGES.genericPassword };
  }

  // 2) Session/token gone — the password was never evaluated; link is dead.
  if (LINK_ERROR_CODES.has(code) || includesAny(haystack, LINK_PATTERNS)) {
    return { kind: "link", message: PASSWORD_UPDATE_MESSAGES.link };
  }

  // 3) Anything else — safe, neutral retry message; do not blame the link.
  return { kind: "unknown", message: PASSWORD_UPDATE_MESSAGES.unknown };
}
