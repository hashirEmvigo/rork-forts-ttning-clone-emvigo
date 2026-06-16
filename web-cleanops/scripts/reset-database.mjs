// =============================================================================
//  ADMIN-ONLY DATABASE RESET  —  Super-Admin-preserving  —  TESTING ONLY
// =============================================================================
//
//  ⚠️  DESTRUCTIVE. ⚠️  Wipes ALL company/test data and keeps ONLY the Super
//  Admin account(s) + the platform-global config the app needs to boot.
//
//  This is the in-terminal, controlled equivalent of `reset-database.sql`. Use
//  it when you prefer a guarded CLI run over the SQL Editor. It follows the same
//  guardrail pattern as `set-temp-password.mjs` / `create-company-admin.mjs`:
//    • Uses the Supabase Admin API with the service_role key.
//    • The service_role key is read ONLY from an env var — never hardcoded,
//      written to disk, or committed.
//    • Requires an explicit `--confirm` flag for any write.
//    • `--dry-run` performs NO writes; it only reports what it would delete.
//    • ABORTS unless at least one ACTIVE super_admin profile exists.
//    • NEVER deletes a super_admin auth user or profile.
//
//  WHAT IT DOES (in dependency-safe order)
//    1. Deletes every NON-super-admin auth user (cascades their `profiles` row).
//       Also removes orphaned auth users with no profile (test artifacts),
//       never touching an email that belongs to a super_admin profile.
//    2. Deletes ALL companies — every company-scoped table references
//       companies(id) ON DELETE CASCADE, so this clears customers, employees,
//       teams, areas, postal cities, languages, roles(company), services,
//       time codes, work orders, visit occurrences, booking queue, company
//       settings/modules/checklists/protocols/media, company entitlements, etc.
//    3. Clears platform-level append-only logs that referenced deleted
//       companies (activity_events, entitlement_activity_log,
//       service_entitlement_log, audit_events).
//
//  WHAT IT PRESERVES
//    • super_admin auth users + profiles.
//    • Platform-global config (company_id IS NULL / no company link): modules,
//      module_categories, settings_templates, global roles/services/checklists,
//      global entitlements, system_settings. Development Center depends on these.
//
//  USAGE (run from the web-cleanops folder, Node 18+ for built-in fetch):
//
//    # Preview only — no writes:
//    SUPABASE_URL="https://<PROJECT_REF>.supabase.co" \
//    SERVICE_ROLE_KEY="<service_role_secret>" \
//    node scripts/reset-database.mjs --dry-run
//
//    # Real reset (preserves ALL super_admins):
//    SUPABASE_URL="https://<PROJECT_REF>.supabase.co" \
//    SERVICE_ROLE_KEY="<service_role_secret>" \
//    node scripts/reset-database.mjs --confirm
//
//    # Keep exactly ONE super admin (delete any other super_admins too):
//    ... node scripts/reset-database.mjs --confirm --keep-super-admin sebastian@stadalliansen.se
//
//  Never paste the service_role key into a file, commit, or chat.
// =============================================================================

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY;
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const confirmed = args.includes("--confirm");
const keepIdx = args.indexOf("--keep-super-admin");
const keepOnlyEmail =
  keepIdx >= 0 && args[keepIdx + 1] ? args[keepIdx + 1].toLowerCase() : null;

const LOG_TABLES = [
  "activity_events",
  "entitlement_activity_log",
  "service_entitlement_log",
  "audit_events",
];

function usageAndExit(message) {
  if (message) console.error(`\n❌  ${message}\n`);
  console.error(
    "Usage:\n" +
      '  SUPABASE_URL="https://<ref>.supabase.co" \\\n' +
      '  SERVICE_ROLE_KEY="<service_role_secret>" \\\n' +
      "  node scripts/reset-database.mjs [--dry-run | --confirm] [--keep-super-admin <email>]\n",
  );
  process.exit(1);
}

if (!supabaseUrl || !serviceRoleKey) {
  usageAndExit(
    "Missing SUPABASE_URL or SERVICE_ROLE_KEY environment variables. " +
      "The service_role key must be supplied via the environment, never hardcoded.",
  );
}
if (!dryRun && !confirmed) {
  usageAndExit(
    "Refusing to wipe data without an explicit --confirm flag. " +
      "Run with --dry-run first to preview, then re-run with --confirm.",
  );
}

const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  "Content-Type": "application/json",
};

/** Reads rows from a PostgREST table; returns [] on a missing-table error. */
async function rest(path) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers });
  if (!res.ok) {
    const body = await res.text();
    // 404 / undefined table → treat as empty so the script is resilient.
    if (res.status === 404 || body.includes("does not exist")) return [];
    throw new Error(`GET ${path} failed (${res.status}): ${body}`);
  }
  return res.json();
}

/** Deletes rows from a PostgREST table by filter. Resilient to missing tables. */
async function restDelete(path) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method: "DELETE",
    headers: { ...headers, Prefer: "return=representation" },
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 404 || body.includes("does not exist")) return [];
    throw new Error(`DELETE ${path} failed (${res.status}): ${body}`);
  }
  return res.json();
}

