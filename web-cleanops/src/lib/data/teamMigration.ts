/**
 * Team migration + shadow-read tooling (TEAM-1).
 *
 * The Teams analogue of {@link import("./employeeMigration")}. Two
 * development/admin utilities, both READ-ONLY against the running app's
 * localStorage source of truth:
 *
 *   1. `migrateTeams()` \u2014 copies localStorage teams INTO the Supabase `teams`
 *      table (single, flat record). Idempotent (upsert on `legacy_id`),
 *      repeatable, with a `dryRun` mode that computes the plan + report WITHOUT
 *      writing. Preserves legacy ids verbatim and the full payload in `data`
 *      jsonb. Skips + reports teams whose company has no Supabase row.
 *
 *   2. `shadowReadTeams()` \u2014 diffs localStorage vs Supabase for a company (count
 *      / id set / name parity / detail payload), producing a structured mismatch
 *      report. Differences are surfaced, never silently ignored.
 *
 * Neither utility touches the UI or employee team-membership. localStorage stays
 * the source of truth for the whole of TEAM-1; Supabase is the shadow copy these
 * tools populate + verify. The CRITICAL guarantee is `legacy_id` stability \u2014
 * employees.team_ids reference the team by it.
 */
import { getTeams } from "@/lib/store";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { Team } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import {
  listTeamSummariesFromSupabase,
  listFullTeamsFromSupabase,
} from "./supabaseTeamRepository";

// \u2500\u2500 Migration \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

/** A single upsert row written to (or planned for) the `teams` table. */
export interface TeamUpsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string;
  name: string;
  description: string | null;
  /** Soft-delete marker \u2014 always null on upsert (an upsert UNDELETES the row). */
  deleted_at: string | null;
  data: Team;
}

/** Structured outcome of a team migration run (or dry-run). */
export interface TeamMigrationReport {
  ok: boolean;
  dryRun: boolean;
  /** Company scope this run was limited to, or null for all companies. */
  companyId: string | null;
  /** Teams read from localStorage for the scope. */
  sourceCount: number;
  /** Rows that would be / were upserted. */
  plannedCount: number;
  /** Rows actually written (0 on dry-run). */
  writtenCount: number;
  /** Source teams skipped because their company_id could not be resolved. */
  skipped: Array<{ id: string; reason: string }>;
  /** Fatal error, if the run failed. */
  error?: string;
}

function scopeByCompany(teams: Team[], companyId: string | null | undefined): Team[] {
  if (companyId === undefined || companyId === null) return teams;
  return teams.filter((t) => t.companyId === companyId);
}

/**
 * Maps a localStorage {@link Team} to a `teams` table upsert row. The flat
 * columns carry name/description/scope; the full record is preserved losslessly
 * in `data`. Shared by the migration utility and the TEAM-3 dual-write mirror so
 * both write byte-identical rows.
 */
export function toTeamUpsertRow(team: Team, companyUuid: string | null): TeamUpsertRow {
  return {
    legacy_id: team.id,
    company_id: companyUuid,
    company_legacy_id: team.companyId,
    name: team.name,
    description: team.description ?? null,
    deleted_at: null,
    data: team,
  };
}

/**
 * Migrates localStorage teams into Supabase.
 *
 * @param options.companyId Restrict to a single app-facing company id.
 * @param options.dryRun    When true, compute the plan + report but write nothing.
 */
export async function migrateTeams(options?: {
  companyId?: string | null;
  dryRun?: boolean;
}): Promise<TeamMigrationReport> {
  const companyId = options?.companyId ?? null;
  const dryRun = options?.dryRun ?? false;

  const source = scopeByCompany(getTeams(), companyId);
  const report: TeamMigrationReport = {
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
  const rows: TeamUpsertRow[] = [];
  for (const team of source) {
    const uuid = companyMap.get(team.companyId) ?? null;
    if (!uuid) {
      report.skipped.push({
        id: team.id,
        reason: `No Supabase company found for legacy_id "${team.companyId}". Migrate companies first.`,
      });
      continue;
    }
    rows.push(toTeamUpsertRow(team, uuid));
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
        .from("teams")
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

// \u2500\u2500 Shadow-read validation \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

/** Per-aspect outcome of a localStorage-vs-Supabase team comparison. */
export interface TeamShadowReport {
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
  /** Human-readable mismatch notes \u2014 never empty when ok is false. */
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
 * Compares localStorage teams against the Supabase shadow copy for a scope.
 * Read-only on both sides; mutates nothing. Validates count / id set / name /
 * a detail sample. Use this to confirm "0 critical mismatches" before any UI
 * cut-over.
 */
export async function shadowReadTeams(
  companyId?: string | null,
): Promise<TeamShadowReport> {
  const scope = companyId ?? null;
  const queryScope = companyId ?? undefined;
  const notes: string[] = [];

  const local = scopeByCompany(getTeams(), queryScope);

  const report: TeamShadowReport = {
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

  let remote: Awaited<ReturnType<typeof listTeamSummariesFromSupabase>>;
  try {
    remote = await listTeamSummariesFromSupabase(queryScope);
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
    local.map((t) => t.id),
    remote.map((t) => t.id),
  );
  report.missingInSupabase = onlyA;
  report.extraInSupabase = onlyB;
  report.idsMatch = onlyA.length === 0 && onlyB.length === 0;
  if (onlyA.length > 0) notes.push(`${onlyA.length} team(s) not yet in Supabase`);
  if (onlyB.length > 0) notes.push(`${onlyB.length} extra team(s) in Supabase`);

  // Name parity on the shared ids.
  const remoteById = new Map(remote.map((t) => [t.id, t] as const));
  let summaryMatch = true;
  for (const l of local) {
    const r = remoteById.get(l.id);
    if (!r) continue;
    if (r.name !== l.name || r.companyId !== l.companyId) {
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
      const remoteFull = await listFullTeamsFromSupabase(queryScope);
      const remoteDetail = remoteFull.find((t) => t.id === sample.id) ?? null;
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
    migrateTeams,
    shadowReadTeams,
  };
}
