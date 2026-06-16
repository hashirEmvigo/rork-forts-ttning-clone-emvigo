/**
 * Employee dual-write mirror (EMP-4).
 *
 * The Employees analogue of {@link import("./teamDualWrite")} — Employees, like
 * Teams, CAN be removed, so this carries the WO-5.6 / Teams soft-delete removal
 * propagation. localStorage stays the source of truth: every employee write
 * completes against localStorage BEFORE this module runs. When
 * {@link EMPLOYEES_DUAL_WRITE} is on, `persistEmployees` (AppContext) fires
 * {@link mirrorEmployeeWrites} in the background to MIRROR the same change into
 * the Supabase `employees` table.
 *
 * Why EMP-4 is now urgent: the Employees READ path is already Supabase-primary
 * (EMPLOYEES_SUPABASE_READ resolves ON in real app builds) while employee WRITES
 * still only hit localStorage. Without this mirror, reads can reconcile to a
 * stale/partial Supabase dataset and a create/edit/archive/delete can appear to
 * be lost after refresh. The mirror closes that asymmetry — it does NOT make
 * Supabase authoritative for writes (a separate flag would do that later).
 *
 * Guarantees (identical to the proven customer/team mirrors):
 *   • Never throws — always invoked fire-and-forget; a Supabase failure can never
 *     break an employee operation.
 *   • Idempotent — upsert on the unique `legacy_id`; repeated saves never inflate.
 *     An upsert UNDELETES a row (writes `deleted_at = null`), so re-activating a
 *     previously removed employee with the same legacy_id is atomic.
 *   • Company-scoped — each row carries the real `company_id` UUID RLS checks;
 *     rows whose company has no Supabase mapping are skipped + surfaced.
 *   • Removal propagation — an employee gone from `next` is SOFT-deleted in
 *     Supabase (`deleted_at` set) so no stale employee survives.
 *   • Self-validating — after mirroring, it re-reads the affected rows and
 *     compares the critical fields, recording any drift (never silently hidden).
 *   • Optional deep shadow validation — when requested (EMPLOYEES_SHADOW_VALIDATE),
 *     it runs a company-scoped {@link shadowReadEmployees} parity pass and records
 *     any divergence via the EMP-2 cutover telemetry. Observability only.
 *
 * All runtime state lives in {@link getEmployeeDualWriteState}.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { Employee } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import {
  toEmployeeUpsertRow,
  shadowReadEmployees,
  type EmployeeUpsertRow,
} from "./employeeMigration";
import { recordEmployeeShadowDrift } from "./employeeCutover";

/** Critical fields validated after every mirrored write (no PII free text). */
export type EmployeeWriteField =
  | "legacy_id"
  | "company_legacy_id"
  | "name"
  | "email"
  | "status";

/** A single field-level discrepancy found while validating a mirrored write. */
export interface EmployeeWriteMismatch {
  id: string;
  field: EmployeeWriteField | "missing";
  local: string;
  supabase: string;
  at: string;
}

/** The classification of changes a single mirror operation carried. */
export interface EmployeeWriteDiff {
  created: string[];
  updated: string[];
  /** Ids present before but gone after — soft-deleted in Supabase. */
  removed: string[];
}

/** Structured outcome of one {@link mirrorEmployeeWrites} run. */
export interface EmployeeDualWriteResult {
  ok: boolean;
  /** True when nothing changed between prev/next (no Supabase work done). */
  noop: boolean;
  diff: EmployeeWriteDiff;
  /** Rows actually upserted to Supabase. */
  mirrored: number;
  /** Rows soft-deleted in Supabase (removal propagation). */
  removed: number;
  /** Source employees skipped (no company mapping / RLS would reject). */
  skipped: Array<{ id: string; reason: string }>;
  /** Field-level mismatches found by the post-write validation. */
  mismatches: EmployeeWriteMismatch[];
  /** Deep shadow-validation drift summaries (only when shadowValidate ran). */
  shadowDrift: string[];
  /** Fatal error captured (never thrown to the caller). */
  error: string | null;
  /** Total wall-clock duration of the mirror, milliseconds. */
  durationMs: number;
}

/** Live, cumulative dual-write metrics (development instrumentation only). */
export interface EmployeeDualWriteState {
  runs: number;
  noops: number;
  created: number;
  updated: number;
  removed: number;
  skipped: number;
  validations: number;
  mismatches: number;
  /** Deep shadow-validation passes that found drift. */
  shadowDrift: number;
  failures: number;
  lastError: string | null;
  lastRunAt: string | null;
  recentMismatches: EmployeeWriteMismatch[];
}

const MAX_RECENT_MISMATCHES = 50;

const state: EmployeeDualWriteState = {
  runs: 0,
  noops: 0,
  created: 0,
  updated: 0,
  removed: 0,
  skipped: 0,
  validations: 0,
  mismatches: 0,
  shadowDrift: 0,
  failures: 0,
  lastError: null,
  lastRunAt: null,
  recentMismatches: [],
};

