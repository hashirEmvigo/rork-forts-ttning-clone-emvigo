/**
 * Supabase-backed Service Entitlements repository (ENT-1 reads + ENT-2
 * authoritative writes).
 *
 * The Entitlements analogue of {@link import("./supabaseModuleRepository")}, but
 * spanning the THREE entitlement stores (migration 0028):
 *
 *   • service_global_entitlements   — platform-wide availability (GLOBAL, no co)
 *   • company_service_entitlements  — per-company access (tri-state)
 *   • service_entitlement_log        — immutable append-only trail
 *
 * Each READ function returns the SAME shapes the localStorage store returns
 * (rebuilt losslessly from the `data` jsonb) so the read seam can swap them in
 * with no UI change. Soft-deleted mutable rows (`deleted_at` set) are filtered
 * out (WO-5.6 convention); the log is append-only and has no soft-delete.
 *
 * WRITES (ENT-2) are AUTHORITATIVE and direct — the exact analogue of the
 * Phase-2A/2B Module writes: a Super-Admin global-availability toggle, a
 * per-company disabled/trial/enabled change, and each entitlement-log append
 * commit to Supabase FIRST and the caller refetches the directory + updates the
 * UI only after a confirmed write. There is NO localStorage authority, NO
 * browser-domain mirror, and NO optimistic persistence on this path. The
 * company write resolves the real tenant UUID the RLS `company_id` check needs
 * (rejecting an unmapped company rather than writing a null tenant RLS would
 * silently drop). All three tables' INSERT/UPDATE policies are super-admin only
 * (0028), matching the Super-Admin-only Services surface.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type {
  ServiceGlobalEntitlement,
  CompanyServiceEntitlement,
  ServiceEntitlementLogEntry,
} from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";

class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "SupabaseEntitlementRepository requires Supabase. Set EXPO_PUBLIC_SUPABASE_URL " +
        "and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

interface GlobalFullRow {
  data: ServiceGlobalEntitlement;
  deleted_at: string | null;
}

interface CompanyFullRow {
  data: CompanyServiceEntitlement;
  company_legacy_id: string;
  deleted_at: string | null;
}

interface LogFullRow {
  data: ServiceEntitlementLogEntry;
}

/**
 * Stable synthetic upsert key for a company entitlement (`${companyId}::${serviceKey}`).
 * Inlined here (rather than imported from
 * {@link import("./entitlementMigration").companyEntitlementLegacyId}) to keep
 * this repository free of an import cycle — entitlementMigration imports this
 * module's list functions. Both formats MUST stay byte-identical.
 */
function companyEntitlementLegacyId(companyId: string, serviceKey: string): string {
  return `${companyId}::${serviceKey}`;
}

// ── Global entitlements ─────────────────────────────────────────────────────

/** FULL global entitlement records (lossless `data` jsonb). */
export async function listGlobalEntitlementsFromSupabase(): Promise<
  ServiceGlobalEntitlement[]
> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("entitlements.global.supabase.full");
  try {
    const { data, error } = await supabase
      .from("service_global_entitlements")
      .select("data, deleted_at");
    if (error) throw new Error(`[entitlements] global list failed: ${error.message}`);
    const rows = (data ?? []) as unknown as GlobalFullRow[];
    return rows
      .filter((r) => !r.deleted_at)
      .map((r) => r.data)
      .filter((g): g is ServiceGlobalEntitlement => Boolean(g));
  } finally {
    stop();
  }
}

// ── Company entitlements ────────────────────────────────────────────────────

