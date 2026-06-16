import type { Session } from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { USE_SUPABASE_AUTH } from "@/lib/featureFlags";

/**
 * Thin Supabase Auth client layer (migration Step 2B.3).
 *
 * This is purely additive plumbing. It is DORMANT by default:
 *   - Every function is a no-op unless {@link USE_SUPABASE_AUTH} is `true`.
 *   - Nothing here is wired into the current login UI or AppContext.
 *   - localStorage remains the single, default source of truth for auth.
 *
 * The functions are intentionally side-effect-free with respect to the running
 * app — they only talk to Supabase Auth when explicitly enabled by the flag,
 * which lets later steps (2B.4+) flip the flag for selected users without any
 * further code changes here.
 *
 * Safety:
 *   - No service_role is used anywhere; only the browser-safe anon client.
 *   - Errors are returned, never thrown, so callers can fall back to
 *     localStorage without the app ever crashing.
 */

/** Whether the Supabase Auth layer is enabled AND the client is configured. */
export const isSupabaseAuthEnabled: boolean =
  USE_SUPABASE_AUTH && isSupabaseConfigured && Boolean(supabase);

/** Result of an auth operation: a session (or null) plus an optional error. */
export interface AuthResult {
  session: Session | null;
  error: string | null;
}

type SupabaseEmailLinkType = "invite" | "recovery";

/** Reason the auth layer declined to act, for clearer diagnostics. */
const DORMANT_REASON =
  "Supabase Auth layer is dormant (EXPO_PUBLIC_USE_SUPABASE_AUTH is false " +
  "or Supabase is not configured). localStorage auth remains active.";

/**
 * Signs a user in against Supabase Auth with email + password.
 *
 * No-op when the layer is dormant — returns `{ session: null }` with the reason
 * surfaced as an error string so callers can fall back to localStorage.
 */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<AuthResult> {
  if (!isSupabaseAuthEnabled || !supabase) {
    return { session: null, error: DORMANT_REASON };
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      return { session: null, error: error.message };
    }
    return { session: data.session, error: null };
  } catch (err) {
    return {
      session: null,
      error: err instanceof Error ? err.message : "Unknown sign-in error.",
    };
  }
}

/**
 * Requests a Supabase Auth password-recovery email for the given address.
 *
 * Sends the email via Supabase Auth (which uses the configured Custom SMTP),
 * with a `redirectTo` pointing at the in-app reset-password route so the user
 * lands in a valid recovery session after clicking the link.
 *
 * No-op when the layer is dormant — returns `{ sent: false }` with the reason
 * surfaced so callers can fall back to the localStorage demo flow.
 *
 * IMPORTANT: callers must always show a generic success message regardless of
 * the result, so the existence of an account is never disclosed.
 */
export async function requestPasswordReset(
  email: string,
  redirectTo?: string,
): Promise<{ sent: boolean; error: string | null }> {
  if (!isSupabaseAuthEnabled || !supabase) {
    return { sent: false, error: DORMANT_REASON };
  }

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo:
        redirectTo ??
        (typeof window !== "undefined"
          ? `${window.location.origin}/reset-password`
          : undefined),
    });
    if (error) {
      return { sent: false, error: error.message };
    }
    return { sent: true, error: null };
  } catch (err) {
    return {
      sent: false,
      error: err instanceof Error ? err.message : "Unknown password-reset error.",
    };
  }
}

/**
 * Completes a Supabase Auth password setup by setting a password for the user
 * in the current recovery/invite session.
 *
 * After clicking a recovery or invite email link, Supabase establishes a
 * temporary session from the URL, which authorises this update. Returns
 * `{ updated: false }` when the layer is dormant or no eligible session exists.
 *
 * On failure it also returns Supabase's stable `AuthError.code` (e.g.
 * `same_password`, `weak_password`, `session_not_found`) so callers can tell a
 * rejected PASSWORD apart from a dead recovery LINK and show an accurate
 * message. `code` is `null` when no structured code is available.
 */
export async function updatePassword(
  password: string,
): Promise<{ updated: boolean; error: string | null; code: string | null }> {
  if (!isSupabaseAuthEnabled || !supabase) {
    return { updated: false, error: DORMANT_REASON, code: null };
  }

  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      return { updated: false, error: error.message, code: error.code ?? null };
    }
    return { updated: true, error: null, code: null };
  } catch (err) {
    return {
      updated: false,
      error: err instanceof Error ? err.message : "Unknown password-update error.",
      code: null,
    };
  }
}

