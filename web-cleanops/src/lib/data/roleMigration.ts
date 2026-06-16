/**
 * Role migration + shadow-read tooling (ROLE-1).
 *
 * The Roles analogue of {@link import("./serviceMigration")}. Two
 * development/admin utilities, both READ-ONLY against the running app's
 * localStorage source of truth:
 *
 *   1. `migrateRoles()` — copies localStorage roles INTO the Supabase `roles`
 *      table (single, flat record). Idempotent (upsert on `legacy_id`),
 *      repeatable, with a `dryRun` mode that computes the plan + report WITHOUT
 *      writing. Preserves legacy ids verbatim and the full payload in `data`
 *      jsonb. GLOBAL roles (companyId === null → the Super Admin templates) are
 *      migrated with `company_id = null`; company roles whose company has no
 *      Supabase row are skipped + reported.
 *
 *   2. `shadowReadRoles()` — diffs localStorage vs Supabase for a scope (count /
 *      id set / name parity / detail payload), producing a structured mismatch
 *      report. Differences are surfaced, never silently ignored.
 *
 * The CRITICAL guarantee is `legacy_id` stability — users.roleId soft-references
 * the role by it.
 */
import { getRoles } from "@/lib/store";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { Role } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import {
  listRoleSummariesFromSupabase,
  listFullRolesFromSupabase,
} from "./supabaseRoleRepository";

// ── Migration ───────────────────────────────────────────────────────────

/** A single upsert row written to (or planned for) the `roles` table. */
export interface RoleUpsertRow {
  legacy_id: string;
  /** Real tenant FK UUID, or null for a GLOBAL role template. */
  company_id: string | null;
  /** App-facing company id, or null for a GLOBAL role template. */
  company_legacy_id: string | null;
  name: string;
  base_role: string | null;
  is_system: boolean;
  /** Soft-delete marker — always null on upsert (an upsert UNDELETES the row). */
  deleted_at: string | null;
  data: Role;
}

/** Structured outcome of a role migration run (or dry-run). */
export interface RoleMigrationReport {
  ok: boolean;
  dryRun: boolean;
  /** Company scope this run was limited to, or null for all companies. */
  companyId: string | null;
  /** Roles read from localStorage for the scope. */
  sourceCount: number;
  /** Rows that would be / were upserted. */
  plannedCount: number;
  /** Rows actually written (0 on dry-run). */
  writtenCount: number;
  /** Source roles skipped because their company_id could not be resolved. */
  skipped: Array<{ id: string; reason: string }>;
  /** Fatal error, if the run failed. */
  error?: string;
}

function scopeByCompany(roles: Role[], companyId: string | null | undefined): Role[] {
  if (companyId === undefined || companyId === null) return roles;
  return roles.filter((r) => r.companyId === companyId);
}

/**
 * Maps a localStorage {@link Role} to a `roles` table upsert row. The flat
 * columns carry name/base_role/is_system/scope; the full record is preserved
 * losslessly in `data`. Shared by the migration utility and the ROLE-3
 * dual-write mirror so both write byte-identical rows.
 *
 * GLOBAL roles (companyId === null) pass `companyUuid = null`.
 */
export function toRoleUpsertRow(role: Role, companyUuid: string | null): RoleUpsertRow {
  return {
    legacy_id: role.id,
    company_id: companyUuid,
    company_legacy_id: role.companyId,
    name: role.name,
    base_role: role.baseRole ?? null,
    is_system: role.isSystem,
    deleted_at: null,
    data: role,
  };
}

/**
 * Migrates localStorage roles into Supabase.
 *
 * @param options.companyId Restrict to a single app-facing company id.
 * @param options.dryRun    When true, compute the plan + report but write nothing.
 */
export async function migrateRoles(options?: {
  companyId?: string | null;
  dryRun?: boolean;
}): Promise<RoleMigrationReport> {
  const companyId = options?.companyId ?? null;
  const dryRun = options?.dryRun ?? false;

  const source = scopeByCompany(getRoles(), companyId);
  const report: RoleMigrationReport = {
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
  const rows: RoleUpsertRow[] = [];
  for (const role of source) {
    // GLOBAL role (Super Admin templates) → company_id null, never skipped.
    if (role.companyId === null) {
      rows.push(toRoleUpsertRow(role, null));
      continue;
    }
    const uuid = companyMap.get(role.companyId) ?? null;
    if (!uuid) {
      report.skipped.push({
        id: role.id,
        reason: `No Supabase company found for legacy_id "${role.companyId}". Migrate companies first.`,
      });
      continue;
    }
    rows.push(toRoleUpsertRow(role, uuid));
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
        .from("roles")
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

/** Per-aspect outcome of a localStorage-vs-Supabase role comparison. */
export interface RoleShadowReport {
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
 * Compares localStorage roles against the Supabase shadow copy for a scope.
 * Read-only on both sides; mutates nothing. Validates count / id set / name /
 * a detail sample. Use this to confirm "0 critical mismatches" before any UI
 * cut-over.
 *
 * NOTE on scope: an unscoped (super-admin) shadow read covers every row; a
 * company-scoped read covers that company PLUS the shared global templates, to
 * mirror the repository's visibility — so the local side scopes the same way.
 */
export async function shadowReadRoles(
  companyId?: string | null,
): Promise<RoleShadowReport> {
  const scope = companyId ?? null;
  const queryScope = companyId ?? undefined;
  const notes: string[] = [];

  // Mirror the repository's effective visibility: scope = company rows + globals.
  const allLocal = getRoles();
  const local =
    queryScope === undefined
      ? allLocal
      : allLocal.filter((r) => r.companyId === queryScope || r.companyId === null);

  const report: RoleShadowReport = {
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

  let remote: Awaited<ReturnType<typeof listRoleSummariesFromSupabase>>;
  try {
    remote = await listRoleSummariesFromSupabase(queryScope);
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
    local.map((r) => r.id),
    remote.map((r) => r.id),
  );
  report.missingInSupabase = onlyA;
  report.extraInSupabase = onlyB;
  report.idsMatch = onlyA.length === 0 && onlyB.length === 0;
  if (onlyA.length > 0) notes.push(`${onlyA.length} role(s) not yet in Supabase`);
  if (onlyB.length > 0) notes.push(`${onlyB.length} extra role(s) in Supabase`);

  // Name + scope parity on the shared ids.
  const remoteById = new Map(remote.map((r) => [r.id, r] as const));
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

  // Detail parity on a single sample id present in both (lossless reconstruction).
  let detailMatch = true;
  const sample = local.find((l) => remoteById.has(l.id));
  if (sample) {
    try {
      const remoteFull = await listFullRolesFromSupabase(queryScope);
      const remoteDetail = remoteFull.find((r) => r.id === sample.id) ?? null;
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
    migrateRoles,
    shadowReadRoles,
  };
}
