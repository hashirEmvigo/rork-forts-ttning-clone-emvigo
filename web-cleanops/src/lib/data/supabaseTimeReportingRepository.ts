/**
 * Supabase-backed Time Reporting READ repository (Slice 2b-2).
 *
 * The first read adapter for the Operational Execution APPROVAL / ADJUSTMENT /
 * TIME-CLASSIFICATION workspace. It implements the storage-agnostic
 * {@link TimeReportingRepository} contract against the Time Reporting tables
 * from migration 0032 (`time_reports`, `time_allocations`, `time_report_flags`,
 * `time_report_events`, `time_report_flag_events`, `time_report_messages`) and
 * returns the SAME {@link TimeReportSummary} / {@link TimeReportDetail} shapes
 * the contract declares, rebuilt losslessly from the `data` jsonb.
 *
 * SCOPE — READ ONLY, DORMANT. This is NOT wired into AppContext, any page or any
 * route, there is no dual-write / shadow-read / cut-over and no bulk mutation,
 * and the legacy checkout `TimeReport` flow is untouched.
 * {@link shouldReadTimeReportingFromSupabase} exposes the dormant
 * {@link TIME_REPORTING_SUPABASE_READ} gate (DEFAULT OFF) for a future consumer;
 * nothing reads it yet.
 *
 * QUERY RULES (Slice 2b-2):
 *   - Every query is company-scoped first (by the app-facing `company_legacy_id`).
 *   - Soft-deleted rows (`deleted_at` set) are excluded by default.
 *   - Filtering + pagination happen SERVER-SIDE (`.eq/.in/.gte/.lte/.or` + `.range`
 *     + `{ count: "exact" }`) — rows are never fully loaded and sliced in memory.
 *   - List summaries stay lightweight: the flat summary columns + the single
 *     `data` jsonb of the report row, never the allocations / flags / messages /
 *     event streams.
 *   - Allocations, flags, messages and both event streams load ONLY in
 *     {@link getDetail}.
 *   - The append-only event / flag-event / message streams are ordered
 *     deterministically (`occurred_at` / `created_at` asc, then legacy_id).
 *
 * SEPARATION OF CONCERNS: a report's APPROVAL status (`status`) is read
 * independently from its FLAG RESOLUTION status (`flag_resolution_status` rollup
 * + the per-flag lifecycle), and PAYROLL approval status is read independently
 * from INVOICE basis status — exactly as the schema stores them.
 *
 * EMPTY SUPABASE IS VALID: an empty result returns an empty list / `total: 0`
 * and a missing report returns `null` — there is NO fallback to localStorage, NO
 * seed and NO unsafe-empty behaviour. Time Reporting NEVER writes payroll basis,
 * writes invoice basis, affects the time bank or makes AI decisions.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import { evaluateSearchThreshold } from "@/lib/searchThreshold";
import { TIME_REPORTING_SUPABASE_READ } from "@/lib/featureFlags";
import type {
  AiReviewRecommendation,
  FlagResolutionStatus,
  InvoiceBasisStatus,
  PayrollApprovalStatus,
  TimeAllocation,
  TimeReport,
  TimeReportMessage,
  TimeReportStatus,
} from "@/types/timeReporting";
import type {
  TimeReportDetail,
  TimeReportEventRecord,
  TimeReportFlagEventRecord,
  TimeReportFlagRecord,
  TimeReportingRepository,
  TimeReportListParams,
  TimeReportSummary,
} from "./timeReportingRepository";
import type { CountParams, DetailParams, ListResult } from "./types";

/**
 * Lightweight summary columns + the lossless report `data` jsonb. The flat
 * columns drive server-side filtering / ordering / pagination; `data` supplies
 * the few summary fields kept only in the jsonb. The allocations, flags,
 * messages and event streams are NOT selected here.
 */
const SUMMARY_COLUMNS =
  "legacy_id, company_legacy_id, mission_log_entry_legacy_id, customer_legacy_id, " +
  "customer_name_snapshot, employee_legacy_id, employee_name_snapshot, " +
  "service_row_legacy_id, scheduled_duration_minutes, actual_duration_minutes, " +
  "total_deviation_minutes, status, payroll_approval_status, invoice_basis_status, " +
  "requires_admin_review, flag_resolution_status, ai_recommendation, submitted_at, data";

