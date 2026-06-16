import type { Company, EntityStatus } from "@/types";
import { getCompanies } from "@/lib/store";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

/**
 * Read-only Supabase access for companies (migration Step 2A).
 *
 * Nothing here writes to Supabase. The goal is only to validate that the app
 * can read shared, persistent company data from Supabase before localStorage is
 * replaced. Failures are swallowed and the function falls back to localStorage
 * so the app can never crash because of Supabase.
 */

/** Shape of a row in the Supabase `companies` table. */
interface CompanyRow {
  id: string;
  legacy_id: string | null;
  name: string;
  status: string | null;
  created_at: string | null;
}

/** Maps a DB status string onto the app's narrower {@link EntityStatus}. */
function normaliseStatus(status: string | null): EntityStatus {
  // The app's Company type only supports active | inactive today; 'archived'
  // (a valid DB value) is treated as inactive for display purposes.
  return status === "active" ? "active" : "inactive";
}

/**
 * Maps a Supabase row to the app's {@link Company} shape.
 *
 * Uses `legacy_id` as the app-facing id when present so existing relationships
 * (users.companyId, customers.companyId, …) keep resolving during migration.
 */
function mapRow(row: CompanyRow): Company {
  return {
    id: row.legacy_id ?? row.id,
    name: row.name,
    status: normaliseStatus(row.status),
    createdAt: row.created_at ?? new Date().toISOString(),
  };
}

/**
 * Fetches companies from Supabase in read-only mode.
 *
 * Safe by design:
 *   - Returns the localStorage companies if Supabase isn't configured.
 *   - Catches all errors and falls back to localStorage.
 *   - Falls back to localStorage if Supabase returns an empty set, so the app
 *     never ends up with no companies during the test phase.
 *
 * @returns companies plus the resolved `source` ('supabase' | 'localStorage').
 */
/** Human-readable reason the read resolved to a particular source. */
export type CompaniesFallbackReason =
  | "ok"
  | "supabase-not-configured"
  | "query-error"
  | "empty-result"
  | "exception";

export async function getCompaniesFromSupabase(): Promise<{
  companies: Company[];
  source: "supabase" | "localStorage";
  reason: CompaniesFallbackReason;
}> {
  const fallback = getCompanies();

  if (!isSupabaseConfigured || !supabase) {
    console.warn(
      "[companies] Fallback to localStorage — reason: Supabase not configured " +
        "(EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY missing or empty).",
    );
    return { companies: fallback, source: "localStorage", reason: "supabase-not-configured" };
  }

  try {
    const { data, error } = await supabase
      .from("companies")
      .select("id, legacy_id, name, status, created_at")
      .order("created_at", { ascending: true });

    if (error) {
      // Surface the full PostgREST error so the exact cause is visible:
      //   - code 42P01 / message 'relation "companies" does not exist' → table missing
      //   - code 42501 / 'permission denied' or empty rows under RLS    → RLS blocking
      //   - 401 / 'Invalid API key' / 'JWT'                             → bad anon key
      console.error(
        "[companies] Fallback to localStorage — reason: query error.",
        {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        },
      );
      return { companies: fallback, source: "localStorage", reason: "query-error" };
    }

    const rows = (data ?? []) as CompanyRow[];
    if (rows.length === 0) {
      // No error but zero rows. Most common causes:
      //   - RLS is enabled but no SELECT policy grants the anon role access
      //     (PostgREST returns [] instead of an error), or
      //   - the seed insert did not run / was rolled back.
      console.warn(
        "[companies] Fallback to localStorage — reason: Supabase returned 0 rows. " +
          "Likely an RLS SELECT policy is missing for the anon role, or the seed " +
          "companies were not inserted. Verify the table has rows in Supabase and " +
          'that policy "companies_read_placeholder" exists.',
      );
      return { companies: fallback, source: "localStorage", reason: "empty-result" };
    }

    return { companies: rows.map(mapRow), source: "supabase", reason: "ok" };
  } catch (err) {
    console.error(
      "[companies] Fallback to localStorage — reason: exception during Supabase request " +
        "(network/CORS/invalid URL).",
      err,
    );
    return { companies: fallback, source: "localStorage", reason: "exception" };
  }
}

