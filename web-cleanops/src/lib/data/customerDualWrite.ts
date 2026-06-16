/**
 * Customer dual-write mirror (P4H · Wave 1D).
 *
 * The FIRST write-path migration step. localStorage stays the single source of
 * truth: every customer write completes synchronously against localStorage
 * BEFORE this module runs. When the {@link CUSTOMERS_DUAL_WRITE} flag is on,
 * `persistCustomers` (AppContext) fires {@link mirrorCustomerWrites} in the
 * background to MIRROR the same change into the Supabase `customers` table.
 *
 * Guarantees:
 *   • Never throws — it is always invoked fire-and-forget (`void mirror…`), so a
 *     Supabase failure / timeout can never break a customer operation.
 *   • Idempotent — writes are `upsert` on the unique `legacy_id`, so re-running
 *     (or repeated saves of the same record) never inflates or duplicates rows.
 *     An upsert UNDELETES a row (writes `deleted_at = null`), so re-creating /
 *     reactivating a customer with the same legacy_id atomically restores it.
 *   • Removal-propagating — ids present-before / absent-after a write are
 *     SOFT-DELETED in Supabase (`deleted_at` stamp; RLS blocks hard delete), so
 *     no stale customer survives to reappear under authoritative reads. Read
 *     paths filter `deleted_at`, so a soft-deleted customer vanishes everywhere.
 *     Archive stays a `status` UPDATE — it is NOT a soft delete.
 *   • Company-scoped — each row carries the real `company_id` UUID that RLS
 *     checks; rows whose company has no Supabase mapping are skipped + surfaced.
 *   • Self-validating — after mirroring, it re-reads the affected rows and
 *     compares the critical fields, recording any drift (never silently hidden).
 *
 * All runtime state lives in {@link getCustomerDualWriteState}, which backs the
 * Super Admin "Customer Dual Write" monitoring panel.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { Customer } from "@/types";
import {
  loadCompanyUuidMap,
  toCustomerUpsertRow,
  type CustomerUpsertRow,
} from "./customerMigration";

/** Critical fields validated after every mirrored write. */
export type CustomerWriteField =
  | "legacy_id"
  | "company_legacy_id"
  | "customer_number"
  | "status"
  | "updated_at";

/** A single field-level discrepancy found while validating a mirrored write. */
export interface CustomerWriteMismatch {
  /** App-facing customer id. */
  id: string;
  /** The critical field that differs (or "missing" when the row never arrived). */
  field: CustomerWriteField | "missing";
  /** Value persisted to localStorage (authoritative). */
  local: string;
  /** Value read back from Supabase. */
  supabase: string;
  /** When the mismatch was observed. */
  at: string;
}

/** The classification of changes a single mirror operation carried. */
export interface CustomerWriteDiff {
  created: string[];
  updated: string[];
  /** Ids present before but gone after — SOFT-DELETED in Supabase (deleted_at). */
  removed: string[];
}

/** Structured outcome of one {@link mirrorCustomerWrites} run. */
export interface CustomerDualWriteResult {
  ok: boolean;
  /** True when nothing changed between prev/next (no Supabase work done). */
  noop: boolean;
  diff: CustomerWriteDiff;
  /** Rows actually upserted to Supabase. */
  mirrored: number;
  /** Rows soft-deleted in Supabase (removal propagated). */
  removed: number;
  /** Source customers skipped (no company mapping / RLS would reject). */
  skipped: Array<{ id: string; reason: string }>;
  /** Field-level mismatches found by the post-write validation. */
  mismatches: CustomerWriteMismatch[];
  /** Fatal error captured (never thrown to the caller). */
  error: string | null;
  /** Total wall-clock duration of the mirror, milliseconds. */
  durationMs: number;
}