/** Shape of the flat summary columns (+ `data`) returned by Supabase. */
interface TimeReportSummaryRow {
  legacy_id: string;
  company_legacy_id: string;
  mission_log_entry_legacy_id: string | null;
  customer_legacy_id: string | null;
  customer_name_snapshot: string | null;
  employee_legacy_id: string | null;
  employee_name_snapshot: string | null;
  service_row_legacy_id: string | null;
  scheduled_duration_minutes: number | null;
  actual_duration_minutes: number | null;
  total_deviation_minutes: number | null;
  status: string;
  payroll_approval_status: string;
  invoice_basis_status: string;
  requires_admin_review: boolean;
  flag_resolution_status: string | null;
  ai_recommendation: string | null;
  submitted_at: string | null;
  data: TimeReport | null;
}

/** Shape of a full report row used by {@link getDetail}. */
interface TimeReportDetailRow {
  data: TimeReport | null;
  company_legacy_id: string;
  deleted_at: string | null;
}

/** Thrown when the repository is used but Supabase is not configured. */
class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "SupabaseTimeReportingRepository requires Supabase. Set EXPO_PUBLIC_SUPABASE_URL " +
        "and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

/**
 * Dormant read gate (DEFAULT OFF). Slice 2b-2 wires NO live consumer; this is
 * here so a later read-seam wave can switch the Time Reporting read source
 * without renaming. It deliberately does NOT use the cut-over resolver.
 */
export function shouldReadTimeReportingFromSupabase(): boolean {
  return TIME_REPORTING_SUPABASE_READ;
}

function rowToSummary(row: TimeReportSummaryRow): TimeReportSummary {
  const d = row.data ?? ({} as Partial<TimeReport>);
  return {
    id: row.legacy_id,
    companyId: row.company_legacy_id,
    missionLogEntryId: row.mission_log_entry_legacy_id ?? d.missionLogEntryId ?? "",
    customerId: row.customer_legacy_id ?? d.customerId ?? "",
    customerNameSnapshot: row.customer_name_snapshot ?? d.customerNameSnapshot ?? "",
    employeeId: row.employee_legacy_id ?? d.employeeId ?? "",
    employeeNameSnapshot: row.employee_name_snapshot ?? d.employeeNameSnapshot ?? "",
    scheduledDurationMinutes:
      row.scheduled_duration_minutes ?? d.scheduledDurationMinutes ?? 0,
    actualDurationMinutes:
      row.actual_duration_minutes ?? d.actualDurationMinutes ?? undefined,
    totalDeviationMinutes:
      row.total_deviation_minutes ?? d.totalDeviationMinutes ?? undefined,
    status: row.status as TimeReportStatus,
    payrollApprovalStatus: row.payroll_approval_status as PayrollApprovalStatus,
    invoiceBasisStatus: row.invoice_basis_status as InvoiceBasisStatus,
    requiresAdminReview: row.requires_admin_review,
    flagResolutionStatus:
      (row.flag_resolution_status as FlagResolutionStatus | null) ?? undefined,
    aiRecommendation:
      (row.ai_recommendation as AiReviewRecommendation | null) ?? undefined,
    submittedAt: row.submitted_at ?? undefined,
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
    `employee_legacy_id.ilike.*${term}*`,
    `work_order_legacy_id.ilike.*${term}*`,
    `service_row_legacy_id.ilike.*${term}*`,
    `customer_name_snapshot.ilike.*${term}*`,
    `employee_name_snapshot.ilike.*${term}*`,
  ].join(",");
}

/**
 * Applies the company scope, the soft-delete exclusion and every Time Reporting
 * filter to a query. Date bounds ("YYYY-MM-DD") are widened to whole-day
 * timestamptz windows so the inclusive `[fromDate, toDate]` range matches the
 * full day on the `submitted_at` column. Deviation thresholds use ABSOLUTE
 * minutes (a deviation may be negative), so min is "outside ±X" and max is
 * "within ±X".
 */
