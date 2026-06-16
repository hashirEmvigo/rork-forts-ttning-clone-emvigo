// ============================================================================
// CleanOps — USER LIFECYCLE ACTIONS (Supabase Edge Function)
// ============================================================================
//
// Companion to `admin-create-user` / `admin-delete-user`. This is the third (and
// only other) place the service_role key is used; it is never exposed to the
// browser. The browser calls this function; the function holds the privileged
// key (injected by Supabase as SUPABASE_SERVICE_ROLE_KEY).
//
// Purpose
//   Power the administrative "User Lifecycle Actions" in
//   Settings → Roles & Permissions → Users WITHOUT leaving the app:
//     • list_meta     — read auth metadata (last sign-in, invite/confirm state)
//                       for the users the caller may see, so the Users table can
//                       show Last Login + Invite Status (auth.users is not
//                       readable from the browser / anon RLS).
//     • resend_invite — re-send the invite email to a user who has not yet
//                       completed onboarding (falls back to a recovery email when
//                       the deployed GoTrue rejects re-inviting an existing user).
//     • set_status    — flip a profile's lifecycle status active <-> inactive
//                       (Disable / Enable user). Inactive profiles are refused at
//                       the admin login gate, which is how "prevent login" is
//                       enforced for Supabase-backed admins.
//
// Authorization (identical model to admin-delete-user)
//   a) Active super_admin  — may act on ANY user.
//   b) Active company_admin — may act ONLY on users in THEIR OWN company, and
//      never on a super_admin.
//   Self-targeting destructive actions (disable yourself) are refused, and the
//   last remaining active super_admin can never be disabled (lockout guard).
//
// What this function intentionally does NOT do
//   * It does not change Employee or Customer authentication flows. It only acts
//     on the shared Supabase identity backbone (auth.users + public.profiles).
//   * It does not delete users (that is admin-delete-user) and never sets a
//     password.
//
// Required runtime env (auto-injected by Supabase):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// DEPLOY: this function is NEW. It must be deployed before the lifecycle actions
// work against a live project:
//   supabase functions deploy admin-user-lifecycle
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// Bumped on every meaningful change so the deployed build is identifiable in
// logs and in responses. If this value is NOT present in a response, the
// function is not deployed (or an older build is serving requests).
const FUNCTION_VERSION = "2026-user-lifecycle-1";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type LifecycleAction = "list_meta" | "resend_invite" | "set_status";

interface LifecycleBody {
  action?: unknown;
  user_id?: unknown;
  email?: unknown;
  status?: unknown;
  /** Invite-email redirect (the app origin + /accept-invite). */
  redirect_to?: unknown;
  /** Recovery-email redirect (the app origin + /reset-password). */
  recovery_redirect_to?: unknown;
}

interface TargetProfile {
  id: string;
  base_role: string | null;
  company_id: string | null;
  email: string | null;
  status: string | null;
}

/** JSON response helper that always includes CORS headers. */
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/** Detects whether an invite error means the email is already registered. */
function isDuplicateEmailError(
  err: { code?: string; status?: number; message?: string } | null,
): boolean {
  if (!err) return false;
  if (err.code === "email_exists") return true;
  const message = (err.message ?? "").toLowerCase();
  return (
    message.includes("already been registered") ||
    message.includes("already registered") ||
    message.includes("already exists") ||
    message.includes("email address has already")
  );
}

