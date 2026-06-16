import type { UserRole } from "@/types";
import { supabase } from "@/lib/supabase";
import { getSession, isSupabaseAuthEnabled } from "@/lib/authSupabase";

/**
 * Client wrapper for the `admin-create-user` Supabase Edge Function (Step 2B.4).
 *
 * The browser never holds the service_role key. This helper only POSTs the
 * provisioning details to the Edge Function, which performs authorization and
 * creation server-side.
 *
 * Two creation modes:
 *   - Invite (default, long-term): no password is handled here — invitees set
 *     their own password via the emailed invite link.
 *   - Temp password (interim, verification only): the admin supplies a
 *     temporary password that is forwarded to the Edge Function so the new
 *     user can sign in immediately. The service_role key is never exposed; only
 *     the chosen password travels over HTTPS to the function.
 *
 * Authorization token strategy:
 *   - If a Supabase Auth session exists (the dormant layer is enabled and the
 *     caller is signed in), its access token is sent as the bearer so the
 *     function can authorize a Super Admin.
 *   - Otherwise the public anon key is sent. The function only honours that for
 *     the self-closing bootstrap path (creating the very first Super Admin when
 *     no profiles exist yet).
 */

const supabaseUrl: string | undefined = import.meta.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey: string | undefined = import.meta.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** Matches a canonical RFC 4122 UUID (the shape the Edge Function requires). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Resolves an app-facing company id to the real Supabase `companies.id` UUID.
 *
 * The app stores companies by their legacy id (e.g. `cmp_nordlys`) because
 * Supabase rows expose `legacy_id` as the app-facing `Company.id` during the
 * migration. The `admin-create-user` Edge Function, however, requires the real
 * `companies.id` UUID. Surfaces like the Admin → Users dialog pass the active
 * user's legacy `companyId`, so we must look up the matching UUID first.
 *
 * Resolution order:
 *   - already a UUID → use as-is (the Create User screen passes this directly);
 *   - otherwise → look up `companies.id` by `legacy_id`.
 *
 * Never invents a UUID. Returns an error string when no real company matches,
 * so creation fails cleanly instead of producing an orphan user.
 */
async function resolveCompanyUuid(
  companyId: string,
): Promise<{ ok: true; uuid: string } | { ok: false; error: string }> {
  const value = companyId.trim();
  if (UUID_RE.test(value)) {
    return { ok: true, uuid: value };
  }
  if (!supabase) {
    return {
      ok: false,
      error: "Supabase is not configured, so the company UUID cannot be resolved.",
    };
  }
  const { data, error } = await supabase
    .from("companies")
    .select("id")
    .eq("legacy_id", value)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      error: `Could not resolve company "${value}" in Supabase: ${error.message}`,
    };
  }
  const uuid = (data?.id as string | undefined) ?? null;
  if (!uuid) {
    return {
      ok: false,
      error:
        `Company "${value}" is not yet synced to Supabase. ` +
        "Create or migrate this company in Supabase before adding logins.",
    };
  }
  return { ok: true, uuid };
}

/** Input for creating a user. `companyId` must be null only for super_admin. */
export interface CreateUserInput {
  email: string;
  baseRole: UserRole;
  companyId: string | null;
  fullName: string | null;
  /**
   * Optional admin-supplied temporary password. When set, the new user can sign
   * in immediately with it (interim verification while invite email delivery is
   * still being configured). When null/omitted, the invite-email flow is used.
   */
  tempPassword?: string | null;
  /**
   * Optional redirect URL for the emailed invite link. When set (typically the
   * live app origin + `/accept-invite`), the invitee lands on the dedicated
   * activation route instead of relying on the server's INVITE_REDIRECT_URL.
   */
  redirectTo?: string | null;
}

