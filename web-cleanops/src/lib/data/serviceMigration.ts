/**
 * Service migration + shadow-read tooling (SVC-1).
 *
 * The Services analogue of {@link import("./teamMigration")}. Two
 * development/admin utilities, both READ-ONLY against the running app's
 * localStorage source of truth:
 *
 *   1. `migrateServices()` — copies localStorage services INTO the Supabase
 *      `services` table (single, flat record). Idempotent (upsert on
 *      `legacy_id`), repeatable, with a `dryRun` mode that computes the plan +
 *      report WITHOUT writing. Preserves legacy ids verbatim and the full payload
 *      in `data` jsonb. GLOBAL services (companyId === null → the Super Admin
 *      catalog) are migrated with `company_id = null`; company services whose
 *      company has no Supabase row are skipped + reported.
 *
 *   2. `shadowReadServices()` — diffs localStorage vs Supabase for a scope (count
 *      / id set / name parity / detail payload), producing a structured mismatch
 *      report. Differences are surfaced, never silently ignored.
 *
 * The CRITICAL guarantee is `legacy_id` stability — work-order service rows and
 * packages soft-reference services by it.
 */
import { getServices } from "@/lib/store";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { Service } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import {
  listServiceSummariesFromSupabase,
  listFullServicesFromSupabase,
} from "./supabaseServiceRepository";

// ── Migration ───────────────────────────────────────────────────────────

/** A single upsert row written to (or planned for) the `services` table. */
export interface ServiceUpsertRow {
  legacy_id: string;
  /** Real tenant FK UUID, or null for a GLOBAL service. */
  company_id: string | null;
  /** App-facing company id, or null for a GLOBAL service. */
  company_legacy_id: string | null;
  category_legacy_id: string | null;
  name: string;
  status: string;
  /** Soft-delete marker — always null on upsert (an upsert UNDELETES the row). */
  deleted_at: string | null;
  data: Service;
}

/** Structured outcome of a service migration run (or dry-run). */
export interface ServiceMigrationReport {
  ok: boolean;
  dryRun: boolean;
  /** Company scope this run was limited to, or null for all companies. */
  companyId: string | null;
  /** Services read from localStorage for the scope. */
  sourceCount: number;
  /** Rows that would be / were upserted. */
  plannedCount: number;
  /** Rows actually written (0 on dry-run). */
  writtenCount: number;
  /** Source services skipped because their company_id could not be resolved. */
  skipped: Array<{ id: string; reason: string }>;
  /** Fatal error, if the run failed. */
  error?: string;
}

function scopeByCompany(services: Service[], companyId: string | null | undefined): Service[] {
  if (companyId === undefined || companyId === null) return services;
  return services.filter((s) => s.companyId === companyId);
}

/**
 * Maps a localStorage {@link Service} to a `services` table upsert row. The flat
 * columns carry name/status/scope/category; the full record is preserved
 * losslessly in `data`. Shared by the migration utility and the SVC-3 dual-write
 * mirror so both write byte-identical rows.
 *
 * GLOBAL services (companyId === null) pass `companyUuid = null`.
 */
export function toServiceUpsertRow(service: Service, companyUuid: string | null): ServiceUpsertRow {
  return {
    legacy_id: service.id,
    company_id: companyUuid,
    company_legacy_id: service.companyId,
    category_legacy_id: service.categoryId,
    name: service.name,
    status: service.status,
    deleted_at: null,
    data: service,
  };
}

/**
 * Migrates localStorage services into Supabase.
 *
 * @param options.companyId Restrict to a single app-facing company id.
 * @param options.dryRun    When true, compute the plan + report but write nothing.
 */
export async function migrateServices(options?: {
  companyId?: string | null;
  dryRun?: boolean;
}): Promise<ServiceMigrationReport> {
  const companyId = options?.companyId ?? null;
  const dryRun = options?.dryRun ?? false;

  const source = scopeByCompany(getServices(), companyId);
  const report: ServiceMigrationReport = {
    ok: false,
    dryRun,
    companyId,
    sourceCount: source.length,
    plannedCount: 0,
    writtenCount: 0,
    skipped: [],
  };

  if (!isSupabaseConfigured || !supabase) {
    report.error = "Supabase is not configured.";
    return report;
  }

  const companyMap = await loadCompanyUuidMap();
  const rows: ServiceUpsertRow[] = [];
  for (const service of source) {
    // GLOBAL service (Super Admin catalog) → company_id null, never skipped.
    if (service.companyId === null) {
      rows.push(toServiceUpsertRow(service, null));
      continue;
    }
    const uuid = companyMap.get(service.companyId) ?? null;
    if (!uuid) {
      report.skipped.push({
        id: service.id,
        reason: `No Supabase company found for legacy_id "${service.companyId}". Migrate companies first.`,
      });
      continue;
    }
    rows.push(toServiceUpsertRow(service, uuid));
  }
  report.plannedCount = rows.length;

  if (dryRun || rows.length === 0) {
    report.ok = report.skipped.length === 0;
    return report;
  }

  const CHUNK = 200;
  try {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await supabase
        .from("services")
        .upsert(chunk, { onConflict: "legacy_id" });
      if (error) {
        report.error = `Upsert failed at chunk ${i / CHUNK}: ${error.message}`;
        report.writtenCount = i;
        return report;
      }
    }
    report.writtenCount = rows.length;
    report.ok = report.skipped.length === 0;
    return report;
  } catch (err) {
    report.error = err instanceof Error ? err.message : "Unknown migration error.";
    return report;
  }
}

