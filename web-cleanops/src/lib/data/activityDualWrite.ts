/**
 * Activity Log dual-write mirror (ACTIVITY-1).
 *
 * The Activity Log analogue of {@link import("./areaDualWrite")}, but APPEND-ONLY.
 * localStorage stays the source of truth: every audit event is appended to
 * localStorage BEFORE this runs. When dual-write / authoritative mode is on,
 * AppContext fires {@link mirrorActivityAppend} to MIRROR the newly-appended
 * event(s) into the `activity_events` table.
 *
 * Because the trail is immutable there is NO update or removal path — the mirror
 * only inserts events present in `next` but not `prev`. Idempotent upsert on
 * `legacy_id` makes re-runs safe. Guarantees (identical to the proven mirrors):
 * never throws, self-validating counters, recorded failures.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { AuditEvent } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import { toActivityEventUpsertRow, type ActivityEventUpsertRow } from "./activityMigration";

export interface ActivityDualWriteState {
  runs: number;
  noops: number;
  appended: number;
  skipped: number;
  failures: number;
  lastError: string | null;
  lastRunAt: string | null;
}

const state: ActivityDualWriteState = {
  runs: 0,
  noops: 0,
  appended: 0,
  skipped: 0,
  failures: 0,
  lastError: null,
  lastRunAt: null,
};

export function getActivityDualWriteState(): ActivityDualWriteState {
  return { ...state };
}

export function resetActivityDualWriteState(): void {
  state.runs = 0;
  state.noops = 0;
  state.appended = 0;
  state.skipped = 0;
  state.failures = 0;
  state.lastError = null;
  state.lastRunAt = null;
}

export interface ActivityDualWriteResult {
  ok: boolean;
  noop: boolean;
  appended: number;
  skipped: Array<{ id: string; reason: string }>;
  error: string | null;
}

/**
 * Mirrors newly-appended audit events (prev → next) into Supabase. Only events
 * present in `next` but absent from `prev` are inserted.
 */
export async function mirrorActivityAppend(
  prev: AuditEvent[],
  next: AuditEvent[],
): Promise<ActivityDualWriteResult> {
  const stop = perf.start("activity.write.dual");
  state.runs += 1;
  state.lastRunAt = new Date().toISOString();

  const result: ActivityDualWriteResult = {
    ok: false,
    noop: false,
    appended: 0,
    skipped: [],
    error: null,
  };

  const fail = (message: string): ActivityDualWriteResult => {
    state.failures += 1;
    state.lastError = message;
    result.error = message;
    return result;
  };

  try {
    const prevIds = new Set(prev.map((e) => e.id));
    const added = next.filter((e) => !prevIds.has(e.id));
    if (added.length === 0) {
      state.noops += 1;
      result.ok = true;
      result.noop = true;
      return result;
    }

    if (!isSupabaseConfigured || !supabase) return fail("Supabase is not configured.");

    const companyMap = await loadCompanyUuidMap();
    const rows: ActivityEventUpsertRow[] = [];
    for (const event of added) {
      const uuid = event.companyId ? companyMap.get(event.companyId) ?? null : null;
      if (event.companyId && !uuid) {
        result.skipped.push({
          id: event.id,
          reason: `No Supabase company for legacy_id "${event.companyId}". Migrate companies first.`,
        });
        state.skipped += 1;
        continue;
      }
      rows.push(toActivityEventUpsertRow(event, uuid));
    }

    if (rows.length > 0) {
      const { error } = await supabase
        .from("activity_events")
        .upsert(rows, { onConflict: "legacy_id" });
      if (error) return fail(`Supabase insert failed: ${error.message}`);
      result.appended = rows.length;
      state.appended += rows.length;
    }

    result.ok = result.skipped.length === 0;
    return result;
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Unknown mirror error.");
  } finally {
    stop();
  }
}

if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    mirrorActivityAppend,
    getActivityDualWriteState,
    resetActivityDualWriteState,
  };
}
