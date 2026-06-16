/**
 * Supabase-backed Service Package read repository (SVCCAT-1).
 *
 * The service-packages analogue of {@link import("./supabaseServiceRepository")}.
 * Reads the `service_packages` table (migration 0019) and returns the SAME
 * {@link ServicePackage} shapes the localStorage store returns.
 *
 * Packages are ALWAYS global master data (the type carries no companyId), so
 * there is NO company scope — every authenticated user reads the full catalog.
 * Soft-deleted rows (`deleted_at` set) are filtered out.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import { planServicePackageServiceRemoval } from "@/lib/servicePackageCatalogCleanup";
import type { ServicePackage } from "@/types";

const SUMMARY_COLUMNS = "legacy_id, name, status, deleted_at";

/** Lightweight package row for count / id-set parity checks. */
export interface ServicePackageSummary {
  id: string;
  name: string;
}

interface ServicePackageSummaryRow {
  legacy_id: string;
  name: string;
  status: string;
  deleted_at: string | null;
}

interface ServicePackageFullRow {
  data: ServicePackage;
  deleted_at: string | null;
}

/** A single authoritative upsert row written to `service_packages`. */
interface ServicePackageWriteRow {
  legacy_id: string;
  company_id: null;
  company_legacy_id: null;
  name: string;
  status: string;
  deleted_at: null;
  data: ServicePackage;
}

class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "SupabaseServicePackageRepository requires Supabase. Set " +
        "EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

function rowToSummary(row: ServicePackageSummaryRow): ServicePackageSummary {
  return { id: row.legacy_id, name: row.name };
}

/**
 * Maps a {@link ServicePackage} to its authoritative `service_packages` row.
 * Packages are ALWAYS global master data, so `company_id` is always null. The
 * flat `status` is derived from the `archived` flag (archive is a reversible
 * status flip — never a hard delete), and the lossless `data` jsonb carries the
 * full package incl. its `items`.
 */
function toWriteRow(pkg: ServicePackage): ServicePackageWriteRow {
  return {
    legacy_id: pkg.id,
    company_id: null,
    company_legacy_id: null,
    name: pkg.name,
    status: pkg.archived ? "archived" : "active",
    deleted_at: null,
    data: pkg,
  };
}

/**
 * Authoritatively upserts a single service package into Supabase (SVCCAT).
 *
 * This is the Supabase-authoritative write path used by the Super Admin package
 * editor — NOT the quarantined browser-domain mirror. Throws on failure so the
 * caller can surface the error and avoid committing an optimistic UI change that
 * never reached the server. RLS restricts writes to super admins (migration
 * 0019); a non-super-admin caller fails closed here.
 */
export async function upsertServicePackageToSupabase(
  pkg: ServicePackage,
): Promise<void> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("servicePackages.write.supabase");
  try {
    const { error } = await supabase
      .from("service_packages")
      .upsert(toWriteRow(pkg), { onConflict: "legacy_id" });
    if (error) {
      throw new Error(`[service_packages] Supabase write failed: ${error.message}`);
    }
  } finally {
    stop();
  }
}

/**
 * Removes a permanently-deleted GLOBAL catalog service from every global service
 * package that snapshotted it, persisting each affected package back to Supabase
 * (SVCCAT). Reads the full package set, removes only items whose
 * `sourceServiceId` matches `serviceId` (legacy free-text items and all other
 * items are preserved; an emptied package is kept), and upserts ONLY the changed
 * rows so the cleanup is authoritative and survives a hard refresh.
 *
 * Service packages are global master data (`company_id` always null), so this
 * only ever touches the global `service_packages` table — it can never reach a
 * company-owned copied service/category. Returns the changed packages exactly as
 * written, so the caller can sync in-memory state to the canonical server rows.
 * Throws on read/write failure so the caller can surface it and abort the
 * surrounding hard-delete (no orphaned items are ever left behind).
 */
export async function removeServiceFromGlobalPackagesInSupabase(
  serviceId: string,
): Promise<ServicePackage[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const normalizedServiceId = serviceId.trim();
  if (!normalizedServiceId) return [];
  const stop = perf.start("servicePackages.serviceCleanup.supabase");
  try {
    const packages = await listFullServicePackagesFromSupabase();
    const { changed } = planServicePackageServiceRemoval(packages, normalizedServiceId);
    for (const pkg of changed) {
      await upsertServicePackageToSupabase(pkg);
    }
    return changed;
  } finally {
    stop();
  }
}

/** Global package summary rows. Soft-deleted rows filtered out. */
export async function listServicePackageSummariesFromSupabase(): Promise<
  ServicePackageSummary[]
> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("servicePackages.list.supabase.summaries");
  try {
    const { data, error } = await supabase
      .from("service_packages")
      .select(SUMMARY_COLUMNS);
    if (error) throw new Error(`[service_packages] Supabase list failed: ${error.message}`);
    const rows = (data ?? []) as unknown as ServicePackageSummaryRow[];
    return rows.filter((r) => !r.deleted_at).map(rowToSummary);
  } finally {
    stop();
  }
}

/** FULL package records (lossless `data` jsonb, incl. items). */
export async function listFullServicePackagesFromSupabase(): Promise<ServicePackage[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("servicePackages.list.supabase.full");
  perf.count("servicePackages.list.supabase.full.calls");
  try {
    const { data, error } = await supabase
      .from("service_packages")
      .select("data, deleted_at");
    if (error) throw new Error(`[service_packages] Supabase full list failed: ${error.message}`);
    const rows = (data ?? []) as unknown as ServicePackageFullRow[];
    return rows
      .filter((r) => !r.deleted_at)
      .map((r) => r.data)
      .filter((p): p is ServicePackage => Boolean(p));
  } finally {
    stop();
  }
}