/** Result of a create-user attempt. */
export interface CreateUserResult {
  ok: boolean;
  /** The new auth user id, when creation succeeded. */
  userId?: string | null;
  /** Whether the 0004 trigger auto-created the matching profile row. */
  profileCreated?: boolean;
  /** True when an emailed invite was sent; false when a temp password was set. */
  invited?: boolean;
  /** True when the admin set an immediate-login temporary password. */
  tempPasswordSet?: boolean;
  /** A user-facing error message when `ok` is false. */
  error?: string;
  /**
   * The `functionVersion` reported by the live `admin-create-user` Edge
   * Function, when present. Used purely for deployment/runtime verification:
   *   - present (e.g. "2024-companyadmin-1") → the updated build is live;
   *   - `null` → the response carried no version, which usually means the old
   *     deployed function is still serving requests.
   */
  functionVersion?: string | null;
  /**
   * Which credential the request was sent with — the decisive diagnostic for
   * the `base_role=none/status=none/company_id=none` symptom:
   *   - "session" → a real Supabase Auth access token was sent, so the Edge
   *     Function can resolve the caller's profile;
   *   - "anon" → no Supabase session existed, so the public anon key was sent.
   *     The caller is signed in via the legacy localStorage path and the Edge
   *     Function sees an anonymous request (caller resolves to none/none/none).
   */
  authMode?: "session" | "anon";
}

/** Whether the create-user path is wired (Supabase env present). */
export const isUserCreationConfigured: boolean = Boolean(supabaseUrl && anonKey);

/** Result of a delete-user attempt. */
export interface DeleteUserResult {
  ok: boolean;
  /** A user-facing error message when `ok` is false. */
  error?: string;
}

/**
 * Deletes a Supabase Auth user (and, via cascade, its `profiles` row) through
 * the `admin-delete-user` Edge Function so the email address is released for
 * reuse. The browser never holds the service_role key; the function performs
 * authorization and deletion server-side.
 *
 * Used when an employee with NO operational history is permanently deleted —
 * the app enforces the no-history rule before calling this; the function only
 * tears down the auth user/profile. A user that is already absent is reported
 * as a success (idempotent), since the email is released either way.
 *
 * Never throws — failures are returned as `{ ok: false, error }`.
 */
