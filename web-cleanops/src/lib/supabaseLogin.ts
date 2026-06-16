import type { User } from "@/types";
import {
  getSession,
  isSupabaseAuthEnabled,
  signInWithPassword,
  signOut,
} from "@/lib/authSupabase";
import { loadProfileForUser } from "@/lib/profile";
import { resolveCompanyAppId } from "@/lib/companiesSupabase";
import type { Profile } from "@/types";

/**
 * Supabase Auth login gate.
 *
 * Routes sign-in through Supabase Auth for any eligible admin so protected Edge
 * Functions (e.g. admin-create-user) receive a real Supabase access token rather
 * than the anon key. Eligibility is determined by the authenticated user's
 * `profiles` row — NOT by a hard-coded email allowlist.
 *
 * Eligible to authenticate through Supabase Auth (the "admin path"):
 *   - base_role === "super_admin" AND status === "active"
 *   - base_role === "company_admin" AND status === "active" AND company_id present
 *
 * Rejected from the admin path:
 *   - inactive / archived profiles            → fail closed (no localStorage retry)
 *   - missing profile for an authed user      → fail closed
 *   - company_admin without company_id        → fail closed (misconfigured)
 *   - employees / customers                   → not admins; fall back to localStorage
 *
 * Fail-closed rules: when a Supabase session is established but the profile is
 * ineligible for a security reason (inactive, missing, misconfigured), the
 * partial session is torn down (signOut) and the caller MUST NOT retry through
 * localStorage. Only genuinely non-admin roles, or credentials Supabase does not
 * recognise at all, are allowed to fall back to the legacy localStorage path.
 *
 * Rollback: set EXPO_PUBLIC_USE_SUPABASE_AUTH=false. The layer goes dormant,
 * {@link shouldAttemptSupabaseAuth} returns false, and every account logs in via
 * localStorage exactly as before.
 */

/** Normalises an email for case-insensitive comparison. */
function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Whether a login attempt should be routed through Supabase Auth first.
 *
 * Because a user's role is only known AFTER authentication (their `profiles` row
 * is readable only once signed in), we attempt Supabase Auth for any login while
 * the layer is enabled. Credentials Supabase does not recognise fall back to the
 * localStorage path, so legacy accounts keep working unchanged.
 *
 * Returns `false` whenever the Supabase Auth layer is dormant (flag off or
 * Supabase not configured) — the instant rollback path.
 */
export function shouldAttemptSupabaseAuth(email: string): boolean {
  if (!isSupabaseAuthEnabled) return false;
  return normaliseEmail(email).length > 0;
}

/**
 * Whether a loaded {@link Profile} may authenticate through the Supabase Auth
 * admin path. Active super admins always qualify; active company admins qualify
 * only when bound to a company.
 */
export function isProfileEligibleForSupabaseAuth(profile: Profile): boolean {
  if (profile.status !== "active") return false;
  if (profile.baseRole === "super_admin") return true;
  if (profile.baseRole === "company_admin") {
    return Boolean(profile.companyId);
  }
  return false;
}

/** Outcome of a Supabase login attempt. */
export interface SupabaseLoginResult {
  user: User | null;
  error: string | null;
  /**
   * True when the caller may safely retry through the legacy localStorage path.
   * Set only when Supabase Auth does not recognise the credentials, or the
   * authenticated identity is a non-admin role (employee/customer) that still
   * uses localStorage. Never set for security rejections (inactive / missing /
   * misconfigured), which fail closed.
   */
  fallbackToLocal: boolean;
}

/**
 * Maps a validated admin {@link Profile} to the app's {@link User}.
 *
 * `appCompanyId` is the app-facing company id resolved via
 * {@link resolveCompanyAppId} (the company's `legacy_id` when present), NOT the
 * raw `profiles.company_id` UUID. Storing the resolved id keeps the logged-in
 * user in the same company id space as the rest of the frontend so module
 * access, role lookups, and company-scoped data resolve correctly.
 */
function mapProfileToUser(
  profile: Profile,
  fallbackEmail: string,
  appCompanyId: string | null,
): User {
  const email = profile.email ?? fallbackEmail;
  return {
    id: profile.id,
    name: profile.fullName ?? email,
    email,
    role: profile.baseRole,
    companyId: appCompanyId,
    status: "active",
    createdAt: profile.createdAt ?? new Date().toISOString(),
  };
}

/** Generic, user-facing rejection message that never leaks internal details. */
const REJECTED_MESSAGE =
  "Not authorized. This account cannot sign in through Supabase Auth.";

/**
 * Attempts a Supabase Auth sign-in and validates the resulting profile against
 * the admin-path eligibility rules. On any failure the Supabase session is
 * signed out so no partial session lingers. The returned `fallbackToLocal` flag
 * tells the caller whether a legacy localStorage retry is permitted.
 */