/** Live, cumulative dual-write metrics (development instrumentation only). */
export interface CustomerDualWriteState {
  /** Mirror operations attempted (one per customer write while the flag is on). */
  runs: number;
  /** Runs that performed no Supabase work (nothing changed). */
  noops: number;
  /** Rows created in Supabase. */
  created: number;
  /** Rows updated in Supabase. */
  updated: number;
  /** Removals detected locally (present-before / absent-after a write). */
  removedDetected: number;
  /** Rows soft-deleted in Supabase (removal propagated via deleted_at). */
  removed: number;
  /** Source rows skipped for want of a company mapping. */
  skipped: number;
  /** Post-write validation passes performed. */
  validations: number;
  /** Field-level mismatches observed across all runs. */
  mismatches: number;
  /** Mirror runs that failed (Supabase unavailable / error / timeout). */
  failures: number;
  /** Most recent fatal error message, if any. */
  lastError: string | null;
  /** ISO timestamp of the last mirror run. */
  lastRunAt: string | null;
  /** Bounded ring of the most recent mismatches, for the monitoring panel. */
  recentMismatches: CustomerWriteMismatch[];
}

const MAX_RECENT_MISMATCHES = 50;

const state: CustomerDualWriteState = {
  runs: 0,
  noops: 0,
  created: 0,
  updated: 0,
  removedDetected: 0,
  removed: 0,
  skipped: 0,
  validations: 0,
  mismatches: 0,
  failures: 0,
  lastError: null,
  lastRunAt: null,
  recentMismatches: [],
};

/** Returns an immutable snapshot of the cumulative dual-write metrics. */
export function getCustomerDualWriteState(): CustomerDualWriteState {
  return { ...state, recentMismatches: [...state.recentMismatches] };
}

/** Clears the cumulative dual-write metrics (used by tests + the dev console). */
export function resetCustomerDualWriteState(): void {
  state.runs = 0;
  state.noops = 0;
  state.created = 0;
  state.updated = 0;
  state.removedDetected = 0;
  state.removed = 0;
  state.skipped = 0;
  state.validations = 0;
  state.mismatches = 0;
  state.failures = 0;
  state.lastError = null;
  state.lastRunAt = null;
  state.recentMismatches = [];
}

/** Stable, comparison-friendly key for a single customer record. */
function fingerprint(customer: Customer): string {
  return JSON.stringify(customer);
}

/** Classifies prev → next into created / updated / removed id sets. */
function diffCustomers(prev: Customer[], next: Customer[]): CustomerWriteDiff {
  const prevById = new Map(prev.map((c) => [c.id, c]));
  const nextById = new Map(next.map((c) => [c.id, c]));
  const created: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  for (const c of next) {
    const before = prevById.get(c.id);
    if (!before) created.push(c.id);
    else if (fingerprint(before) !== fingerprint(c)) updated.push(c.id);
  }
  for (const c of prev) {
    if (!nextById.has(c.id)) removed.push(c.id);
  }
  return { created, updated, removed };
}

/**
 * Returns the unique set of customer ids a `prev → next` write touches
 * (created ∪ updated ∪ removed). Used by the ordered mirror queue to know which
 * customers a given mirror operation must serialize against. Empty means a noop.
 */
export function affectedCustomerIds(
  prev: Customer[],
  next: Customer[],
): string[] {
  const { created, updated, removed } = diffCustomers(prev, next);
  return [...new Set([...created, ...updated, ...removed])];
}

function recordMismatch(m: CustomerWriteMismatch): void {
  state.mismatches += 1;
  state.recentMismatches.unshift(m);
  if (state.recentMismatches.length > MAX_RECENT_MISMATCHES) {
    state.recentMismatches.length = MAX_RECENT_MISMATCHES;
  }
}

