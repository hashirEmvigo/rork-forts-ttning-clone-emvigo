/**
 * Activity Log migration + shadow-read tooling (ACTIVITY-1).
 *
 * The Activity Log analogue of {@link import("./areaMigration")}. Two READ-ONLY
 * development/admin utilities:
 *
 *   1. `migrateActivityEvents()` — copies localStorage audit events INTO the
 *      Supabase `activity_events` table (idempotent upsert on `legacy_id`,
 *      `dryRun` mode). Company-scoped events whose company has no Supabase
 *      mapping are skipped + reported; platform-level events (companyId null)
 *      migrate with company_id = null.
 *   2. `shadowReadActivityEvents()` — diffs localStorage vs Supabase for a scope
 *      (count / id set / detail payload), capped to the freshest events.
 *
 * localStorage stays the source of truth; these tools only populate + verify.
 * The trail is append-only — there is no removal/soft-delete path.
 */
import { getAuditEvents } from "@/lib/store";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { AuditEvent } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import {
  listActivityEventSummariesFromSupabase,
  listActivityEventsFromSupabase,
} from "./supabaseActivityRepository";

/** A single upsert row written to (or planned for) the `activity_events` table. */
export interface ActivityEventUpsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string | null;
  actor_id: string | null;
  actor_name: string;
  actor_role: string;
  action: string;
  occurred_at: string;
  data: AuditEvent;
}

export interface ActivityMigrationReport {
  ok: boolean;
  dryRun: boolean;
  companyId: string | null;
  sourceCount: number;
  plannedCount: number;
  writtenCount: number;
  skipped: Array<{ id: string; reason: string }>;
  error?: string;
}

function scopeByCompany(events: AuditEvent[], companyId: string | null | undefined): AuditEvent[] {
  if (companyId === undefined || companyId === null) return events;
  return events.filter((e) => e.companyId === companyId);
}

/**
 * Maps a localStorage {@link AuditEvent} to an `activity_events` upsert row.
 * Shared by the migration utility and the dual-write mirror so both write
 * byte-identical rows. Platform-level events carry company_id/company_legacy_id
 * null.
 */
export function toActivityEventUpsertRow(
  event: AuditEvent,
  companyUuid: string | null,
): ActivityEventUpsertRow {
  return {
    legacy_id: event.id,
    company_id: companyUuid,
    company_legacy_id: event.companyId,
    actor_id: event.actorId,
    actor_name: event.actorName,
    actor_role: event.actorRole,
    action: event.action,
    occurred_at: event.at,
    data: event,
  };
}

/** Migrates localStorage audit events into Supabase. */
export async function migrateActivityEvents(options?: {
  companyId?: string | null;
  dryRun?: boolean;
}): Promise<ActivityMigrationReport> {
  const companyId = options?.companyId ?? null;
  const dryRun = options?.dryRun ?? false;

  const source = scopeByCompany(getAuditEvents(), companyId);
  const report: ActivityMigrationReport = {
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
  const rows: ActivityEventUpsertRow[] = [];
  for (const event of source) {
    const uuid = event.companyId ? companyMap.get(event.companyId) ?? null : null;
    if (event.companyId && !uuid) {
      report.skipped.push({
        id: event.id,
        reason: `No Supabase company for legacy_id "${event.companyId}". Migrate companies first.`,
      });
      continue;
    }
    rows.push(toActivityEventUpsertRow(event, uuid));
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
        .from("activity_events")
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

export interface ActivityShadowReport {
  ok: boolean;
  companyId: string | null;
  localCount: number;
  supabaseCount: number;
  countMatch: boolean;
  idsMatch: boolean;
  detailMatch: boolean;
  missingInSupabase: string[];
  notes: string[];
}

/**
 * Compares localStorage audit events against the Supabase shadow copy for a
 * scope. Because both sides are capped to the freshest events, the comparison
 * is over the id SET of the local (capped) events — every local event must be
 * present in Supabase. Extra Supabase rows beyond the local cap are expected
 * (Supabase is uncapped) and never flagged as drift.
 */
export async function shadowReadActivityEvents(
  companyId?: string | null,
): Promise<ActivityShadowReport> {
  const scope = companyId ?? null;
  const queryScope = companyId ?? undefined;
  const notes: string[] = [];

  const local = scopeByCompany(getAuditEvents(), queryScope);

  const report: ActivityShadowReport = {
    ok: false,
    companyId: scope,
    localCount: local.length,
    supabaseCount: 0,
    countMatch: false,
    idsMatch: false,
    detailMatch: false,
    missingInSupabase: [],
    notes,
  };

  if (!isSupabaseConfigured || !supabase) {
    notes.push("Supabase is not configured.");
    return report;
  }

  let remote;
  try {
    remote = await listActivityEventSummariesFromSupabase(queryScope);
  } catch (err) {
    notes.push(err instanceof Error ? err.message : "Supabase read failed.");
    return report;
  }

  report.supabaseCount = remote.length;
  const remoteIds = new Set(remote.map((e) => e.id));
  const missing = local.filter((e) => !remoteIds.has(e.id)).map((e) => e.id);
  report.missingInSupabase = missing;
  report.idsMatch = missing.length === 0;
  // Supabase must contain at least as many rows as the local capped set.
  report.countMatch = remote.length >= local.length;
  if (missing.length > 0) notes.push(`${missing.length} event(s) not yet in Supabase`);

  let detailMatch = true;
  const sample = local.find((e) => remoteIds.has(e.id));
  if (sample) {
    try {
      const remoteFull = await listActivityEventsFromSupabase(queryScope);
      const remoteDetail = remoteFull.find((e) => e.id === sample.id) ?? null;
      detailMatch =
        Boolean(remoteDetail) && JSON.stringify(remoteDetail) === JSON.stringify(sample);
      if (!detailMatch) notes.push(`detail mismatch for ${sample.id}`);
    } catch (err) {
      detailMatch = false;
      notes.push(err instanceof Error ? err.message : "detail read failed");
    }
  }
  report.detailMatch = detailMatch;

  report.ok = report.idsMatch && report.detailMatch;
  return report;
}

if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    migrateActivityEvents,
    shadowReadActivityEvents,
  };
}
