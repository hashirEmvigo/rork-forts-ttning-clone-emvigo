// ============================================================================
// CleanOps — SAFE USER DELETION PATH (Supabase Edge Function)
// ============================================================================
//
// Companion to `admin-create-user`. This is the ONLY place (besides create)
// where the service_role key is used; it is never exposed to the browser.
//
// Purpose
//   When an employee is PERMANENTLY deleted in the app (allowed only when the
//   employee has no operational history), the linked Supabase Auth user and its
//   `profiles` row must also be removed so the email address is released for
//   reuse. Deleting only the local record left an orphaned auth user + profile,
//   which made the next "create employee" with the same email fail with
//   "A user with this email address already exists."
//
//   Deleting the auth user cascades to the profile automatically because
//   `profiles.id references auth.users(id) on delete cascade` (migration 0003).
//
// Responsibilities
//   1. CORS + method handling.
//   2. Validate input (a single auth `user_id` UUID).
//   3. Authorize the caller:
//        a) Active super_admin — may delete any user.
//        b) Active company_admin — may delete users that belong to THEIR OWN
//           company and are NOT super_admins.
//   4. Delete the auth user by id (cascades to the profile). Idempotent: a user
//      that no longer exists is treated as already-deleted (success), so the
//      email is reported as released regardless.
//
//   5. Email-based fallback (legacy users). When the caller cannot supply a
//      valid auth UUID (legacy employees often carry a local `usr_...` id even
//      though an orphaned Supabase auth user/profile still holds the email), the
//      caller may pass an `email` instead. We then look up the matching profile
//      by email and delete that auth user — subject to the SAME authorization
//      rules as the id path. If multiple profiles share the email we FAIL SAFELY
//      (409 conflict) rather than guessing which one to delete.
//
// What this function intentionally does NOT do
//   * It does not check operational history — the app enforces that rule before
//     ever calling here. This function is purely the auth/profile teardown.
//   * The email fallback resolves to exactly ONE profile and applies every
//     authorization/safety check before deleting; it never bulk-deletes.
//
// Required runtime env (auto-injected by Supabase):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// Bumped on every meaningful change so the deployed build is identifiable.
const FUNCTION_VERSION = "2024-delete-user-3-email-fallback-debug";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface DeleteUserBody {
  user_id?: unknown;
  email?: unknown;
}

interface TargetProfile {
  id: string;
  base_role: string | null;
  company_id: string | null;
}

