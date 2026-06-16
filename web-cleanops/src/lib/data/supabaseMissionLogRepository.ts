/**
 * Supabase-backed Mission Log READ repository (Slice 2b-1).
 *
 * The first read adapter for the Operational Execution EXECUTION LEDGER. It
 * implements the storage-agnostic {@link MissionLogRepository} contract against
 * the Mission Log tables from migration 0031 (`mission_log_entries`,
 * `mission_staff_sessions`, `mission_log_events`) and returns the SAME
 * {@link MissionLogSummary} / {@link MissionLogDetail} shapes the contract
 * declares, rebuilt losslessly from the `data` jsonb.
 *
 * SCOPE — READ ONLY, DORMANT. This is NOT wired into AppContext, any page or any
 * route, there is no dual-write / shadow-read / cut-over, and the legacy checkout
 * `TimeReport` flow is untouched. {@link shouldReadMissionLogFromSupabase} exposes
 * the dormant {@link MISSION_LOG_SUPABASE_READ} gate (DEFAULT OFF) for a future
 * consumer; nothing reads it yet.
 *
 * QUERY RULES (Slice 2b-1):
 *   - Every query is company-scoped first (by the app-facing `company_legacy_id`).
 *   - Soft-deleted rows (`deleted_at` set) are excluded by default.
 *   - Filtering + pagination happen SERVER-SIDE (`.eq/.in/.gte/.lte/.or` + `.range`
 *     + `{ count: "exact" }`) — rows are never fully loaded and sliced in memory.
 *   - List summaries stay lightweight: the flat summary columns + the single
 *     `data` jsonb of the entry row, never the sessions or the event stream.
 *   - Staff sessions and the event stream load ONLY in {@link getDetail}.
 *   - The event stream is ordered deterministically (`occurred_at` asc, then id).
 *
 * EMPTY SUPABASE IS VALID: an empty result returns an empty list / `total: 0` and
 * a missing entry returns `null` — there is NO fallback to localStorage, NO seed
 * and NO unsafe-empty behaviour. Mission Log is execution-ledger only: this
 * adapter never mutates Schedule, payroll, invoices or the time bank.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import { evaluateSearchThreshold } from "@/lib/searchThreshold";
import { MISSION_LOG_SUPABASE_READ } from "@/lib/featureFlags";
import type {
  DelayStatus,
  MissionLogEntry,
  MissionLogEvent,
  MissionStaffSession,
  MissionStatus,
} from "@/types/missionLog";
import type {
  MissionLogDetail,
  MissionLogListParams,
  MissionLogRepository,
  MissionLogSummary,
} from "./missionLogRepository";
import type { CountParams, DetailParams, ListResult } from "./types";

/**
 * Lightweight summary columns + the lossless entry `data` jsonb. The flat
 * columns drive server-side filtering / ordering / pagination; `data` supplies
 * the few summary fields kept only in the jsonb (name snapshot + actual times).
 * The sessions and the event stream are NOT selected here.
 */
const SUMMARY_COLUMNS =
  "legacy_id, company_legacy_id, booking_occurrence_legacy_id, work_order_legacy_id, " +
  "customer_legacy_id, service_row_legacy_id, scheduled_start_time, scheduled_end_time, " +
  "mission_status, delay_status, requires_admin_review, data";

/** Shape of the flat summary columns (+ `data`) returned by Supabase. */
interface MissionEntrySummaryRow {
  legacy_id: string;
  company_legacy_id: string;
  booking_occurrence_legacy_id: string;
  work_order_legacy_id: string | null;
  customer_legacy_id: string | null;
  service_row_legacy_id: string | null;
  scheduled_start_time: string | null;
  scheduled_end_time: string | null;
  mission_status: string;
  delay_status: string;
  requires_admin_review: boolean;
  data: MissionLogEntry | null;
}

/** Shape of a full entry row used by {@link getDetail}. */
interface MissionEntryDetailRow {
  data: MissionLogEntry | null;
  company_legacy_id: string;
  deleted_at: string | null;
}

/** Thrown when the repository is used but Supabase is not configured. */
class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "SupabaseMissionLogRepository requires Supabase. Set EXPO_PUBLIC_SUPABASE_URL " +
        "and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

/**
 * Dormant read gate (DEFAULT OFF). Slice 2b-1 wires NO live consumer; this is
 * here so a later read-seam wave can switch the Mission Log read source without
 * renaming. It deliberately does NOT use the cut-over resolver.
 */
export function shouldReadMissionLogFromSupabase(): boolean {
  return MISSION_LOG_SUPABASE_READ;
}