/** Returns an immutable snapshot of the cumulative dual-write metrics. */
export function getEmployeeDualWriteState(): EmployeeDualWriteState {
  return { ...state, recentMismatches: [...state.recentMismatches] };
}

/** Clears the cumulative dual-write metrics (used by tests + the dev console). */
export function resetEmployeeDualWriteState(): void {
  state.runs = 0;
  state.noops = 0;
  state.created = 0;
  state.updated = 0;
  state.removed = 0;
  state.skipped = 0;
  state.validations = 0;
  state.mismatches = 0;
  state.shadowDrift = 0;
  state.failures = 0;
  state.lastError = null;
  state.lastRunAt = null;
  state.recentMismatches = [];
}

/** Stable, comparison-friendly key for a single employee record. */
function fingerprint(employee: Employee): string {
  return JSON.stringify(employee);
}

/** Classifies prev → next into created / updated / removed id sets. */
function diffEmployees(prev: Employee[], next: Employee[]): EmployeeWriteDiff {
  const prevById = new Map(prev.map((e) => [e.id, e]));
  const nextById = new Map(next.map((e) => [e.id, e]));
  const created: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  for (const e of next) {
    const before = prevById.get(e.id);
    if (!before) created.push(e.id);
    else if (fingerprint(before) !== fingerprint(e)) updated.push(e.id);
  }
  for (const e of prev) {
    if (!nextById.has(e.id)) removed.push(e.id);
  }
  return { created, updated, removed };
}

function recordMismatch(m: EmployeeWriteMismatch): void {
  state.mismatches += 1;
  state.recentMismatches.unshift(m);
  if (state.recentMismatches.length > MAX_RECENT_MISMATCHES) {
    state.recentMismatches.length = MAX_RECENT_MISMATCHES;
  }
}

