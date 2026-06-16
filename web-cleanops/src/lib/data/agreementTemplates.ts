/**
 * Agreement Template Foundation (Phase 9 · template → agreement creation).
 *
 * Templates are BLUEPRINTS that suggest default values for Customer Agreements.
 * Agreements are OPERATIONAL RECORDS that own the final active rules.
 *
 * Core contracts:
 *   1. Templates suggest; agreements own (independent after creation).
 *   2. Template values are SNAPSHOT-COPIED at agreement-creation time — the
 *      agreement is NEVER live-linked to mutable template values.
 *   3. Future template changes NEVER rewrite existing agreements.
 *   4. Template version changes only affect NEW agreements created from the
 *      new version.
 *   5. Entitlement gate: templates may SUGGEST Time Bank rules, but an
 *      entitlement MUST still decide whether the company/package can use
 *      Time Bank — no hidden activation through template selection.
 *
 * This module is PURE and FOUNDATION ONLY:
 *   * No Supabase writes, no localStorage, no UI, no flags, no activation.
 *   * Every function returns NEW objects and never mutates its inputs.
 *   * No migration is created; no production-authoritative flip; no rollout.
 */

import type {
  AgreementTemplate,
  AgreementTemplateLine,
  AgreementTemplateOwnerType,
  AgreementTemplateStatus,
  AgreementTemplateRecurrenceDefaults,
  AgreementStatus,
  BillingModel,
  CustomerAgreement,
  CustomerAgreementLine,
  InvoiceInterval,
  TimeBankCancellationPolicy,
  TimeBankRules,
  TimeBankTemplateRules,
} from "@/types";
import {
  createAgreementTimeBankSnapshot,
  defaultTemplateTimeBankRules,
  templateTimeBankEnabled,
} from "./timeBankTemplateBinding";
import type { AgreementTimeBankSnapshot } from "./timeBankTemplateBinding";

// ── ID helpers ─────────────────────────────────────────────────

let _templateSeq = 0;
let _lineSeq = 0;
let _agreementSeq = 0;
let _agreementLineSeq = 0;
let _agreementGroupSeq = 0;
let _templateGroupSeq = 0;

function nextTemplateId(): string {
  _templateSeq += 1;
  return `tpl_${String(_templateSeq).padStart(6, "0")}`;
}

function nextTemplateLineId(): string {
  _lineSeq += 1;
  return `tpl_line_${String(_lineSeq).padStart(6, "0")}`;
}

function nextAgreementId(): string {
  _agreementSeq += 1;
  return `agr_${String(_agreementSeq).padStart(6, "0")}`;
}

function nextAgreementLineId(): string {
  _agreementLineSeq += 1;
  return `agr_line_${String(_agreementLineSeq).padStart(6, "0")}`;
}

function nextAgreementGroupId(): string {
  _agreementGroupSeq += 1;
  return `agr_group_${String(_agreementGroupSeq).padStart(6, "0")}`;
}

function nextTemplateGroupId(): string {
  _templateGroupSeq += 1;
  return `tpl_group_${String(_templateGroupSeq).padStart(6, "0")}`;
}

/** Reset all sequencers (for deterministic testing). */
export function resetTemplateSequencers(): void {
  _templateSeq = 0;
  _lineSeq = 0;
  _agreementSeq = 0;
  _agreementLineSeq = 0;
  _agreementGroupSeq = 0;
  _templateGroupSeq = 0;
}

// ── Default / factory ──────────────────────────────────────────