export async function loginWithSupabase(
  email: string,
  password: string,
): Promise<SupabaseLoginResult> {
  if (!isSupabaseAuthEnabled) {
    return { user: null, error: null, fallbackToLocal: true };
  }

  const { session, error: signInError } = await signInWithPassword(email, password);
  if (signInError || !session) {
    // Supabase Auth does not recognise these credentials (unknown user or wrong
    // password). Allow the legacy localStorage path to handle the attempt.
    return { user: null, error: signInError ?? "Invalid email or password.", fallbackToLocal: true };
  }

  const authedEmail = normaliseEmail(session.user.email ?? email);

  const { profile, missing, error: profileError } = await loadProfileForUser(
    session.user.id,
  );

  if (profileError) {
    await signOut();
    return {
      user: null,
      error: "Could not verify your account. Please try again.",
      fallbackToLocal: false,
    };
  }

  if (missing || !profile) {
    // Authenticated against Supabase but no profile row — a broken/forbidden
    // state. Fail closed; do not guess a role via localStorage.
    await signOut();
    return { user: null, error: REJECTED_MESSAGE, fallbackToLocal: false };
  }

  // Disabled accounts must never sign in, on any path.
  if (profile.status !== "active") {
    await signOut();
    return {
      user: null,
      error: "This account is not active. Contact an administrator.",
      fallbackToLocal: false,
    };
  }

  // Non-admin roles (employee/customer) are not part of the Supabase admin path
  // yet. They keep using localStorage, so tear down the session and fall back.
  if (profile.baseRole === "employee" || profile.baseRole === "customer") {
    await signOut();
    return { user: null, error: REJECTED_MESSAGE, fallbackToLocal: true };
  }

  // company_admin without a company is a misconfiguration — fail closed.
  if (profile.baseRole === "company_admin" && !profile.companyId) {
    await signOut();
    return {
      user: null,
      error: "This company administrator account is not linked to a company.",
      fallbackToLocal: false,
    };
  }

  if (!isProfileEligibleForSupabaseAuth(profile)) {
    await signOut();
    return { user: null, error: REJECTED_MESSAGE, fallbackToLocal: false };
  }

  const appCompanyId = await resolveCompanyAppId(profile.companyId);
  return {
    user: mapProfileToUser(profile, authedEmail, appCompanyId),
    error: null,
    fallbackToLocal: false,
  };
}

/**
 * Restores a previously authenticated Supabase admin session on app load,
 * re-running the full eligibility validation. Returns `null` when the layer is
 * dormant, there is no session, or any validation check fails (in which case the
 * stale session is signed out). Keeps an eligible admin signed in across reloads
 * without touching the localStorage session.
 */
export async function restoreSupabaseSession(): Promise<User | null> {
  if (!isSupabaseAuthEnabled) return null;

  const { session, error } = await getSession();
  if (error || !session) return null;

  const authedEmail = normaliseEmail(session.user.email ?? "");

  const { profile, missing } = await loadProfileForUser(session.user.id);
  if (missing || !profile) {
    await signOut();
    return null;
  }
  if (!isProfileEligibleForSupabaseAuth(profile)) {
    await signOut();
    return null;
  }

  const appCompanyId = await resolveCompanyAppId(profile.companyId);
  return mapProfileToUser(profile, authedEmail, appCompanyId);
}

/**
 * Hydrates the app {@link User} from the CURRENT Supabase session for the
 * post-invite / post-password-set onboarding flow ONLY.
 *
 * After an invitee sets their password on `/accept-invite`, the invite
 * session is upgraded to a full authenticated session. This maps that session
 * straight into the app so the user is signed in without a second trip through
 * the `/login` gate.
 *
 * Unlike {@link loginWithSupabase} and {@link restoreSupabaseSession}, this
 * INTENTIONALLY allows any *active* role — including `employee` — so invited
 * employees get the same smooth onboarding as admins. It does NOT relax the
 * permission model: it only runs immediately after a verified password set and
 * still fails closed for inactive/archived profiles or missing sessions.
 *
 * It must NEVER be wired into the normal `/login` gate; that gate keeps its
 * existing admin-only Supabase behaviour.
 */
export async function hydrateSessionAfterPasswordSet(): Promise<User | null> {
  if (!isSupabaseAuthEnabled) return null;

  const { session, error } = await getSession();
  if (error || !session) return null;

  const authedEmail = normaliseEmail(session.user.email ?? "");

  const { profile, missing } = await loadProfileForUser(session.user.id);
  if (missing || !profile) return null;

  // Inactive/archived accounts must never be signed in, even right after a
  // password set on a valid recovery link.
  if (profile.status !== "active") return null;

  const appCompanyId = await resolveCompanyAppId(profile.companyId);
  return mapProfileToUser(profile, authedEmail, appCompanyId);
}