function normalise(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

/**
 * Re-reads each mirrored row from Supabase and compares the critical fields
 * against the authoritative localStorage record. Read-only; records drift but
 * never throws. Returns the mismatches found this run. Only non-PII summary
 * fields are compared (no phone / address / free text).
 */
async function validateMirroredRows(
  rows: EmployeeUpsertRow[],
  sourceById: Map<string, Employee>,
): Promise<EmployeeWriteMismatch[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const stop = perf.start("employee.write.validation");
  const found: EmployeeWriteMismatch[] = [];
  const at = new Date().toISOString();
  try {
    for (const row of rows) {
      const local = sourceById.get(row.legacy_id);
      if (!local) continue;
      const { data, error } = await supabase
        .from("employees")
        .select("legacy_id, company_legacy_id, name, email, status")
        .eq("legacy_id", row.legacy_id)
        .maybeSingle();
      state.validations += 1;
      if (error || !data) {
        const m: EmployeeWriteMismatch = {
          id: row.legacy_id,
          field: "missing",
          local: local.id,
          supabase: error ? `error: ${error.message}` : "no row",
          at,
        };
        found.push(m);
        recordMismatch(m);
        continue;
      }
      const r = data as unknown as {
        legacy_id: string;
        company_legacy_id: string;
        name: string;
        email: string;
        status: string;
      };
      const checks: Array<[EmployeeWriteField, string, string]> = [
        ["legacy_id", local.id, r.legacy_id],
        ["company_legacy_id", local.companyId, r.company_legacy_id],
        ["name", normalise(local.name), normalise(r.name)],
        ["email", normalise(local.email), normalise(r.email)],
        ["status", normalise(local.status), normalise(r.status)],
      ];
      for (const [field, localVal, supaVal] of checks) {
        if (localVal !== supaVal) {
          const m: EmployeeWriteMismatch = {
            id: row.legacy_id,
            field,
            local: localVal,
            supabase: supaVal,
            at,
          };
          found.push(m);
          recordMismatch(m);
        }
      }
    }
    return found;
  } finally {
    stop();
  }
}

/**
 * Runs a company-scoped deep shadow comparison for each company touched this
 * mirror run and records any divergence. Observability only — never blocks the
 * write. Returns the human-readable drift summaries found.
 */
async function deepShadowValidate(
  companyLegacyIds: Set<string>,
): Promise<string[]> {
  const drift: string[] = [];
  for (const companyId of companyLegacyIds) {
    try {
      const report = await shadowReadEmployees(companyId);
      if (!report.ok) {
        const summary = `company ${companyId}: ${report.notes.join("; ")}`;
        drift.push(summary);
        state.shadowDrift += 1;
        recordEmployeeShadowDrift(summary);
      }
    } catch (err) {
      const summary = `company ${companyId}: shadow read failed (${
        err instanceof Error ? err.message : "unknown"
      })`;
      drift.push(summary);
      state.shadowDrift += 1;
      recordEmployeeShadowDrift(summary);
    }
  }
  return drift;
}

/**
 * Mirrors an employee write (prev → next) into Supabase.
 *
 * Always call fire-and-forget AFTER the authoritative localStorage write has
 * completed. localStorage is never affected by this function; it only upserts
 * the changed rows into the `employees` table, soft-deletes removed rows, and
 * validates the result.
 *
 * @param prev The employees array BEFORE the write (authoritative previous state).
 * @param next The employees array AFTER the write (now persisted to localStorage).
 * @param options.shadowValidate When true, run the deeper company-scoped
 *   {@link shadowReadEmployees} parity pass after a successful mirror.
 */
export async function mirrorEmployeeWrites(
  prev: Employee[],
  next: Employee[],
  options?: { shadowValidate?: boolean },
): Promise<EmployeeDualWriteResult> {
  const shadowValidate = options?.shadowValidate ?? false;
  const stopDual = perf.start("employee.write.dual");
  const startedAt =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  state.runs += 1;
  state.lastRunAt = new Date().toISOString();

  const diff = diffEmployees(prev, next);

  const result: EmployeeDualWriteResult = {
    ok: false,
    noop: false,
    diff,
    mirrored: 0,
    removed: 0,
    skipped: [],
    mismatches: [],
    shadowDrift: [],
    error: null,
    durationMs: 0,
  };

  const finish = (): EmployeeDualWriteResult => {
    stopDual();
    result.durationMs =
      (typeof performance !== "undefined" ? performance.now() : Date.now()) -
      startedAt;
    return result;
  };

  const changedIds = [...diff.created, ...diff.updated];
  if (changedIds.length === 0 && diff.removed.length === 0) {
    state.noops += 1;
    result.ok = true;
    result.noop = true;
    return finish();
  }

  if (!isSupabaseConfigured || !supabase) {
    // localStorage already succeeded; record the failed mirror, never throw.
    state.failures += 1;
    state.lastError = "Supabase is not configured.";
    result.error = "Supabase is not configured.";
    return finish();
  }

  const nextById = new Map(next.map((e) => [e.id, e]));
  const stopWrite = perf.start("employee.write.supabase");
  try {
    const companyMap = await loadCompanyUuidMap();
    const rows: EmployeeUpsertRow[] = [];
    const sourceById = new Map<string, Employee>();
    const touchedCompanies = new Set<string>();
    for (const id of changedIds) {
      const employee = nextById.get(id);
      if (!employee) continue;
      const uuid = companyMap.get(employee.companyId) ?? null;
      if (!uuid) {
        result.skipped.push({
          id,
          reason: `No Supabase company for legacy_id "${employee.companyId}". Migrate companies first.`,
        });
        state.skipped += 1;
        continue;
      }
      rows.push(toEmployeeUpsertRow(employee, uuid));
      sourceById.set(id, employee);
      touchedCompanies.add(employee.companyId);
    }

    if (rows.length > 0) {
      const { error } = await supabase
        .from("employees")
        .upsert(rows, { onConflict: "legacy_id" });
      if (error) {
        state.failures += 1;
        state.lastError = error.message;
        result.error = `Supabase upsert failed: ${error.message}`;
        return finish();
      }
      result.mirrored = rows.length;
      const createdSet = new Set(diff.created);
      for (const row of rows) {
        if (createdSet.has(row.legacy_id)) state.created += 1;
        else state.updated += 1;
      }
    }

    // Removal propagation (WO-5.6 convention): soft-delete the removed rows so no
    // stale employee survives. A failure here is recorded but never blocks the op.
    if (diff.removed.length > 0) {
      const { error } = await supabase
        .from("employees")
        .update({ deleted_at: new Date().toISOString() })
        .in("legacy_id", diff.removed);
      if (error) {
        state.failures += 1;
        state.lastError = error.message;
        result.error = `Supabase soft-delete failed: ${error.message}`;
        return finish();
      }
      result.removed = diff.removed.length;
      state.removed += diff.removed.length;
    }

    stopWrite();

    // Post-write parity validation — surfaces drift, never blocks anything.
    result.mismatches = await validateMirroredRows(rows, sourceById);

    // Optional deep shadow validation (EMPLOYEES_SHADOW_VALIDATE) — broader
    // company-scoped parity beyond the just-written rows. Observability only.
    if (shadowValidate && touchedCompanies.size > 0) {
      result.shadowDrift = await deepShadowValidate(touchedCompanies);
    }

    result.ok =
      result.error === null &&
      result.skipped.length === 0 &&
      result.mismatches.length === 0;
    return finish();
  } catch (err) {
    stopWrite();
    state.failures += 1;
    state.lastError = err instanceof Error ? err.message : "Unknown mirror error.";
    result.error = state.lastError;
    return finish();
  }
}

// Expose a console handle in development for manual inspection.
if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    mirrorEmployeeWrites,
    getEmployeeDualWriteState,
    resetEmployeeDualWriteState,
  };
}
