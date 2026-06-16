import { supabase } from "@/lib/supabase";
import { getSession } from "@/lib/authSupabase";
import { inviteRedirectUrl, passwordRecoveryRedirectUrl } from "@/lib/employeeLoginInvite";

/**
 * Client wrapper for the `admin-user-lifecycle` Supabase Edge Function.
 *
 * The browser never holds the service_role key. This helper only POSTs lifecycle
 * requests to the Edge Function, which performs authorization (active super_admin
 * → any user; active company_admin → their own company's non-super-admins) and
 * the privileged work (reading auth.users metadata, re-sending invites, flipping
 * profile status) server-side.
 *
 * Every function is side-effect-free with respect to the running app and never
 * throws — failures are returned as `{ ok: false, error }` so the UI can show a
 * clear toast instead of crashing. When the Edge Function is not deployed yet,
 * the request fails cleanly with a deploy hint.
 */

const supabaseUrl: string | undefined = import.meta.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey: string | undefined = import.meta.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** Whether the lifecycle path is wired (Supabase env present). */
export const isUserLifecycleConfigured: boolean = Boolean(supabaseUrl && anonKey);

/** Auth metadata surfaced for the Users table (sourced from `auth.users`). */
export interface UserAuthMeta {
  /** ISO timestamp of the user's most recent sign-in, or null if they never have. */
  lastSignInAt: string | null;
  /** ISO timestamp the email was confirmed, or null. */
  emailConfirmedAt: string | null;
  /** ISO timestamp an invite was issued, or null. */
  invitedAt: string | null;
  /** ISO timestamp the auth user was created, or null. */
  createdAt: string | null;
}

/** Map of profile/auth user id → auth metadata. */
export type UserAuthMetaMap = Record<string, UserAuthMeta>;

interface LifecycleRequestBody {
  action: "list_meta" | "resend_invite" | "set_status";
  user_id?: string;
  email?: string;
  status?: "active" | "inactive";
  redirect_to?: string;
  recovery_redirect_to?: string;
}

const NOT_CONFIGURED_ERROR =
  "Supabase is not configured (EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY).";

const DEPLOY_HINT =
  " If this keeps failing, the admin-user-lifecycle Edge Function may not be " +
  "deployed yet (supabase functions deploy admin-user-lifecycle).";

/** Resolves the bearer token: a real session token when signed in, else anon. */
async function resolveBearer(): Promise<string> {
  if (!anonKey) return "";
  if (supabase) {
    const { session } = await getSession();
    if (session?.access_token) return session.access_token;
  }
  return anonKey;
}

/** Low-level POST to the lifecycle function. Never throws. */
async function postLifecycle(
  body: LifecycleRequestBody,
): Promise<{ ok: boolean; status: number; payload: Record<string, unknown> | null }> {
  const url = `${(supabaseUrl as string).replace(/\/$/, "")}/functions/v1/admin-user-lifecycle`;
  const bearer = await resolveBearer();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey as string,
      Authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  return { ok: response.ok, status: response.status, payload };
}

/** Result of any single lifecycle write action. */
export interface LifecycleActionResult {
  ok: boolean;
  error?: string;
  /** For resend_invite: which email was actually sent. */
  mode?: "invite" | "recovery_fallback";
}

/**
 * Reads auth metadata for every user the caller may see (RLS-scoped server-side),
 * keyed by user id. Returns an empty map (never throws) when the layer is not
 * configured or the function is unavailable, so the table degrades gracefully to
 * showing "—" for Last Login / Invite Status.
 */
export async function fetchUserAuthMeta(): Promise<{
  ok: boolean;
  meta: UserAuthMetaMap;
  error?: string;
}> {
  if (!isUserLifecycleConfigured) {
    return { ok: false, meta: {}, error: NOT_CONFIGURED_ERROR };
  }
  try {
    const { ok, payload } = await postLifecycle({ action: "list_meta" });
    if (!ok || !payload?.ok) {
      const error =
        (typeof payload?.error === "string" ? payload.error : "Could not load user metadata.") +
        DEPLOY_HINT;
      return { ok: false, meta: {}, error };
    }
    const rows = Array.isArray(payload.users)
      ? (payload.users as Array<Record<string, unknown>>)
      : [];
    const meta: UserAuthMetaMap = {};
    for (const row of rows) {
      const id = typeof row.id === "string" ? row.id : null;
      if (!id) continue;
      meta[id] = {
        lastSignInAt: typeof row.lastSignInAt === "string" ? row.lastSignInAt : null,
        emailConfirmedAt:
          typeof row.emailConfirmedAt === "string" ? row.emailConfirmedAt : null,
        invitedAt: typeof row.invitedAt === "string" ? row.invitedAt : null,
        createdAt: typeof row.createdAt === "string" ? row.createdAt : null,
      };
    }
    return { ok: true, meta };
  } catch (err) {
    return {
      ok: false,
      meta: {},
      error: (err instanceof Error ? err.message : "Network error loading metadata.") + DEPLOY_HINT,
    };
  }
}

/**
 * Re-sends the invite email to a user who has not completed onboarding. The
 * server re-issues the original invite; if the deployed GoTrue rejects
 * re-inviting an existing user, it falls back to a recovery email (also lets the
 * user set a password and sign in). Never throws.
 */
export async function resendUserInvite(input: {
  userId: string;
  email?: string | null;
}): Promise<LifecycleActionResult> {
  if (!isUserLifecycleConfigured) {
    return { ok: false, error: NOT_CONFIGURED_ERROR };
  }
  try {
    const { ok, payload } = await postLifecycle({
      action: "resend_invite",
      user_id: input.userId,
      ...(input.email ? { email: input.email } : {}),
      ...(inviteRedirectUrl() ? { redirect_to: inviteRedirectUrl() } : {}),
      ...(passwordRecoveryRedirectUrl()
        ? { recovery_redirect_to: passwordRecoveryRedirectUrl() }
        : {}),
    });
    if (!ok || !payload?.ok) {
      return {
        ok: false,
        error:
          (typeof payload?.error === "string" ? payload.error : "Could not re-send the invite.") +
          DEPLOY_HINT,
      };
    }
    const mode =
      payload.mode === "recovery_fallback" ? "recovery_fallback" : "invite";
    return { ok: true, mode };
  } catch (err) {
    return {
      ok: false,
      error: (err instanceof Error ? err.message : "Network error sending invite.") + DEPLOY_HINT,
    };
  }
}

/**
 * Flips a user's profile lifecycle status (Disable → "inactive" / Enable →
 * "active"). Inactive admin profiles are refused at the login gate. Never throws.
 */
export async function setUserLifecycleStatus(input: {
  userId: string;
  status: "active" | "inactive";
}): Promise<LifecycleActionResult> {
  if (!isUserLifecycleConfigured) {
    return { ok: false, error: NOT_CONFIGURED_ERROR };
  }
  try {
    const { ok, payload } = await postLifecycle({
      action: "set_status",
      user_id: input.userId,
      status: input.status,
    });
    if (!ok || !payload?.ok) {
      return {
        ok: false,
        error:
          (typeof payload?.error === "string"
            ? payload.error
            : "Could not update the user's status.") + DEPLOY_HINT,
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: (err instanceof Error ? err.message : "Network error updating status.") + DEPLOY_HINT,
    };
  }
}