function normaliseStatus(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

/**
 * Re-reads each mirrored row from Supabase and compares the critical fields
 * against the authoritative localStorage record. Read-only; records drift but
 * never throws. Returns the mismatches found this run.
 */
async function validateMirroredRows(
  rows: CustomerUpsertRow[],
  sourceById: Map<string, Customer>,
): Promise<CustomerWriteMismatch[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const stop = perf.start("customer.write.validation");
  const found: CustomerWriteMismatch[] = [];
  const at = new Date().toISOString();
  try {
    for (const row of rows) {
      const local = sourceById.get(row.legacy_id);
      if (!local) continue;
      const { data, error } = await supabase
        .from("customers")
        .select("legacy_id, company_legacy_id, customer_number, status, data")
        .eq("legacy_id", row.legacy_id)
        .maybeSingle();
      state.validations += 1;
      if (error || !data) {
        const m: CustomerWriteMismatch = {
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
        customer_number: string;
        status: string;
        data: Customer | null;
      };
      const checks: Array<[CustomerWriteField, string, string]> = [
        ["legacy_id", local.id, r.legacy_id],
        ["company_legacy_id", local.companyId, r.company_legacy_id],
        ["customer_number", local.customerNumber, r.customer_number],
        ["status", normaliseStatus(local.status), normaliseStatus(r.status)],
        // updated_at lives in the lossless `data` payload (the column is a
        // server trigger value and intentionally diverges from the source).
        [
          "updated_at",
          normaliseStatus(local.updatedAt),
          normaliseStatus(r.data?.updatedAt),
        ],
      ];
      for (const [field, localVal, supaVal] of checks) {
        if (localVal !== supaVal) {
          const m: CustomerWriteMismatch = {
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
 * Mirrors a customer write (prev → next) into Supabase.
 *
 * Always call fire-and-forget AFTER the authoritative localStorage write has
 * completed. localStorage is never affected by this function; it only upserts
 * the changed rows into the shadow `customers` table and validates the result.
 *
 * @param prev The customers array BEFORE the write (authoritative previous state).
 * @param next The customers array AFTER the write (now persisted to localStorage).
 */
export async function mirrorCustomerWrites(
  prev: Customer[],
  next: Customer[],
): Promise<CustomerDualWriteResult> {
  const stopDual = perf.start("customer.write.dual");
  const startedAt =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  state.runs += 1;
  state.lastRunAt = new Date().toISOString();

  const diff = diffCustomers(prev, next);
  state.removedDetected += diff.removed.length;

  const result: CustomerDualWriteResult = {
    ok: false,
    noop: false,
    diff,
    mirrored: 0,
    removed: 0,
    skipped: [],
    mismatches: [],
    error: null,
    durationMs: 0,
  };

  const finish = (): CustomerDualWriteResult => {
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

  const nextById = new Map(next.map((c) => [c.id, c]));
  const stopWrite = perf.start("customer.write.supabase");
  try {
    const companyMap = await loadCompanyUuidMap();
    const rows: CustomerUpsertRow[] = [];
    const sourceById = new Map<string, Customer>();
    for (const id of changedIds) {
      const customer = nextById.get(id);
      if (!customer) continue;
      const uuid = companyMap.get(customer.companyId) ?? null;
      if (!uuid) {
        result.skipped.push({
          id,
          reason: `No Supabase company for legacy_id "${customer.companyId}". Migrate companies first.`,
        });
        state.skipped += 1;
        continue;
      }
      rows.push(toCustomerUpsertRow(customer, uuid));
      sourceById.set(id, customer);
    }

    if (rows.length > 0) {
      const { error } = await supabase
        .from("customers")
        .upsert(rows, { onConflict: "legacy_id" });
      if (error) {
        state.failures += 1;
        state.lastError = error.message;
        result.error = `Supabase upsert failed: ${error.message}`;
        return finish();
      }
      result.mirrored = rows.length;
      // Attribute created vs updated for the monitoring panel.
      const createdSet = new Set(diff.created);
      for (const row of rows) {
        if (createdSet.has(row.legacy_id)) state.created += 1;
        else state.updated += 1;
      }
    }

    // Removal propagation (mirrors work_orders 0009 / employees 0010): soft-delete
    // the removed rows so no stale customer survives to reappear under
    // authoritative reads. RLS blocks hard delete; this is an idempotent UPDATE
    // that stamps `deleted_at`. A failure here is recorded but never thrown.
    if (diff.removed.length > 0) {
      const { error } = await supabase
        .from("customers")
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
    result.ok = result.error === null && result.skipped.length === 0 &&
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
// Merges with the handles already attached in `parity.ts` / `customerMigration.ts`.
if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    mirrorCustomerWrites,
    getCustomerDualWriteState,
    resetCustomerDualWriteState,
  };
}