function rowToSummary(row: MissionEntrySummaryRow): MissionLogSummary {
  const d = row.data ?? ({} as Partial<MissionLogEntry>);
  return {
    id: row.legacy_id,
    companyId: row.company_legacy_id,
    bookingOccurrenceId: row.booking_occurrence_legacy_id,
    workOrderId: row.work_order_legacy_id ?? d.workOrderId ?? undefined,
    customerId: row.customer_legacy_id ?? d.customerId ?? "",
    customerNameSnapshot: d.customerNameSnapshot ?? "",
    scheduledStartTime: row.scheduled_start_time ?? d.scheduledStartTime ?? "",
    scheduledEndTime: row.scheduled_end_time ?? d.scheduledEndTime ?? "",
    actualStartTime: d.actualStartTime ?? undefined,
    actualEndTime: d.actualEndTime ?? undefined,
    missionStatus: row.mission_status as MissionStatus,
    delayStatus: row.delay_status as DelayStatus,
    requiresAdminReview: row.requires_admin_review,
  };
}

/**
 * A minimal structural view of the chainable PostgREST query the filters touch.
 * Typed locally so the filter helper can be shared by list / search without
 * leaking `any` into the public surface.
 */
interface FilterableQuery {
  eq(column: string, value: unknown): FilterableQuery;
  in(column: string, values: readonly unknown[]): FilterableQuery;
  is(column: string, value: unknown): FilterableQuery;
  gte(column: string, value: unknown): FilterableQuery;
  lte(column: string, value: unknown): FilterableQuery;
  or(filters: string): FilterableQuery;
}

/** Builds the identifier-aware free-text OR expression (server-side ilike). */
function buildSearchExpression(rawSearch: string | undefined): string | null {
  const { activeQuery, shouldSearch } = evaluateSearchThreshold(rawSearch ?? "");
  if (!shouldSearch) return null;
  const term = activeQuery.replace(/[*,]/g, "").toLowerCase();
  if (!term) return null;
  return [
    `customer_legacy_id.ilike.*${term}*`,
    `work_order_legacy_id.ilike.*${term}*`,
    `booking_occurrence_legacy_id.ilike.*${term}*`,
    `service_row_legacy_id.ilike.*${term}*`,
  ].join(",");
}

/**
 * Applies the company scope, the soft-delete exclusion and every Mission Log
 * filter to a query. Date bounds ("YYYY-MM-DD") are widened to whole-day
 * timestamptz windows so the inclusive `[fromDate, toDate]` range matches the
 * full day on the `scheduled_start_time` column.
 */
function applyListFilters<Q extends FilterableQuery>(
  query: Q,
  params: MissionLogListParams,
): Q {
  let q: FilterableQuery = query;
  if (params.companyId !== undefined && params.companyId !== null) {
    q = q.eq("company_legacy_id", params.companyId);
  }
  q = q.is("deleted_at", null);
  if (params.fromDate) {
    q = q.gte("scheduled_start_time", `${params.fromDate}T00:00:00.000Z`);
  }
  if (params.toDate) {
    q = q.lte("scheduled_start_time", `${params.toDate}T23:59:59.999Z`);
  }
  if (params.missionStatuses && params.missionStatuses.length > 0) {
    q = q.in("mission_status", params.missionStatuses);
  }
  if (params.delayStatuses && params.delayStatuses.length > 0) {
    q = q.in("delay_status", params.delayStatuses);
  }
  if (params.requiresAdminReviewOnly) {
    q = q.eq("requires_admin_review", true);
  }
  if (params.customerId) {
    q = q.eq("customer_legacy_id", params.customerId);
  }
  if (params.serviceRowLegacyId) {
    q = q.eq("service_row_legacy_id", params.serviceRowLegacyId);
  }
  const searchExpr = buildSearchExpression(params.search);
  if (searchExpr) {
    q = q.or(searchExpr);
  }
  return q as Q;
}

