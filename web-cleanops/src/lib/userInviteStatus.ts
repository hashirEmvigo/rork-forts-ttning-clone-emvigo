import type { UserAuthMeta } from "@/lib/adminUserLifecycle";

/**
 * Onboarding/invite state derived from a user's Supabase `auth.users` metadata.
 *
 *   - `accepted` — the user has signed in at least once → onboarding complete.
 *   - `pending`  — an auth identity exists but the user has never signed in →
 *                  they were invited / provisioned but have not completed
 *                  onboarding. This is the only state where "Resend Invite"
 *                  applies.
 *   - `unknown`  — no auth metadata is available (e.g. the lifecycle Edge
 *                  Function is not deployed yet, still loading, or the user has
 *                  no auth identity). The table shows a neutral placeholder.
 */
export type InviteStatus = "accepted" | "pending" | "unknown";

/** Derives the invite/onboarding status from a user's auth metadata. */
export function deriveInviteStatus(meta: UserAuthMeta | undefined | null): InviteStatus {
  if (!meta) return "unknown";
  if (meta.lastSignInAt) return "accepted";
  return "pending";
}

/** Short, human-readable label for each invite status. */
export function inviteStatusLabel(status: InviteStatus): string {
  switch (status) {
    case "accepted":
      return "Onboarded";
    case "pending":
      return "Invited";
    case "unknown":
    default:
      return "—";
  }
}

/**
 * Whether "Resend Invite" should be offered. The ticket scopes it to users who
 * have NEVER completed onboarding. We therefore offer it for `pending` users,
 * and also for `unknown` (we cannot prove they have onboarded, so we let the
 * admin try — the server re-issues an invite or falls back to a recovery email).
 * Once a user is known-`accepted`, the action is hidden.
 */
export function canResendInvite(status: InviteStatus): boolean {
  return status !== "accepted";
}
