// =============================================================================
//  ADMIN-ONLY TEMPORARY PASSWORD UTILITY  —  DEVELOPMENT / TESTING ONLY
// =============================================================================
//
//  ⚠️  WARNING — READ BEFORE USING  ⚠️
//
//  This is a controlled, one-time admin helper for setting a TEMPORARY password
//  on an EXISTING Supabase Auth user WITHOUT sending any recovery/invite email
//  (which avoids Supabase's built-in email rate limits during testing).
//
//  It is intentionally kept OUTSIDE the app UI and is NOT importable by, nor
//  reachable from, the client application. It must only ever be run by an
//  administrator from a trusted local machine.
//
//  HARD SAFETY RULES (enforced below):
//    • Uses the Supabase Admin API with the service_role key.
//    • The service_role key is read ONLY from an environment variable at
//      runtime — it is NEVER hardcoded, written to disk, or committed.
//    • Requires an EXPLICIT email AND password as arguments.
//    • Requires an EXPLICIT `--confirm` flag, so it can NEVER overwrite a
//      password automatically/accidentally.
//    • Only updates an EXISTING user (it does not create users).
//    • Sends NO recovery or invite email.
//    • Logs success/failure clearly.
//
//  This tool is for controlled admin setup / testing ONLY. Do NOT wire it into
//  any user flow, CI step, or server endpoint. For real users, configure Custom
//  SMTP and use normal password recovery instead.
//
// -----------------------------------------------------------------------------
//  Usage (run from the web-cleanops folder, Node 18+ for built-in fetch):
//
//    SUPABASE_URL="https://<PROJECT_REF>.supabase.co" \
//    SERVICE_ROLE_KEY="<service_role_secret>" \
//    node scripts/set-temp-password.mjs sebastian@stadalliansen.se "<temporary-password>" --confirm
//
//  Run it once, then close the terminal. Never paste the service_role key into
//  any file. Never commit secrets.
// =============================================================================

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY;
const email = process.argv[2];
const newPassword = process.argv[3];
const confirmed = process.argv.includes("--confirm");

function usageAndExit(message) {
  if (message) console.error(`\n❌  ${message}\n`);
  console.error(
    'Usage:\n' +
      '  SUPABASE_URL="https://<ref>.supabase.co" \\\n' +
      '  SERVICE_ROLE_KEY="<service_role_secret>" \\\n' +
      '  node scripts/set-temp-password.mjs <email> "<new-password>" --confirm\n',
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

if (!email || !newPassword) {
  usageAndExit("An explicit <email> and <new-password> are both required.");
}

if (!confirmed) {
  usageAndExit(
    "Refusing to change a password without the explicit --confirm flag. " +
      "This safeguard prevents accidental/automatic overwrites. " +
      "Re-run the command with --confirm appended once you are sure.",
  );
}

if (newPassword.length < 8) {
  usageAndExit("Temporary password must be at least 8 characters.");
}

const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  "Content-Type": "application/json",
};

/** Finds an existing auth user by email via the paginated admin list endpoint. */
async function findUserByEmail(targetEmail) {
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=200`,
      { headers },
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

async function main() {
  console.log("⚠️  ADMIN-ONLY temporary password utility (no email will be sent).");
  console.log(`🔎  Looking up existing auth user: ${email} ...`);

  const user = await findUserByEmail(email);
  if (!user) {
    // We never create users here — fail loudly so the admin verifies state.
    console.error(
      `❌  No existing auth user found for ${email}. ` +
        "This tool only updates EXISTING users; create the user first.",
    );
    process.exit(1);
  }

  console.log(`✅  Found user UID: ${user.id}. Setting temporary password ...`);
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${user.id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ password: newPassword, email_confirm: true }),
  });

  if (!res.ok) {
    throw new Error(`Update failed (${res.status}): ${await res.text()}`);
  }

  console.log("✅  Success — password set and email marked confirmed.");
  console.log("ℹ️   No recovery/invite email was sent.");
  console.log("➡️   You can now log in with this email + the temporary password.");
  console.log(
    "🔁  Remember: configure Custom SMTP later for proper password recovery.",
  );
}

main().catch((err) => {
  console.error(`❌  ${err?.message ?? err}`);
  process.exit(1);
});
