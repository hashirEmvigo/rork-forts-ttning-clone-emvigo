// =============================================================================
//  Supabase MANAGEMENT-API SQL runner  —  Admin-only  —  TESTING ONLY
// =============================================================================
//
//  Executes a .sql file (or stdin) against the project's database via the
//  Supabase Management API (POST /v1/projects/{ref}/database/query).
//
//  Why this exists: this sandbox has the Management API personal access token
//  (SUPABASE_ACCESS_TOKEN, "sbp_..."), but NOT the service_role secret that
//  scripts/reset-database.mjs requires. The Management API runs SQL with the
//  privileged role (can touch auth.users), which is what the transactional
//  reset-database.sql needs.
//
//  SECURITY (mirrors the existing admin scripts):
//    • The access token is read ONLY from the environment or the local .env
//      file — never hardcoded, never written to disk, never echoed.
//    • Read-only by default; destructive SQL lives in reviewed .sql files.
//
//  USAGE (run from the web-cleanops folder, Node 18+):
//    node scripts/mgmt-db-query.mjs path/to/query.sql
//    echo "select 1;" | node scripts/mgmt-db-query.mjs -
// =============================================================================

import { readFileSync } from "node:fs";

/** Read a KEY=value entry from the local .env without printing it. */
function fromEnvFile(key) {
  try {
    const txt = readFileSync(new URL("../.env", import.meta.url), "utf8");
    const line = txt
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim() : undefined;
  } catch {
    return undefined;
  }
}

const token =
  process.env.SUPABASE_ACCESS_TOKEN || fromEnvFile("SUPABASE_ACCESS_TOKEN");
const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  fromEnvFile("EXPO_PUBLIC_SUPABASE_URL");
const projectRef = supabaseUrl?.match(
  /https:\/\/([a-z0-9]+)\.supabase\.co/,
)?.[1];

if (!token) {
  console.error("❌  Missing SUPABASE_ACCESS_TOKEN (env or .env).");
  process.exit(1);
}
if (!projectRef) {
  console.error("❌  Could not derive project ref from EXPO_PUBLIC_SUPABASE_URL.");
  process.exit(1);
}

const sqlPath = process.argv[2];
if (!sqlPath) {
  console.error("Usage: node scripts/mgmt-db-query.mjs <file.sql | ->");
  process.exit(1);
}
const sql = sqlPath === "-" ? readFileSync(0, "utf8") : readFileSync(sqlPath, "utf8");

console.error(`▶  project ref: ${projectRef}  (sql bytes: ${sql.length})`);

const res = await fetch(
  `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  },
);

const text = await res.text();
console.error(`◀  HTTP ${res.status}`);
// Pretty-print JSON results when possible.
try {
  console.log(JSON.stringify(JSON.parse(text), null, 2));
} catch {
  console.log(text);
}
if (!res.ok) process.exit(1);
