/**
 * Reads the explicit auth error that Supabase encodes in an email-link redirect.
 *
 * When a Super Admin / Company Admin password-recovery (or invite) link's
 * single-use token is already consumed, expired, or otherwise rejected, GoTrue
 * does NOT deliver a session. Instead it redirects the browser to the configured
 * redirect URL with the failure encoded in the URL — for the implicit flow this
 * lands in the hash, e.g.:
 *
 *   /reset-password#error=access_denied&error_code=otp_expired&
 *     error_description=Email+link+is+invalid+or+has+expired
 *
 * Without reading these params the reset/invite pages only observe "no session"
 * and fall back to a generic message, which hides the real cause (a used/expired
 * link) and makes a token-validity problem look like a frontend bug. This helper
 * surfaces the actual reason so the UI can show an accurate message and QA can
 * tell the two apart.
 *
 * It is READ-ONLY: it never creates or clears a session and never talks to
 * Supabase, so it is safe to call from any auth page without side effects. It is
 * intentionally scoped to the admin recovery flow and does not touch Employee or
 * Customer auth.
 */

/** The decoded auth error params from a Supabase email-link redirect. */
export interface SupabaseAuthLinkError {
  /** High-level error, e.g. "access_denied". */
  error: string | null;
  /** Machine-readable code, e.g. "otp_expired" / "access_denied". */
  errorCode: string | null;
  /** Human-readable description from GoTrue (already URL-decoded). */
  description: string | null;
}

function firstNonEmpty(...values: Array<string | null>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

function stripLeading(value: string, prefix: "#" | "?"): string {
  return value.startsWith(prefix) ? value.slice(1) : value;
}

/**
 * Pure parser: given a raw `hash` and `search` string, returns the encoded
 * Supabase auth error, or `null` when neither carries one. The hash takes
 * precedence because the implicit flow encodes failures there; the query string
 * is a fallback for proxies/templates that move the params.
 */
export function parseSupabaseAuthLinkError(input: {
  hash: string;
  search: string;
}): SupabaseAuthLinkError | null {
  const hashParams = new URLSearchParams(stripLeading(input.hash, "#"));
  const searchParams = new URLSearchParams(stripLeading(input.search, "?"));

  const error = firstNonEmpty(hashParams.get("error"), searchParams.get("error"));
  const errorCode = firstNonEmpty(
    hashParams.get("error_code"),
    searchParams.get("error_code"),
  );
  const description = firstNonEmpty(
    hashParams.get("error_description"),
    searchParams.get("error_description"),
  );

  if (!error && !errorCode && !description) return null;
  return { error, errorCode, description };
}

/** Reads the current browser URL for a Supabase auth-link error. SSR-safe. */
export function readSupabaseAuthLinkError(): SupabaseAuthLinkError | null {
  if (typeof window === "undefined") return null;
  return parseSupabaseAuthLinkError({
    hash: window.location.hash,
    search: window.location.search,
  });
}

/**
 * Maps a Supabase auth-link error to a concise, accurate, user-facing sentence
 * for the given flow. "Used or expired" is by far the most common case (the
 * single-use link was consumed — often by an email scanner/link-preview bot —
 * before the recipient clicked, or it simply timed out), so it gets a clear,
 * actionable message. Anything else falls back to GoTrue's own description.
 */
export function describeSupabaseAuthLinkError(
  err: SupabaseAuthLinkError,
  flow: "recovery" | "invite",
): string {
  const haystack = `${err.errorCode ?? ""} ${err.error ?? ""} ${
    err.description ?? ""
  }`.toLowerCase();
  const isUsedOrExpired =
    haystack.includes("otp_expired") ||
    haystack.includes("access_denied") ||
    haystack.includes("expired") ||
    haystack.includes("invalid");

  if (isUsedOrExpired) {
    return flow === "recovery"
      ? "This password reset link has already been used or has expired. Request a new one below."
      : "This invite link has already been used or has expired. Ask an admin to send a new invite.";
  }

  return (
    err.description ??
    (flow === "recovery"
      ? "This password reset link could not be verified. Request a new one below."
      : "This invite link could not be verified. Ask an admin to send a new invite.")
  );
}