// ── Shadow-read validation ────────────────────────────────────────────────

/** Per-aspect outcome of a localStorage-vs-Supabase service comparison. */
export interface ServiceShadowReport {
  ok: boolean;
  companyId: string | null;
  localCount: number;
  supabaseCount: number;
  countMatch: boolean;
  idsMatch: boolean;
  summaryMatch: boolean;
  detailMatch: boolean;
  /** Ids present locally but missing in Supabase (not yet migrated). */
  missingInSupabase: string[];
  /** Ids present in Supabase but absent locally (stale/extra). */
  extraInSupabase: string[];
  /** Human-readable mismatch notes — never empty when ok is false. */
  notes: string[];
}

function idSetDiff(a: string[], b: string[]): { onlyA: string[]; onlyB: string[] } {
  const setB = new Set(b);
  const setA = new Set(a);
  return {
    onlyA: a.filter((id) => !setB.has(id)),
    onlyB: b.filter((id) => !setA.has(id)),
  };
}

/**
 * Compares localStorage services against the Supabase shadow copy for a scope.
 * Read-only on both sides; mutates nothing. Validates count / id set / name /
 * a detail sample. Use this to confirm "0 critical mismatches" before any UI
 * cut-over.
 *
 * NOTE on scope: an unscoped (super-admin) shadow read covers every row; a
 * company-scoped read covers that company PLUS the shared global catalog, to
 * mirror the repository's visibility — so the local side scopes the same way.
 */
export async function shadowReadServices(
  companyId?: string | null,
): Promise<ServiceShadowReport> {
  const scope = companyId ?? null;
  const queryScope = companyId ?? undefined;
  const notes: string[] = [];

  // Mirror the repository's effective visibility: scope = company rows + globals.
  const allLocal = getServices();
  const local =
    queryScope === undefined
      ? allLocal
      : allLocal.filter((s) => s.companyId === queryScope || s.companyId === null);

  const report: ServiceShadowReport = {
    ok: false,
    companyId: scope,
    localCount: local.length,
    supabaseCount: 0,
    countMatch: false,
    idsMatch: false,
    summaryMatch: false,
    detailMatch: false,
    missingInSupabase: [],
    extraInSupabase: [],
    notes,
  };

  if (!isSupabaseConfigured || !supabase) {
    notes.push("Supabase is not configured.");
    return report;
  }

  let remote: Awaited<ReturnType<typeof listServiceSummariesFromSupabase>>;
  try {
    remote = await listServiceSummariesFromSupabase(queryScope);
  } catch (err) {
    notes.push(err instanceof Error ? err.message : "Supabase read failed.");
    return report;
  }

  report.supabaseCount = remote.length;
  report.countMatch = local.length === remote.length;
  if (!report.countMatch) {
    notes.push(`count mismatch: local ${local.length} vs supabase ${remote.length}`);
  }

  const { onlyA, onlyB } = idSetDiff(
    local.map((s) => s.id),
    remote.map((s) => s.id),
  );
  report.missingInSupabase = onlyA;
  report.extraInSupabase = onlyB;
  report.idsMatch = onlyA.length === 0 && onlyB.length === 0;
  if (onlyA.length > 0) notes.push(`${onlyA.length} service(s) not yet in Supabase`);
  if (onlyB.length > 0) notes.push(`${onlyB.length} extra service(s) in Supabase`);

  // Name + scope parity on the shared ids.
  const remoteById = new Map(remote.map((s) => [s.id, s] as const));
  let summaryMatch = true;
  for (const l of local) {
    const r = remoteById.get(l.id);
    if (!r) continue;
    if (r.name !== l.name || (r.companyId ?? null) !== (l.companyId ?? null)) {
      summaryMatch = false;
      notes.push(`summary mismatch for ${l.id}`);
      break;
    }
  }
  report.summaryMatch = summaryMatch;

  // Detail parity on a single sample id present in both (lossless reconstruction).
  let detailMatch = true;
  const sample = local.find((l) => remoteById.has(l.id));
  if (sample) {
    try {
      const remoteFull = await listFullServicesFromSupabase(queryScope);
      const remoteDetail = remoteFull.find((s) => s.id === sample.id) ?? null;
      detailMatch =
        Boolean(remoteDetail) && JSON.stringify(remoteDetail) === JSON.stringify(sample);
      if (!detailMatch) notes.push(`detail mismatch for ${sample.id}`);
    } catch (err) {
      detailMatch = false;
      notes.push(err instanceof Error ? err.message : "detail read failed");
    }
  }
  report.detailMatch = detailMatch;

  report.ok =
    report.countMatch && report.idsMatch && report.summaryMatch && report.detailMatch;
  return report;
}

// Expose console handles in development for manual migration + verification.
if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    migrateServices,
    shadowReadServices,
  };
}