function applyListFilters<Q extends FilterableQuery>(
  query: Q,
  params: TimeReportListParams,
): Q {
  let q: FilterableQuery = query;
  if (params.companyId !== undefined && params.companyId !== null) {
    q = q.eq("company_legacy_id", params.companyId);
  }
  q = q.is("deleted_at", null);
  if (params.fromDate) {
    q = q.gte("submitted_at", `${params.fromDate}T00:00:00.000Z`);
  }
  if (params.toDate) {
    q = q.lte("submitted_at", `${params.toDate}T23:59:59.999Z`);
  }
  if (params.statuses && params.statuses.length > 0) {
    q = q.in("status", params.statuses);
  }
  if (params.payrollStatuses && params.payrollStatuses.length > 0) {
    q = q.in("payroll_approval_status", params.payrollStatuses);
  }
  if (params.invoiceStatuses && params.invoiceStatuses.length > 0) {
    q = q.in("invoice_basis_status", params.invoiceStatuses);
  }
  if (params.flagResolutionStatuses && params.flagResolutionStatuses.length > 0) {
    q = q.in("flag_resolution_status", params.flagResolutionStatuses);
  }
  if (params.aiRecommendations && params.aiRecommendations.length > 0) {
    q = q.in("ai_recommendation", params.aiRecommendations);
  }
  if (params.requiresAdminReviewOnly) {
    q = q.eq("requires_admin_review", true);
  }
  if (params.employeeIds && params.employeeIds.length > 0) {
    q = q.in("employee_legacy_id", params.employeeIds);
  }
  if (params.customerIds && params.customerIds.length > 0) {
    q = q.in("customer_legacy_id", params.customerIds);
  }
  if (params.serviceRowLegacyId) {
    q = q.eq("service_row_legacy_id", params.serviceRowLegacyId);
  }
  if (params.missionLogEntryLegacyId) {
    q = q.eq("mission_log_entry_legacy_id", params.missionLogEntryLegacyId);
  }
  if (params.minDeviationMinutes !== undefined && params.minDeviationMinutes > 0) {
    const m = params.minDeviationMinutes;
    q = q.or(`total_deviation_minutes.gte.${m},total_deviation_minutes.lte.${-m}`);
  }
  if (params.maxDeviationMinutes !== undefined && params.maxDeviationMinutes >= 0) {
    const m = params.maxDeviationMinutes;
    q = q.gte("total_deviation_minutes", -m).lte("total_deviation_minutes", m);
  }
  const searchExpr = buildSearchExpression(params.search);
  if (searchExpr) {
    q = q.or(searchExpr);
  }
  return q as Q;
}

/** Shared list/search read path: server-side filtered + paginated summaries. */
async function queryPage(
  params: TimeReportListParams,
): Promise<ListResult<TimeReportSummary>> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("timeReporting.list.supabase.summaries");
  try {
    let query = supabase
      .from("time_reports")
      .select(SUMMARY_COLUMNS, { count: "exact" }) as unknown as FilterableQuery;
    query = applyListFilters(query, params);
    // Deterministic ordering: newest submitted report first, legacy_id tiebreak.
    let ordered = (query as unknown as {
      order(column: string, opts: { ascending: boolean }): unknown;
    }).order("submitted_at", { ascending: false });
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
      data: TimeReportSummaryRow[] | null;
      error: { message: string } | null;
      count: number | null;
    };
    if (error) {
      throw new Error(`[timeReporting] Supabase list failed: ${error.message}`);
    }
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

