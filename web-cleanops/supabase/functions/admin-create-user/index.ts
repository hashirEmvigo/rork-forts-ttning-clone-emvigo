// ============================================================================
// CleanOps — Step 2B.4: SAFE USER CREATION PATH (Supabase Edge Function)
// ============================================================================
//
// This function is the ONLY place the service_role key is ever used. It is
// never exposed to the browser. The browser calls this function; the function
// holds the privileged key (injected by Supabase as SUPABASE_SERVICE_ROLE_KEY).
//
// Responsibilities
//   1. CORS + method handling.
//   2. Validate input (mirrors the fail-closed rules in migration 0004).
//   3. Authorize the caller:
//        a) Authenticated mode — caller presents a valid Supabase Auth JWT that
//           resolves to a `profiles` row with base_role = 'super_admin'.
//        b) Bootstrap mode — when there is NO active super_admin profile yet,
//           allow creating the VERY FIRST super_admin without a JWT. This path
//           is self-closing: once an active super_admin profile exists it can
//           never be used again. When the secret BOOTSTRAP_SUPER_ADMIN_EMAIL is
//           set, the bootstrapped email must match.
//   4. Create the user with provisioning metadata (base_role / company_id /
//      full_name). The 0004 trigger then creates exactly one matching profile
//      in the SAME transaction. Two creation modes:
//        a) Invite mode (DEFAULT, long-term): `auth.admin.inviteUserByEmail`
//           emails an invite link; the invitee sets their own password.
//        b) Temp-password mode (INTERIM, verification only): when the caller
//           passes a `temp_password`, we use `auth.admin.createUser` with
//           `email_confirm: true` so the user can sign in immediately with that
//           password. This is only for login verification while SMTP / invite
//           email delivery is still being configured. The password travels over
//           HTTPS to this function; the service_role key never leaves it.
//   5. Rollback (safe, targeted): we ONLY ever delete an auth user that this
//      exact request created (we keep its id). We NEVER search by email and
//      delete a match — doing so would destroy a pre-existing account when a
//      duplicate-email error occurs. Duplicate emails return a clear 409.
//
// Orphan prevention
//   * Orphan auth user (no profile): impossible — the 0004 trigger fires in the
//     same transaction and rolls the auth user back if provisioning fails.
//   * Orphan profile (no auth user): impossible — profiles are only created by
//     the trigger, which runs off auth.users.
//
// No password is handled here or in the browser. Invitees set their own
// password through the emailed invite link.
//
// Required runtime env (auto-injected by Supabase):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// Optional secrets (set with `supabase secrets set ...`):
//   BOOTSTRAP_SUPER_ADMIN_EMAIL   — locks bootstrap to a single email
//   INVITE_REDIRECT_URL           — where the invite link sends the user
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const ALLOWED_ROLES = ["super_admin", "company_admin", "employee", "customer"] as const;
type BaseRole = (typeof ALLOWED_ROLES)[number];

// Bumped on every meaningful change so the deployed build is identifiable in
// logs and in the success/error responses. If this value is NOT present in the
// runtime logs (or the response), the OLD function is still deployed.
const FUNCTION_VERSION = "2025-staffid-1";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface CreateUserBody {
  email?: unknown;
  base_role?: unknown;
  company_id?: unknown;
  full_name?: unknown;
  temp_password?: unknown;
  redirect_to?: unknown;
}

interface ValidatedInput {
  email: string;
  baseRole: BaseRole;
  companyId: string | null;
  fullName: string | null;
  /** Optional admin-supplied temporary password (interim login verification). */
  tempPassword: string | null;
  /** Optional caller-supplied invite redirect URL (must be a valid http(s) URL). */
  redirectTo: string | null;
}

/** Minimum length for an admin-supplied temporary password. */
const MIN_TEMP_PASSWORD_LENGTH = 8;

/** JSON response helper that always includes CORS headers. */
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/**
 * Detects whether an invite error means the email is already registered.
 * GoTrue surfaces this as code "email_exists" / status 422, or a message that
 * mentions the address is already registered. We treat any of these as a
 * duplicate so we can return a clean 409 WITHOUT touching the existing user.
 */
