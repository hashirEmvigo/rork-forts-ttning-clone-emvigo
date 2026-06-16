/**
 * Supabase-backed Checklist Template repository boundary (Phase 2C-A3.1).
 *
 * This module talks only to the `checklist_templates` table. It never reads from
 * browser storage, never migrates/rescues local data, and treats empty Supabase
 * reads as authoritative [] / null results. Global/company defaults must be
 * created explicitly outside this boundary; there is no lazy seed path here.
 */
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { perf } from "@/lib/perf";
import {
  sortChecklistItems,
  sortChecklistSections,
  type ChecklistTemplateV2,
  type ChecklistSection,
  type ChecklistItem,
} from "@/types";
import type { DetailParams } from "./types";

const CHECKLIST_TEMPLATE_COLUMNS =
  "legacy_id, company_id, company_legacy_id, scope, name, is_archived, " +
  "data, deleted_at, created_at, updated_at";

/** The lossless aggregate persisted in `checklist_templates.data`. */
export interface ChecklistTemplateAggregate {
  template: ChecklistTemplateV2;
  sections: ChecklistSection[];
  items: ChecklistItem[];
}

/** Row inserted/updated in the `checklist_templates` table. */
export interface ChecklistTemplateUpsertRow {
  legacy_id: string;
  company_id: string | null;
  company_legacy_id: string | null;
  scope: string;
  name: string;
  is_archived: boolean;
  data: ChecklistTemplateAggregate;
  deleted_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

/** Lightweight template row for count / id-set parity checks. */
export interface ChecklistTemplateSummary {
  id: string;
  companyId: string | null;
  scope: string;
  name: string;
}

interface ChecklistTemplateSummaryRow {
  legacy_id: string;
  company_legacy_id: string | null;
  scope: string;
  name: string;
  is_archived: boolean;
  deleted_at: string | null;
}

interface ChecklistTemplateRow extends ChecklistTemplateUpsertRow {
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChecklistTemplateListOptions {
  includeArchived?: boolean;
}

export interface ChecklistTemplateDetailParams extends DetailParams, ChecklistTemplateListOptions {
  scope?: string | null;
}

export interface CreateChecklistTemplateAggregateParams {
  /** Real Supabase companies.id UUID for company templates; null for globals. */
  companyUuid: string | null;
}

export interface ChecklistTemplateMutationParams extends ChecklistTemplateDetailParams {
  now?: string;
}

export type ChecklistTemplateMetadataPatch = Partial<
  Pick<
    ChecklistTemplateV2,
    | "name"
    | "description"
    | "categoryIds"
    | "floorPresetIds"
    | "sortOrder"
    | "audience"
    | "originType"
    | "originId"
    | "sourceGlobalTemplateId"
    | "sourceGlobalTemplateName"
    | "version"
    | "schemaVersion"
  >
>;

export interface CopyGlobalTemplateToCompanyParams {
  targetCompanyId: string;
  targetCompanyUuid: string;
  newTemplateId: string;
  sectionIdFor: (sourceSection: ChecklistSection) => string;
  itemIdFor: (sourceItem: ChecklistItem) => string;
  name?: string;
  now?: string;
}

class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "SupabaseChecklistTemplateRepository requires Supabase. Set " +
        "EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

function requireClient() {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  return supabase;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeAggregate(aggregate: ChecklistTemplateAggregate): ChecklistTemplateAggregate {
  return {
    template: aggregate.template,
    sections: sortChecklistSections(aggregate.sections),
    items: sortChecklistItems(aggregate.items),
  };
}

function rowToSummary(row: ChecklistTemplateSummaryRow): ChecklistTemplateSummary {
  return {
    id: row.legacy_id,
    companyId: row.company_legacy_id,
    scope: row.scope,
    name: row.name,
  };
}

/** Maps a complete checklist-template aggregate to the flat Supabase row shape. */
export function toChecklistTemplateUpsertRow(
  aggregate: ChecklistTemplateAggregate,
  companyUuid: string | null,
): ChecklistTemplateUpsertRow {
  const normalized = normalizeAggregate(aggregate);
  const { template } = normalized;
  return {
    legacy_id: template.id,
    company_id: companyUuid,
    company_legacy_id: template.companyId,
    scope: template.scope ?? (template.companyId ? "company" : "global"),
    name: template.name,
    is_archived: template.isArchived,
    data: normalized,
    deleted_at: null,
    created_at: template.createdAt,
    updated_at: template.updatedAt,
  };
}

function rowToAggregate(row: ChecklistTemplateRow): ChecklistTemplateAggregate | null {
  if (!row.data?.template) return null;
  return normalizeAggregate(row.data);
}

function isVisibleRow(
  row: ChecklistTemplateRow | null,
  params: ChecklistTemplateDetailParams = {},
): row is ChecklistTemplateRow {
  if (!row || row.deleted_at) return false;
  if (params.includeArchived === false && row.is_archived) return false;
  if (params.companyId !== undefined && params.companyId !== null) {
    if (row.company_legacy_id !== params.companyId && row.company_legacy_id !== null) return false;
  }
  if (params.scope !== undefined && params.scope !== null && row.scope !== params.scope) return false;
  return true;
}

function withTimestamp(
  aggregate: ChecklistTemplateAggregate,
  now: string,
): ChecklistTemplateAggregate {
  return normalizeAggregate({
    ...aggregate,
    template: { ...aggregate.template, updatedAt: now },
  });
}

function withArchiveState(
  aggregate: ChecklistTemplateAggregate,
  isArchived: boolean,
  now: string,
): ChecklistTemplateAggregate {
  return normalizeAggregate({
    ...aggregate,
    template: { ...aggregate.template, isArchived, updatedAt: now },
  });
}

async function updateAggregateRow(
  legacyId: string,
  aggregate: ChecklistTemplateAggregate,
  params: ChecklistTemplateMutationParams = {},
): Promise<ChecklistTemplateAggregate | null> {
  const client = requireClient();
  const { template } = aggregate;
  let query = client
    .from("checklist_templates")
    .update({
      company_legacy_id: template.companyId,
      scope: template.scope ?? (template.companyId ? "company" : "global"),
      name: template.name,
      is_archived: template.isArchived,
      data: normalizeAggregate(aggregate),
      updated_at: template.updatedAt,
    })
    .eq("legacy_id", legacyId)
    .is("deleted_at", null);
  if (params.companyId !== undefined && params.companyId !== null) {
    query = query.eq("company_legacy_id", params.companyId);
  }
  if (params.scope !== undefined && params.scope !== null) {
    query = query.eq("scope", params.scope);
  }
  const { data, error } = await query.select(CHECKLIST_TEMPLATE_COLUMNS).maybeSingle();
  if (error) throw new Error(`[checklistTemplates] Supabase update failed: ${error.message}`);
  const updated = (data ?? null) as unknown as ChecklistTemplateRow | null;
  return updated ? rowToAggregate(updated) : null;
}

function mapRows(rows: ChecklistTemplateRow[]): ChecklistTemplateAggregate[] {
  return rows
    .map(rowToAggregate)
    .filter((aggregate): aggregate is ChecklistTemplateAggregate => Boolean(aggregate));
}

/** Supabase source-of-truth boundary for checklist template aggregates. */
export const supabaseChecklistTemplateRepository = {
  /** Lists non-deleted global templates. Empty Supabase returns []. */
  async listGlobal(options: ChecklistTemplateListOptions = {}): Promise<ChecklistTemplateAggregate[]> {
    const client = requireClient();
    const { data, error } = await client
      .from("checklist_templates")
      .select(CHECKLIST_TEMPLATE_COLUMNS)
      .eq("scope", "global")
      .is("company_legacy_id", null)
      .is("deleted_at", null);
    if (error) throw new Error(`[checklistTemplates] Supabase global list failed: ${error.message}`);
    const rows = ((data ?? []) as unknown as ChecklistTemplateRow[]).filter(
      (row) => options.includeArchived !== false || !row.is_archived,
    );
    return mapRows(rows);
  },

  /** Lists non-deleted templates owned by one company only. */
  async listCompany(
    companyId: string,
    options: ChecklistTemplateListOptions = {},
  ): Promise<ChecklistTemplateAggregate[]> {
    const client = requireClient();
    const stop = perf.start("checklistTemplates.list.supabase.repository.company");
    try {
      let query = client
        .from("checklist_templates")
        .select(CHECKLIST_TEMPLATE_COLUMNS)
        .eq("company_legacy_id", companyId)
        .is("deleted_at", null);
      if (options.includeArchived === false) query = query.eq("is_archived", false);
      const { data, error } = await query;
      if (error) throw new Error(`[checklistTemplates] Supabase company list failed: ${error.message}`);
      return mapRows((data ?? []) as unknown as ChecklistTemplateRow[]);
    } finally {
      stop();
    }
  },

  /** Lists one company's templates plus shared global templates. */
  async listCompanyAndGlobal(
    companyId: string,
    options: ChecklistTemplateListOptions = {},
  ): Promise<ChecklistTemplateAggregate[]> {
    const client = requireClient();
    let query = client
      .from("checklist_templates")
      .select(CHECKLIST_TEMPLATE_COLUMNS)
      .or(`company_legacy_id.eq.${companyId},company_legacy_id.is.null`)
      .is("deleted_at", null);
    if (options.includeArchived === false) query = query.eq("is_archived", false);
    const { data, error } = await query;
    if (error) {
      throw new Error(`[checklistTemplates] Supabase company/global list failed: ${error.message}`);
    }
    return mapRows((data ?? []) as unknown as ChecklistTemplateRow[]);
  },

  /** Looks up one non-deleted template by legacy id, optionally scoped. */
  async getByLegacyId(
    legacyId: string,
    params: ChecklistTemplateDetailParams = {},
  ): Promise<ChecklistTemplateAggregate | null> {
    const client = requireClient();
    const { data, error } = await client
      .from("checklist_templates")
      .select(CHECKLIST_TEMPLATE_COLUMNS)
      .eq("legacy_id", legacyId)
      .maybeSingle();
    if (error) throw new Error(`[checklistTemplates] Supabase get failed: ${error.message}`);
    const row = (data ?? null) as unknown as ChecklistTemplateRow | null;
    if (!isVisibleRow(row, params)) return null;
    return rowToAggregate(row);
  },

  /** Resolves an app-facing company id to the real Supabase companies.id UUID. */
  async resolveCompanyUuidByLegacyId(companyId: string): Promise<string | null> {
    const client = requireClient();
    const { data, error } = await client
      .from("companies")
      .select("id")
      .eq("legacy_id", companyId)
      .maybeSingle();
    if (error) {
      throw new Error(`[checklistTemplates] Supabase company UUID lookup failed: ${error.message}`);
    }
    return ((data ?? null) as { id: string } | null)?.id ?? null;
  },

  /** Inserts a new checklist-template aggregate. No upsert, no lazy seed. */
  async createAggregate(
    aggregate: ChecklistTemplateAggregate,
    params: CreateChecklistTemplateAggregateParams,
  ): Promise<ChecklistTemplateAggregate> {
    const client = requireClient();
    const row = toChecklistTemplateUpsertRow(aggregate, params.companyUuid);
    const { data, error } = await client
      .from("checklist_templates")
      .insert(row)
      .select(CHECKLIST_TEMPLATE_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(`[checklistTemplates] Supabase create failed: ${error.message}`);
    const created = rowToAggregate(data as unknown as ChecklistTemplateRow);
    if (!created) throw new Error("[checklistTemplates] Supabase create returned an invalid row");
    return created;
  },

  /** Replaces the persisted aggregate for an existing template row. */
  async updateAggregate(
    aggregate: ChecklistTemplateAggregate,
    params: ChecklistTemplateMutationParams = {},
  ): Promise<ChecklistTemplateAggregate | null> {
    return updateAggregateRow(aggregate.template.id, normalizeAggregate(aggregate), params);
  },

  /** Updates top-level template metadata inside both flat columns and JSON data. */
  async updateMetadata(
    legacyId: string,
    patch: ChecklistTemplateMetadataPatch,
    params: ChecklistTemplateMutationParams = {},
  ): Promise<ChecklistTemplateAggregate | null> {
    const current = await this.getByLegacyId(legacyId, params);
    if (!current) return null;
    const now = params.now ?? nowIso();
    const next = normalizeAggregate({
      ...current,
      template: { ...current.template, ...patch, updatedAt: now },
    });
    return updateAggregateRow(legacyId, next, params);
  },

  /** Replaces section/item JSON aggregate content without touching browser storage. */
  async updateSectionsAndItems(
    legacyId: string,
    sections: ChecklistSection[],
    items: ChecklistItem[],
    params: ChecklistTemplateMutationParams = {},
  ): Promise<ChecklistTemplateAggregate | null> {
    const current = await this.getByLegacyId(legacyId, params);
    if (!current) return null;
    const next = withTimestamp({ ...current, sections, items }, params.now ?? nowIso());
    return updateAggregateRow(legacyId, next, params);
  },

  /** Archives a template by setting its domain archive flag. No hard delete. */
  async archive(
    legacyId: string,
    params: ChecklistTemplateMutationParams = {},
  ): Promise<ChecklistTemplateAggregate | null> {
    const current = await this.getByLegacyId(legacyId, { ...params, includeArchived: true });
    if (!current) return null;
    return updateAggregateRow(
      legacyId,
      withArchiveState(current, true, params.now ?? nowIso()),
      params,
    );
  },

  /** Restores a domain-archived template. */
  async restore(
    legacyId: string,
    params: ChecklistTemplateMutationParams = {},
  ): Promise<ChecklistTemplateAggregate | null> {
    const current = await this.getByLegacyId(legacyId, { ...params, includeArchived: true });
    if (!current) return null;
    return updateAggregateRow(
      legacyId,
      withArchiveState(current, false, params.now ?? nowIso()),
      params,
    );
  },

  /**
   * Copies an existing Supabase global template into one company. Callers provide
   * deterministic new ids; this is a Supabase-to-Supabase copy, not a seed or
   * browser-storage rescue path.
   */
  async copyGlobalToCompany(
    sourceLegacyId: string,
    params: CopyGlobalTemplateToCompanyParams,
  ): Promise<ChecklistTemplateAggregate | null> {
    const source = await this.getByLegacyId(sourceLegacyId, {
      scope: "global",
      includeArchived: false,
    });
    if (!source || source.template.scope !== "global" || source.template.companyId !== null) {
      return null;
    }

    const now = params.now ?? nowIso();
    const sectionIdMap = new Map<string, string>();
    const sections = source.sections.map((section) => {
      const id = params.sectionIdFor(section);
      sectionIdMap.set(section.id, id);
      return {
        ...section,
        id,
        templateId: params.newTemplateId,
        companyId: params.targetCompanyId,
        createdAt: now,
        updatedAt: now,
      } satisfies ChecklistSection;
    });
    const items = source.items.map((item) => ({
      ...item,
      id: params.itemIdFor(item),
      sectionId: sectionIdMap.get(item.sectionId) ?? item.sectionId,
      templateId: params.newTemplateId,
      companyId: params.targetCompanyId,
      createdAt: now,
      updatedAt: now,
    })) satisfies ChecklistItem[];

    const aggregate: ChecklistTemplateAggregate = normalizeAggregate({
      template: {
        ...source.template,
        id: params.newTemplateId,
        companyId: params.targetCompanyId,
        scope: "company",
        name: params.name ?? source.template.name,
        isArchived: false,
        originType: "global",
        originId: source.template.id,
        sourceGlobalTemplateId: source.template.id,
        sourceGlobalTemplateName: source.template.name,
        createdAt: now,
        updatedAt: now,
      },
      sections,
      items,
    });

    return this.createAggregate(aggregate, { companyUuid: params.targetCompanyUuid });
  },

  /** Soft-deletes a template row by setting deleted_at. There is no hard-delete path. */
  async softDelete(
    legacyId: string,
    params: ChecklistTemplateMutationParams = {},
  ): Promise<boolean> {
    const client = requireClient();
    let query = client
      .from("checklist_templates")
      .update({ deleted_at: params.now ?? nowIso() })
      .eq("legacy_id", legacyId)
      .is("deleted_at", null);
    if (params.companyId !== undefined && params.companyId !== null) {
      query = query.eq("company_legacy_id", params.companyId);
    }
    if (params.scope !== undefined && params.scope !== null) {
      query = query.eq("scope", params.scope);
    }
    const { data, error } = await query.select("legacy_id").maybeSingle();
    if (error) throw new Error(`[checklistTemplates] Supabase soft-delete failed: ${error.message}`);
    return Boolean(data);
  },
};

/**
 * Company-scoped summary rows: the company's templates PLUS the shared global
 * library. Soft-deleted rows filtered out. Unscoped returns all RLS-visible.
 */
export async function listChecklistTemplateSummariesFromSupabase(
  companyId?: string | null,
): Promise<ChecklistTemplateSummary[]> {
  if (!isSupabaseConfigured || !supabase) throw new SupabaseNotConfiguredError();
  const stop = perf.start("checklistTemplates.list.supabase.summaries");
  try {
    let query = supabase.from("checklist_templates").select(
      "legacy_id, company_legacy_id, scope, name, is_archived, deleted_at",
    );
    if (companyId !== undefined && companyId !== null) {
      query = query.or(`company_legacy_id.eq.${companyId},company_legacy_id.is.null`);
    }
    const { data, error } = await query;
    if (error) {
      throw new Error(`[checklist_templates] Supabase list failed: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as ChecklistTemplateSummaryRow[];
    return rows.filter((r) => !r.deleted_at).map(rowToSummary);
  } finally {
    stop();
  }
}

/** FULL template aggregates (lossless `data` jsonb) for a company scope. */
export async function listFullChecklistTemplatesFromSupabase(
  companyId?: string | null,
): Promise<ChecklistTemplateAggregate[]> {
  if (companyId !== undefined && companyId !== null) {
    return supabaseChecklistTemplateRepository.listCompanyAndGlobal(companyId, {
      includeArchived: true,
    });
  }
  const client = requireClient();
  const stop = perf.start("checklistTemplates.list.supabase.full");
  perf.count("checklistTemplates.list.supabase.full.calls");
  try {
    const { data, error } = await client
      .from("checklist_templates")
      .select(CHECKLIST_TEMPLATE_COLUMNS)
      .is("deleted_at", null);
    if (error) {
      throw new Error(`[checklist_templates] Supabase full list failed: ${error.message}`);
    }
    return mapRows((data ?? []) as unknown as ChecklistTemplateRow[]);
  } finally {
    stop();
  }
}