/**
 * Matches a canonical v4-style UUID. Used to decide whether a stored
 * `company_id` is a Supabase `companies.id` (UUID) that must be normalised to
 * the app-facing `legacy_id`, or is already an app-facing id.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves a raw `profiles.company_id` to the app-facing company id used
 * everywhere else in the frontend (roles, modules, customers, work orders, …).
 *
 * The migration keeps a single app-facing id space: a company's `legacy_id`
 * (e.g. `cmp_nordlys`) when present, otherwise its Supabase UUID. A Supabase
 * profile stores the `companies.id` UUID as its FK, so without this mapping a
 * logged-in admin's `user.companyId` would be a UUID that never matches the
 * legacy-keyed data — breaking module access, role lookups, etc.
 *
 * Behaviour:
 *   - `null` in → `null` out (e.g. super admins with no company).
 *   - A non-UUID value is assumed to already be an app-facing id and returned
 *     unchanged (no query) — keeps legacy/demo users working.
 *   - A UUID is looked up in `companies`; returns `legacy_id` when present,
 *     else the UUID itself. On any error/missing row it safely falls back to
 *     the original value so login is never blocked by this resolution.
 */
export async function resolveCompanyAppId(
  companyId: string | null,
): Promise<string | null> {
  if (!companyId) return null;

  // Already an app-facing legacy id (or some non-UUID identifier) — nothing to do.
  if (!UUID_RE.test(companyId)) return companyId;

  if (!isSupabaseConfigured || !supabase) return companyId;

  try {
    const { data, error } = await supabase
      .from("companies")
      .select("id, legacy_id")
      .eq("id", companyId)
      .maybeSingle();

    if (error || !data) {
      console.warn(
        "[companies] Could not resolve app-facing company id from UUID; " +
          "using the UUID as-is. Module/role lookups keyed by legacy_id may miss.",
        { companyId, error: error?.message ?? "no matching row" },
      );
      return companyId;
    }

    return data.legacy_id ?? data.id;
  } catch (err) {
    console.warn(
      "[companies] Exception while resolving app-facing company id; using UUID as-is.",
      err,
    );
    return companyId;
  }
}

/** Result of a company write attempt against Supabase. */
export type CompanyWriteResult =
  | { ok: true; company: Company }
  | { ok: false; error: string };

/** Result of a company status/name update against Supabase. */
export type CompanyUpdateResult = { ok: true } | { ok: false; error: string };

/**
 * Inserts a new company into Supabase.
 *
 * Unlike the read path, errors here are NOT swallowed — they are returned to
 * the caller so a failed write never silently looks successful. The new row's
 * `legacy_id` is the app-facing id, keeping local roles/modules/relationships
 * consistent before and after a refresh.
 */
export async function createCompanyInSupabase(input: {
  legacyId: string;
  name: string;
  status: EntityStatus;
}): Promise<CompanyWriteResult> {
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, error: "Supabase is not configured." };
  }

  try {
    const { data, error } = await supabase
      .from("companies")
      .insert({ legacy_id: input.legacyId, name: input.name, status: input.status })
      .select("id, legacy_id, name, status, created_at")
      .single();

    if (error) {
      console.error("[companies] Insert failed.", {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
      return { ok: false, error: error.message };
    }

    return { ok: true, company: mapRow(data as CompanyRow) };
  } catch (err) {
    console.error("[companies] Insert exception (network/CORS/invalid URL).", err);
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error." };
  }
}

/**
 * Updates an existing company in Supabase, matched by its app-facing id
 * (stored as `legacy_id`). Errors are surfaced to the caller.
 */
export async function updateCompanyInSupabase(
  legacyId: string,
  patch: { name?: string; status?: EntityStatus },
): Promise<CompanyUpdateResult> {
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, error: "Supabase is not configured." };
  }

  try {
    const { error } = await supabase
      .from("companies")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("legacy_id", legacyId);

    if (error) {
      console.error("[companies] Update failed.", {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (err) {
    console.error("[companies] Update exception (network/CORS/invalid URL).", err);
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error." };
  }
}