function readSupabaseEmailLinkType(): string | null {
  if (typeof window === "undefined") return null;

  const fromHash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const hashType = new URLSearchParams(fromHash).get("type");
  if (hashType) return hashType;

  return new URLSearchParams(window.location.search).get("type");
}

async function waitForCurrentSession(): Promise<{ session: Session | null; error: string | null }> {
  if (!isSupabaseAuthEnabled || !supabase) {
    return { session: null, error: DORMANT_REASON };
  }

  const client = supabase;

  try {
    // The URL token is parsed asynchronously on load. Wait for the first
    // auth-state change (e.g. PASSWORD_RECOVERY / SIGNED_IN) before reading.
    const sessionFromEvent = await new Promise<Session | null>((resolve) => {
      let settled = false;
      const finish = (session: Session | null) => {
        if (settled) return;
        settled = true;
        resolve(session);
      };

      const { data } = client.auth.onAuthStateChange((_event, session) => {
        if (session) {
          data.subscription.unsubscribe();
          finish(session);
        }
      });

      // Fallback: resolve after a short window regardless, then clean up.
      window.setTimeout(() => {
        data.subscription.unsubscribe();
        finish(null);
      }, 1500);
    });

    if (sessionFromEvent) {
      return { session: sessionFromEvent, error: null };
    }

    const { data, error } = await client.auth.getSession();
    if (error) {
      return { session: null, error: error.message };
    }
    return { session: data.session, error: null };
  } catch (err) {
    return {
      session: null,
      error: err instanceof Error ? err.message : "Unknown auth-session error.",
    };
  }
}

async function hasEmailLinkSession(
  expectedType: SupabaseEmailLinkType,
): Promise<{ valid: boolean; error: string | null }> {
  const observedType = readSupabaseEmailLinkType();
  if (observedType && observedType !== expectedType) {
    return {
      valid: false,
      error: `Expected a ${expectedType} link, but received a ${observedType} link.`,
    };
  }

  const { session, error } = await waitForCurrentSession();
  if (error) {
    return { valid: false, error };
  }
  return { valid: Boolean(session), error: null };
}

/**
 * Checks whether a valid Supabase recovery session is currently established.
 * Invite links are explicitly rejected so `/reset-password` stays recovery-only.
 */
export async function hasRecoverySession(): Promise<{ valid: boolean; error: string | null }> {
  return hasEmailLinkSession("recovery");
}

/**
 * Checks whether a valid Supabase invite session is currently established.
 * Recovery links are explicitly rejected so invites use `/accept-invite` only.
 */
export async function hasInviteSession(): Promise<{ valid: boolean; error: string | null }> {
  return hasEmailLinkSession("invite");
}

/**
 * Signs the current Supabase Auth user out.
 *
 * No-op when the layer is dormant. Errors are returned, never thrown.
 */
export async function signOut(): Promise<{ error: string | null }> {
  if (!isSupabaseAuthEnabled || !supabase) {
    return { error: null };
  }

  try {
    const { error } = await supabase.auth.signOut();
    return { error: error ? error.message : null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown sign-out error." };
  }
}

/**
 * Reads the current Supabase Auth session, if any.
 *
 * Returns `{ session: null }` when the layer is dormant.
 */
export async function getSession(): Promise<AuthResult> {
  if (!isSupabaseAuthEnabled || !supabase) {
    return { session: null, error: null };
  }

  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      return { session: null, error: error.message };
    }
    return { session: data.session, error: null };
  } catch (err) {
    return {
      session: null,
      error: err instanceof Error ? err.message : "Unknown getSession error.",
    };
  }
}

/**
 * Subscribes to Supabase Auth state changes.
 *
 * Returns an `unsubscribe` function. When the layer is dormant, the callback is
 * never invoked and `unsubscribe` is a no-op, so callers can wire this up
 * unconditionally without affecting the current app.
 */
export function onAuthStateChange(
  callback: (session: Session | null) => void,
): () => void {
  if (!isSupabaseAuthEnabled || !supabase) {
    return () => {};
  }

  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });

  return () => {
    data.subscription.unsubscribe();
  };
}
