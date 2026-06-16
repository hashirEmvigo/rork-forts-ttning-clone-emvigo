/**
 * Settings Template migration + shadow-read tooling (SET-1).
 *
 * The settings-templates analogue of {@link import("./servicePackageMigration")},
 * simplified because templates are ALWAYS global master data (no companyId):
 *
 *   1. `migrateSettingsTemplates()` — idempotent upsert on `legacy_id` into the
 *      Supabase `settings_templates` table, `dryRun` mode. Every row is
 *      `company_id = null`; nothing is ever skipped for company mapping.
 *   2. `shadowReadSettingsTemplates()` — count / id-set / name / detail parity.
 *
 * `status` is derived from the `archived` flag ("archived" | "active") so the
 * flat column stays meaningful; the lossless `data` jsonb carries the full
 * template incl. its `SettingsData` blob.
 */
import { getSettingsTemplates } from "@/lib/store";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { SettingsTemplate } from "@/types";
import {
  listSettingsTemplateSummariesFromSupabase,
  listFullSettingsTemplatesFromSupabase,
} from "./supabaseSettingsTemplateRepository";

/** A single upsert row written to (or planned for) `settings_templates`. */
export interface SettingsTemplateUpsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string | null;
  name: string;
  status: string;
  deleted_at: string | null;
  data: SettingsTemplate;
}

/** Structured outcome of a settings-template migration run (or dry-run). */
export interface SettingsTemplateMigrationReport {
  ok: boolean;
  dryRun: boolean;
  sourceCount: number;
  plannedCount: number;
  writtenCount: number;
  error?: string;
}

/** Maps a localStorage {@link SettingsTemplate} to a `settings_templates` row. */
export function toSettingsTemplateUpsertRow(
  template: SettingsTemplate,
): SettingsTemplateUpsertRow {
  return {
    legacy_id: template.id,
    company_id: null,
    company_legacy_id: null,
    name: template.name,
    status: template.archived ? "archived" : "active",
    deleted_at: null,
    data: template,
  };
}

/** Migrates localStorage settings templates into Supabase. */
export async function migrateSettingsTemplates(options?: {
  dryRun?: boolean;
}): Promise<SettingsTemplateMigrationReport> {
  const dryRun = options?.dryRun ?? false;

  const source = getSettingsTemplates();
  const report: SettingsTemplateMigrationReport = {
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

  const rows = source.map(toSettingsTemplateUpsertRow);
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
        .from("settings_templates")
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

/** Per-aspect outcome of a localStorage-vs-Supabase template comparison. */
export interface SettingsTemplateShadowReport {
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

/** Compares localStorage settings templates against the Supabase shadow copy. */
export async function shadowReadSettingsTemplates(): Promise<SettingsTemplateShadowReport> {
  const notes: string[] = [];
  const local = getSettingsTemplates();

  const report: SettingsTemplateShadowReport = {
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

  let remote: Awaited<ReturnType<typeof listSettingsTemplateSummariesFromSupabase>>;
  try {
    remote = await listSettingsTemplateSummariesFromSupabase();
  } catch (err) {
    notes.push(err instanceof Error ? err.message : "Supabase read failed.");
    return report;
  }

  report.supabaseCount = remote.length;
  report.countMatch = local.length === remote.length;
  if (!report.countMatch) {
    notes.push(`count mismatch: local ${local.length} vs supabase ${remote.length}`);
  }

  const { onlyA, onlyB } = idSetDiff(local.map((t) => t.id), remote.map((t) => t.id));
  report.missingInSupabase = onlyA;
  report.extraInSupabase = onlyB;
  report.idsMatch = onlyA.length === 0 && onlyB.length === 0;
  if (onlyA.length > 0) notes.push(`${onlyA.length} template(s) not yet in Supabase`);
  if (onlyB.length > 0) notes.push(`${onlyB.length} extra template(s) in Supabase`);

  const remoteById = new Map(remote.map((t) => [t.id, t] as const));
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
      const remoteFull = await listFullSettingsTemplatesFromSupabase();
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

if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    migrateSettingsTemplates,
    shadowReadSettingsTemplates,
  };
}