/** Lists every auth user (paginated admin endpoint). */
async function listAuthUsers() {
  const all = [];
  for (let page = 1; page <= 50; page++) {
    const res = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=200`,
      { headers },
    );
    if (!res.ok) {
      throw new Error(`List users failed (${res.status}): ${await res.text()}`);
    }
    const data = await res.json();
    const users = data.users ?? [];
    all.push(...users);
    if (users.length < 200) break;
  }
  return all;
}

async function deleteAuthUser(id) {
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${id}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Delete auth user ${id} failed (${res.status}): ${await res.text()}`);
  }
}

async function main() {
  console.log("⚠️  ADMIN-ONLY DATABASE RESET (Super-Admin-preserving).");
  console.log(dryRun ? "🧪  DRY RUN — no writes will be made.\n" : "🔥  LIVE RUN — data WILL be deleted.\n");

  // 1. Load profiles to classify super admins vs the rest.
  const profiles = await rest(
    "profiles?select=id,email,base_role,status,company_id",
  );
  const superAdmins = profiles.filter((p) => p.base_role === "super_admin");
  const activeSupers = superAdmins.filter((p) => p.status === "active");

  if (activeSupers.length === 0) {
    usageAndExit(
      "ABORT: no active super_admin profile found. Refusing to wipe (would lock you out).",
    );
  }

  // Determine which super admins to KEEP.
  let keptSupers = superAdmins;
  if (keepOnlyEmail) {
    keptSupers = superAdmins.filter(
      (p) => (p.email ?? "").toLowerCase() === keepOnlyEmail,
    );
    if (keptSupers.length === 0) {
      usageAndExit(
        `ABORT: --keep-super-admin ${keepOnlyEmail} did not match any super_admin profile.`,
      );
    }
  }
  const keptSuperIds = new Set(keptSupers.map((p) => p.id));
  const keptSuperEmails = new Set(
    keptSupers.map((p) => (p.email ?? "").toLowerCase()).filter(Boolean),
  );

  // 2. Decide which auth users to delete.
  const authUsers = await listAuthUsers();
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const toDelete = authUsers.filter((u) => {
    if (keptSuperIds.has(u.id)) return false; // preserved super admin
    const email = (u.email ?? "").toLowerCase();
    if (email && keptSuperEmails.has(email)) return false; // protect super email
    return true; // non-super profile OR orphaned auth user
  });

  const companies = await rest("companies?select=id,name");

  // ── Report ────────────────────────────────────────────────────────────────
  console.log("Preserved super_admin account(s):");
  keptSupers.forEach((p) =>
    console.log(`   ✅  ${p.email ?? "(no email)"}  [${p.id}]`),
  );
  console.log("");
  console.log(`Auth users to delete ......... ${toDelete.length}`);
  console.log(`Companies to delete .......... ${companies.length}`);
  console.log(`Profiles total (pre) ......... ${profiles.length}`);
  console.log(`Log tables to clear .......... ${LOG_TABLES.join(", ")}`);
  console.log("");

  if (dryRun) {
    console.log("🧪  Dry run complete — nothing was changed.");
    console.log("➡️   Re-run with --confirm to execute the reset.");
    return;
  }

  // ── Execute (dependency-safe order) ─────────────────────────────────────────
  // 3. Delete non-super auth users first (cascades their profiles).
  console.log("Deleting non-super-admin auth users (cascades profiles) ...");
  let deleted = 0;
  for (const u of toDelete) {
    await deleteAuthUser(u.id);
    deleted++;
    if (deleted % 25 === 0) console.log(`   ... ${deleted}/${toDelete.length}`);
  }
  console.log(`   ✅  Deleted ${deleted} auth user(s).`);

  // 4. Delete all companies (cascades all company-scoped data).
  console.log("Deleting all companies (cascades company-scoped data) ...");
  const removedCompanies = await restDelete("companies?id=not.is.null");
  console.log(`   ✅  Deleted ${removedCompanies.length} company/companies.`);

  // 5. Clear platform-level logs / orphans.
  console.log("Clearing platform-level log tables ...");
  for (const table of LOG_TABLES) {
    const removed = await restDelete(`${table}?id=not.is.null`);
    console.log(`   ✅  ${table}: cleared ${removed.length} row(s).`);
  }

  // 6. Verify.
  const profilesAfter = await rest("profiles?select=id,base_role");
  const companiesAfter = await rest("companies?select=id");
  const nonSuperAfter = profilesAfter.filter((p) => p.base_role !== "super_admin");
  console.log("");
  console.log("─────────────────────────────────────────────");
  console.log("RESET VERIFICATION:");
  console.log(`  companies remaining .......... ${companiesAfter.length} (expect 0)`);
  console.log(`  profiles remaining ........... ${profilesAfter.length} (super admins only)`);
  console.log(`  non-super-admin profiles ..... ${nonSuperAfter.length} (expect 0)`);
  console.log("─────────────────────────────────────────────");

  if (companiesAfter.length !== 0 || nonSuperAfter.length !== 0) {
    throw new Error(
      "Verification FAILED — residual companies or non-super-admin profiles remain. " +
        "Inspect the project (a FK may not cascade as expected) before retrying.",
    );
  }

  console.log("✅  Reset complete. Only the Super Admin account(s) + platform globals remain.");
  console.log("➡️   You can now log in as Super Admin and test the full flow from scratch.");
}

main().catch((err) => {
  console.error(`❌  ${err?.message ?? err}`);
  process.exit(1);
});
