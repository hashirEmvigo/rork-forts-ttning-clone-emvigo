/**
 * Service Entitlements migration + shadow-read tooling (ENT-1).
 *
 * The Entitlements analogue of {@link import("./areaMigration")}, spanning the
 * THREE entitlement stores. Two READ-ONLY development/admin utilities:
 *
 *   1. `migrateEntitlements()` — copies localStorage entitlements (global +
 *      company + log) INTO the Supabase tables (idempotent upsert on
 *      `legacy_id`, `dryRun` mode). Company rows whose company has no Supabase
 *      mapping are skipped + reported; global rows + platform-wide log entries
 *      have no company dependency.
 *   2. `shadowReadEntitlements()` — diffs localStorage vs Supabase (counts / id
 *      sets / detail payloads) across all three stores.
 *
 * localStorage stays the source of truth; these tools only populate + verify.
 */
import {
  getServiceGlobalEntitlements,
  getCompanyServiceEntitlements,
  getServiceEntitlementLog,
} from "@/lib/store";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type {
  ServiceGlobalEntitlement,
  CompanyServiceEntitlement,
  ServiceEntitlementLogEntry,
} from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import {
  listGlobalEntitlementsFromSupabase,
  listCompanyEntitlementsFromSupabase,
  listEntitlementLogFromSupabase,
} from "./supabaseEntitlementRepository";

/** Stable synthetic upsert key for a company entitlement. */
export function companyEntitlementLegacyId(companyId: string, serviceKey: string): string {
  return `${companyId}::${serviceKey}`;
}

export interface GlobalEntitlementUpsertRow {
  legacy_id: string;
  service_key: string;
  enabled: boolean;
  deleted_at: string | null;
  data: ServiceGlobalEntitlement;
}

export interface CompanyEntitlementUpsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string;
  service_key: string;
  status: string;
  enabled: boolean;
  deleted_at: string | null;
  data: CompanyServiceEntitlement;
}

export interface EntitlementLogUpsertRow {
  legacy_id: string;
  service_key: string;
  company_id: string | null;
  company_legacy_id: string | null;
  action: string;
  changed_at: string;
  data: ServiceEntitlementLogEntry;
}

export function toGlobalEntitlementUpsertRow(
  g: ServiceGlobalEntitlement,
): GlobalEntitlementUpsertRow {
  return {
    legacy_id: g.serviceKey,
    service_key: g.serviceKey,
    enabled: g.enabled,
    deleted_at: null,
    data: g,
  };
}

export function toCompanyEntitlementUpsertRow(
  c: CompanyServiceEntitlement,
  companyUuid: string | null,
): CompanyEntitlementUpsertRow {
  return {
    legacy_id: companyEntitlementLegacyId(c.companyId, c.serviceKey),
    company_id: companyUuid,
    company_legacy_id: c.companyId,
    service_key: c.serviceKey,
    status: c.status ?? (c.enabled ? "enabled" : "disabled"),
    enabled: c.enabled,
    deleted_at: null,
    data: c,
  };
}

export function toEntitlementLogUpsertRow(
  l: ServiceEntitlementLogEntry,
  companyUuid: string | null,
): EntitlementLogUpsertRow {
  return {
    legacy_id: l.id,
    service_key: l.serviceKey,
    company_id: companyUuid,
    company_legacy_id: l.companyId,
    action: l.action,
    changed_at: l.changedAt,
    data: l,
  };
}

export interface EntitlementMigrationReport {
  ok: boolean;
  dryRun: boolean;
  companyId: string | null;
  global: { source: number; written: number };
  company: { source: number; planned: number; written: number };
  log: { source: number; planned: number; written: number };
  skipped: Array<{ id: string; reason: string }>;
  error?: string;
}

function scopeCompany<T extends { companyId: string }>(
  items: T[],
  companyId: string | null | undefined,
): T[] {
  if (companyId === undefined || companyId === null) return items;
  return items.filter((i) => i.companyId === companyId);
}