/** Loads the classified minute slices for one report (soft-deleted excluded). */
async function loadAllocations(reportLegacyId: string): Promise<TimeAllocation[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("time_allocations")
    .select("data, deleted_at, created_at, legacy_id")
    .eq("time_report_legacy_id", reportLegacyId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .order("legacy_id", { ascending: true });
  if (error) {
    throw new Error(`[timeReporting] Supabase allocations failed: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as { data: TimeAllocation | null }[];
  return rows.map((r) => r.data).filter((a): a is TimeAllocation => Boolean(a));
}

/** Loads the flags for one report (soft-deleted excluded). */
async function loadFlags(reportLegacyId: string): Promise<TimeReportFlagRecord[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("time_report_flags")
    .select("data, deleted_at, created_at, legacy_id")
    .eq("time_report_legacy_id", reportLegacyId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .order("legacy_id", { ascending: true });
  if (error) {
    throw new Error(`[timeReporting] Supabase flags failed: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as { data: TimeReportFlagRecord | null }[];
  return rows.map((r) => r.data).filter((f): f is TimeReportFlagRecord => Boolean(f));
}

/** Loads the admin↔employee thread for one report (append-only, oldest first). */
async function loadMessages(reportLegacyId: string): Promise<TimeReportMessage[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("time_report_messages")
    .select("data, created_at, legacy_id")
    .eq("time_report_legacy_id", reportLegacyId)
    .order("created_at", { ascending: true })
    .order("legacy_id", { ascending: true });
  if (error) {
    throw new Error(`[timeReporting] Supabase messages failed: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as { data: TimeReportMessage | null }[];
  return rows.map((r) => r.data).filter((m): m is TimeReportMessage => Boolean(m));
}

/**
 * Loads the IMMUTABLE event stream for one report, ordered deterministically
 * (oldest first by `occurred_at`, then `legacy_id`). Append-only — no soft-delete.
 */
async function loadEvents(reportLegacyId: string): Promise<TimeReportEventRecord[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("time_report_events")
    .select("data, occurred_at, legacy_id")
    .eq("time_report_legacy_id", reportLegacyId)
    .order("occurred_at", { ascending: true })
    .order("legacy_id", { ascending: true });
  if (error) {
    throw new Error(`[timeReporting] Supabase events failed: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as { data: TimeReportEventRecord | null }[];
  return rows.map((r) => r.data).filter((e): e is TimeReportEventRecord => Boolean(e));
}

/**
 * Loads the IMMUTABLE flag-resolution history for one report (the flag triage
 * audit trail), ordered deterministically. Append-only — no soft-delete.
 */
async function loadFlagEvents(
  reportLegacyId: string,
): Promise<TimeReportFlagEventRecord[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("time_report_flag_events")
    .select("data, occurred_at, legacy_id")
    .eq("time_report_legacy_id", reportLegacyId)
    .order("occurred_at", { ascending: true })
    .order("legacy_id", { ascending: true });
  if (error) {
    throw new Error(`[timeReporting] Supabase flag events failed: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as { data: TimeReportFlagEventRecord | null }[];
  return rows
    .map((r) => r.data)
    .filter((e): e is TimeReportFlagEventRecord => Boolean(e));
}

/** The Slice 2b-2 read-only Time Reporting repository (dormant — no consumer). */
export const supabaseTimeReportingRepository: TimeReportingRepository = {
  async listSummaries(params: TimeReportListParams = {}) {
    return queryPage(params);
  },

  async getDetail(id: string, params: DetailParams = {}) {
    if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
    const stop = perf.start("timeReporting.detail.supabase");
    try {
      const { data, error } = await supabase
        .from("time_reports")
        .select("data, company_legacy_id, deleted_at")
        .eq("legacy_id", id)
        .maybeSingle();
      if (error) {
        throw new Error(`[timeReporting] Supabase detail failed: ${error.message}`);
      }
      if (!data) return null;
      const row = data as unknown as TimeReportDetailRow;
      if (row.deleted_at) return null;
      if (
        params.companyId !== undefined &&
        params.companyId !== null &&
        row.company_legacy_id !== params.companyId
      ) {
        return null;
      }
      const report = row.data;
      if (!report) return null;
      const [allocations, flags, messages, events, flagEvents] = await Promise.all([
        loadAllocations(id),
        loadFlags(id),
        loadMessages(id),
        loadEvents(id),
        loadFlagEvents(id),
      ]);
      const detail: TimeReportDetail = {
        ...report,
        allocations,
        flags,
        messages,
        events,
        flagEvents,
      };
      return detail;
    } finally {
      stop();
    }
  },

  async search(params: TimeReportListParams) {
    return queryPage(params);
  },

  async count(params: CountParams = {}) {
    if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
    let query = supabase
      .from("time_reports")
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
    if (error) {
      throw new Error(`[timeReporting] Supabase count failed: ${error.message}`);
    }
    return count ?? 0;
  },
};
