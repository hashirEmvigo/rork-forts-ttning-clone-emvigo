/**
 * Agreement Templates persistence orchestration (Phase 9 · foundation write path).
 *
 * The production WRITE path that turns the pure Agreement Template LOGIC layer
 * (`agreementTemplates.ts`) into durable Supabase rows on the migration 0015
 * schema. It is the missing half between the immutable builders and the
 * repository read/write surface (`agreementTemplatesRepository.ts`).
 *
 * Entry points:
 *   1. {@link persistTemplate} — IDEMPOTENT upsert of a template + its lines.
 *      Resolves the tenant UUID for company templates (global → null) and writes
 *      the template (parent) before its lines (children) so a failed parent write
 *      never leaves orphan lines. Re-running overwrites the same `legacy_id`
 *      (heals drift / flips status), never duplicates.
 *   2. {@link copyGlobalTemplateToCompany} — reads a persisted (typically global)
 *      template + lines, builds an INDEPENDENT company-owned copy
 *      ({@link copyTemplateToCompany}) and persists it.
 *   3. {@link archiveTemplate} — flips a template's status to `inactive` (or
 *      `superseded`) and re-persists. Templates are archived, never deleted;
 *      existing agreements created from them are snapshots and stay unaffected.
 *   4. {@link createAgreementFromPersistedTemplate} — reads a persisted template
 *      + lines and runs the pure Template → Agreement creation flow. The
 *      returned agreement is an INDEPENDENT snapshot — it is NOT persisted here
 *      (the caller owns the agreement write path), and NO Time Bank wallet is
 *      created (entitlement still gates that downstream).
 *
 * FOUNDATION ONLY — changes NO business behaviour and performs NO activation:
 * localStorage stays the operational source of truth; these tables are a shadow
 * copy until a future explicit cut-over. No flag, no production-authoritative
 * flip, no customer rollout, no UI, no automatic wallet creation.
 */
import type {
  AgreementTemplate,
  AgreementTemplateLine,
  AgreementTemplateStatus,
} from "@/types";
import {
  copyTemplateToCompany,
  createAgreementFromTemplate,
  validateTemplateForCreation,
  type CreateAgreementFromTemplateResult,
  type CreateAgreementOverrides,
} from "./agreementTemplates";
import { supabaseAgreementTemplatesRepository } from "./agreementTemplatesRepository";
import { loadCompanyUuidMap } from "./customerMigration";

/** Shared write options across the persistence entry points. */
export interface TemplatePersistOptions {
  /** When true, compute the plan + report but write nothing. */
  dryRun?: boolean;
}

/**
 * Resolves the real Supabase tenant UUID for an app-facing company id. Returns
 * null when no `companies` row matches (RLS would reject the write) so callers
 * can abort cleanly with a clear reason.
 */
async function resolveCompanyUuid(companyLegacyId: string): Promise<string | null> {
  const map = await loadCompanyUuidMap();
  return map.get(companyLegacyId) ?? null;
}

// ── Template persistence (idempotent upsert) ─────────────────

/** Inputs for {@link persistTemplate}. */
export interface PersistTemplateInput extends TemplatePersistOptions {
  template: AgreementTemplate;
  lines: AgreementTemplateLine[];
}

/** Outcome of a {@link persistTemplate} run. */
export interface PersistTemplateResult {
  ok: boolean;
  dryRun: boolean;
  /** The persisted template (echoed for chaining). Null only on early failure. */
  template: AgreementTemplate | null;
  /** Number of template rows written (0 or 1; 0 on dryRun). */
  writtenTemplateCount: number;
  /** Number of line rows written (0 on dryRun). */
  writtenLineCount: number;
  error?: string;
}

/**
 * IDEMPOTENT upsert of a template + its lines. For COMPANY templates the tenant
 * UUID is resolved (write aborts cleanly if the company is not migrated); for
 * GLOBAL templates the UUID is null (Super Admin RLS). The template (parent) is
 * written before the lines (children) so a failed parent write never leaves
 * orphan lines.
 */
export async function persistTemplate(
  input: PersistTemplateInput,
): Promise<PersistTemplateResult> {
  const dryRun = input.dryRun ?? false;
  const { template, lines } = input;

  const result: PersistTemplateResult = {
    ok: false,
    dryRun,
    template: null,
    writtenTemplateCount: 0,
    writtenLineCount: 0,
  };

  // Resolve tenant UUID for company templates; global templates carry no company.
  let companyUuid: string | null = null;
  if (template.ownerType === "company") {
    if (!template.companyId) {
      result.error = "Company template is missing companyId.";
      return result;
    }
    companyUuid = await resolveCompanyUuid(template.companyId);
    if (!companyUuid) {
      result.error = `No Supabase company found for legacy_id "${template.companyId}". Migrate companies first.`;
      return result;
    }
  }

  if (dryRun) {
    result.ok = true;
    result.template = template;
    return result;
  }

  try {
    result.writtenTemplateCount = await supabaseAgreementTemplatesRepository.upsertTemplates(
      [template],
      companyUuid,
    );
    result.writtenLineCount = await supabaseAgreementTemplatesRepository.upsertTemplateLines(
      lines,
      companyUuid,
    );
    result.ok = true;
    result.template = template;
    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : "Unknown template persistence error.";
    return result;
  }
}

// ── Copy: persisted global → company template ────────────────

/** Inputs for {@link copyGlobalTemplateToCompany}. */
export interface CopyGlobalToCompanyInput extends TemplatePersistOptions {
  /** The source (typically global) template legacy id to copy. */
  sourceTemplateId: string;
  /** The company that will own the copy. */
  targetCompanyId: string;
  /** Optional new name for the copy. */
  name?: string;
}

