// =============================================================================
//  COMPANY ADMIN PROVISIONING UTILITY  —  ADMIN-ONLY / TRUSTED MACHINE ONLY
// =============================================================================
//
//  ⚠️  WARNING — READ BEFORE USING  ⚠️
//
//  This is a controlled admin helper that provisions a real **Company Admin**
//  account so it exists in BOTH sources of truth:
//
//      Supabase Auth (auth.users)  +  public.profiles
//
//  Admin login now requires a real Supabase Auth identity. Legacy/localStorage
//  admin accounts are no longer valid. Use this once per Company Admin to create
//  (or repair) their Supabase Auth user and matching profile.
//
//  HARD SAFETY RULES (enforced below):
//    • Uses the Supabase Admin API + PostgREST with the service_role key.
//    • The service_role key is read ONLY from an environment variable at runtime
//      — it is NEVER hardcoded, written to disk, logged, or committed.
//    • Requires an EXPLICIT email, temporary password, and company identifier.
//    • Requires an EXPLICIT `--confirm` flag, so it can NEVER write automatically.
//    • Provisions base_role = 'company_admin' ONLY. It refuses to create
//      super_admins (that path stays manual / separate by design).
//    • Resolves the company UUID up front and FAILS SAFELY if it is missing or
//      invalid — it never invents a company_id.
//    • Idempotent: re-running for the same email reuses the existing Auth user
//      and updates (not duplicates) the profiles row.
//    • Does NOT weaken Edge Function authorization or restore demo-admin login.
//
//  This tool is for controlled admin provisioning ONLY. Do NOT wire it into any
//  user flow, CI step, or server endpoint.
//
// -----------------------------------------------------------------------------
//  Usage (run from the web-cleanops folder, Node 18+ for built-in fetch):
//
//    SUPABASE_URL="https://<PROJECT_REF>.supabase.co" \
//    SERVICE_ROLE_KEY="<service_role_secret>" \
//    node scripts/create-company-admin.mjs \
//      --email admin@example.com \
//      --password "<temporary-password>" \
//      --company <company-uuid-or-legacy-id> \
//      --confirm
//
//  Run it once, then close the terminal. Never paste the service_role key into
//  any file. Never commit secrets.
// =============================================================================

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY;

// --- Minimal flag parser (supports --key value and --key=value) --------------
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const eq = token.indexOf("=");
    if (eq !== -1) {
      args[token.slice(2, eq)] = token.slice(eq + 1);
    } else {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true; // boolean flag
      }
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const email = typeof args.email === "string" ? args.email.trim() : "";
const tempPassword = typeof args.password === "string" ? args.password : "";
const company = typeof args.company === "string" ? args.company.trim() : "";
const fullName = typeof args.name === "string" ? args.name.trim() : null;
const confirmed = args.confirm === true || args.confirm === "true";
const dryRun = args["dry-run"] === true || args["dry-run"] === "true";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function usageAndExit(message) {
  if (message) console.error(`\n❌  ${message}\n`);
  console.error(
    "Usage:\n" +
      '  SUPABASE_URL="https://<ref>.supabase.co" \\\n' +
      '  SERVICE_ROLE_KEY="<service_role_secret>" \\\n' +
      "  node scripts/create-company-admin.mjs \\\n" +
      "    --email <email> \\\n" +
      '    --password "<temporary-password>" \\\n' +
      "    --company <company-uuid-or-legacy-id> \\\n" +
      "    [--name \"<full name>\"] \\\n" +
      "    (--confirm | --dry-run)\n",
  );
  process.exit(1);
}

// --- Guardrails ---------------------------------------------------------------

if (!supabaseUrl || !serviceRoleKey) {
  usageAndExit(
    "Missing SUPABASE_URL or SERVICE_ROLE_KEY environment variables. " +
      "The service_role key must be supplied via the environment, never hardcoded.",
  );
}

