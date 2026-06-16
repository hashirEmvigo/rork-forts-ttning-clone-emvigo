/**
 * Checklist Template migration + shadow-read tooling (CHK-1).
 *
 * Reads the three localStorage collections (templates / sections / items),
 * groups them into {@link ChecklistTemplateAggregate}s keyed by template id, and
 * upserts one row per template into `checklist_templates`. Global templates
 * (companyId null) migrate with company_id null and are never skipped; company
 * templates whose company has no Supabase row are skipped + reported.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { ChecklistTemplateV2, ChecklistSection, ChecklistItem } from "@/types";
import { loadCompanyUuidMap } from "./customerMigration";
import {
  listChecklistTemplateSummariesFromSupabase,
  listFullChecklistTemplatesFromSupabase,
  type ChecklistTemplateAggregate,
} from "./supabaseChecklistTemplateRepository";

const TEMPLATES_KEY = "cleanops.checklistTemplates";
const SECTIONS_KEY = "cleanops.checklistSections";
const ITEMS_KEY = "cleanops.checklistItems";

function readKey<T>(key: string): T[] {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

/** Builds the lossless aggregates from the three localStorage collections. */
export function readLocalChecklistAggregates(): ChecklistTemplateAggregate[] {
  const templates = readKey<ChecklistTemplateV2>(TEMPLATES_KEY);
  const sections = readKey<ChecklistSection>(SECTIONS_KEY);
  const items = readKey<ChecklistItem>(ITEMS_KEY);
  return templates.map((template) => ({
    template,
    sections: sections.filter((s) => s.templateId === template.id),
    items: items.filter((i) => i.templateId === template.id),
  }));
}

/** A single upsert row written to (or planned for) `checklist_templates`. */
export interface ChecklistTemplateUpsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string | null;
  scope: string;
  name: string;
  is_archived: boolean;
  deleted_at: string | null;
  data: ChecklistTemplateAggregate;
}

/** Structured outcome of a checklist-template migration run (or dry-run). */
export interface ChecklistTemplateMigrationReport {
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
  aggregates: ChecklistTemplateAggregate[],
  companyId: string | null | undefined,
): ChecklistTemplateAggregate[] {
  if (companyId === undefined || companyId === null) return aggregates;
  return aggregates.filter(
    (a) => a.template.companyId === companyId || a.template.scope === "global",
  );
}

/** Maps a localStorage aggregate to a `checklist_templates` upsert row. */
export function toChecklistTemplateUpsertRow(
  aggregate: ChecklistTemplateAggregate,
  companyUuid: string | null,
): ChecklistTemplateUpsertRow {
  const t = aggregate.template;
  return {
    legacy_id: t.id,
    company_id: companyUuid,
    company_legacy_id: t.companyId,
    scope: t.scope ?? (t.companyId ? "company" : "global"),
    name: t.name,
    is_archived: t.isArchived,
    deleted_at: null,
    data: aggregate,
  };
}

/** Migrates localStorage checklist templates into Supabase. */
export async function migrateChecklistTemplates(options?: {
  companyId?: string | null;
  dryRun?: boolean;
}): Promise<ChecklistTemplateMigrationReport> {
  const companyId = options?.companyId ?? null;
  const dryRun = options?.dryRun ?? false;

  const source = scopeByCompany(readLocalChecklistAggregates(), companyId);
  const report: ChecklistTemplateMigrationReport = {
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
  const rows: ChecklistTemplateUpsertRow[] = [];
  for (const aggregate of source) {
    const t = aggregate.template;
    if (t.scope === "global" || !t.companyId) {
      rows.push(toChecklistTemplateUpsertRow(aggregate, null));
      continue;
    }
    const uuid = companyMap.get(t.companyId) ?? null;
    if (!uuid) {
      report.skipped.push({
        id: t.id,
        reason: `No Supabase company found for legacy_id "${t.companyId}". Migrate companies first.`,
      });
      continue;
    }
    rows.push(toChecklistTemplateUpsertRow(aggregate, uuid));
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
        .from("checklist_templates")
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

/** Per-aspect outcome of a localStorage-vs-Supabase template comparison. */
export interface ChecklistTemplateShadowReport {
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

/** Compares localStorage checklist templates against the Supabase shadow copy. */
export async function shadowReadChecklistTemplates(
  companyId?: string | null,
): Promise<ChecklistTemplateShadowReport> {
  const scope = companyId ?? null;
  const queryScope = companyId ?? undefined;
  const notes: string[] = [];

  const local = scopeByCompany(readLocalChecklistAggregates(), queryScope);

  const report: ChecklistTemplateShadowReport = {
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

  let remote: Awaited<ReturnType<typeof listChecklistTemplateSummariesFromSupabase>>;
  try {
    remote = await listChecklistTemplateSummariesFromSupabase(queryScope);
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
    local.map((a) => a.template.id),
    remote.map((t) => t.id),
  );
  report.missingInSupabase = onlyA;
  report.extraInSupabase = onlyB;
  report.idsMatch = onlyA.length === 0 && onlyB.length === 0;
  if (onlyA.length > 0) notes.push(`${onlyA.length} template(s) not yet in Supabase`);
  if (onlyB.length > 0) notes.push(`${onlyB.length} extra template(s) in Supabase`);

  const remoteById = new Map(remote.map((t) => [t.id, t] as const));
  let summaryMatch = true;
  for (const l of local) {
    const r = remoteById.get(l.template.id);
    if (!r) continue;
    if (r.name !== l.template.name) {
      summaryMatch = false;
      notes.push(`summary mismatch for ${l.template.id}`);
      break;
    }
  }
  report.summaryMatch = summaryMatch;

  let detailMatch = true;
  const sample = local.find((l) => remoteById.has(l.template.id));
  if (sample) {
    try {
      const remoteFull = await listFullChecklistTemplatesFromSupabase(queryScope);
      const remoteDetail =
        remoteFull.find((a) => a.template.id === sample.template.id) ?? null;
      detailMatch =
        Boolean(remoteDetail) && JSON.stringify(remoteDetail) === JSON.stringify(sample);
      if (!detailMatch) notes.push(`detail mismatch for ${sample.template.id}`);
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
    migrateChecklistTemplates,
    shadowReadChecklistTemplates,
  };
}