/** Outcome of a {@link copyGlobalTemplateToCompany} run. */
export interface CopyGlobalToCompanyResult {
  ok: boolean;
  dryRun: boolean;
  /** The new company-owned template (draft). Null on early failure. */
  template: AgreementTemplate | null;
  /** The new company-owned lines. */
  lines: AgreementTemplateLine[];
  error?: string;
}

/**
 * Reads a persisted source template + lines, builds an INDEPENDENT company-owned
 * copy (fresh id + group, ownerType `company`, status `draft`, recording
 * `copiedFromTemplateId` for traceability only) and persists it. Future edits to
 * the source never affect the copy.
 */
export async function copyGlobalTemplateToCompany(
  input: CopyGlobalToCompanyInput,
): Promise<CopyGlobalToCompanyResult> {
  const dryRun = input.dryRun ?? false;
  const result: CopyGlobalToCompanyResult = {
    ok: false,
    dryRun,
    template: null,
    lines: [],
  };

  const source = await supabaseAgreementTemplatesRepository.getTemplateWithLines(
    input.sourceTemplateId,
  );
  if (!source) {
    result.error = `Source template "${input.sourceTemplateId}" not found.`;
    return result;
  }

  const { template, lines } = copyTemplateToCompany({
    source: source.template,
    sourceLines: source.lines,
    targetCompanyId: input.targetCompanyId,
    name: input.name,
  });

  const persist = await persistTemplate({ template, lines, dryRun });
  result.ok = persist.ok;
  result.template = persist.ok ? template : null;
  result.lines = persist.ok ? lines : [];
  result.error = persist.error;
  return result;
}

// ── Archive (status flip; never destroy) ─────────────────────

/** Inputs for {@link archiveTemplate}. */
export interface ArchiveTemplateInput extends TemplatePersistOptions {
  /** The template legacy id to archive. */
  templateId: string;
  /** App-facing company scope guard for company templates. */
  companyId?: string | null;
  /** Target archive status (default `inactive`). */
  status?: Extract<AgreementTemplateStatus, "inactive" | "superseded">;
  now: string;
}

/** Outcome of an {@link archiveTemplate} run. */
export interface ArchiveTemplateResult {
  ok: boolean;
  dryRun: boolean;
  template: AgreementTemplate | null;
  error?: string;
}

/**
 * Archives a template by flipping its status (default `inactive`) and
 * re-persisting. The row is preserved (no destructive delete) so it stays
 * readable for audit; existing agreements created from it are snapshots and are
 * unaffected. Lines are left untouched (their `active` flags are unchanged).
 */
export async function archiveTemplate(
  input: ArchiveTemplateInput,
): Promise<ArchiveTemplateResult> {
  const dryRun = input.dryRun ?? false;
  const result: ArchiveTemplateResult = { ok: false, dryRun, template: null };

  const existing = await supabaseAgreementTemplatesRepository.getTemplateById(input.templateId, {
    companyId: input.companyId,
  });
  if (!existing) {
    result.error = `Template "${input.templateId}" not found or out of scope.`;
    return result;
  }

  const archived: AgreementTemplate = {
    ...existing,
    status: input.status ?? "inactive",
    updatedAt: input.now,
  };

  const persist = await persistTemplate({ template: archived, lines: [], dryRun });
  result.ok = persist.ok;
  result.template = persist.ok ? archived : null;
  result.error = persist.error;
  return result;
}

// ── Template → Agreement from persisted data ─────────────────

/** Inputs for {@link createAgreementFromPersistedTemplate}. */
export interface CreateAgreementFromPersistedTemplateInput {
  /** The persisted template legacy id to snapshot from. */
  templateId: string;
  /** The customer the agreement belongs to. */
  customerId: string;
  /** The company the agreement belongs to. */
  companyId: string;
  /** App-facing company scope guard for company templates. */
  scopeCompanyId?: string | null;
  /** Optional overrides applied AFTER the template snapshot. */
  overrides?: CreateAgreementOverrides;
}

/** Outcome of a {@link createAgreementFromPersistedTemplate} run. */
export interface CreateAgreementFromPersistedTemplateResult {
  ok: boolean;
  /** The independent agreement snapshot (NOT persisted here). Null on failure. */
  result: CreateAgreementFromTemplateResult | null;
  /** Validation errors that blocked creation. */
  errors: string[];
  error?: string;
}

/**
 * Reads a persisted template + lines and runs the PURE Template → Agreement
 * creation flow. The template must be `active` with at least one active line
 * ({@link validateTemplateForCreation}); the resulting agreement is an
 * INDEPENDENT snapshot and is NOT written here. No Time Bank wallet is created —
 * the entitlement gate still governs activation downstream.
 */
export async function createAgreementFromPersistedTemplate(
  input: CreateAgreementFromPersistedTemplateInput,
): Promise<CreateAgreementFromPersistedTemplateResult> {
  const result: CreateAgreementFromPersistedTemplateResult = {
    ok: false,
    result: null,
    errors: [],
  };

  const loaded = await supabaseAgreementTemplatesRepository.getTemplateWithLines(input.templateId, {
    companyId: input.scopeCompanyId,
  });
  if (!loaded) {
    result.error = `Template "${input.templateId}" not found or out of scope.`;
    return result;
  }

  const validation = validateTemplateForCreation(loaded.template, loaded.lines);
  if (!validation.valid) {
    result.errors = validation.errors;
    result.error = "Template is not usable for agreement creation.";
    return result;
  }

  result.result = createAgreementFromTemplate({
    template: loaded.template,
    lines: loaded.lines,
    customerId: input.customerId,
    companyId: input.companyId,
    overrides: input.overrides,
  });
  result.ok = true;
  return result;
}