export async function deleteSupabaseUser(
  userId: string,
  email?: string,
): Promise<DeleteUserResult> {
  if (!supabaseUrl || !anonKey) {
    return {
      ok: false,
      error:
        "Supabase is not configured (EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY).",
    };
  }
  const id = userId.trim();
  const fallbackEmail = email?.trim().toLowerCase() ?? "";
  const hasValidUuid = UUID_RE.test(id);
  const hasEmail = fallbackEmail.includes("@");

  if (!hasValidUuid && !hasEmail) {
    // No usable Supabase UUID and no email to fall back on — the login was a
    // local-only record (never provisioned in Supabase), so there is nothing to
    // delete server-side. Treat as done.
    // eslint-disable-next-line no-console
    console.warn(
      "[deleteSupabaseUser] SKIPPED server delete — no UUID and no email.",
      { id, looksLocal: id.startsWith("usr_") },
    );
    return { ok: true };
  }

  // Build the request body. Prefer the UUID; otherwise fall back to the email so
  // legacy users (local `usr_...` id but an orphaned Supabase auth/profile that
  // still reserves the email) are cleaned up and the email is released.
  const requestBody: { user_id?: string; email?: string } = {};
  if (hasValidUuid) requestBody.user_id = id;
  if (hasEmail) requestBody.email = fallbackEmail;

  // eslint-disable-next-line no-console
  console.log("[deleteSupabaseUser] calling admin-delete-user", {
    userId: hasValidUuid ? id : null,
    via: hasValidUuid ? "id" : "email",
    hasEmailFallback: hasEmail,
  });

  // Prefer a real session token so the function can authorize the admin caller.
  let bearer = anonKey;
  if (supabase) {
    const { session } = await getSession();
    if (session?.access_token) {
      bearer = session.access_token;
    }
  }

  const url = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/admin-delete-user`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify(requestBody),
    });

    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; error?: string }
      | null;

    // eslint-disable-next-line no-console
    console.log("[deleteSupabaseUser] admin-delete-user response", {
      status: response.status,
      ok: response.ok,
      payload,
    });
    if (!response.ok || !payload?.ok) {
      return {
        ok: false,
        error: payload?.error ?? `Request failed (${response.status}).`,
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Network error deleting user.",
    };
  }
}

/**
 * Creates a Supabase Auth user via the Edge Function and returns the outcome.
 * Never throws — failures are returned as `{ ok: false, error }`.
 */
export async function createSupabaseUser(
  input: CreateUserInput,
): Promise<CreateUserResult> {
  if (!supabaseUrl || !anonKey) {
    return {
      ok: false,
      error:
        "Supabase is not configured (EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY).",
    };
  }

  // Resolve the app-facing (possibly legacy) company id to the real Supabase
  // UUID the Edge Function expects. Skipped for super_admin (companyId null).
  let resolvedCompanyId: string | null = null;
  if (input.companyId) {
    const resolved = await resolveCompanyUuid(input.companyId);
    if (resolved.ok === false) {
      return { ok: false, error: resolved.error };
    }
    resolvedCompanyId = resolved.uuid;
  }

  // Prefer a real session token; fall back to the anon key for bootstrap.
  let bearer = anonKey;
  let authMode: "session" | "anon" = "anon";
  if (supabase) {
    const { session } = await getSession();
    if (session?.access_token) {
      bearer = session.access_token;
      authMode = "session";
    }
  }

  // Decisive runtime diagnostic: when the layer is enabled but no session was
  // found, the request will be anonymous and the Edge Function cannot resolve a
  // caller (base_role/status/company_id = none). Make that visible up-front.
  if (authMode === "anon") {
    // eslint-disable-next-line no-console
    console.warn(
      "[admin-create-user] No Supabase Auth session — sending the public anon key. " +
        (isSupabaseAuthEnabled
          ? "You appear to be signed in via the legacy localStorage path; the Edge " +
            "Function will resolve the caller as none/none/none. Sign in with an " +
            "account that exists in Supabase auth.users with an active admin profile."
          : "EXPO_PUBLIC_USE_SUPABASE_AUTH is not enabled, so no Supabase session can " +
            "ever be created. Enable it and sign in as a Supabase-backed admin."),
    );
  }

  const url = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/admin-create-user`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({
        email: input.email,
        base_role: input.baseRole,
        company_id: resolvedCompanyId,
        full_name: input.fullName,
        // Only included when the admin opted into immediate-login temp password.
        ...(input.tempPassword ? { temp_password: input.tempPassword } : {}),
        // Explicit invite redirect so the link resolves to a real app route.
        ...(input.redirectTo ? { redirect_to: input.redirectTo } : {}),
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          ok?: boolean;
          userId?: string | null;
          profileCreated?: boolean;
          invited?: boolean;
          tempPasswordSet?: boolean;
          error?: string;
          functionVersion?: string | null;
        }
      | null;

    // Preserve the live function version (if any) for deployment verification.
    const functionVersion: string | null =
      typeof payload?.functionVersion === "string" ? payload.functionVersion : null;

    if (!response.ok || !payload?.ok) {
      // When no session token was sent, the caller is anonymous to the Edge
      // Function — the root cause of the none/none/none rejection. Make the
      // remedy explicit instead of leaving the admin guessing.
      const sessionHint =
        authMode === "anon"
          ? "\n\nNo Supabase Auth session was found, so the request used the public " +
            "anon key and the Edge Function saw an anonymous caller. Sign in with an " +
            "account that exists in Supabase auth.users and has an active admin " +
            "profile so a real session token is sent."
          : "";
      return {
        ok: false,
        error: (payload?.error ?? `Request failed (${response.status}).`) + sessionHint,
        functionVersion,
        authMode,
      };
    }

    return {
      ok: true,
      userId: payload.userId ?? null,
      profileCreated: payload.profileCreated ?? false,
      invited: payload.invited ?? false,
      tempPasswordSet: payload.tempPasswordSet ?? false,
      functionVersion,
      authMode,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Network error creating user.",
      authMode,
    };
  }
}
