/**
 * Time Code migration + shadow-read tooling (TIMECODE-1).
 *
 * The Time Codes analogue of {@link import("./roleMigration")}. Two
 * development/admin utilities, both READ-ONLY against the running app's
 * localStorage source of truth:
 *
 *   1. `migrateTimeCodes()` — copies localStorage time codes INTO the Supabase
 *      `time_codes` table (single, flat record). Idempotent (upsert on
 *      `legacy_id`), repeatable, with a `dryRun` mode that computes the plan +
 *      report WITHOUT writing. Preserves legacy ids verbatim and the full payload
 *      in `data` jsonb. GLOBAL codes (companyId === null → the Super Admin master
 *      library) are migrated with `company_id = null`; company codes whose company
 *      has no Supabase row are skipped + reported.
 *
 *   2. `shadowReadTimeCodes()` — diffs localStorage vs Supabase for a scope
 *      (count / id set / code parity / detail payload), producing a structured
 *      mismatch report. Differences are surfaced, never silently ignored.
 *
 * The CRITICAL guarantee is `legacy_id` stability — services.timeCodeId / time
 * reports soft-reference the code by it.
 */
import { getTimeCodes } from "@/lib/timeCodeStore";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { TimeCode } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import {
  listTimeCodeSummariesFromSupabase,
  listFullTimeCodesFromSupabase,
} from "./supabaseTimeCodeRepository";

// ── Migration ───────────────────────────────────────────────────────────

/** A single upsert row written to (or planned for) the `time_codes` table. */
export interface TimeCodeUpsertRow {
  legacy_id: string;
  /** Real tenant FK UUID, or null for a GLOBAL master-library code. */
  company_id: string | null;
  /** App-facing company id, or null for a GLOBAL master-library code. */
  company_legacy_id: string | null;
  code: string;
  type: string;
  active: boolean;
  system_managed: boolean;
  /** Soft-delete marker — always null on upsert (an upsert UNDELETES the row). */
  deleted_at: string | null;
  data: TimeCode;
}

/** Structured outcome of a time-code migration run (or dry-run). */
export interface TimeCodeMigrationReport {
  ok: boolean;
  dryRun: boolean;
  /** Company scope this run was limited to, or null for all companies. */
  companyId: string | null;
  /** Codes read from localStorage for the scope. */
  sourceCount: number;
  /** Rows that would be / were upserted. */
  plannedCount: number;
  /** Rows actually written (0 on dry-run). */
  writtenCount: number;
  /** Source codes skipped because their company_id could not be resolved. */
  skipped: Array<{ id: string; reason: string }>;
  /** Fatal error, if the run failed. */
  error?: string;
}

function scopeByCompany(codes: TimeCode[], companyId: string | null | undefined): TimeCode[] {
  if (companyId === undefined || companyId === null) return codes;
  return codes.filter((c) => c.companyId === companyId);
}

/**
 * Maps a localStorage {@link TimeCode} to a `time_codes` table upsert row. The
 * flat columns carry code/type/active/system_managed/scope; the full record is
 * preserved losslessly in `data`. Shared by the migration utility and the
 * TIMECODE-3 dual-write mirror so both write byte-identical rows.
 *
 * GLOBAL codes (companyId === null) pass `companyUuid = null`.
 */
export function toTimeCodeUpsertRow(code: TimeCode, companyUuid: string | null): TimeCodeUpsertRow {
  return {
    legacy_id: code.id,
    company_id: companyUuid,
    company_legacy_id: code.companyId,
    code: code.code,
    type: code.type,
    active: code.active,
    system_managed: code.systemManaged,
    deleted_at: null,
    data: code,
  };
}

/**
 * Migrates localStorage time codes into Supabase.
 *
 * @param options.companyId Restrict to a single app-facing company id.
 * @param options.dryRun    When true, compute the plan + report but write nothing.
 */
export async function migrateTimeCodes(options?: {
  companyId?: string | null;
  dryRun?: boolean;
}): Promise<TimeCodeMigrationReport> {
  const companyId = options?.companyId ?? null;
  const dryRun = options?.dryRun ?? false;

  const source = scopeByCompany(getTimeCodes(), companyId);
  const report: TimeCodeMigrationReport = {
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
  const rows: TimeCodeUpsertRow[] = [];
  for (const code of source) {
    // GLOBAL code (Super Admin master library) → company_id null, never skipped.
    if (code.companyId === null) {
      rows.push(toTimeCodeUpsertRow(code, null));
      continue;
    }
    const uuid = companyMap.get(code.companyId) ?? null;
    if (!uuid) {
      report.skipped.push({
        id: code.id,
        reason: `No Supabase company found for legacy_id "${code.companyId}". Migrate companies first.`,
      });
      continue;
    }
    rows.push(toTimeCodeUpsertRow(code, uuid));
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
        .from("time_codes")
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

/** Per-aspect outcome of a localStorage-vs-Supabase time-code comparison. */
export interface TimeCodeShadowReport {
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
 * Compares localStorage time codes against the Supabase shadow copy for a scope.
 * Read-only on both sides; mutates nothing. Validates count / id set / code /
 * a detail sample. Use this to confirm "0 critical mismatches" before any UI
 * cut-over.
 *
 * NOTE on scope: an unscoped (super-admin) shadow read covers every row; a
 * company-scoped read covers that company PLUS the shared global master library,
 * to mirror the repository's visibility — so the local side scopes the same way.
 */
export async function shadowReadTimeCodes(
  companyId?: string | null,
): Promise<TimeCodeShadowReport> {
  const scope = companyId ?? null;
  const queryScope = companyId ?? undefined;
  const notes: string[] = [];

  // Mirror the repository's effective visibility: scope = company rows + globals.
  const allLocal = getTimeCodes();
  const local =
    queryScope === undefined
      ? allLocal
      : allLocal.filter((c) => c.companyId === queryScope || c.companyId === null);

  const report: TimeCodeShadowReport = {
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

  let remote: Awaited<ReturnType<typeof listTimeCodeSummariesFromSupabase>>;
  try {
    remote = await listTimeCodeSummariesFromSupabase(queryScope);
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
    local.map((c) => c.id),
    remote.map((c) => c.id),
  );
  report.missingInSupabase = onlyA;
  report.extraInSupabase = onlyB;
  report.idsMatch = onlyA.length === 0 && onlyB.length === 0;
  if (onlyA.length > 0) notes.push(`${onlyA.length} time code(s) not yet in Supabase`);
  if (onlyB.length > 0) notes.push(`${onlyB.length} extra time code(s) in Supabase`);

  // Code + scope parity on the shared ids.
  const remoteById = new Map(remote.map((c) => [c.id, c] as const));
  let summaryMatch = true;
  for (const l of local) {
    const r = remoteById.get(l.id);
    if (!r) continue;
    if (r.code !== l.code || (r.companyId ?? null) !== (l.companyId ?? null)) {
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
      const remoteFull = await listFullTimeCodesFromSupabase(queryScope);
      const remoteDetail = remoteFull.find((c) => c.id === sample.id) ?? null;
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
    migrateTimeCodes,
    shadowReadTimeCodes,
  };
}
