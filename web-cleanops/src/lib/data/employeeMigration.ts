/**
 * Employee migration + shadow-read tooling (P7C · EMP-1).
 *
 * The Employees analogue of {@link import("./customerMigration")}. Two
 * development/admin utilities, both READ-ONLY against the running app's
 * localStorage source of truth:
 *
 *   1. `migrateEmployees()` — copies localStorage employees INTO the Supabase
 *      `employees` table (single, flat record). Idempotent (upsert on
 *      `legacy_id`), repeatable, with a `dryRun` mode that computes the plan +
 *      report WITHOUT writing. Preserves legacy ids verbatim and the full
 *      payload in `data` jsonb. Skips + reports employees whose company has no
 *      Supabase row, and surfaces per-company duplicate emails (the app-level
 *      uniqueness guard is not yet a DB constraint — see migration 0010).
 *
 *   2. `shadowReadEmployees()` — diffs localStorage vs Supabase for a company
 *      (count / id set / summary fields incl. teamCount + hasLogin / detail
 *      payload), producing a structured mismatch report. Differences are
 *      surfaced, never silently ignored.
 *
 * Neither utility touches the UI, the Schedule resolver, assignment logic, or
 * the linked-login User write path. localStorage stays the source of truth for
 * the whole of EMP-1; Supabase is the shadow copy these tools populate + verify.
 * The CRITICAL guarantee is `legacy_id` stability — existing service-row
 * assignments and the deferred Time Reports / Activity tracks reference the
 * employee by it.
 */
import { getEmployees } from "@/lib/store";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { Employee } from "@/types";
import { localDataLayer } from "./localStorageAdapters";
import { supabaseEmployeeRepository } from "./supabaseEmployeeRepository";
import { loadCompanyUuidMap } from "./customerMigration";

// ── Migration ─────────────────────────────────────────────

/** A single upsert row written to (or planned for) the `employees` table. */
export interface EmployeeUpsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string;
  name: string;
  email: string;
  title: string | null;
  status: string;
  team_ids: string[];
  user_legacy_id: string | null;
  postal_city_id: string | null;
  language_id: string | null;
  /** Soft-delete marker — always null on upsert (an upsert UNDELETES the row). */
  deleted_at: string | null;
  data: Employee;
}

/** Structured outcome of an employee migration run (or dry-run). */
export interface EmployeeMigrationReport {
  ok: boolean;
  dryRun: boolean;
  /** Company scope this run was limited to, or null for all companies. */
  companyId: string | null;
  /** Employees read from localStorage for the scope. */
  sourceCount: number;
  /** Rows that would be / were upserted. */
  plannedCount: number;
  /** Rows actually written (0 on dry-run). */
  writtenCount: number;
  /** Source employees skipped because their company_id could not be resolved. */
  skipped: Array<{ id: string; reason: string }>;
  /**
   * Duplicate emails detected within a company (the app-level uniqueness guard
   * is not yet a DB constraint). Surfaced, never blocking — migration 0010 ships
   * only a non-unique lookup index for this reason.
   */
  duplicateEmails: Array<{ companyId: string; email: string; ids: string[] }>;
  /** Fatal error, if the run failed. */
  error?: string;
}

function scopeByCompany(employees: Employee[], companyId: string | null | undefined): Employee[] {
  if (companyId === undefined || companyId === null) return employees;
  return employees.filter((e) => e.companyId === companyId);
}

/**
 * Maps a localStorage {@link Employee} to an `employees` table upsert row. The
 * flat columns mirror {@link EmployeeSummary} plus the soft FK columns; the full
 * record is preserved losslessly in `data` (incl. workingSchedule). Shared by
 * the migration utility and the future EMP-4 dual-write mirror so both write
 * byte-identical rows.
 */
/**
 * Coerces an optional soft-FK / string reference to `null` when it is absent OR
 * an empty/whitespace-only string, so the mirror never writes `""` into a column
 * that should be a clean null (mirrors the updateEmployee Pass-1 normalisation).
 */
