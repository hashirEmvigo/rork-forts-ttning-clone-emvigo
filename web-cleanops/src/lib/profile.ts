import type { EntityStatus, Profile, ProfileStatus, UserRole } from "@/types";
import { supabase } from "@/lib/supabase";
import { isSupabaseAuthEnabled } from "@/lib/authSupabase";

/**
 * Profile loading helper (migration Step 2B.3).
 *
 * Loads a user's Supabase `profiles` row after a Supabase Auth sign-in. Like
 * the auth layer it sits behind, this is DORMANT by default and only does work
 * when {@link isSupabaseAuthEnabled} is `true`.
 *
 * It reads through the browser-safe anon client and relies on the RLS policies
 * from migration 0003 (a user can read their own profile). No service_role is
 * used. Errors are returned, never thrown.
 */

/** Raw shape of a row in the Supabase `profiles` table. */
interface ProfileRow {
  id: string;
  company_id: string | null;
  base_role: string;
  full_name: string | null;
  email: string | null;
  status: string | null;
  created_at: string | null;
}

/**
 * Raw `profiles` row joined to its `companies` row so we can resolve the
 * app-facing company id (`legacy_id`) and display name in a single query rather
 * than one round-trip per row.
 */
interface ProfileRosterRow extends ProfileRow {
  companies: { legacy_id: string | null; name: string | null; status: string | null } | null;
  /** Bare-integer Staff ID issued by the allocator (NUM-1 Phase 3), or null. */
  staff_number: number | null;
}

/**
 * A Supabase admin `profiles` row normalised for the Roles & Permissions
 * assigned-user roster. `companyId` is already mapped to the app-facing id
 * (`legacy_id` when present), so it sits in the same id space as the rest of the
 * frontend and existing company lookups keep working.
 */
export interface AdminProfileRosterRow {
  id: string;
  /** App-facing company id (`legacy_id`), or null for platform super admins. */
  companyId: string | null;
  /** Display name of the owning company, or null for platform super admins. */
  companyName: string | null;
  /**
   * Owning company's lifecycle status, resolved from the companies join.
   * "active" for platform super admins (no company). Used by the Roles &
   * Permissions company filter / assignment views; other consumers ignore it.
   */
  companyStatus?: EntityStatus;
  baseRole: UserRole;
  fullName: string | null;
  email: string | null;
  status: ProfileStatus;
  /**
   * Profile creation timestamp (`profiles.created_at`), or null when unknown.
   * Optional so existing callers that never construct timestamps keep
   * compiling; used to order "recently added" member lists newest-first.
   */
  createdAt?: string | null;
  /**
   * Bare-integer company-scoped Staff ID (NUM-1 Phase 3) for the Employees/Team
   * page. Null for super admins (no company) and any profile not yet issued one.
   */
  staffNumber?: number | null;
}

/** Outcome of attempting to load a profile. */
export interface LoadProfileResult {
  profile: Profile | null;
  /**
   * True when the auth user exists but no matching profile row was found.
   * This should be impossible given the fail-closed provisioning trigger
   * (migration 0004), but callers must still handle it defensively.
   */
  missing: boolean;
  error: string | null;
}

/** Narrows a raw DB base_role string onto the app's {@link UserRole}. */
function normaliseBaseRole(value: string): UserRole {
  if (
    value === "super_admin" ||
    value === "company_admin" ||
    value === "employee" ||
    value === "customer"
  ) {
    return value;
  }
  // Fail safe to the least-privileged role rather than trusting an unknown value.
  return "customer";
}

/** Narrows a raw DB status string onto {@link ProfileStatus}. */
function normaliseStatus(value: string | null): ProfileStatus {
  if (value === "active" || value === "inactive" || value === "archived") {
    return value;
  }
  return "inactive";
}

/** Narrows a company's raw status onto {@link EntityStatus}; defaults active. */
function normaliseCompanyStatus(value: string | null | undefined): EntityStatus {
  if (value === "active" || value === "inactive" || value === "archived") {
    return value;
  }
  return "active";
}

/** Maps a Supabase `profiles` row to the app's {@link Profile} shape. */
function mapRow(row: ProfileRow): Profile {
  return {
    id: row.id,
    companyId: row.company_id,
    baseRole: normaliseBaseRole(row.base_role),
    fullName: row.full_name,
    email: row.email,
    status: normaliseStatus(row.status),
    createdAt: row.created_at,
  };
}

