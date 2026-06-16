/**
 * Service Package migration + shadow-read tooling (SVCCAT-1).
 *
 * The service-packages analogue of {@link import("./serviceCategoryMigration")},
 * simplified because packages are ALWAYS global master data (no companyId):
 *
 *   1. `migrateServicePackages()` — idempotent upsert on `legacy_id` into the
 *      Supabase `service_packages` table, `dryRun` mode. Every package row is
 *      `company_id = null`; nothing is ever skipped for company mapping.
 *
 *   2. `shadowReadServicePackages()` — count / id-set / name / detail parity.
 *
 * `status` is derived from the `archived` flag ("archived" | "active") so the
 * flat column stays meaningful; the lossless `data` jsonb carries the full
 * package incl. its `items`.
 */
import { getServicePackages } from "@/lib/store";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { ServicePackage } from "@/types";
import {
  listServicePackageSummariesFromSupabase,
  listFullServicePackagesFromSupabase,
} from "./supabaseServicePackageRepository";

/** A single upsert row written to (or planned for) `service_packages`. */
export interface ServicePackageUpsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string | null;
  name: string;
  status: string;
  deleted_at: string | null;
  data: ServicePackage;
}

/** Structured outcome of a package migration run (or dry-run). */
export interface ServicePackageMigrationReport {
  ok: boolean;
  dryRun: boolean;
  sourceCount: number;
  plannedCount: number;
  writtenCount: number;
  error?: string;
}

/** Maps a localStorage {@link ServicePackage} to a `service_packages` row. */
export function toServicePackageUpsertRow(pkg: ServicePackage): ServicePackageUpsertRow {
  return {
    legacy_id: pkg.id,
    company_id: null,
    company_legacy_id: null,
    name: pkg.name,
    status: pkg.archived ? "archived" : "active",
    deleted_at: null,
    data: pkg,
  };
}

/** Migrates localStorage service packages into Supabase. */
export async function migrateServicePackages(options?: {
  dryRun?: boolean;
}): Promise<ServicePackageMigrationReport> {
  const dryRun = options?.dryRun ?? false;

  const source = getServicePackages();
  const report: ServicePackageMigrationReport = {
    ok: false,
    dryRun,
    sourceCount: source.length,
    plannedCount: 0,
    writtenCount: 0,
  };

  if (!isSupabaseConfigured || !supabase) {
    report.error = "Supabase is not configured.";
    return report;
  }

  const rows = source.map(toServicePackageUpsertRow);
  report.plannedCount = rows.length;

  if (dryRun || rows.length === 0) {
    report.ok = true;
    return report;
  }

  const CHUNK = 200;
  try {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await supabase
        .from("service_packages")
        .upsert(chunk, { onConflict: "legacy_id" });
      if (error) {
        report.error = `Upsert failed at chunk ${i / CHUNK}: ${error.message}`;
        report.writtenCount = i;
        return report;
      }
    }
    report.writtenCount = rows.length;
    report.ok = true;
    return report;
  } catch (err) {
    report.error = err instanceof Error ? err.message : "Unknown migration error.";
    return report;
  }
}

/** Per-aspect outcome of a localStorage-vs-Supabase package comparison. */
export interface ServicePackageShadowReport {
  ok: boolean;
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

/** Compares localStorage service packages against the Supabase shadow copy. */
export async function shadowReadServicePackages(): Promise<ServicePackageShadowReport> {
  const notes: string[] = [];
  const local = getServicePackages();

  const report: ServicePackageShadowReport = {
    ok: false,
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

  let remote: Awaited<ReturnType<typeof listServicePackageSummariesFromSupabase>>;
  try {
    remote = await listServicePackageSummariesFromSupabase();
  } catch (err) {
    notes.push(err instanceof Error ? err.message : "Supabase read failed.");
    return report;
  }

  report.supabaseCount = remote.length;
  report.countMatch = local.length === remote.length;
  if (!report.countMatch) {
    notes.push(`count mismatch: local ${local.length} vs supabase ${remote.length}`);
  }

  const { onlyA, onlyB } = idSetDiff(local.map((p) => p.id), remote.map((p) => p.id));
  report.missingInSupabase = onlyA;
  report.extraInSupabase = onlyB;
  report.idsMatch = onlyA.length === 0 && onlyB.length === 0;
  if (onlyA.length > 0) notes.push(`${onlyA.length} package(s) not yet in Supabase`);
  if (onlyB.length > 0) notes.push(`${onlyB.length} extra package(s) in Supabase`);

  const remoteById = new Map(remote.map((p) => [p.id, p] as const));
  let summaryMatch = true;
  for (const l of local) {
    const r = remoteById.get(l.id);
    if (!r) continue;
    if (r.name !== l.name) {
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
      const remoteFull = await listFullServicePackagesFromSupabase();
      const remoteDetail = remoteFull.find((p) => p.id === sample.id) ?? null;
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
    migrateServicePackages,
    shadowReadServicePackages,
  };
}