/** Inputs for {@link buildAgreementTemplate}. */
export interface BuildAgreementTemplateInput {
  /** Ownership tier. */
  ownerType: AgreementTemplateOwnerType;
  /** Owning company id (null for global templates). */
  companyId: string | null;
  /** Display name. */
  name: string;
  /** Optional description. */
  description?: string;
  /** Suggested billing model. */
  billingModel?: BillingModel;
  /** Suggested invoice interval. */
  invoiceInterval?: InvoiceInterval;
  /** Whether Time Bank is eligible. */
  timeBankEligible?: boolean;
  /** Advisory Time Bank rules. */
  timeBankTemplateRules?: TimeBankTemplateRules | null;
  /** Free-text notes. */
  notes?: string;
  /** Lifecycle status (defaults to "draft"). */
  status?: AgreementTemplateStatus;
}

/**
 * Builds an immutable {@link AgreementTemplate} record. Returns a NEW object
 * every call — the caller owns it. This is a pure factory, not a persistence
 * operation.
 */
export function buildAgreementTemplate(
  input: BuildAgreementTemplateInput,
): AgreementTemplate {
  const now = new Date().toISOString();
  return {
    id: nextTemplateId(),
    templateGroupId: nextTemplateGroupId(),
    ownerType: input.ownerType,
    companyId: input.companyId,
    name: input.name,
    description: input.description,
    version: 1,
    status: input.status ?? "draft",
    copiedFromTemplateId: null,
    billingModel: input.billingModel ?? "per_visit",
    invoiceInterval: input.invoiceInterval ?? "monthly",
    timeBankEligible: input.timeBankEligible ?? false,
    timeBankTemplateRules: input.timeBankTemplateRules ?? null,
    notes: input.notes,
    validFrom: null,
    validTo: null,
    supersedesVersionId: null,
    supersededById: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Inputs for {@link buildAgreementTemplateLine}. */
export interface BuildAgreementTemplateLineInput {
  /** Owning template id. */
  templateId: string;
  /** Owning template group id. */
  templateGroupId: string;
  /** Ownership tier (denormalised). */
  ownerType: AgreementTemplateOwnerType;
  /** Owning company id (denormalised, null for global). */
  companyId: string | null;
  /** Display order. */
  sortOrder?: number;
  /** Source catalog service id. */
  sourceServiceId?: string | null;
  /** Snapshot of the service name. */
  serviceNameSnapshot: string;
  /** Snapshot of the category name. */
  categoryNameSnapshot?: string | null;
  /** Suggested default price. */
  defaultPrice?: number | null;
  /** Suggested default VAT. */
  defaultVat?: number | null;
  /** Pricing model. */
  pricingModel?: import("@/types").PricingModel;
  /** Per-line billing override (only legal when header is `hybrid`). */
  billingModelOverride?: BillingModel | null;
  /** Suggested default quantity. */
  defaultQuantity?: number | null;
  /** Unit label. */
  unit?: string;
  /** Suggested default duration in minutes. */
  defaultDurationMinutes?: number | null;
  /** Advisory recurrence defaults. */
  recurrenceDefaults?: AgreementTemplateRecurrenceDefaults | null;
  /** Free-text notes. */
  notes?: string;
  /** Whether the line is active. */
  active?: boolean;
}

/**
 * Builds an immutable {@link AgreementTemplateLine} record. Returns a NEW
 * object every call. Pure factory — no persistence.
 */
export function buildAgreementTemplateLine(
  input: BuildAgreementTemplateLineInput,
): AgreementTemplateLine {
  const now = new Date().toISOString();
  return {
    id: nextTemplateLineId(),
    templateId: input.templateId,
    templateGroupId: input.templateGroupId,
    ownerType: input.ownerType,
    companyId: input.companyId,
    sortOrder: input.sortOrder ?? 0,
    sourceServiceId: input.sourceServiceId ?? null,
    serviceNameSnapshot: input.serviceNameSnapshot,
    categoryNameSnapshot: input.categoryNameSnapshot ?? null,
    categoryTypeSnapshot: null,
    serviceBasisTypeSnapshot: null,
    defaultPrice: input.defaultPrice ?? null,
    defaultVat: input.defaultVat ?? null,
    pricingModel: input.pricingModel ?? "fixed",
    billingModelOverride: input.billingModelOverride ?? null,
    defaultQuantity: input.defaultQuantity ?? null,
    unit: input.unit,
    defaultDurationMinutes: input.defaultDurationMinutes ?? null,
    recurrenceDefaults: input.recurrenceDefaults ?? null,
    payrollGroupTypeSnapshot: null,
    timeCodeSnapshot: null,
    notes: input.notes,
    active: input.active ?? true,
    createdAt: now,
    updatedAt: now,
  };
}

// ── Template validation ────────────────────────────────────────

/** Validation result for {@link validateTemplateForCreation}. */
export interface TemplateValidationResult {
  /** True when the template is valid and can be used to create an agreement. */
  valid: boolean;
  /** Human-readable error messages (empty when valid). */
  errors: string[];
}

/**
 * Validates that a template is in a usable state for creating a new
 * Customer Agreement. The template must:
 *   * Exist (not null/undefined).
 *   * Have status `active` (draft / inactive / superseded templates cannot
 *     be used to create new agreements).
 *   * Have at least one active line.
 *
 * This is a PURE check — it does not enforce entitlements (that is the
 * caller's responsibility).
 */
export function validateTemplateForCreation(
  template: AgreementTemplate | null | undefined,
  lines?: AgreementTemplateLine[] | null,
): TemplateValidationResult {
  const errors: string[] = [];

  if (!template) {
    errors.push("Template is missing.");
    return { valid: false, errors };
  }

  if (template.status !== "active") {
    errors.push(
      `Template "${template.name}" has status "${template.status}" — only active templates can be used to create agreements.`,
    );
  }

  const activeLines = (lines ?? []).filter((l) => l.active);
  if (activeLines.length === 0) {
    errors.push(
      `Template "${template.name}" has no active lines — an agreement must have at least one service line.`,
    );
  }

  return { valid: errors.length === 0, errors };
}

// ── Template → Agreement snapshot ──────────────────────────────

/** Inputs for {@link createAgreementFromTemplate}. */
export interface CreateAgreementFromTemplateInput {
  /** The template to snapshot from. */
  template: AgreementTemplate;
  /** The template's lines to snapshot. */
  lines: AgreementTemplateLine[];
  /** The customer the agreement belongs to. */
  customerId: string;
  /** The company the agreement belongs to. */
  companyId: string;
  /**
   * Optional overrides applied AFTER the template snapshot. The caller may
   * override individual fields on the resulting {@link CustomerAgreement} or
   * individual lines. Overrides always win over template suggestions.
   */
  overrides?: CreateAgreementOverrides;
}

/** Field-level overrides for {@link createAgreementFromTemplate}. */
export interface CreateAgreementOverrides {
  /** Override the agreement header fields. */
  header?: Partial<Pick<CustomerAgreement, "billingModel" | "invoiceInterval" | "name" | "notes" | "validFrom" | "validTo">>;
  /** Override the Time Bank rules. */
  timeBankRulesOverride?: Partial<TimeBankRules>;
  /** Override the cancellation credit policy. */
  cancellationPolicyOverride?: Partial<TimeBankCancellationPolicy>;
  /** Per-line overrides, keyed by template line id. */
  lineOverrides?: Record<string, Partial<Omit<CustomerAgreementLine, "id" | "agreementId" | "agreementGroupId" | "companyId" | "createdAt" | "updatedAt">>>;
}

/** The result of {@link createAgreementFromTemplate}. */
export interface CreateAgreementFromTemplateResult {
  /** The newly created {@link CustomerAgreement} header (a snapshot copy). */
  agreement: CustomerAgreement;
  /** The newly created {@link CustomerAgreementLine} rows (snapshot copies). */
  lines: CustomerAgreementLine[];
  /** The Time Bank snapshot produced during creation. */
  timeBankSnapshot: AgreementTimeBankSnapshot;
  /** The source template id (for traceability). */
  sourceTemplateId: string;
  /** The source template version at creation time. */
  sourceTemplateVersion: number;
}

/**
 * Creates a NEW Customer Agreement (v1) and its lines from an Agreement
 * Template — the core Template → Agreement flow.
 *
 * This function SNAPSHOTS every relevant template value into independent
 * agreement records. After this call:
 *   * The agreement is COMPLETELY INDEPENDENT of the template.
 *   * Future template changes NEVER affect this agreement.
 *   * The agreementGroupId is freshly generated for this new version chain.
 *
 * The caller MUST still:
 *   * Validate the template with {@link validateTemplateForCreation} before
 *     calling this function.
 *   * Apply the entitlement gate before creating any Time Bank wallet.
 *   * Persist the resulting agreement and lines (this function only creates
 *     in-memory records — it does NOT write to any store).
 *
 * Override hierarchy (last wins):
 *   1. Template defaults
 *   2. Override fields (if provided)
 */
export function createAgreementFromTemplate(
  input: CreateAgreementFromTemplateInput,
): CreateAgreementFromTemplateResult {
  const now = new Date().toISOString();
  const { template, lines, customerId, companyId, overrides } = input;

  // ── Agreement group ──────────────────────────────────────────
  // Every new agreement from a template starts a fresh version chain.
  const agreementGroupId = nextAgreementGroupId();
  const agreementId = nextAgreementId();

  // ── Time Bank snapshot ───────────────────────────────────────
  const timeBankSnapshot = createAgreementTimeBankSnapshot({
    templateRules: template.timeBankTemplateRules ?? null,
    rulesOverride: overrides?.timeBankRulesOverride,
    cancellationPolicyOverride: overrides?.cancellationPolicyOverride,
  });

  // ── Agreement header ────────────────────────────────────────
  const agreement: CustomerAgreement = {
    id: agreementId,
    agreementGroupId,
    companyId,
    customerId,
    version: 1,
    status: "active" as AgreementStatus,
    billingModel: overrides?.header?.billingModel ?? template.billingModel,
    invoiceInterval: overrides?.header?.invoiceInterval ?? template.invoiceInterval,
    name: overrides?.header?.name ?? template.name,
    validFrom: overrides?.header?.validFrom ?? null,
    validTo: overrides?.header?.validTo ?? null,
    supersedesVersionId: null,
    supersededById: null,
    sourceType: "template",
    sourceReferenceId: template.id,
    notes: overrides?.header?.notes ?? template.notes,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
  };

  // ── Agreement lines ─────────────────────────────────────────
  const activeLines = lines.filter((l) => l.active);
  const agreementLines: CustomerAgreementLine[] = activeLines.map((tl, index) => {
    const lineOverride = overrides?.lineOverrides?.[tl.id];

    return {
      id: nextAgreementLineId(),
      agreementId,
      agreementGroupId,
      companyId,
      sortOrder: lineOverride?.sortOrder ?? tl.sortOrder ?? index,
      billingModelOverride: lineOverride?.billingModelOverride ?? tl.billingModelOverride ?? null,
      pricingModel: lineOverride?.pricingModel ?? tl.pricingModel,
      agreedPrice: lineOverride?.agreedPrice ?? tl.defaultPrice ?? null,
      quantity: lineOverride?.quantity ?? tl.defaultQuantity ?? null,
      unit: lineOverride?.unit ?? tl.unit,
      vat: (lineOverride as Record<string, unknown>)?.vat as number | null ?? tl.defaultVat ?? null,
      sourceServiceId: (lineOverride as Record<string, unknown>)?.sourceServiceId as string | null ?? tl.sourceServiceId ?? null,
      serviceNameSnapshot: (lineOverride as Record<string, unknown>)?.serviceNameSnapshot as string ?? tl.serviceNameSnapshot,
      categoryNameSnapshot: (lineOverride as Record<string, unknown>)?.categoryNameSnapshot as string | null ?? tl.categoryNameSnapshot ?? null,
      categoryTypeSnapshot: (lineOverride as Record<string, unknown>)?.categoryTypeSnapshot as import("@/types").ServiceCategoryType | null ?? tl.categoryTypeSnapshot ?? null,
      serviceBasisTypeSnapshot: (lineOverride as Record<string, unknown>)?.serviceBasisTypeSnapshot as import("@/types").ServiceBasisType | null ?? tl.serviceBasisTypeSnapshot ?? null,
      notes: (lineOverride as Record<string, unknown>)?.notes as string ?? tl.notes,
      createdAt: now,
      updatedAt: now,
    };
  });

  return {
    agreement,
    lines: agreementLines,
    timeBankSnapshot,
    sourceTemplateId: template.id,
    sourceTemplateVersion: template.version,
  };
}

// ── Copy: global → company template ────────────────────────────

/** The result of {@link copyTemplateToCompany}. */
export interface CopyTemplateResult {
  /** The new company-owned template (fresh id + group; status "draft"). */
  template: AgreementTemplate;
  /** The new company-owned template lines (fresh ids, re-pointed). */
  lines: AgreementTemplateLine[];
}

/**
 * Copies a (typically GLOBAL) template + its lines into a NEW, independent
 * COMPANY-owned template. The copy:
 *   * gets a FRESH id and a FRESH templateGroupId (its own version chain);
 *   * is owned by `targetCompanyId` (ownerType "company");
 *   * starts as a `draft` (the company publishes it explicitly);
 *   * records `copiedFromTemplateId = source.id` for traceability ONLY — it is
 *     NOT live-linked, so future edits to the source never affect the copy.
 *
 * Pure: builds new records, mutates nothing. Persistence is the caller's job.
 */
export function copyTemplateToCompany(input: {
  source: AgreementTemplate;
  sourceLines: AgreementTemplateLine[];
  targetCompanyId: string;
  /** Optional new name; defaults to the source name. */
  name?: string;
}): CopyTemplateResult {
  const { source, sourceLines, targetCompanyId } = input;
  const template = buildAgreementTemplate({
    ownerType: "company",
    companyId: targetCompanyId,
    name: input.name ?? source.name,
    description: source.description,
    billingModel: source.billingModel,
    invoiceInterval: source.invoiceInterval,
    timeBankEligible: source.timeBankEligible,
    timeBankTemplateRules: source.timeBankTemplateRules ?? null,
    notes: source.notes,
    status: "draft",
  });
  template.copiedFromTemplateId = source.id;

  const lines = sourceLines.map((sl) =>
    buildAgreementTemplateLine({
      templateId: template.id,
      templateGroupId: template.templateGroupId,
      ownerType: "company",
      companyId: targetCompanyId,
      sortOrder: sl.sortOrder,
      sourceServiceId: sl.sourceServiceId ?? null,
      serviceNameSnapshot: sl.serviceNameSnapshot,
      categoryNameSnapshot: sl.categoryNameSnapshot ?? null,
      defaultPrice: sl.defaultPrice ?? null,
      defaultVat: sl.defaultVat ?? null,
      pricingModel: sl.pricingModel,
      billingModelOverride: sl.billingModelOverride ?? null,
      defaultQuantity: sl.defaultQuantity ?? null,
      unit: sl.unit,
      defaultDurationMinutes: sl.defaultDurationMinutes ?? null,
      recurrenceDefaults: sl.recurrenceDefaults ?? null,
      notes: sl.notes,
      active: sl.active,
    }),
  );

  return { template, lines };
}

// ── Re-exports for convenience ─────────────────────────────────

export type { AgreementTimeBankSnapshot };
export {
  createAgreementTimeBankSnapshot,
  defaultTemplateTimeBankRules,
  templateTimeBankEnabled,
} from "./timeBankTemplateBinding";