/** Shared list/search read path: server-side filtered + paginated summaries. */
async function queryPage(
  params: MissionLogListParams,
): Promise<ListResult<MissionLogSummary>> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("missionLog.list.supabase.summaries");
  try {
    let query = supabase
      .from("mission_log_entries")
      .select(SUMMARY_COLUMNS, { count: "exact" }) as unknown as FilterableQuery;
    query = applyListFilters(query, params);
    // Deterministic ordering: newest scheduled mission first, legacy_id tiebreak.
    let ordered = (query as unknown as {
      order(column: string, opts: { ascending: boolean }): unknown;
    }).order("scheduled_start_time", { ascending: false });
    ordered = (ordered as {
      order(column: string, opts: { ascending: boolean }): unknown;
    }).order("legacy_id", { ascending: true });

    const pageSize = params.pageSize;
    const page = params.page && params.page > 0 ? params.page : 1;
    let finalQuery = ordered;
    if (pageSize && pageSize > 0) {
      const from = (page - 1) * pageSize;
      finalQuery = (ordered as {
        range(from: number, to: number): unknown;
      }).range(from, from + pageSize - 1);
    }

    const { data, error, count } = (await finalQuery) as {
      data: MissionEntrySummaryRow[] | null;
      error: { message: string } | null;
      count: number | null;
    };
    if (error) throw new Error(`[missionLog] Supabase list failed: ${error.message}`);
    const items = (data ?? []).map(rowToSummary);
    const total = count ?? items.length;
    return {
      items,
      total,
      page: pageSize && pageSize > 0 ? page : 1,
      pageSize: pageSize && pageSize > 0 ? pageSize : total,
    };
  } finally {
    stop();
  }
}

/** Loads the per-employee sessions for one mission (soft-deleted excluded). */
async function loadStaffSessions(entryLegacyId: string): Promise<MissionStaffSession[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("mission_staff_sessions")
    .select("data, deleted_at")
    .eq("mission_log_entry_legacy_id", entryLegacyId);
  if (error) {
    throw new Error(`[missionLog] Supabase sessions failed: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as {
    data: MissionStaffSession | null;
    deleted_at: string | null;
  }[];
  return rows
    .filter((r) => !r.deleted_at)
    .map((r) => r.data)
    .filter((s): s is MissionStaffSession => Boolean(s));
}

/**
 * Loads the IMMUTABLE event stream for one mission, ordered deterministically
 * (oldest first by `occurred_at`, then `legacy_id`). The events table has no
 * soft-delete column — it is append-only.
 */
async function loadEvents(entryLegacyId: string): Promise<MissionLogEvent[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("mission_log_events")
    .select("data, occurred_at, legacy_id")
    .eq("mission_log_entry_legacy_id", entryLegacyId)
    .order("occurred_at", { ascending: true })
    .order("legacy_id", { ascending: true });
  if (error) {
    throw new Error(`[missionLog] Supabase events failed: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as { data: MissionLogEvent | null }[];
  return rows.map((r) => r.data).filter((e): e is MissionLogEvent => Boolean(e));
}

/** The Slice 2b-1 read-only Mission Log repository (dormant — no live consumer). */
export const supabaseMissionLogRepository: MissionLogRepository = {
  async listSummaries(params: MissionLogListParams = {}) {
    return queryPage(params);
  },

  async getDetail(id: string, params: DetailParams = {}) {
    if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
    const stop = perf.start("missionLog.detail.supabase");
    try {
      const { data, error } = await supabase
        .from("mission_log_entries")
        .select("data, company_legacy_id, deleted_at")
        .eq("legacy_id", id)
        .maybeSingle();
      if (error) {
        throw new Error(`[missionLog] Supabase detail failed: ${error.message}`);
      }
      if (!data) return null;
      const row = data as unknown as MissionEntryDetailRow;
      if (row.deleted_at) return null;
      if (
        params.companyId !== undefined &&
        params.companyId !== null &&
        row.company_legacy_id !== params.companyId
      ) {
        return null;
      }
      const entry = row.data;
      if (!entry) return null;
      const [staffSessions, events] = await Promise.all([
        loadStaffSessions(id),
        loadEvents(id),
      ]);
      const detail: MissionLogDetail = { ...entry, staffSessions, events };
      return detail;
    } finally {
      stop();
    }
  },

  async search(params: MissionLogListParams) {
    return queryPage(params);
  },

  async count(params: CountParams = {}) {
    if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
    let query = supabase
      .from("mission_log_entries")
      .select("legacy_id", { count: "exact", head: true }) as unknown as FilterableQuery;
    if (params.companyId !== undefined && params.companyId !== null) {
      query = query.eq("company_legacy_id", params.companyId);
    }
    query = query.is("deleted_at", null);
    const searchExpr = buildSearchExpression(params.search);
    if (searchExpr) {
      query = query.or(searchExpr);
    }
    const { error, count } = (await query) as unknown as {
      error: { message: string } | null;
      count: number | null;
    };
    if (error) throw new Error(`[missionLog] Supabase count failed: ${error.message}`);
    return count ?? 0;
  },
};
