/**
 * Visit Occurrence migration + shadow-read tooling (MISSION-1).
 *
 * The Missions analogue of {@link import("./areaMigration")}. Two READ-ONLY
 * development/admin utilities:
 *
 *   1. `migrateVisitOccurrences()` — copies localStorage occurrences INTO the
 *      Supabase `visit_occurrences` table (idempotent upsert on `legacy_id`,
 *      `dryRun` mode). Occurrences whose company has no Supabase row are
 *      skipped + reported.
 *   2. `shadowReadVisitOccurrences()` — diffs localStorage vs Supabase for a
 *      company scope (count / id set / summary parity / detail payload).
 *
 * The CRITICAL guarantee is `legacy_id` stability — protocol runs reference an
 * occurrence by `visitOccurrenceId`, so the id survives verbatim.
 */
import { getAllVisitOccurrences } from "@/lib/visitOccurrenceStore";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { VisitOccurrence } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import {
  listVisitOccurrenceSummariesFromSupabase,
  listFullVisitOccurrencesFromSupabase,
} from "./supabaseVisitOccurrenceRepository";

/** A single upsert row written to (or planned for) `visit_occurrences`. */
export interface VisitOccurrenceUpsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string;
  customer_legacy_id: string;
  work_order_legacy_id: string;
  service_row_id: string;
  scheduled_date: string;
  status: string;
  deleted_at: string | null;
  data: VisitOccurrence;
}

/** Structured outcome of a visit-occurrence migration run (or dry-run). */
export interface VisitOccurrenceMigrationReport {
  ok: boolean;
  dryRun: boolean;
  companyId: string | null;
  sourceCount: number;
  plannedCount: number;
  writtenCount: number;
  skipped: Array<{ id: string; reason: string }>;
  error?: string;
}

function scopeByCompany(
  rows: VisitOccurrence[],
  companyId: string | null | undefined,
): VisitOccurrence[] {
  if (companyId === undefined || companyId === null) return rows;
  return rows.filter((v) => v.companyId === companyId);
}

/**
 * Maps a localStorage {@link VisitOccurrence} to a `visit_occurrences` upsert
 * row. Shared by the migration utility and the dual-write mirror so both write
 * byte-identical rows.
 */
export function toVisitOccurrenceUpsertRow(
  visit: VisitOccurrence,
  companyUuid: string | null,
): VisitOccurrenceUpsertRow {
  return {
    legacy_id: visit.id,
    company_id: companyUuid,
    company_legacy_id: visit.companyId,
    customer_legacy_id: visit.customerId,
    work_order_legacy_id: visit.workOrderId,
    service_row_id: visit.serviceRowId,
    scheduled_date: visit.scheduledDate,
    status: visit.status,
    deleted_at: null,
    data: visit,
  };
}

/** Migrates localStorage visit occurrences into Supabase. */
export async function migrateVisitOccurrences(options?: {
  companyId?: string | null;
  dryRun?: boolean;
}): Promise<VisitOccurrenceMigrationReport> {
  const companyId = options?.companyId ?? null;
  const dryRun = options?.dryRun ?? false;

  const source = scopeByCompany(getAllVisitOccurrences(), companyId);
  const report: VisitOccurrenceMigrationReport = {
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
  const rows: VisitOccurrenceUpsertRow[] = [];
  for (const visit of source) {
    const uuid = companyMap.get(visit.companyId) ?? null;
    if (!uuid) {
      report.skipped.push({
        id: visit.id,
        reason: `No Supabase company found for legacy_id "${visit.companyId}". Migrate companies first.`,
      });
      continue;
    }
    rows.push(toVisitOccurrenceUpsertRow(visit, uuid));
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
        .from("visit_occurrences")
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

/** Per-aspect outcome of a localStorage-vs-Supabase occurrence comparison. */
export interface VisitOccurrenceShadowReport {
  ok: boolean;
  companyId: string | null;
  localCount: number;
  supabaseCount: number;
  countMatch: boolean;
  idsMatch: boolean;
  summaryMatch: boolean;
  detailMatch: boolean;
  missingInSupabase: string[];
  extraInSupabase: string[];
  notes: string[];
}

function idSetDiff(a: string[], b: string[]): { onlyA: string[]; onlyB: string[] } {
  const setB = new Set(b);
  const setA = new Set(a);
  return { onlyA: a.filter((id) => !setB.has(id)), onlyB: b.filter((id) => !setA.has(id)) };
}

/** Compares localStorage occurrences against the Supabase shadow copy. */
export async function shadowReadVisitOccurrences(
  companyId?: string | null,
): Promise<VisitOccurrenceShadowReport> {
  const scope = companyId ?? null;
  const queryScope = companyId ?? undefined;
  const notes: string[] = [];

  const local = scopeByCompany(getAllVisitOccurrences(), queryScope);

  const report: VisitOccurrenceShadowReport = {
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

  let remote: Awaited<ReturnType<typeof listVisitOccurrenceSummariesFromSupabase>>;
  try {
    remote = await listVisitOccurrenceSummariesFromSupabase(queryScope);
  } catch (err) {
    notes.push(err instanceof Error ? err.message : "Supabase read failed.");
    return report;
  }

  report.supabaseCount = remote.length;
  report.countMatch = local.length === remote.length;
  if (!report.countMatch) {
    notes.push(`count mismatch: local ${local.length} vs supabase ${remote.length}`);
  }

  const { onlyA, onlyB } = idSetDiff(local.map((v) => v.id), remote.map((v) => v.id));
  report.missingInSupabase = onlyA;
  report.extraInSupabase = onlyB;
  report.idsMatch = onlyA.length === 0 && onlyB.length === 0;
  if (onlyA.length > 0) notes.push(`${onlyA.length} occurrence(s) not yet in Supabase`);
  if (onlyB.length > 0) notes.push(`${onlyB.length} extra occurrence(s) in Supabase`);

  const remoteById = new Map(remote.map((v) => [v.id, v] as const));
  let summaryMatch = true;
  for (const l of local) {
    const r = remoteById.get(l.id);
    if (!r) continue;
    if (
      r.companyId !== l.companyId ||
      r.customerId !== l.customerId ||
      r.workOrderId !== l.workOrderId ||
      r.scheduledDate !== l.scheduledDate ||
      r.status !== l.status
    ) {
      summaryMatch = false;
      notes.push(`summary mismatch for ${l.id}`);
      break;
    }
  }
  report.summaryMatch = summaryMatch;

  let detailMatch = true;
  const sample = local.find((l) => remoteById.has(l.id));
  if (sample) {
    try {
      const remoteFull = await listFullVisitOccurrencesFromSupabase(queryScope);
      const remoteDetail = remoteFull.find((v) => v.id === sample.id) ?? null;
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

if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    migrateVisitOccurrences,
    shadowReadVisitOccurrences,
  };
}
