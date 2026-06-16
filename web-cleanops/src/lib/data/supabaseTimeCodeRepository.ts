/**
 * Supabase-backed Time Code repository (TIMECODE-1 read + TIMECODE-5 writes).
 *
 * The Time Codes analogue of {@link import("./supabaseRoleRepository")}. It reads
 * AND writes the `time_codes` table (migration 0024 schema, aligned + seeded onto
 * the live table by 0052) and returns the SAME shapes the localStorage store
 * returns, so the read seam can swap it in with no UI change.
 *
 * Behaviour parity — the in-memory `timeCodes` array the UI consumes holds BOTH
 * the GLOBAL (Super Admin) master library and company-owned codes (future), then
 * filters per view. So when a company scope is supplied, this repository returns
 * that company's codes PLUS every global code (`company_legacy_id is null`),
 * exactly the RLS-visible set. When unscoped (super admin) it returns all
 * RLS-visible rows. Soft-deleted rows (`deleted_at` set) are filtered out
 * (WO-5.6 convention).
 *
 * WRITES (TIMECODE-5) are AUTHORITATIVE and direct: each create/update/delete
 * commits to Supabase FIRST and the caller only updates the UI after a confirmed
 * write. There is NO localStorage authority, NO browser-domain mirror, and NO
 * optimistic persistence on this path. Writes are scoped to the GLOBAL master
 * library (companyId === null) — the only scope the Super Admin manages today; a
 * company-scoped record is rejected up-front rather than silently written with a
 * null tenant.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import type { TimeCode } from "@/types";

/** Columns selected for a lightweight summary list (no `data` jsonb). */
const SUMMARY_COLUMNS = "legacy_id, company_legacy_id, code, type, active, deleted_at";

/** Lightweight time-code row for count / id-set parity checks. */
export interface TimeCodeSummary {
  id: string;
  companyId: string | null;
  code: string;
}

/** Shape of the flat summary columns returned by Supabase. */
interface TimeCodeSummaryRow {
  legacy_id: string;
  company_legacy_id: string | null;
  code: string;
  type: string;
  active: boolean;
  deleted_at: string | null;
}

/** Shape of a full code row (the lossless `data` jsonb + scope/soft-delete). */
interface TimeCodeFullRow {
  data: TimeCode;
  company_legacy_id: string | null;
  deleted_at: string | null;
}

/** Thrown when the repository is used but Supabase is not configured. */
class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "SupabaseTimeCodeRepository requires Supabase. Set EXPO_PUBLIC_SUPABASE_URL " +
        "and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

function rowToSummary(row: TimeCodeSummaryRow): TimeCodeSummary {
  return { id: row.legacy_id, companyId: row.company_legacy_id, code: row.code };
}

/**
 * Applies the company scope to a `time_codes` query, mirroring the localStorage
 * store's effective visibility:
 *   • scope supplied → that company's rows OR global rows (company_legacy_id null)
 *   • scope omitted  → all RLS-visible rows (super admin)
 */
function applyScope<T extends { or: (f: string) => T }>(
  query: T,
  companyId: string | null | undefined,
): T {
  if (companyId === undefined || companyId === null) return query;
  // PostgREST OR filter: this company's rows OR the shared global master library.
  return query.or(`company_legacy_id.eq.${companyId},company_legacy_id.is.null`);
}

/**
 * Fetches the company-scoped (+ global) summary rows. Soft-deleted rows are
 * filtered out (WO-5.6 convention).
 */