/**
 * Lists the platform's admin (`super_admin` / `company_admin`) `profiles` rows
 * for the Roles & Permissions assigned-user roster.
 *
 * Read-only and safe by design:
 *   - Returns `[]` when the Supabase Auth layer is dormant (flag off / not
 *     configured), so callers fall back to the localStorage roster alone.
 *   - Honours RLS: a super admin sees every admin profile; a company admin sees
 *     only their own company's. Employees/customers are intentionally excluded
 *     — they still come from localStorage during the migration.
 *   - Catches all errors and returns `[]` rather than throwing.
 *
 * The owning company is embedded so `companyId` is normalised to the app-facing
 * `legacy_id` and a display name is available without extra queries.
 */
export async function listAdminProfiles(): Promise<AdminProfileRosterRow[]> {
  const all = await listDirectoryProfiles();
  return all.filter(
    (row) => row.baseRole === "super_admin" || row.baseRole === "company_admin",
  );
}

/**
 * Lists EVERY `profiles` row the caller may see — the single, global identity
 * backbone shared by both the Employees directory and the Roles & Permissions
 * assigned-user roster. This is what makes `profiles` the source of truth: any
 * login provisioned on any device (admin, employee or customer) is visible here
 * regardless of the device's localStorage.
 *
 * Read-only and safe by design:
 *   - Returns `[]` when the Supabase Auth layer is dormant (flag off / not
 *     configured), so callers fall back to their localStorage roster alone.
 *   - Honours RLS (migration 0003): a super admin sees every profile; a company
 *     admin sees only their own company's; everyone else sees just themselves.
 *   - Catches all errors and returns `[]` rather than throwing.
 *
 * The owning company is embedded so `companyId` is normalised to the app-facing
 * `legacy_id` and a display name is available without extra queries.
 */
export async function listDirectoryProfiles(): Promise<AdminProfileRosterRow[]> {
  if (!isSupabaseAuthEnabled || !supabase) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "id, company_id, base_role, full_name, email, status, created_at, staff_number, companies(legacy_id, name, status)",
      );

    if (error) {
      console.warn(
        "[profile] Could not list directory profiles; " +
          "falling back to localStorage roster only.",
        { message: error.message, code: error.code },
      );
      return [];
    }

    const rows = (data ?? []) as unknown as ProfileRosterRow[];
    return rows.map((row) => {
      const company = row.companies;
      return {
        id: row.id,
        companyId: company?.legacy_id ?? row.company_id,
        companyName: company?.name ?? null,
        companyStatus: normaliseCompanyStatus(company?.status),
        baseRole: normaliseBaseRole(row.base_role),
        fullName: row.full_name,
        email: row.email,
        status: normaliseStatus(row.status),
        createdAt: row.created_at,
        staffNumber: typeof row.staff_number === "number" ? row.staff_number : null,
      };
    });
  } catch (err) {
    console.warn(
      "[profile] Exception while listing directory profiles; falling back to " +
        "localStorage roster only.",
      err,
    );
    return [];
  }
}

/**
 * Loads the `profiles` row for a given auth user id.
 *
 * Returns `{ profile: null, missing: false }` when the auth layer is dormant,
 * so calling this from anywhere is safe while the flag is off.
 *
 * @param userId the Supabase `auth.users` id (equals `profiles.id`).
 */
export async function loadProfileForUser(userId: string): Promise<LoadProfileResult> {
  if (!isSupabaseAuthEnabled || !supabase) {
    return { profile: null, missing: false, error: null };
  }

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, company_id, base_role, full_name, email, status, created_at")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      return { profile: null, missing: false, error: error.message };
    }

    if (!data) {
      // No row for an authenticated user. The fail-closed provisioning trigger
      // (0004) makes this an unexpected, treat-as-broken state — callers should
      // refuse access rather than guess a role.
      console.error(
        "[profile] No profiles row found for authenticated user. " +
          "Expected exactly one per auth user (see migration 0004).",
        { userId },
      );
      return { profile: null, missing: true, error: null };
    }

    return { profile: mapRow(data as ProfileRow), missing: false, error: null };
  } catch (err) {
    return {
      profile: null,
      missing: false,
      error: err instanceof Error ? err.message : "Unknown profile load error.",
    };
  }
}