/** FULL company entitlement records for an optional company scope. */
export async function listCompanyEntitlementsFromSupabase(
  companyId?: string | null,
): Promise<CompanyServiceEntitlement[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("entitlements.company.supabase.full");
  perf.count("entitlements.company.supabase.full.calls");
  try {
    let query = supabase
      .from("company_service_entitlements")
      .select("data, company_legacy_id, deleted_at");
    if (companyId !== undefined && companyId !== null) {
      query = query.eq("company_legacy_id", companyId);
    }
    const { data, error } = await query;
    if (error) throw new Error(`[entitlements] company list failed: ${error.message}`);
    const rows = (data ?? []) as unknown as CompanyFullRow[];
    return rows
      .filter((r) => !r.deleted_at)
      .map((r) => r.data)
      .filter((c): c is CompanyServiceEntitlement => Boolean(c));
  } finally {
    stop();
  }
}

// ── Authoritative writes (ENT-2 · Supabase-first, no localStorage authority) ──

/** Columns an authoritative GLOBAL entitlement write commits. */
interface GlobalEntitlementWriteRow {
  legacy_id: string;
  service_key: string;
  enabled: boolean;
  /** Lossless record the read path reconstructs from. */
  data: ServiceGlobalEntitlement;
  deleted_at: string | null;
}

/** Columns an authoritative COMPANY entitlement write commits. */
interface CompanyEntitlementWriteRow {
  legacy_id: string;
  /** Real tenant UUID FK the RLS `company_id = current_company_id()` check needs. */
  company_id: string;
  /** App-facing company id (the company `legacy_id`) for cheap query scoping. */
  company_legacy_id: string;
  service_key: string;
  status: string;
  enabled: boolean;
  /** Lossless record the read path reconstructs from. */
  data: CompanyServiceEntitlement;
  deleted_at: string | null;
}

/** Columns an entitlement-log append commits (insert-only; immutable trail). */
interface EntitlementLogWriteRow {
  legacy_id: string;
  service_key: string;
  company_id: string | null;
  company_legacy_id: string | null;
  action: string;
  changed_at: string;
  data: ServiceEntitlementLogEntry;
}

interface GlobalEntitlementDataRow {
  data: ServiceGlobalEntitlement;
}
interface CompanyEntitlementDataRow {
  data: CompanyServiceEntitlement;
}

/**
 * Authoritatively UPSERTS a GLOBAL service-availability record by `legacy_id`
 * (= the service key). Used by the Super-Admin global-availability toggle.
 * Updates the flat `service_key`/`enabled` columns AND the lossless `data`
 * jsonb; an upsert always UNDELETES. Resolves with the persisted record
 * (reconstructed from `data`).
 */
export async function upsertGlobalEntitlementInSupabase(
  entitlement: ServiceGlobalEntitlement,
): Promise<ServiceGlobalEntitlement> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("entitlements.global.upsert.supabase");
  try {
    const row: GlobalEntitlementWriteRow = {
      legacy_id: entitlement.serviceKey,
      service_key: entitlement.serviceKey,
      enabled: entitlement.enabled,
      data: entitlement,
      deleted_at: null,
    };
    const { data, error } = await supabase
      .from("service_global_entitlements")
      .upsert(row, { onConflict: "legacy_id" })
      .select("data")
      .single();
    if (error) throw new Error(`[service_global_entitlements] upsert failed: ${error.message}`);
    const saved = (data as GlobalEntitlementDataRow | null)?.data;
    if (!saved) throw new Error("[service_global_entitlements] upsert returned no row.");
    return saved;
  } finally {
    stop();
  }
}

/**
 * Authoritatively UPSERTS a COMPANY entitlement (tri-state access) by its
 * composite `legacy_id` ("${companyId}::${serviceKey}"). Used by the Super-Admin
 * disabled/trial/enabled control — it commits the FULLY-computed
 * {@link CompanyServiceEntitlement} so the persisted row always carries a
 * coherent status/enabled pair and the right timestamps.
 *
 * The app's company id space is the company `legacy_id`, but RLS checks the real
 * `company_id` UUID, so the tenant UUID is resolved via {@link loadCompanyUuidMap}
 * and written into `company_id`. An entitlement whose company has no Supabase row
 * is REJECTED up-front (rather than written with a null tenant RLS would silently
 * drop), so the caller surfaces the error and leaves the UI untouched. Updates
 * the flat columns AND the lossless `data` jsonb; resolves with the persisted
 * record reconstructed from `data`.
 */