export async function listTimeCodeSummariesFromSupabase(
  companyId?: string | null,
): Promise<TimeCodeSummary[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("timeCodes.list.supabase.summaries");
  try {
    const query = applyScope(supabase.from("time_codes").select(SUMMARY_COLUMNS), companyId);
    const { data, error } = await query;
    if (error) {
      throw new Error(`[time_codes] Supabase list failed: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as TimeCodeSummaryRow[];
    return rows.filter((r) => !r.deleted_at).map(rowToSummary);
  } finally {
    stop();
  }
}

/**
 * Lists FULL time-code records (the lossless `data` jsonb) for a company scope
 * (+ the global master library). Returns the same {@link TimeCode} objects the
 * page reads from localStorage today, so the read source can move to Supabase
 * without any visible behaviour change.
 */
export async function listFullTimeCodesFromSupabase(
  companyId?: string | null,
): Promise<TimeCode[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("timeCodes.list.supabase.full");
  perf.count("timeCodes.list.supabase.full.calls");
  try {
    const query = applyScope(
      supabase.from("time_codes").select("data, company_legacy_id, deleted_at"),
      companyId,
    );
    const { data, error } = await query;
    if (error) {
      throw new Error(`[time_codes] Supabase full list failed: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as TimeCodeFullRow[];
    return rows
      .filter((r) => !r.deleted_at)
      .map((r) => r.data)
      .filter((c): c is TimeCode => Boolean(c));
  } finally {
    stop();
  }
}

// ── Authoritative writes (TIMECODE-5) ──────────────────────────────────────

/** The full set of columns an authoritative write commits to the live table. */
interface TimeCodeWriteRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string | null;
  code: string;
  name: string;
  type: string;
  description: string | null;
  active: boolean;
  system_managed: boolean;
  deleted_at: string | null;
  /** Lossless record the read path reconstructs from. */
  data: TimeCode;
}

/** Shape of the `data` jsonb returned by a write's `.select("data")`. */
interface TimeCodeDataRow {
  data: TimeCode;
}

/**
 * Guards the GLOBAL-only write scope. Time Codes are managed only by the Super
 * Admin today (`companyId === null`); a company-scoped write would need a real
 * tenant UUID, so reject it explicitly rather than write a null `company_id`.
 */
function assertGlobalScope(record: TimeCode): void {
  if (record.companyId !== null) {
    throw new Error(
      "[time_codes] Company-scoped time code writes are not supported yet — " +
        "only the global master library is managed today.",
    );
  }
}

/**
 * Builds the complete `time_codes` row for a GLOBAL master code. Unlike the
 * dual-write mirror's {@link import("./timeCodeMigration").toTimeCodeUpsertRow}
 * (which only carries the flat SUMMARY columns + `data`), this includes the
 * NOT NULL `name`/`type` and the `description` flat columns the LIVE table
 * requires, so an authoritative INSERT can never trip a NOT NULL constraint.
 */
function toWriteRow(record: TimeCode, deletedAt: string | null): TimeCodeWriteRow {
  return {
    legacy_id: record.id,
    company_id: null,
    company_legacy_id: record.companyId,
    code: record.code,
    name: record.name,
    type: record.type,
    description: record.description ?? null,
    active: record.active,
    system_managed: record.systemManaged,
    deleted_at: deletedAt,
    data: record,
  };
}

/**
 * Authoritatively INSERTS a new GLOBAL time code. Resolves with the persisted
 * record (reconstructed from the row's `data` jsonb). Rejects when Supabase is
 * unconfigured, RLS blocks the insert, or the unique `legacy_id`/`code` index is
 * violated — the caller surfaces the error and leaves the directory untouched.
 */
export async function createTimeCodeInSupabase(record: TimeCode): Promise<TimeCode> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  assertGlobalScope(record);
  const stop = perf.start("timeCodes.create.supabase");
  try {
    const { data, error } = await supabase
      .from("time_codes")
      .insert(toWriteRow(record, null))
      .select("data")
      .single();
    if (error) throw new Error(`[time_codes] create failed: ${error.message}`);
    const created = (data as TimeCodeDataRow | null)?.data;
    if (!created) throw new Error("[time_codes] create returned no row.");
    return created;
  } finally {
    stop();
  }
}

/**
 * Authoritatively UPDATES an existing, non-deleted GLOBAL time code (edit + the
 * archive/restore active toggle both route here with the fully-computed record).
 * Updates the flat columns AND the lossless `data` jsonb. The write is scoped to
 * `legacy_id` + `deleted_at is null`; if it affects 0 rows (not found, already
 * soft-deleted, or RLS-blocked) it REJECTS so the caller keeps the row visible
 * and surfaces an error — never a silent no-op.
 */
export async function updateTimeCodeInSupabase(record: TimeCode): Promise<TimeCode> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  assertGlobalScope(record);
  const stop = perf.start("timeCodes.update.supabase");
  try {
    const { data, error } = await supabase
      .from("time_codes")
      .update({
        code: record.code,
        name: record.name,
        type: record.type,
        description: record.description ?? null,
        active: record.active,
        data: record,
      })
      .eq("legacy_id", record.id)
      .is("deleted_at", null)
      .select("data");
    if (error) throw new Error(`[time_codes] update failed: ${error.message}`);
    const rows = (data ?? []) as unknown as TimeCodeDataRow[];
    if (rows.length === 0) {
      throw new Error(
        "[time_codes] update affected 0 rows — the time code was not found or you " +
          "don't have permission to change it.",
      );
    }
    return rows[0].data;
  } finally {
    stop();
  }
}

/**
 * Authoritatively SOFT-DELETES a GLOBAL time code by setting `deleted_at`. Scoped
 * to `legacy_id` + `deleted_at is null` so a repeated delete is a confirmed
 * no-op rather than a false success; if it affects 0 rows it REJECTS so the
 * caller keeps the row and surfaces an error.
 */
export async function softDeleteTimeCodeInSupabase(id: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("timeCodes.softDelete.supabase");
  try {
    const { data, error } = await supabase
      .from("time_codes")
      .update({ deleted_at: new Date().toISOString() })
      .eq("legacy_id", id)
      .is("deleted_at", null)
      .select("legacy_id");
    if (error) throw new Error(`[time_codes] delete failed: ${error.message}`);
    const rows = (data ?? []) as unknown as Array<{ legacy_id: string }>;
    if (rows.length === 0) {
      throw new Error(
        "[time_codes] delete affected 0 rows — the time code was not found or you " +
          "don't have permission to delete it.",
      );
    }
  } finally {
    stop();
  }
}
