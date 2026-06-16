/**
 * Booking Queue dual-write mirror (BQ-1).
 *
 * The Booking Queue analogue of {@link import("./areaDualWrite")}. localStorage
 * stays the source of truth: every queue write completes against localStorage
 * BEFORE this runs. When dual-write / authoritative mode is on, AppContext fires
 * {@link mirrorBookingQueueWrites} to MIRROR the change into the `booking_queue`
 * table.
 *
 * Guarantees (identical to the proven area mirror): never throws, idempotent
 * upsert on `legacy_id`, company-scoped, removal propagation (soft-delete),
 * self-validating post-write.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { BookingQueueItem } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import { toBookingQueueUpsertRow, type BookingQueueUpsertRow } from "./bookingQueueMigration";

export type BookingQueueWriteField =
  | "legacy_id"
  | "company_legacy_id"
  | "work_order_legacy_id"
  | "service_row_legacy_id";

export interface BookingQueueWriteMismatch {
  id: string;
  field: BookingQueueWriteField | "missing";
  local: string;
  supabase: string;
  at: string;
}

export interface BookingQueueWriteDiff {
  created: string[];
  updated: string[];
  removed: string[];
}

export interface BookingQueueDualWriteResult {
  ok: boolean;
  noop: boolean;
  diff: BookingQueueWriteDiff;
  mirrored: number;
  removed: number;
  skipped: Array<{ id: string; reason: string }>;
  mismatches: BookingQueueWriteMismatch[];
  error: string | null;
  durationMs: number;
}

export interface BookingQueueDualWriteState {
  runs: number;
  noops: number;
  created: number;
  updated: number;
  removed: number;
  skipped: number;
  validations: number;
  mismatches: number;
  failures: number;
  lastError: string | null;
  lastRunAt: string | null;
  recentMismatches: BookingQueueWriteMismatch[];
}

const MAX_RECENT_MISMATCHES = 50;

const state: BookingQueueDualWriteState = {
  runs: 0,
  noops: 0,
  created: 0,
  updated: 0,
  removed: 0,
  skipped: 0,
  validations: 0,
  mismatches: 0,
  failures: 0,
  lastError: null,
  lastRunAt: null,
  recentMismatches: [],
};

export function getBookingQueueDualWriteState(): BookingQueueDualWriteState {
  return { ...state, recentMismatches: [...state.recentMismatches] };
}

export function resetBookingQueueDualWriteState(): void {
  state.runs = 0;
  state.noops = 0;
  state.created = 0;
  state.updated = 0;
  state.removed = 0;
  state.skipped = 0;
  state.validations = 0;
  state.mismatches = 0;
  state.failures = 0;
  state.lastError = null;
  state.lastRunAt = null;
  state.recentMismatches = [];
}

function fingerprint(item: BookingQueueItem): string {
  return JSON.stringify(item);
}

function diffBookingQueue(
  prev: BookingQueueItem[],
  next: BookingQueueItem[],
): BookingQueueWriteDiff {
  const prevById = new Map(prev.map((b) => [b.id, b]));
  const nextById = new Map(next.map((b) => [b.id, b]));
  const created: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  for (const b of next) {
    const before = prevById.get(b.id);
    if (!before) created.push(b.id);
    else if (fingerprint(before) !== fingerprint(b)) updated.push(b.id);
  }
  for (const b of prev) {
    if (!nextById.has(b.id)) removed.push(b.id);
  }
  return { created, updated, removed };
}

function recordMismatch(m: BookingQueueWriteMismatch): void {
  state.mismatches += 1;
  state.recentMismatches.unshift(m);
  if (state.recentMismatches.length > MAX_RECENT_MISMATCHES) {
    state.recentMismatches.length = MAX_RECENT_MISMATCHES;
  }
}

async function validateMirroredRows(
  rows: BookingQueueUpsertRow[],
  sourceById: Map<string, BookingQueueItem>,
): Promise<BookingQueueWriteMismatch[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const stop = perf.start("bookingQueue.write.validation");
  const found: BookingQueueWriteMismatch[] = [];
  const at = new Date().toISOString();
  try {
    for (const row of rows) {
      const local = sourceById.get(row.legacy_id);
      if (!local) continue;
      const { data, error } = await supabase
        .from("booking_queue")
        .select("legacy_id, company_legacy_id, work_order_legacy_id, service_row_legacy_id")
        .eq("legacy_id", row.legacy_id)
        .maybeSingle();
      state.validations += 1;
      if (error || !data) {
        const m: BookingQueueWriteMismatch = {
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
        work_order_legacy_id: string;
        service_row_legacy_id: string;
      };
      const checks: Array<[BookingQueueWriteField, string, string]> = [
        ["legacy_id", local.id, r.legacy_id],
        ["company_legacy_id", local.companyId, r.company_legacy_id],
        ["work_order_legacy_id", local.workOrderId, r.work_order_legacy_id],
        ["service_row_legacy_id", local.serviceRowId, r.service_row_legacy_id],
      ];
      for (const [field, localVal, supaVal] of checks) {
        if (localVal !== supaVal) {
          const m: BookingQueueWriteMismatch = {
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

/** Mirrors a booking-queue write (prev → next) into Supabase. */
export async function mirrorBookingQueueWrites(
  prev: BookingQueueItem[],
  next: BookingQueueItem[],
): Promise<BookingQueueDualWriteResult> {
  const stopDual = perf.start("bookingQueue.write.dual");
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  state.runs += 1;
  state.lastRunAt = new Date().toISOString();

  const diff = diffBookingQueue(prev, next);

  const result: BookingQueueDualWriteResult = {
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

  const finish = (): BookingQueueDualWriteResult => {
    stopDual();
    result.durationMs =
      (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt;
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
    state.failures += 1;
    state.lastError = "Supabase is not configured.";
    result.error = "Supabase is not configured.";
    return finish();
  }

  const nextById = new Map(next.map((b) => [b.id, b]));
  const stopWrite = perf.start("bookingQueue.write.supabase");
  try {
    const companyMap = await loadCompanyUuidMap();
    const rows: BookingQueueUpsertRow[] = [];
    const sourceById = new Map<string, BookingQueueItem>();
    for (const id of changedIds) {
      const item = nextById.get(id);
      if (!item) continue;
      const uuid = companyMap.get(item.companyId) ?? null;
      if (!uuid) {
        result.skipped.push({
          id,
          reason: `No Supabase company for legacy_id "${item.companyId}". Migrate companies first.`,
        });
        state.skipped += 1;
        continue;
      }
      rows.push(toBookingQueueUpsertRow(item, uuid));
      sourceById.set(id, item);
    }

    if (rows.length > 0) {
      const { error } = await supabase
        .from("booking_queue")
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

    if (diff.removed.length > 0) {
      const { error } = await supabase
        .from("booking_queue")
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

    result.mismatches = await validateMirroredRows(rows, sourceById);
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

if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    mirrorBookingQueueWrites,
    getBookingQueueDualWriteState,
    resetBookingQueueDualWriteState,
  };
}