/** Normalises a well-formed http(s) redirect URL, or null when invalid. */
function normaliseRedirect(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return value.trim();
    }
  } catch {
    // ignore malformed
  }
  return null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("[admin-user-lifecycle] Missing required runtime env.");
    return json({ error: "Server is not configured." }, 500);
  }

  let body: LifecycleBody;
  try {
    body = (await req.json()) as LifecycleBody;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const action =
    typeof body.action === "string" ? (body.action.trim() as LifecycleAction) : "";
  if (action !== "list_meta" && action !== "resend_invite" && action !== "set_status") {
    return json(
      { error: "action must be one of: list_meta, resend_invite, set_status." },
      400,
    );
  }

  // Privileged admin client. NEVER returned to the browser.
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── Authorization ──────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";

  let callerIsSuperAdmin = false;
  let callerIsCompanyAdmin = false;
  let callerCompanyId: string | null = null;
  let callerId: string | null = null;
  let callerBaseRole: string | null = null;
  let callerStatus: string | null = null;
  if (bearer && bearer !== anonKey) {
    const { data: userData } = await admin.auth.getUser(bearer);
    callerId = userData.user?.id ?? null;
    if (callerId) {
      const { data: callerProfile } = await admin
        .from("profiles")
        .select("base_role, status, company_id")
        .eq("id", callerId)
        .maybeSingle();
      callerBaseRole = (callerProfile?.base_role as string | undefined) ?? null;
      callerStatus = (callerProfile?.status as string | undefined) ?? null;
      const isActive = callerProfile?.status === "active";
      callerIsSuperAdmin = callerProfile?.base_role === "super_admin" && isActive;
      callerIsCompanyAdmin = callerProfile?.base_role === "company_admin" && isActive;
      callerCompanyId = (callerProfile?.company_id as string | undefined) ?? null;
    }
  }

  console.log("[admin-user-lifecycle] authz", {
    functionVersion: FUNCTION_VERSION,
    action,
    callerId,
    callerBaseRole,
    callerStatus,
    callerCompanyId,
  });

  if (!callerIsSuperAdmin && !callerIsCompanyAdmin) {
    return json(
      {
        error:
          "Not authorized. Your signed-in profile must be an active super_admin " +
          "or company_admin.",
        code: "not_authorized",
        functionVersion: FUNCTION_VERSION,
      },
      401,
    );
  }
  if (callerIsCompanyAdmin && !callerIsSuperAdmin && !callerCompanyId) {
    return json(
      { error: "Your admin account is not linked to a company.", functionVersion: FUNCTION_VERSION },
      403,
    );
  }

  // ── Action: list_meta ──────────────────────────────────────────────────────
  // Returns auth metadata for the users the caller may see. Company admins are
  // restricted to their own company's profile ids so other companies' login
  // times never leak.
  if (action === "list_meta") {
    // Resolve the set of profile ids the caller is allowed to see.
    let allowedIds: Set<string> | null = null; // null = all (super admin)
    if (!callerIsSuperAdmin) {
      const { data: companyProfiles, error: scopeError } = await admin
        .from("profiles")
        .select("id")
        .eq("company_id", callerCompanyId);
      if (scopeError) {
        console.error("[admin-user-lifecycle] scope lookup failed", scopeError);
        return json({ error: "Could not resolve company scope." }, 500);
      }
      allowedIds = new Set((companyProfiles ?? []).map((r) => r.id as string));
    }

    // Page through auth.users and collect the metadata we surface.
    const perPage = 200;
    const maxPages = 50; // safety cap (10k users)
    const users: Array<{
      id: string;
      lastSignInAt: string | null;
      emailConfirmedAt: string | null;
      invitedAt: string | null;
      createdAt: string | null;
    }> = [];
    for (let page = 1; page <= maxPages; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) {
        console.error("[admin-user-lifecycle] listUsers failed", error);
        return json({ error: "Could not read user metadata." }, 500);
      }
      const batch = data?.users ?? [];
      for (const u of batch) {
        if (allowedIds && !allowedIds.has(u.id)) continue;
        users.push({
          id: u.id,
          lastSignInAt: u.last_sign_in_at ?? null,
          emailConfirmedAt:
            (u.email_confirmed_at as string | undefined) ??
            (u.confirmed_at as string | undefined) ??
            null,
          invitedAt: (u.invited_at as string | undefined) ?? null,
          createdAt: u.created_at ?? null,
        });
      }
      if (batch.length < perPage) break;
    }

    return json({ ok: true, users, functionVersion: FUNCTION_VERSION }, 200);
  }

  // ── Resolve the target profile (shared by resend_invite + set_status) ───────
  const userId =
    typeof body.user_id === "string" && body.user_id.trim() !== ""
      ? body.user_id.trim()
      : "";
  const email =
    typeof body.email === "string" && body.email.trim() !== ""
      ? body.email.trim().toLowerCase()
      : "";
  const hasValidUuid = UUID_RE.test(userId);
  const hasValidEmail = EMAIL_RE.test(email);

  if (!hasValidUuid && !hasValidEmail) {
    return json({ error: "A valid user_id (UUID) or email is required." }, 400);
  }

  let targetProfile: TargetProfile | null = null;
  if (hasValidUuid) {
    const { data, error } = await admin
      .from("profiles")
      .select("id, base_role, company_id, email, status")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      console.error("[admin-user-lifecycle] target lookup by id failed", error);
      return json({ error: "Could not verify the target user." }, 500);
    }
    targetProfile = (data as TargetProfile | null) ?? null;
  } else {
    const { data: matches, error } = await admin
      .from("profiles")
      .select("id, base_role, company_id, email, status")
      .ilike("email", email);
    if (error) {
      console.error("[admin-user-lifecycle] target lookup by email failed", error);
      return json({ error: "Could not look up the user by email." }, 500);
    }
    const rows = (matches as TargetProfile[] | null) ?? [];
    if (rows.length === 0) {
      return json({ error: "No user found for that email." }, 404);
    }
    if (rows.length > 1) {
      return json(
        {
          error:
            "Multiple accounts share this email address. Resolve the conflict " +
            "manually first.",
          code: "email_conflict",
        },
        409,
      );
    }
    targetProfile = rows[0];
  }

  if (!targetProfile) {
    return json({ error: "Target user not found." }, 404);
  }

  // Company Admin scope: only act on non-super-admins in their own company.
  if (!callerIsSuperAdmin && callerIsCompanyAdmin) {
    if (targetProfile.base_role === "super_admin") {
      return json(
        { error: "Company admins cannot manage Super Admin accounts." },
        403,
      );
    }
    if (!callerCompanyId || targetProfile.company_id !== callerCompanyId) {
      return json(
        { error: "Company admins can only manage users in their own company." },
        403,
      );
    }
  }

  const targetEmail = (targetProfile.email ?? email).trim().toLowerCase();

  // ── Action: resend_invite ──────────────────────────────────────────────────
  if (action === "resend_invite") {
    if (!EMAIL_RE.test(targetEmail)) {
      return json({ error: "This user has no email address to send an invite to." }, 400);
    }
    const inviteRedirect = normaliseRedirect(body.redirect_to) ?? undefined;
    const recoveryRedirect = normaliseRedirect(body.recovery_redirect_to) ?? undefined;

    // Primary: re-send the invite email. Modern GoTrue re-sends for an existing
    // unconfirmed user; older builds reject duplicates, which we handle below.
    const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(
      targetEmail,
      { redirectTo: inviteRedirect },
    );
    if (!inviteError) {
      console.log("[admin-user-lifecycle] invite re-sent", {
        functionVersion: FUNCTION_VERSION,
        targetId: targetProfile.id,
      });
      return json({ ok: true, mode: "invite", functionVersion: FUNCTION_VERSION }, 200);
    }

    // Fallback: the deployed GoTrue refused to re-invite an existing user. Send a
    // recovery email instead — it also lets the user set a password and get in.
    if (isDuplicateEmailError(inviteError)) {
      const { error: recoveryError } = await admin.auth.resetPasswordForEmail(
        targetEmail,
        { redirectTo: recoveryRedirect },
      );
      if (recoveryError) {
        console.error("[admin-user-lifecycle] recovery fallback failed", recoveryError);
        return json({ error: recoveryError.message }, 400);
      }
      console.log("[admin-user-lifecycle] invite fell back to recovery email", {
        functionVersion: FUNCTION_VERSION,
        targetId: targetProfile.id,
      });
      return json(
        { ok: true, mode: "recovery_fallback", functionVersion: FUNCTION_VERSION },
        200,
      );
    }

    console.error("[admin-user-lifecycle] invite failed", inviteError);
    return json({ error: inviteError.message }, 400);
  }

  // ── Action: set_status ─────────────────────────────────────────────────────
  if (action === "set_status") {
    const status =
      typeof body.status === "string" ? body.status.trim() : "";
    if (status !== "active" && status !== "inactive") {
      return json({ error: "status must be 'active' or 'inactive'." }, 400);
    }

    // Disabling guards: never disable yourself, never disable the last active
    // super_admin (platform lockout protection).
    if (status === "inactive") {
      if (callerId && callerId === targetProfile.id) {
        return json({ error: "You cannot disable your own account." }, 403);
      }
      if (targetProfile.base_role === "super_admin") {
        const { count, error: countError } = await admin
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("base_role", "super_admin")
          .eq("status", "active")
          .neq("id", targetProfile.id);
        if (countError) {
          console.error("[admin-user-lifecycle] super_admin count failed", countError);
          return json({ error: "Could not verify remaining administrators." }, 500);
        }
        if ((count ?? 0) === 0) {
          return json(
            { error: "You cannot disable the last active Super Admin." },
            403,
          );
        }
      }
    }

    const { error: updateError } = await admin
      .from("profiles")
      .update({ status })
      .eq("id", targetProfile.id);
    if (updateError) {
      console.error("[admin-user-lifecycle] status update failed", updateError);
      return json({ error: updateError.message }, 400);
    }

    console.log("[admin-user-lifecycle] status updated", {
      functionVersion: FUNCTION_VERSION,
      targetId: targetProfile.id,
      status,
    });
    return json({ ok: true, status, functionVersion: FUNCTION_VERSION }, 200);
  }

  return json({ error: "Unhandled action." }, 400);
});