function nullableRef(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function toEmployeeUpsertRow(
  employee: Employee,
  companyUuid: string | null,
): EmployeeUpsertRow {
  return {
    legacy_id: employee.id,
    company_id: companyUuid,
    company_legacy_id: employee.companyId,
    name: employee.name,
    email: employee.email ?? "",
    title: nullableRef(employee.title),
    status: employee.status,
    team_ids: employee.teamIds ?? [],
    user_legacy_id: nullableRef(employee.userId),
    postal_city_id: nullableRef(employee.postalCityId),
    language_id: nullableRef(employee.languageId),
    deleted_at: null,
    data: employee,
  };
}

/** Detects per-company duplicate emails (case-insensitive) for the report. */
function findDuplicateEmails(
  employees: Employee[],
): Array<{ companyId: string; email: string; ids: string[] }> {
  const byKey = new Map<string, { companyId: string; email: string; ids: string[] }>();
  for (const e of employees) {
    const email = (e.email ?? "").trim().toLowerCase();
    if (!email) continue;
    const key = `${e.companyId}::${email}`;
    const existing = byKey.get(key);
    if (existing) existing.ids.push(e.id);
    else byKey.set(key, { companyId: e.companyId, email, ids: [e.id] });
  }
  return [...byKey.values()].filter((row) => row.ids.length > 1);
}

/**
 * Migrates localStorage employees into Supabase.
 *
 * @param options.companyId Restrict to a single app-facing company id.
 * @param options.dryRun    When true, compute the plan + report but write nothing.
 */
export async function migrateEmployees(options?: {
  companyId?: string | null;
  dryRun?: boolean;
}): Promise<EmployeeMigrationReport> {
  const companyId = options?.companyId ?? null;
  const dryRun = options?.dryRun ?? false;

  const source = scopeByCompany(getEmployees(), companyId);
  const report: EmployeeMigrationReport = {
    ok: false,
    dryRun,
    companyId,
    sourceCount: source.length,
    plannedCount: 0,
    writtenCount: 0,
    skipped: [],
    duplicateEmails: findDuplicateEmails(source),
  };

  if (!isSupabaseConfigured || !supabase) {
    report.error = "Supabase is not configured.";
    return report;
  }

  const companyMap = await loadCompanyUuidMap();
  const rows: EmployeeUpsertRow[] = [];
  for (const employee of source) {
    const uuid = companyMap.get(employee.companyId) ?? null;
    if (!uuid) {
      // No matching companies row — RLS would reject the write. Skip + report.
      report.skipped.push({
        id: employee.id,
        reason: `No Supabase company found for legacy_id "${employee.companyId}". Migrate companies first.`,
      });
      continue;
    }
    rows.push(toEmployeeUpsertRow(employee, uuid));
  }
  report.plannedCount = rows.length;

  if (dryRun) {
    report.ok = report.skipped.length === 0;
    return report;
  }

  if (rows.length === 0) {
    report.ok = report.skipped.length === 0;
    return report;
  }

  // Idempotent + repeatable: upsert on the unique `legacy_id`. Re-running simply
  // refreshes existing rows. Chunked to keep request payloads reasonable.
  const CHUNK = 200;
  try {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await supabase
        .from("employees")
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

// ── Backfill preflight inspection ─────────────────────────

/** Backfill readiness of a single company. */
export type EmployeeCompanyReadinessStatus =
  | "not_backfilled"
  | "partially_backfilled"
  | "parity_ok"
  | "mismatch"
  | "unmapped";

/**
 * Per-company readiness row — COUNTS ONLY, never any employee name / email /
 * phone / address. Safe to render in the Super Admin operational surface.
 */
export interface EmployeeCompanyReadiness {
  /** App-facing company id (legacy_id). Company ids are not employee PII. */
  companyId: string;
  /** Whether a Supabase `companies` row maps this legacy id (writes need it). */
  mapped: boolean;
  /** Employees this company has in the localStorage source of truth. */
  localCount: number;
  /** Active (non-soft-deleted) Supabase employee rows for this company. */
  supabaseActiveCount: number;
  /** Soft-deleted (`deleted_at` set) Supabase employee rows for this company. */
  supabaseDeletedCount: number;
  status: EmployeeCompanyReadinessStatus;
}

/** Aggregate, PII-free outcome of {@link inspectEmployeeBackfill}. */
export interface EmployeeBackfillInspection {
  ok: boolean;
  supabaseConfigured: boolean;
  companies: EmployeeCompanyReadiness[];
  totals: {
    localCount: number;
    supabaseActiveCount: number;
    supabaseDeletedCount: number;
  };
  error?: string;
}

function readinessStatus(
  mapped: boolean,
  localCount: number,
  supabaseActiveCount: number,
): EmployeeCompanyReadinessStatus {
  if (!mapped) return localCount > 0 || supabaseActiveCount > 0 ? "unmapped" : "parity_ok";
  if (supabaseActiveCount > localCount) return "mismatch";
  if (supabaseActiveCount === localCount) return "parity_ok";
  if (supabaseActiveCount === 0) return "not_backfilled";
  return "partially_backfilled";
}

/**
 * Read-only preflight: counts localStorage vs Supabase employees per company and
 * classifies each company's backfill readiness. Writes nothing. Surfaces ONLY
 * counts + company ids + a mapped/parity status — never an employee record, name
 * or email — so it is safe to expose in the deployed Super Admin surface.
 *
 * The active/soft-deleted split is read directly from the `employees` table
 * (a single scoped query over `company_legacy_id, deleted_at`), so the same RLS
 * the running session sees applies; companies with no Supabase mapping are
 * flagged `unmapped` (their writes would be RLS-rejected until companies migrate).
 */
export async function inspectEmployeeBackfill(): Promise<EmployeeBackfillInspection> {
  const local = getEmployees();
  const localByCompany = new Map<string, number>();
  for (const e of local) {
    localByCompany.set(e.companyId, (localByCompany.get(e.companyId) ?? 0) + 1);
  }

  const inspection: EmployeeBackfillInspection = {
    ok: false,
    supabaseConfigured: isSupabaseConfigured && Boolean(supabase),
    companies: [],
    totals: { localCount: local.length, supabaseActiveCount: 0, supabaseDeletedCount: 0 },
  };

  if (!isSupabaseConfigured || !supabase) {
    inspection.error = "Supabase is not configured.";
    return inspection;
  }

  const companyMap = await loadCompanyUuidMap();

  const { data, error } = await supabase
    .from("employees")
    .select("company_legacy_id, deleted_at");
  if (error) {
    inspection.error = error.message;
    return inspection;
  }

  const activeByCompany = new Map<string, number>();
  const deletedByCompany = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ company_legacy_id: string; deleted_at: string | null }>) {
    const target = row.deleted_at ? deletedByCompany : activeByCompany;
    target.set(row.company_legacy_id, (target.get(row.company_legacy_id) ?? 0) + 1);
  }

  const companyIds = new Set<string>([
    ...localByCompany.keys(),
    ...activeByCompany.keys(),
    ...deletedByCompany.keys(),
  ]);

  const companies: EmployeeCompanyReadiness[] = [...companyIds]
    .sort((a, b) => a.localeCompare(b))
    .map((companyId) => {
      const localCount = localByCompany.get(companyId) ?? 0;
      const supabaseActiveCount = activeByCompany.get(companyId) ?? 0;
      const supabaseDeletedCount = deletedByCompany.get(companyId) ?? 0;
      const mapped = companyMap.has(companyId);
      inspection.totals.supabaseActiveCount += supabaseActiveCount;
      inspection.totals.supabaseDeletedCount += supabaseDeletedCount;
      return {
        companyId,
        mapped,
        localCount,
        supabaseActiveCount,
        supabaseDeletedCount,
        status: readinessStatus(mapped, localCount, supabaseActiveCount),
      };
    });

  inspection.companies = companies;
  inspection.ok = companies.every((c) => c.status === "parity_ok");
  return inspection;
}

// ── Shadow-read validation ────────────────────────────────

/** Per-aspect outcome of a localStorage-vs-Supabase employee comparison. */
export interface EmployeeShadowReport {
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
 * Compares localStorage employees against the Supabase shadow copy for a scope.
 * Read-only on both sides; mutates nothing. Validates count / id set / summary
 * fields (incl. teamCount + hasLogin + status — the status-coverage check, since
 * no implicit status filter is applied) / a detail sample. Use this to confirm
 * "0 critical mismatches" before any future UI cut-over (EMP-2/EMP-3).
 */
export async function shadowReadEmployees(
  companyId?: string | null,
): Promise<EmployeeShadowReport> {
  // Label-only normalisation (mirrors customers/work orders). The ADAPTER scope
  // stays `companyId` (undefined for the all-companies case): the local adapter
  // filters on undefined → all, whereas the Supabase repository treats
  // null/undefined the same way. We keep `companyId` for the queries and only
  // label with `scope`.
  const scope = companyId ?? null;
  const queryScope = companyId ?? undefined;
  const notes: string[] = [];

  const local = await localDataLayer.employees.listSummaries({ companyId: queryScope });

  const report: EmployeeShadowReport = {
    ok: false,
    companyId: scope,
    localCount: local.total,
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

  let remote: Awaited<ReturnType<typeof supabaseEmployeeRepository.listSummaries>>;
  try {
    remote = await supabaseEmployeeRepository.listSummaries({ companyId: queryScope });
  } catch (err) {
    notes.push(err instanceof Error ? err.message : "Supabase read failed.");
    return report;
  }

  report.supabaseCount = remote.total;
  report.countMatch = local.total === remote.total;
  if (!report.countMatch) {
    notes.push(`count mismatch: local ${local.total} vs supabase ${remote.total}`);
  }

  const { onlyA, onlyB } = idSetDiff(
    local.items.map((e) => e.id),
    remote.items.map((e) => e.id),
  );
  report.missingInSupabase = onlyA;
  report.extraInSupabase = onlyB;
  report.idsMatch = onlyA.length === 0 && onlyB.length === 0;
  if (onlyA.length > 0) notes.push(`${onlyA.length} employee(s) not yet in Supabase`);
  if (onlyB.length > 0) notes.push(`${onlyB.length} extra employee(s) in Supabase`);

  // Summary field spot-check on the shared ids (incl. teamCount + hasLogin +
  // status — proves the status-coverage + login + team projections survive).
  const remoteById = new Map(remote.items.map((e) => [e.id, e] as const));
  let summaryMatch = true;
  for (const l of local.items) {
    const r = remoteById.get(l.id);
    if (!r) continue;
    if (
      r.name !== l.name ||
      r.email !== l.email ||
      (r.title ?? undefined) !== (l.title ?? undefined) ||
      r.status !== l.status ||
      r.teamCount !== l.teamCount ||
      r.hasLogin !== l.hasLogin
    ) {
      summaryMatch = false;
      notes.push(`summary mismatch for ${l.id}`);
      break;
    }
  }
  report.summaryMatch = summaryMatch;

  // Detail parity on a single sample id present in both (lossless reconstruction
  // incl. workingSchedule + every lookup-link field).
  let detailMatch = true;
  const sample = local.items.find((l) => remoteById.has(l.id));
  if (sample) {
    try {
      const [localDetail, remoteDetail] = await Promise.all([
        localDataLayer.employees.getDetail(sample.id, { companyId: queryScope }),
        supabaseEmployeeRepository.getDetail(sample.id, { companyId: queryScope }),
      ]);
      detailMatch =
        Boolean(remoteDetail) &&
        JSON.stringify(remoteDetail) === JSON.stringify(localDetail);
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
    migrateEmployees,
    shadowReadEmployees,
  };
}