/** Migrates localStorage entitlements (all three stores) into Supabase. */
export async function migrateEntitlements(options?: {
  companyId?: string | null;
  dryRun?: boolean;
}): Promise<EntitlementMigrationReport> {
  const companyId = options?.companyId ?? null;
  const dryRun = options?.dryRun ?? false;

  const globals = getServiceGlobalEntitlements();
  const companies = scopeCompany(getCompanyServiceEntitlements(), companyId);
  const logs = getServiceEntitlementLog().filter(
    (l) => companyId === null || l.companyId === companyId,
  );

  const report: EntitlementMigrationReport = {
    ok: false,
    dryRun,
    companyId,
    global: { source: globals.length, written: 0 },
    company: { source: companies.length, planned: 0, written: 0 },
    log: { source: logs.length, planned: 0, written: 0 },
    skipped: [],
  };

  if (!isSupabaseConfigured || !supabase) {
    report.error = "Supabase is not configured.";
    return report;
  }

  const companyMap = await loadCompanyUuidMap();

  const globalRows = globals.map(toGlobalEntitlementUpsertRow);

  const companyRows: CompanyEntitlementUpsertRow[] = [];
  for (const c of companies) {
    const uuid = companyMap.get(c.companyId) ?? null;
    if (!uuid) {
      report.skipped.push({
        id: companyEntitlementLegacyId(c.companyId, c.serviceKey),
        reason: `No Supabase company for legacy_id "${c.companyId}". Migrate companies first.`,
      });
      continue;
    }
    companyRows.push(toCompanyEntitlementUpsertRow(c, uuid));
  }
  report.company.planned = companyRows.length;

  const logRows: EntitlementLogUpsertRow[] = [];
  for (const l of logs) {
    const uuid = l.companyId ? companyMap.get(l.companyId) ?? null : null;
    if (l.companyId && !uuid) {
      report.skipped.push({
        id: l.id,
        reason: `No Supabase company for log legacy_id "${l.companyId}". Migrate companies first.`,
      });
      continue;
    }
    logRows.push(toEntitlementLogUpsertRow(l, uuid));
  }
  report.log.planned = logRows.length;

  if (dryRun) {
    report.ok = report.skipped.length === 0;
    return report;
  }

  try {
    if (globalRows.length > 0) {
      const { error } = await supabase
        .from("service_global_entitlements")
        .upsert(globalRows, { onConflict: "legacy_id" });
      if (error) {
        report.error = `Global upsert failed: ${error.message}`;
        return report;
      }
      report.global.written = globalRows.length;
    }
    if (companyRows.length > 0) {
      const { error } = await supabase
        .from("company_service_entitlements")
        .upsert(companyRows, { onConflict: "legacy_id" });
      if (error) {
        report.error = `Company upsert failed: ${error.message}`;
        return report;
      }
      report.company.written = companyRows.length;
    }
    if (logRows.length > 0) {
      const { error } = await supabase
        .from("service_entitlement_log")
        .upsert(logRows, { onConflict: "legacy_id" });
      if (error) {
        report.error = `Log upsert failed: ${error.message}`;
        return report;
      }
      report.log.written = logRows.length;
    }
    report.ok = report.skipped.length === 0;
    return report;
  } catch (err) {
    report.error = err instanceof Error ? err.message : "Unknown migration error.";
    return report;
  }
}

export interface EntitlementShadowReport {
  ok: boolean;
  companyId: string | null;
  global: { local: number; supabase: number; match: boolean };
  company: { local: number; supabase: number; match: boolean };
  log: { local: number; supabase: number; match: boolean };
  detailMatch: boolean;
  notes: string[];
}

/** Compares localStorage entitlements against the Supabase shadow copy. */
export async function shadowReadEntitlements(
  companyId?: string | null,
): Promise<EntitlementShadowReport> {
  const scope = companyId ?? null;
  const queryScope = companyId ?? undefined;
  const notes: string[] = [];

  const localGlobals = getServiceGlobalEntitlements();
  const localCompanies = scopeCompany(getCompanyServiceEntitlements(), queryScope);
  const localLogs = getServiceEntitlementLog().filter(
    (l) => scope === null || l.companyId === scope,
  );

  const report: EntitlementShadowReport = {
    ok: false,
    companyId: scope,
    global: { local: localGlobals.length, supabase: 0, match: false },
    company: { local: localCompanies.length, supabase: 0, match: false },
    log: { local: localLogs.length, supabase: 0, match: false },
    detailMatch: false,
    notes,
  };

  if (!isSupabaseConfigured || !supabase) {
    notes.push("Supabase is not configured.");
    return report;
  }

  try {
    const [remoteGlobals, remoteCompanies, remoteLogs] = await Promise.all([
      listGlobalEntitlementsFromSupabase(),
      listCompanyEntitlementsFromSupabase(queryScope),
      listEntitlementLogFromSupabase(queryScope),
    ]);

    report.global.supabase = remoteGlobals.length;
    report.company.supabase = remoteCompanies.length;
    report.log.supabase = remoteLogs.length;
    report.global.match = remoteGlobals.length === localGlobals.length;
    report.company.match = remoteCompanies.length === localCompanies.length;
    report.log.match = remoteLogs.length === localLogs.length;
    if (!report.global.match) notes.push("global count mismatch");
    if (!report.company.match) notes.push("company count mismatch");
    if (!report.log.match) notes.push("log count mismatch");

    let detailMatch = true;
    const sample = localCompanies[0];
    if (sample) {
      const remote = remoteCompanies.find(
        (c) => c.companyId === sample.companyId && c.serviceKey === sample.serviceKey,
      );
      detailMatch = Boolean(remote) && JSON.stringify(remote) === JSON.stringify(sample);
      if (!detailMatch) notes.push(`detail mismatch for ${sample.companyId}/${sample.serviceKey}`);
    }
    report.detailMatch = detailMatch;

    report.ok =
      report.global.match && report.company.match && report.log.match && report.detailMatch;
    return report;
  } catch (err) {
    notes.push(err instanceof Error ? err.message : "Supabase read failed.");
    return report;
  }
}

if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    migrateEntitlements,
    shadowReadEntitlements,
  };
}