function isDuplicateEmailError(err: {
  code?: string;
  status?: number;
  message?: string;
} | null): boolean {
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

/**
 * Assigns a durable, company-scoped Staff ID (NUM-1 Phase 3) to a freshly
 * provisioned company-scoped profile (company_admin / employee).
 *
 * The Staff ID comes from the SAME `allocate_number` authority the rest of the
 * app uses. It is allocated through a CALLER-SCOPED client (the caller's JWT) so
 * the RPC sees a real `auth.uid()` and its per-tenant authorization holds: a
 * company admin may allocate for their own company; a super admin may allocate
 * for any. The bare integer is then written onto the profile with the service
 * role. super_admins have no company and therefore receive no company staff
 * number (callers must skip them before calling this).
 *
 * Returns `{ ok: true, staffNumber }` or `{ ok: false, error }`; the caller
 * fails closed (rolls the user back) on `ok: false`.
 */
async function assignStaffNumber(params: {
  // deno-lint-ignore no-explicit-any
  admin: any;
  supabaseUrl: string;
  anonKey: string;
  bearer: string;
  userId: string;
  companyUuid: string;
}): Promise<{ ok: true; staffNumber: number } | { ok: false; error: string }> {
  const { admin, supabaseUrl, anonKey, bearer, userId, companyUuid } = params;

  // Resolve the company legacy id — the allocator's company scope key.
  const { data: company, error: companyError } = await admin
    .from("companies")
    .select("legacy_id")
    .eq("id", companyUuid)
    .maybeSingle();
  if (companyError) return { ok: false, error: companyError.message };
  const scope = ((company?.legacy_id as string | undefined) ?? "").trim();
  if (!scope) return { ok: false, error: "Company has no legacy id for staff allocation." };

  // A caller token is required so allocate_number sees auth.uid(). Company-scoped
  // creations are always authenticated (company_admin or super_admin).
  if (!bearer) return { ok: false, error: "Missing caller token for staff allocation." };
  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: issued, error: allocError } = await caller.rpc("allocate_number", {
    p_company_scope: scope,
    p_entity_kind: "staff",
  });
  if (allocError) return { ok: false, error: allocError.message };
  const staffNumber = Number(issued);
  if (!Number.isInteger(staffNumber) || staffNumber < 1) {
    return { ok: false, error: `Allocator returned an invalid staff number: ${String(issued)}` };
  }

  // Persist the bare integer onto the just-provisioned profile (service role).
  const { error: updateError } = await admin
    .from("profiles")
    .update({ staff_number: staffNumber })
    .eq("id", userId);
  if (updateError) return { ok: false, error: updateError.message };

  return { ok: true, staffNumber };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates and normalises the request body, mirroring the 0004 trigger rules. */
function validate(body: CreateUserBody): { input?: ValidatedInput; error?: string } {
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) {
    return { error: "A valid email is required." };
  }

  const baseRoleRaw = typeof body.base_role === "string" ? body.base_role.trim() : "";
  if (!ALLOWED_ROLES.includes(baseRoleRaw as BaseRole)) {
    return { error: "base_role must be one of: " + ALLOWED_ROLES.join(", ") + "." };
  }
  const baseRole = baseRoleRaw as BaseRole;

  const companyRaw =
    typeof body.company_id === "string" && body.company_id.trim() !== ""
      ? body.company_id.trim()
      : null;

  if (baseRole === "super_admin") {
    if (companyRaw !== null) {
      return { error: "A super_admin must not have a company_id." };
    }
  } else {
    if (companyRaw === null) {
      return { error: `company_id is required for role "${baseRole}".` };
    }
    if (!UUID_RE.test(companyRaw)) {
      return { error: "company_id must be a valid UUID." };
    }
  }

  const fullName =
    typeof body.full_name === "string" && body.full_name.trim() !== ""
      ? body.full_name.trim()
      : null;

  let tempPassword: string | null = null;
  if (body.temp_password !== undefined && body.temp_password !== null) {
    if (typeof body.temp_password !== "string") {
      return { error: "temp_password must be a string." };
    }
    const pw = body.temp_password;
    if (pw.length < MIN_TEMP_PASSWORD_LENGTH) {
      return {
        error: `Temporary password must be at least ${MIN_TEMP_PASSWORD_LENGTH} characters.`,
      };
    }
    tempPassword = pw;
  }

  // Optional redirect URL for the invite link. Only accept a well-formed
  // http(s) URL; GoTrue still enforces its own allow-list, so a bad value here
  // simply falls back to the server default rather than breaking the request.
  let redirectTo: string | null = null;
  if (typeof body.redirect_to === "string" && body.redirect_to.trim() !== "") {
    const candidate = body.redirect_to.trim();
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        redirectTo = candidate;
      }
    } catch {
      // Ignore malformed URLs — fall back to INVITE_REDIRECT_URL below.
    }
  }

  return {
    input: { email, baseRole, companyId: companyRaw, fullName, tempPassword, redirectTo },
  };
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
    console.error("[admin-create-user] Missing required runtime env.");
    return json({ error: "Server is not configured." }, 500);
  }

  let body: CreateUserBody;
  try {
    body = (await req.json()) as CreateUserBody;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const { input, error: validationError } = validate(body);
  if (!input) {
    return json({ error: validationError }, 400);
  }

  // Privileged admin client. NEVER returned to the browser.
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── Authorization ────────────────────────────────────────────────────────
  // Try to resolve a real Supabase Auth user from the caller's bearer token.
  // The browser also sends the public anon key as a bearer; that resolves to no
  // user, so it can never be mistaken for an authenticated caller.
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
      callerIsSuperAdmin =
        callerProfile?.base_role === "super_admin" && isActive;
      callerIsCompanyAdmin =
        callerProfile?.base_role === "company_admin" && isActive;
      callerCompanyId =
        (callerProfile?.company_id as string | undefined) ?? null;
    }
  }

  // Diagnostic log (no secrets). Lets us confirm via `fetchProjectLogs` exactly
  // which caller and authorization branch handled the request, and that the NEW
  // build is deployed (FUNCTION_VERSION).
  console.log("[admin-create-user] authz diagnostics", {
    functionVersion: FUNCTION_VERSION,
    callerId,
    callerBaseRole,
    callerStatus,
    callerCompanyId,
    targetCompanyId: input.companyId,
    targetBaseRole: input.baseRole,
    bearerIsAnon: bearer === anonKey,
    hasBearer: Boolean(bearer),
  });

  // ── Company Admin authorization ────────────────────────────────────────────
  // A Company Admin may create logins ONLY for their own company, and only for
  // non-super-admin roles. Same-company is enforced by comparing the resolved
  // target company_id (a real UUID, already validated above) against the
  // caller's own profile company_id. Super Admin protections are preserved:
  // a Company Admin can never create a super_admin, and can never target a
  // different company.
  if (!callerIsSuperAdmin && callerIsCompanyAdmin) {
    if (input.baseRole === "super_admin") {
      return json(
        { error: "Company admins cannot create Super Admin accounts." },
        403,
      );
    }
    if (!callerCompanyId) {
      return json(
        { error: "Your admin account is not linked to a company." },
        403,
      );
    }
    if (input.companyId !== callerCompanyId) {
      return json(
        { error: "Company admins can only create users for their own company." },
        403,
      );
    }
    console.log("[admin-create-user] authorized via company_admin branch", {
      functionVersion: FUNCTION_VERSION,
      callerId,
      companyId: input.companyId,
    });
    // Authorized company-admin creation within their own company.
  } else if (callerIsSuperAdmin) {
    console.log("[admin-create-user] authorized via super_admin branch", {
      functionVersion: FUNCTION_VERSION,
      callerId,
    });
  } else {
    // Bootstrap mode: only when NO active super_admin profile exists yet, and
    // only to create the first super_admin. Self-closing — fails permanently
    // once an active super_admin profile exists.
    const { count, error: countError } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("base_role", "super_admin")
      .eq("status", "active");

    if (countError) {
      console.error("[admin-create-user] Failed to count super_admin profiles.", countError);
      return json({ error: "Authorization check failed." }, 500);
    }

    const noSuperAdminYet = (count ?? 0) === 0;
    if (!noSuperAdminYet) {
      // Specific diagnostic so the client error alone proves the NEW build is
      // deployed and shows WHY authorization fell through (e.g. the caller's
      // profile is not an active company_admin/super_admin).
      console.warn("[admin-create-user] authorization denied (no matching branch)", {
        functionVersion: FUNCTION_VERSION,
        callerId,
        callerBaseRole,
        callerStatus,
        callerCompanyId,
      });
      const detail =
        "resolved base_role=" + (callerBaseRole ?? "none") +
        ", status=" + (callerStatus ?? "none") +
        ", company_id=" + (callerCompanyId ?? "none");
      return json(
        {
          error:
            "Not authorized to create users. Your signed-in profile must be an " +
            "active super_admin, or an active company_admin creating a user for " +
            "their own company. (" + detail + ")",
          code: "not_authorized",
          functionVersion: FUNCTION_VERSION,
        },
        401,
      );
    }
    if (input.baseRole !== "super_admin") {
      return json(
        { error: "Bootstrap only allows creating the first Super Admin." },
        401,
      );
    }
    const expectedEmail = Deno.env.get("BOOTSTRAP_SUPER_ADMIN_EMAIL")?.trim().toLowerCase();
    if (expectedEmail && expectedEmail !== input.email) {
      return json(
        { error: "Bootstrap is locked to a different email address." },
        401,
      );
    }
    console.warn(
      "[admin-create-user] Bootstrap mode: creating the first super_admin.",
      { email: input.email },
    );
  }

  // ── Pre-existence guard (fixes the temp-password duplicate gotcha) ─────────
  // `inviteUserByEmail` reliably returns a duplicate error, but
  // `auth.admin.createUser` (temp-password mode) can SILENTLY return the
  // pre-existing user with no error — which previously made a duplicate look
  // like a successful creation. Before creating anything, check whether a
  // profile already exists for this email (the 0004 trigger always mirrors the
  // auth email into profiles.email, so this is an authoritative existence
  // check). If found, reject with a clean 409 and create/delete nothing.
  const { data: existingProfile, error: existingError } = await admin
    .from("profiles")
    .select("id, base_role, status, company_id")
    .ilike("email", input.email)
    .maybeSingle();

  // TEMP DEBUG: surface exactly what the duplicate pre-check sees, so a stale
  // profile (auth user not actually deleted) is immediately visible in logs.
  console.log("[admin-create-user] duplicate pre-check", {
    email: input.email,
    foundExistingProfile: Boolean(existingProfile),
    existingProfile: existingProfile ?? null,
  });

  if (existingError) {
    console.error("[admin-create-user] Duplicate pre-check failed.", existingError);
    return json({ error: "Could not verify whether the email is already in use." }, 500);
  }
  if (existingProfile) {
    console.warn("[admin-create-user] Duplicate email rejected by pre-check (no creation).", {
      email: input.email,
      existingProfileId: existingProfile.id,
    });
    return json(
      { error: "A user with this email address already exists.", code: "email_exists" },
      409,
    );
  }

  // ── Create the user (the 0004 trigger provisions the profile) ──────────────
  const metadata: Record<string, string> = { base_role: input.baseRole };
  if (input.companyId) metadata.company_id = input.companyId;
  if (input.fullName) metadata.full_name = input.fullName;

  // Prefer the caller-supplied redirect (the live app origin + /accept-invite)
  // so invites resolve to the dedicated activation route regardless of server env configuration;
  // fall back to the INVITE_REDIRECT_URL secret when none was provided.
  const redirectTo =
    input.redirectTo ?? (Deno.env.get("INVITE_REDIRECT_URL")?.trim() || undefined);

  // Two creation modes (see header). Temp-password mode lets the new user sign
  // in immediately; invite mode emails a link for them to set their own.
  const usingTempPassword = input.tempPassword !== null;
  const { data: created, error: inviteError } = usingTempPassword
    ? await admin.auth.admin.createUser({
        email: input.email,
        password: input.tempPassword as string,
        email_confirm: true,
        user_metadata: metadata,
      })
    : await admin.auth.admin.inviteUserByEmail(input.email, {
        data: metadata,
        redirectTo,
      });

  if (inviteError) {
    // IMPORTANT: do NOT search by email and delete. On an error the invite did
    // not create a user for us (or the email already exists), so there is
    // nothing this request is responsible for cleaning up. Deleting a matching
    // account here would destroy a pre-existing user — exactly the data-loss
    // bug we are fixing.
    if (isDuplicateEmailError(inviteError)) {
      console.warn("[admin-create-user] Duplicate email rejected (no deletion).", {
        email: input.email,
      });
      return json(
        { error: "A user with this email address already exists.", code: "email_exists" },
        409,
      );
    }
    console.error("[admin-create-user] Invite failed (no user created).", inviteError);
    return json({ error: inviteError.message }, 400);
  }

  // Defense-in-depth for temp-password mode: even though the pre-check above
  // should have caught duplicates, `auth.admin.createUser` returns an EMPTY
  // `identities` array when it hands back a pre-existing user instead of
  // creating a new one. Treat that as a duplicate and do NOT delete the user
  // (it was not created by this request).
  if (usingTempPassword && created.user) {
    const identities = created.user.identities;
    const isPreExisting = Array.isArray(identities) && identities.length === 0;
    if (isPreExisting) {
      console.warn("[admin-create-user] Duplicate email detected post-create (no deletion).", {
        email: input.email,
      });
      return json(
        { error: "A user with this email address already exists.", code: "email_exists" },
        409,
      );
    }
  }

  // The auth user this request created. This — and only this — id is eligible
  // for rollback below.
  const createdUserId = created.user?.id ?? null;

  // Confirm the profile was auto-provisioned by the 0004 trigger (read-back).
  let profileCreated = false;
  if (createdUserId) {
    const { data: profile } = await admin
      .from("profiles")
      .select("id, company_id, base_role, status")
      .eq("id", createdUserId)
      .maybeSingle();
    profileCreated = Boolean(profile);
  }

  // Targeted rollback: invite succeeded but the matching profile is missing.
  // We delete ONLY the user this request just created (by its known id), never
  // by an email lookup. This prevents an orphaned auth user with no profile.
  if (createdUserId && !profileCreated) {
    try {
      await admin.auth.admin.deleteUser(createdUserId);
      console.warn("[admin-create-user] Rolled back the user created this request (no profile).", {
        userId: createdUserId,
      });
    } catch (cleanupErr) {
      console.error("[admin-create-user] Targeted rollback failed.", cleanupErr);
    }
    return json(
      { error: "User provisioning failed and was rolled back. Please try again." },
      500,
    );
  }

  const userId = createdUserId;

  // ── Staff ID allocation (NUM-1 Phase 3) ────────────────────────────────────
  // Company-scoped staff/admin logins (company_admin / employee) get a durable
  // company-scoped Staff ID from the shared allocator so the Employees/Team page
  // can show a clean numeric Staff ID for them. Fail closed: if a company-scoped
  // profile cannot be given a Staff ID, roll back the user THIS request created so
  // no company staff profile ever exists without one. super_admins are skipped
  // (no company → no company staff number).
  let assignedStaffNumber: number | null = null;
  if (userId && input.companyId && input.baseRole !== "super_admin") {
    const staffResult = await assignStaffNumber({
      admin,
      supabaseUrl,
      anonKey,
      bearer,
      userId,
      companyUuid: input.companyId,
    });
    if (!staffResult.ok) {
      try {
        await admin.auth.admin.deleteUser(userId);
        console.warn("[admin-create-user] Rolled back user (Staff ID not assigned).", {
          userId,
          reason: staffResult.error,
        });
      } catch (cleanupErr) {
        console.error("[admin-create-user] Rollback after Staff ID failure failed.", cleanupErr);
      }
      return json(
        {
          error:
            "User created but Staff ID assignment failed and was rolled back. Please try again.",
        },
        500,
      );
    }
    assignedStaffNumber = staffResult.staffNumber;
  }

  return json(
    {
      ok: true,
      userId,
      email: input.email,
      baseRole: input.baseRole,
      companyId: input.companyId,
      profileCreated,
      staffNumber: assignedStaffNumber,
      // `invited` is true for the emailed-invite flow; false when an admin temp
      // password was set (the user can sign in immediately).
      invited: !usingTempPassword,
      tempPasswordSet: usingTempPassword,
      functionVersion: FUNCTION_VERSION,
    },
    200,
  );
});