if (!email) usageAndExit("An explicit --email is required.");
if (!tempPassword) usageAndExit("An explicit --password (temporary) is required.");
if (tempPassword.length < 8) {
  usageAndExit("Temporary password must be at least 8 characters.");
}
if (!company) {
  usageAndExit(
    "An explicit --company is required (a Supabase company UUID or a legacy id such as 'cmp_nordlys').",
  );
}
if (!confirmed && !dryRun) {
  usageAndExit(
    "Refusing to provision without the explicit --confirm flag. " +
      "This safeguard prevents accidental writes. Re-run with --confirm once sure, " +
      "or use --dry-run to preview without writing.",
  );
}

const authHeaders = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  "Content-Type": "application/json",
};

const restHeaders = {
  ...authHeaders,
  Prefer: "return=representation",
};

/** Resolves a company by UUID (id) or by legacy_id; returns the row or null. */
async function resolveCompany(identifier) {
  const column = UUID_RE.test(identifier) ? "id" : "legacy_id";
  const url =
    `${supabaseUrl}/rest/v1/companies` +
    `?${column}=eq.${encodeURIComponent(identifier)}` +
    `&select=id,legacy_id,name,status`;
  const res = await fetch(url, { headers: restHeaders });
  if (!res.ok) {
    throw new Error(`Company lookup failed (${res.status}): ${await res.text()}`);
  }
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

/** Finds an existing auth user by email via the paginated admin list endpoint. */
async function findAuthUserByEmail(targetEmail) {
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=200`,
      { headers: authHeaders },
    );
    if (!res.ok) {
      throw new Error(`List users failed (${res.status}): ${await res.text()}`);
    }
    const data = await res.json();
    const users = data.users ?? [];
    const match = users.find(
      (u) => (u.email ?? "").toLowerCase() === targetEmail.toLowerCase(),
    );
    if (match) return match;
    if (users.length < 200) break; // no more pages
  }
  return null;
}

/** Creates a confirmed auth user with the temporary password (no email sent). */
async function createAuthUser(targetEmail, password) {
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ email: targetEmail, password, email_confirm: true }),
  });
  if (!res.ok) {
    throw new Error(`Create auth user failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

/** Sets the temporary password + confirms the email on an existing user. */
async function updateAuthPassword(userId, password) {
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    headers: authHeaders,
    body: JSON.stringify({ password, email_confirm: true }),
  });
  if (!res.ok) {
    throw new Error(`Update auth user failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

/** Fetches an existing profile row by id (== auth user id), or null. */
async function findProfileById(userId) {
  const url =
    `${supabaseUrl}/rest/v1/profiles` +
    `?id=eq.${encodeURIComponent(userId)}` +
    `&select=id,company_id,base_role,status,email,full_name`;
  const res = await fetch(url, { headers: restHeaders });
  if (!res.ok) {
    throw new Error(`Profile lookup failed (${res.status}): ${await res.text()}`);
  }
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

/**
 * Upserts the company_admin profile row keyed on id (== auth user id).
 * Idempotent: inserts when missing, updates the admin-relevant fields otherwise.
 */
async function upsertProfile(userId, companyId, existingProfile) {
  const payload = {
    id: userId,
    company_id: companyId,
    base_role: "company_admin",
    status: "active",
    email,
    ...(fullName ? { full_name: fullName } : {}),
  };

  if (existingProfile) {
    const url = `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: restHeaders,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`Profile update failed (${res.status}): ${await res.text()}`);
    }
    return { row: (await res.json())[0], action: "updated" };
  }

  const res = await fetch(`${supabaseUrl}/rest/v1/profiles`, {
    method: "POST",
    headers: restHeaders,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Profile insert failed (${res.status}): ${await res.text()}`);
  }
  return { row: (await res.json())[0], action: "created" };
}

async function main() {
  if (dryRun) {
    console.log("🧪  DRY RUN — no writes will be made to Supabase.");
  } else {
    console.log("⚠️  ADMIN-ONLY Company Admin provisioning (no email will be sent).");
  }
  console.log(`👤  Email   : ${email}`);
  console.log(`🏢  Company : ${company}`);

  // 1. Resolve company FIRST so we never create an Auth user for an invalid one.
  const companyRow = await resolveCompany(company);
  if (!companyRow) {
    console.error(
      `❌  No company found for '${company}'. Provide a valid Supabase company ` +
        "UUID or an existing legacy id (e.g. 'cmp_nordlys'). Aborting — no Auth " +
        "user or profile was created.",
    );
    process.exit(1);
  }
  if (companyRow.status !== "active") {
    console.error(
      `❌  Company '${companyRow.name}' is '${companyRow.status}', not 'active'. ` +
        "Refusing to provision a Company Admin for a non-active company.",
    );
    process.exit(1);
  }
  console.log(
    `✅  Company resolved: ${companyRow.name} (id=${companyRow.id}` +
      `${companyRow.legacy_id ? `, legacy_id=${companyRow.legacy_id}` : ""}).`,
  );

  // --- DRY RUN: report intended behavior, then exit without any writes. -------
  if (dryRun) {
    const existingAuthUser = await findAuthUserByEmail(email);
    const existingProfile = existingAuthUser
      ? await findProfileById(existingAuthUser.id)
      : null;

    console.log("\n🧪  Dry-run summary (no changes were made):");
    console.log(`    Company id     : ${companyRow.id}`);
    console.log(`    Company name   : ${companyRow.name ?? "(unknown)"}`);
    console.log(`    Company status : ${companyRow.status}`);

    if (existingAuthUser) {
      console.log(`    Auth user      : EXISTS (UID: ${existingAuthUser.id})`);
      console.log("    Would do       : update temporary password + confirm email");
    } else {
      console.log("    Auth user      : does NOT exist");
      console.log("    Would do       : create a confirmed Auth user");
    }

    if (!existingAuthUser) {
      console.log("    Profile        : not checked (depends on new Auth user id)");
      console.log("    Would do       : create a company_admin profile");
    } else if (existingProfile) {
      console.log(
        `    Profile        : EXISTS (base_role=${existingProfile.base_role}, ` +
          `status=${existingProfile.status}, company_id=${existingProfile.company_id})`,
      );
      if (existingProfile.base_role === "super_admin") {
        console.log(
          "    Would do       : ABORT — profile is super_admin; this tool refuses to downgrade it",
        );
      } else {
        console.log(
          `    Would do       : update profile (base_role=company_admin, status=active, company_id=${companyRow.id})`,
        );
      }
    } else {
      console.log("    Profile        : does NOT exist");
      console.log(
        `    Would do       : create profile (base_role=company_admin, status=active, company_id=${companyRow.id})`,
      );
    }

    console.log("\n✅  Dry run complete. Re-run with --confirm (without --dry-run) to apply.");
    return;
  }

  // 2. Create or locate the Auth user (no duplicates).
  let authUser = await findAuthUserByEmail(email);
  if (authUser) {
    console.log(`ℹ️   Auth user already exists (UID: ${authUser.id}). Reusing it.`);
    console.log("🔑  Setting the temporary password + confirming the email ...");
    await updateAuthPassword(authUser.id, tempPassword);
  } else {
    console.log("➕  No existing Auth user — creating a confirmed one ...");
    authUser = await createAuthUser(email, tempPassword);
    console.log(`✅  Auth user created (UID: ${authUser.id}).`);
  }

  // 3. Upsert the matching profile (idempotent).
  const existingProfile = await findProfileById(authUser.id);
  if (existingProfile && existingProfile.base_role === "super_admin") {
    console.error(
      `❌  Profile ${authUser.id} is a super_admin. This tool only provisions ` +
        "company_admin and refuses to downgrade a super_admin. Aborting.",
    );
    process.exit(1);
  }

  const { row, action } = await upsertProfile(
    authUser.id,
    companyRow.id,
    existingProfile,
  );

  console.log(`✅  Profile ${action}:`);
  console.log(
    `    id=${row.id} base_role=${row.base_role} status=${row.status} ` +
      `company_id=${row.company_id}`,
  );

  console.log("\n🎉  Company Admin provisioned successfully.");
  console.log("➡️   They can now log in with this email + the temporary password.");
  console.log(
    "🔁  Ask them to rotate the temporary password once Custom SMTP recovery is set up.",
  );
}

main().catch((err) => {
  console.error(`❌  ${err?.message ?? err}`);
  process.exit(1);
});