/** JSON response helper that always includes CORS headers. */
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
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
    console.error("[admin-delete-user] Missing required runtime env.");
    return json({ error: "Server is not configured." }, 500);
  }

  let body: DeleteUserBody;
  try {
    body = (await req.json()) as DeleteUserBody;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

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
  // TEMP DEBUG: confirm the function is invoked and which path will be taken.
  console.log("[admin-delete-user] request received", {
    functionVersion: FUNCTION_VERSION,
    userId,
    validUuid: hasValidUuid,
    email,
    validEmail: hasValidEmail,
    path: hasValidUuid ? "id" : hasValidEmail ? "email-fallback" : "none",
  });

  if (!hasValidUuid && !hasValidEmail) {
    return json(
      { error: "A valid user_id (UUID) or email is required." },
      400,
    );
  }

  // Privileged admin client. NEVER returned to the browser.
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── Authorization ────────────────────────────────────────────────────────
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

  if (!callerIsSuperAdmin && !callerIsCompanyAdmin) {
    console.warn("[admin-delete-user] authorization denied (not an active admin)", {
      functionVersion: FUNCTION_VERSION,
      callerId,
      callerBaseRole,
      callerStatus,
    });
    return json(
      {
        error:
          "Not authorized to delete users. Your signed-in profile must be an " +
          "active super_admin or company_admin.",
        code: "not_authorized",
        functionVersion: FUNCTION_VERSION,
      },
      401,
    );
  }

  // ── Resolve the target profile ─────────────────────────────────────────────
  // Two paths: explicit UUID, or email fallback for legacy users whose local
  // record has no usable auth UUID. The email path resolves to EXACTLY ONE
  // profile or fails safely.
  let targetProfile: TargetProfile | null = null;
  let resolvedUserId = "";

  if (hasValidUuid) {
    resolvedUserId = userId;
    const { data, error: targetError } = await admin
      .from("profiles")
      .select("id, base_role, company_id")
      .eq("id", userId)
      .maybeSingle();
    if (targetError) {
      console.error("[admin-delete-user] Could not read target profile by id.", targetError);
      return json({ error: "Could not verify the target user." }, 500);
    }
    targetProfile = (data as TargetProfile | null) ?? null;
  } else {
    // Email fallback. Find every profile that matches the email so we can refuse
    // to guess when there is ambiguity.
    const { data: matches, error: matchError } = await admin
      .from("profiles")
      .select("id, base_role, company_id")
      .ilike("email", email);
    if (matchError) {
      console.error("[admin-delete-user] Email lookup failed.", matchError);
      return json({ error: "Could not look up the user by email." }, 500);
    }
    const rows = (matches as TargetProfile[] | null) ?? [];
    console.log("[admin-delete-user] email fallback lookup", {
      functionVersion: FUNCTION_VERSION,
      email,
      matchCount: rows.length,
    });
    if (rows.length === 0) {
      // No Supabase profile holds this email — it is already free for reuse.
      console.warn("[admin-delete-user] No profile for email; email already free.", {
        email,
      });
      return json(
        {
          ok: true,
          email,
          alreadyAbsent: true,
          via: "email",
          functionVersion: FUNCTION_VERSION,
        },
        200,
      );
    }
    if (rows.length > 1) {
      // Ambiguous — never guess which account to delete.
      console.error("[admin-delete-user] Multiple profiles share the email; refusing.", {
        email,
        matchCount: rows.length,
      });
      return json(
        {
          error:
            "Multiple accounts share this email address. Resolve the conflict " +
            "manually before deleting.",
          code: "email_conflict",
          matchCount: rows.length,
          functionVersion: FUNCTION_VERSION,
        },
        409,
      );
    }
    targetProfile = rows[0];
    resolvedUserId = rows[0].id;
  }

  // Prevent self-deletion as a safety backstop (the app also blocks this).
  if (callerId && callerId === resolvedUserId) {
    return json({ error: "You cannot delete your own account." }, 403);
  }

  // Company Admin scope: may only delete non-super-admins in their own company.
  if (!callerIsSuperAdmin && callerIsCompanyAdmin && targetProfile) {
    if (targetProfile.base_role === "super_admin") {
      return json(
        { error: "Company admins cannot delete Super Admin accounts." },
        403,
      );
    }
    if (!callerCompanyId || targetProfile.company_id !== callerCompanyId) {
      return json(
        { error: "Company admins can only delete users in their own company." },
        403,
      );
    }
  }

  // ── Delete the auth user (cascades to the profile) ─────────────────────────
  const { error: deleteError } = await admin.auth.admin.deleteUser(resolvedUserId);
  if (deleteError) {
    // Treat "user not found" as already-deleted (idempotent success): the email
    // is released either way, which is the caller's goal.
    const message = (deleteError.message ?? "").toLowerCase();
    const notFound =
      deleteError.status === 404 ||
      message.includes("not found") ||
      message.includes("user not found");
    if (notFound) {
      console.warn("[admin-delete-user] User already absent; treating as deleted.", {
        userId: resolvedUserId,
      });
      return json(
        {
          ok: true,
          userId: resolvedUserId,
          alreadyAbsent: true,
          via: hasValidUuid ? "id" : "email",
          functionVersion: FUNCTION_VERSION,
        },
        200,
      );
    }
    console.error("[admin-delete-user] Delete failed.", deleteError);
    return json({ error: deleteError.message }, 400);
  }

  console.log("[admin-delete-user] Deleted auth user (profile cascaded).", {
    functionVersion: FUNCTION_VERSION,
    callerId,
    userId: resolvedUserId,
    via: hasValidUuid ? "id" : "email",
  });

  return json(
    {
      ok: true,
      userId: resolvedUserId,
      via: hasValidUuid ? "id" : "email",
      functionVersion: FUNCTION_VERSION,
    },
    200,
  );
});
