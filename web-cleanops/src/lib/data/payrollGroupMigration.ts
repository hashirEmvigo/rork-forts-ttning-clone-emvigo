/**
 * Payroll Group migration + shadow-read tooling (SVCCAT-1).
 *
 * The payroll-groups analogue of {@link import("./serviceCategoryMigration")}.
 * Two READ-ONLY development/admin utilities:
 *
 *   1. `migratePayrollGroups()` — idempotent upsert on `legacy_id` into the
 *      Supabase `payroll_groups` table, `dryRun` mode. GLOBAL groups
 *      (companyId === null) migrate with `company_id = null`; company groups
 *      with no Supabase company row are skipped + reported.
 *
 *   2. `shadowReadPayrollGroups()` — count / id-set / name / detail parity diff.
 */
import { getPayrollGroups } from "@/lib/store";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { PayrollGroup } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import {
  listPayrollGroupSummariesFromSupabase,
  listFullPayrollGroupsFromSupabase,
} from "./supabasePayrollGroupRepository";

/** A single upsert row written to (or planned for) `payroll_groups`. */
export interface PayrollGroupUpsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string | null;
  name: string;
  status: string;
  deleted_at: string | null;
  data: PayrollGroup;
}

/** Structured outcome of a payroll-group migration run (or dry-run). */
export interface PayrollGroupMigrationReport {
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
  groups: PayrollGroup[],
  companyId: string | null | undefined,
): PayrollGroup[] {
  if (companyId === undefined || companyId === null) return groups;
  return groups.filter((g) => g.companyId === companyId);
}

/** Maps a localStorage {@link PayrollGroup} to a `payroll_groups` upsert row. */
export function toPayrollGroupUpsertRow(
  group: PayrollGroup,
  companyUuid: string | null,
): PayrollGroupUpsertRow {
  return {
    legacy_id: group.id,
    company_id: companyUuid,
    company_legacy_id: group.companyId,
    name: group.name,
    status: group.status,
    deleted_at: null,
    data: group,
  };
}

/** Migrates localStorage payroll groups into Supabase. */
export async function migratePayrollGroups(options?: {
  companyId?: string | null;
  dryRun?: boolean;
}): Promise<PayrollGroupMigrationReport> {
  const companyId = options?.companyId ?? null;
  const dryRun = options?.dryRun ?? false;

  const source = scopeByCompany(getPayrollGroups(), companyId);
  const report: PayrollGroupMigrationReport = {
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
  const rows: PayrollGroupUpsertRow[] = [];
  for (const group of source) {
    if (group.companyId === null) {
      rows.push(toPayrollGroupUpsertRow(group, null));
      continue;
    }
    const uuid = companyMap.get(group.companyId) ?? null;
    if (!uuid) {
      report.skipped.push({
        id: group.id,
        reason: `No Supabase company found for legacy_id "${group.companyId}". Migrate companies first.`,
      });
      continue;
    }
    rows.push(toPayrollGroupUpsertRow(group, uuid));
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
        .from("payroll_groups")
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

/** Per-aspect outcome of a localStorage-vs-Supabase payroll-group comparison. */
export interface PayrollGroupShadowReport {
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

/** Compares localStorage payroll groups against the Supabase shadow copy. */
export async function shadowReadPayrollGroups(
  companyId?: string | null,
): Promise<PayrollGroupShadowReport> {
  const scope = companyId ?? null;
  const queryScope = companyId ?? undefined;
  const notes: string[] = [];

  const allLocal = getPayrollGroups();
  const local =
    queryScope === undefined
      ? allLocal
      : allLocal.filter((g) => g.companyId === queryScope || g.companyId === null);

  const report: PayrollGroupShadowReport = {
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

  let remote: Awaited<ReturnType<typeof listPayrollGroupSummariesFromSupabase>>;
  try {
    remote = await listPayrollGroupSummariesFromSupabase(queryScope);
  } catch (err) {
    notes.push(err instanceof Error ? err.message : "Supabase read failed.");
    return report;
  }

  report.supabaseCount = remote.length;
  report.countMatch = local.length === remote.length;
  if (!report.countMatch) {
    notes.push(`count mismatch: local ${local.length} vs supabase ${remote.length}`);
  }

  const { onlyA, onlyB } = idSetDiff(local.map((g) => g.id), remote.map((g) => g.id));
  report.missingInSupabase = onlyA;
  report.extraInSupabase = onlyB;
  report.idsMatch = onlyA.length === 0 && onlyB.length === 0;
  if (onlyA.length > 0) notes.push(`${onlyA.length} group(s) not yet in Supabase`);
  if (onlyB.length > 0) notes.push(`${onlyB.length} extra group(s) in Supabase`);

  const remoteById = new Map(remote.map((g) => [g.id, g] as const));
  let summaryMatch = true;
  for (const l of local) {
    const r = remoteById.get(l.id);
    if (!r) continue;
    if (r.name !== l.name || (r.companyId ?? null) !== (l.companyId ?? null)) {
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
      const remoteFull = await listFullPayrollGroupsFromSupabase(queryScope);
      const remoteDetail = remoteFull.find((g) => g.id === sample.id) ?? null;
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
    migratePayrollGroups,
    shadowReadPayrollGroups,
  };
}