export async function upsertCompanyEntitlementInSupabase(
  entitlement: CompanyServiceEntitlement,
): Promise<CompanyServiceEntitlement> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("entitlements.company.upsert.supabase");
  try {
    const companyMap = await loadCompanyUuidMap();
    const companyUuid = companyMap.get(entitlement.companyId);
    if (!companyUuid) {
      throw new Error(
        `[company_service_entitlements] No Supabase company found for "${entitlement.companyId}" — ` +
          "cannot persist a service entitlement for an unmapped company.",
      );
    }
    const row: CompanyEntitlementWriteRow = {
      legacy_id: companyEntitlementLegacyId(entitlement.companyId, entitlement.serviceKey),
      company_id: companyUuid,
      company_legacy_id: entitlement.companyId,
      service_key: entitlement.serviceKey,
      status: entitlement.status ?? (entitlement.enabled ? "enabled" : "disabled"),
      enabled: entitlement.enabled,
      data: entitlement,
      deleted_at: null,
    };
    const { data, error } = await supabase
      .from("company_service_entitlements")
      .upsert(row, { onConflict: "legacy_id" })
      .select("data")
      .single();
    if (error) throw new Error(`[company_service_entitlements] upsert failed: ${error.message}`);
    const saved = (data as CompanyEntitlementDataRow | null)?.data;
    if (!saved) throw new Error("[company_service_entitlements] upsert returned no row.");
    return saved;
  } finally {
    stop();
  }
}

/**
 * Authoritatively APPENDS one entitlement-log entry (insert-only — the trail is
 * immutable under RLS). `legacy_id` = the entry id, so a retried append is a
 * confirmed duplicate-key error rather than a silent duplicate. For a
 * company-scoped entry the real tenant UUID is resolved + written (rejecting an
 * unmapped company); a platform-wide (global) entry carries `company_id` null.
 */
export async function appendEntitlementLogInSupabase(
  entry: ServiceEntitlementLogEntry,
): Promise<void> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("entitlements.log.append.supabase");
  try {
    let companyUuid: string | null = null;
    if (entry.companyId) {
      const companyMap = await loadCompanyUuidMap();
      companyUuid = companyMap.get(entry.companyId) ?? null;
      if (!companyUuid) {
        throw new Error(
          `[service_entitlement_log] No Supabase company found for "${entry.companyId}" — ` +
            "cannot persist the entitlement-log entry for an unmapped company.",
        );
      }
    }
    const row: EntitlementLogWriteRow = {
      legacy_id: entry.id,
      service_key: entry.serviceKey,
      company_id: companyUuid,
      company_legacy_id: entry.companyId,
      action: entry.action,
      changed_at: entry.changedAt,
      data: entry,
    };
    const { error } = await supabase.from("service_entitlement_log").insert(row);
    if (error) throw new Error(`[service_entitlement_log] append failed: ${error.message}`);
  } finally {
    stop();
  }
}

// ── Entitlement log ─────────────────────────────────────────────────────────

/** FULL entitlement log entries for an optional company scope (newest first). */
export async function listEntitlementLogFromSupabase(
  companyId?: string | null,
): Promise<ServiceEntitlementLogEntry[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("entitlements.log.supabase.full");
  try {
    let query = supabase
      .from("service_entitlement_log")
      .select("data")
      .order("changed_at", { ascending: false });
    if (companyId !== undefined && companyId !== null) {
      query = query.eq("company_legacy_id", companyId);
    }
    const { data, error } = await query;
    if (error) throw new Error(`[entitlements] log list failed: ${error.message}`);
    const rows = (data ?? []) as unknown as LogFullRow[];
    return rows.map((r) => r.data).filter((l): l is ServiceEntitlementLogEntry => Boolean(l));
  } finally {
    stop();
  }
}
