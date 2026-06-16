import {
  getActiveFloorPresets,
  getAllFloorPresets,
  getFloorPreset,
} from "@/lib/floorPresetStore";
import {
  getActiveChecklistCategories,
  getAllChecklistCategories,
  getAllChecklistCategoriesByType,
  getChecklistCategory,
} from "@/lib/checklistCategoryStore";
import {
  getGlobalTemplate,
  getGlobalTemplates,
  getItems,
  getSection,
  getSections,
  getTemplate,
  getTemplates,
} from "@/lib/checklistTemplateStore";
import {
  getRun,
  getRunItems,
  getRunSections,
  getRuns,
  getRunsByVisitOccurrence,
} from "@/lib/protocolRunStore";
import {
  getVisitOccurrence,
  getVisitOccurrences,
  getVisitOccurrencesForCustomer,
  getVisitOccurrencesForWorkOrder,
} from "@/lib/visitOccurrenceStore";
import {
  getCustomerProtocol,
  getCustomerProtocolItems,
  getCustomerProtocolSection,
  getCustomerProtocolSections,
  getCustomerProtocols,
} from "@/lib/customerProtocolStore";
import type {
  ChecklistCategory,
  ChecklistCategoryType,
  ChecklistItem,
  ChecklistSection,
  ChecklistTemplateV2,
  CustomerProtocolItem,
  CustomerProtocolSection,
  CustomerProtocolV2,
  FloorPreset,
  ProtocolRunItem,
  ProtocolRunSection,
  ProtocolRunV2,
  VisitOccurrence,
} from "@/types";

/**
 * Checklist Manager V2 — Settings resolver (Phase 1 Foundation, Ticket 7).
 *
 * A read-only adapter that future checklist/protocol/template code consumes
 * instead of touching the localStorage stores or the legacy hardcoded category
 * unions directly. Keeping this as the single stable interface means the
 * underlying persistence (localStorage today, Supabase later) can change
 * without rewriting consumers.
 *
 * Contract:
 *  - Read-only: no create/update/archive/reorder is exposed here. Management
 *    screens keep calling the stores directly.
 *  - Active-by-default: archived items are returned only when explicitly
 *    requested via `{ includeArchived: true }`.
 *  - Company-scoped: every lookup requires a `companyId`.
 *  - Deterministic ordering: inherited from the stores' `sortOrder` sorting.
 */

export interface ResolveOptions {
  /** Include archived items (for historical references). Defaults to false. */
  includeArchived?: boolean;
}

/** Active floor presets for a company, or all (incl. archived) when requested. */
export function resolveFloorPresets(
  companyId: string,
  options?: ResolveOptions,
): FloorPreset[] {
  return options?.includeArchived
    ? getAllFloorPresets(companyId)
    : getActiveFloorPresets(companyId);
}

/**
 * A single floor preset by id, scoped to a company. Archived presets resolve to
 * null unless `includeArchived` is true, so callers don't accidentally surface
 * retired presets in active flows.
 */
export function resolveFloorPresetById(
  companyId: string,
  presetId: string,
  options?: ResolveOptions,
): FloorPreset | null {
  const preset = getFloorPreset(companyId, presetId);
  if (!preset) return null;
  if (preset.isArchived && !options?.includeArchived) return null;
  return preset;
}

/** Active categories of a type for a company, or all when requested. */
export function resolveChecklistCategories(
  companyId: string,
  type: ChecklistCategoryType,
  options?: ResolveOptions,
): ChecklistCategory[] {
  return options?.includeArchived
    ? getAllChecklistCategories(companyId, type)
    : getActiveChecklistCategories(companyId, type);
}

/**
 * Every category type for a company, keyed by type. Active-only by default;
 * pass `includeArchived` for historical references.
 */
export function resolveChecklistCategoriesByType(
  companyId: string,
  options?: ResolveOptions,
): Record<ChecklistCategoryType, ChecklistCategory[]> {
  return getAllChecklistCategoriesByType(companyId, {
    includeArchived: options?.includeArchived ?? false,
  });
}

/**
 * A single category by id, scoped to a company. Archived categories resolve to
 * null unless `includeArchived` is true.
 */
export function resolveChecklistCategoryById(
  companyId: string,
  categoryId: string,
  options?: ResolveOptions,
): ChecklistCategory | null {
  const category = getChecklistCategory(companyId, categoryId);
  if (!category) return null;
  if (category.isArchived && !options?.includeArchived) return null;
  return category;
}

/* -------------------------------------------------------------------------- */
/* Checklist templates (Phase 2, Ticket 14)                                    */
/* -------------------------------------------------------------------------- */
/**
 * Read-only access to the Template → Section → Item hierarchy, scoped to a
 * company. The same active-by-default contract applies: archived templates are
 * only returned when `includeArchived` is requested. Sections and items are
 * owned children, so they are resolved through their (company-owned) parent —
 * lookups for templates/sections not owned by `companyId` return empty/null,
 * keeping every read company-scoped.
 */

/** Active templates for a company, or all (incl. archived) when requested. */
export function resolveChecklistTemplates(
  companyId: string,
  options?: ResolveOptions,
): ChecklistTemplateV2[] {
  return getTemplates(companyId, {
    includeArchived: options?.includeArchived ?? false,
  });
}

/* -------------------------------------------------------------------------- */
/* Global template library (Global Template Foundation)                       */
/* -------------------------------------------------------------------------- */
/**
 * Read-only access separating the two template tiers. Company admins can read
 * both collections (the global library is a read-only starting point), but only
 * edit company templates — enforced where mutations happen, not here. The two
 * collections never bleed into each other: globals are system-owned
 * (`companyId: null`) and company templates are company-scoped.
 */

/** The global (system-owned) template library; active-only by default. */
export function resolveGlobalTemplates(
  options?: ResolveOptions,
): ChecklistTemplateV2[] {
  return getGlobalTemplates({
    includeArchived: options?.includeArchived ?? false,
  });
}

/** A single global template by id. Archived resolve to null unless requested. */
export function resolveGlobalTemplate(
  templateId: string,
  options?: ResolveOptions,
): ChecklistTemplateV2 | null {
  const template = getGlobalTemplate(templateId);
  if (!template) return null;
  if (template.isArchived && !options?.includeArchived) return null;
  return template;
}

/**
 * Ordered sections for a global template. Returns an empty array when the
 * template is unknown or not a global template — keeping the Super Admin global
 * builder strictly scoped to the global tier.
 */
export function resolveGlobalTemplateSections(
  templateId: string,
): ChecklistSection[] {
  if (!getGlobalTemplate(templateId)) return [];
  return getSections(templateId);
}

/**
 * Ordered items for a global template section. Returns an empty array when the
 * template/section is unknown or the section does not belong to the given
 * global template.
 */
export function resolveGlobalTemplateItems(
  templateId: string,
  sectionId: string,
): ChecklistItem[] {
  if (!getGlobalTemplate(templateId)) return [];
  const section = getSection(sectionId);
  if (!section || section.templateId !== templateId) return [];
  return getItems(sectionId);
}

/**
 * A company's own templates (alias of {@link resolveChecklistTemplates} with an
 * explicit name that pairs with {@link resolveGlobalTemplates} for clarity at
 * call sites that surface both tiers).
 */
export function resolveCompanyTemplates(
  companyId: string,
  options?: ResolveOptions,
): ChecklistTemplateV2[] {
  return resolveChecklistTemplates(companyId, options);
}

/**
 * A single template by id, scoped to a company. Archived templates resolve to
 * null unless `includeArchived` is true.
 */
export function resolveChecklistTemplate(
  companyId: string,
  templateId: string,
  options?: ResolveOptions,
): ChecklistTemplateV2 | null {
  const template = getTemplate(companyId, templateId);
  if (!template) return null;
  if (template.isArchived && !options?.includeArchived) return null;
  return template;
}

/**
 * Ordered sections for a template, scoped to a company. Returns an empty array
 * when the template is unknown or not owned by the company (archived templates
 * still expose their sections for historical references).
 */
export function resolveChecklistSections(
  companyId: string,
  templateId: string,
): ChecklistSection[] {
  const template = getTemplate(companyId, templateId);
  if (!template) return [];
  return getSections(templateId);
}

/**
 * Ordered items for a section, scoped to a company. Returns an empty array when
 * the section is unknown or not owned by the company.
 */
export function resolveChecklistItems(
  companyId: string,
  sectionId: string,
): ChecklistItem[] {
  const section = getSection(sectionId);
  if (!section || section.companyId !== companyId) return [];
  return getItems(sectionId);
}

/* -------------------------------------------------------------------------- */
/* Protocol runs (Phase 3A, Ticket 25)                                         */
/* -------------------------------------------------------------------------- */
/**
 * Read-only access to the execution snapshot hierarchy (Run → RunSection →
 * RunItem), scoped to a company. This is the active execution read path: future
 * execution UI consumes these resolvers, never the store directly. No mutation
 * logic is exposed here — status updates go through {@link protocolRunStore}.
 */

/** All protocol runs for a company, newest first. */
export function resolveProtocolRuns(companyId: string): ProtocolRunV2[] {
  return getRuns(companyId);
}

/** A single protocol run by id, scoped to a company. */
export function resolveProtocolRun(
  companyId: string,
  runId: string,
): ProtocolRunV2 | null {
  return getRun(companyId, runId);
}

/**
 * Ordered sections for a run, scoped to a company. Returns an empty array when
 * the run is unknown or not owned by the company.
 */
export function resolveProtocolSections(
  companyId: string,
  runId: string,
): ProtocolRunSection[] {
  const run = getRun(companyId, runId);
  if (!run) return [];
  return getRunSections(companyId, runId);
}

/**
 * Ordered items for a run section, scoped to a company. Returns an empty array
 * when the section is unknown or not owned by the company.
 */
export function resolveProtocolItems(
  companyId: string,
  sectionId: string,
): ProtocolRunItem[] {
  return getRunItems(companyId, sectionId);
}

/**
 * Runs bound to a visit occurrence (Phase 4A), scoped to a company. Returns an
 * empty array when the occurrence is unknown or not owned by the company.
 */
export function resolveProtocolRunsForVisit(
  companyId: string,
  visitOccurrenceId: string,
): ProtocolRunV2[] {
  if (!getVisitOccurrence(companyId, visitOccurrenceId)) return [];
  return getRunsByVisitOccurrence(companyId, visitOccurrenceId);
}

/* -------------------------------------------------------------------------- */
/* Visit occurrences (Phase 4A, Ticket 52)                                     */
/* -------------------------------------------------------------------------- */
/**
 * Read-only access to the execution anchor (Customer Protocol → VisitOccurrence
 * → ProtocolRun), scoped to a company. Future Check-in / scheduling / reporting
 * UI consumes these resolvers, never the store directly. No mutation logic is
 * exposed here — status transitions go through {@link visitOccurrenceStore} or
 * the integrity helpers in {@link executionLifecycle}.
 */

/** All visit occurrences for a company, ordered by scheduled date. */
export function resolveVisitOccurrences(
  companyId: string,
): VisitOccurrence[] {
  return getVisitOccurrences(companyId);
}

/** A single visit occurrence by id, scoped to a company. */
export function resolveVisitOccurrence(
  companyId: string,
  visitOccurrenceId: string,
): VisitOccurrence | null {
  return getVisitOccurrence(companyId, visitOccurrenceId);
}

/** Visit occurrences for a customer within a company, ordered. */
export function resolveVisitOccurrencesForCustomer(
  companyId: string,
  customerId: string,
): VisitOccurrence[] {
  return getVisitOccurrencesForCustomer(companyId, customerId);
}

/** Visit occurrences for a work order within a company, ordered. */
export function resolveVisitOccurrencesForWorkOrder(
  companyId: string,
  workOrderId: string,
): VisitOccurrence[] {
  return getVisitOccurrencesForWorkOrder(companyId, workOrderId);
}

/* -------------------------------------------------------------------------- */
/* Customer protocol library (Phase 3C, Ticket 32)                             */
/* -------------------------------------------------------------------------- */
/**
 * Read-only access to the customer-specific protocol hierarchy (Protocol →
 * Section → Item), scoped to a company AND a customer. This is the primary read
 * path for customer protocol UI and future work-order integration — consumers
 * read through these resolvers, never the store directly. No mutation logic is
 * exposed here. The active-by-default contract applies: archived protocols are
 * only returned when `includeArchived` is requested. Sections/items are owned
 * children, so they resolve through their (company-scoped) parent.
 */

/** Active protocols for a customer, or all (incl. archived) when requested. */
export function resolveCustomerProtocols(
  companyId: string,
  customerId: string,
  options?: ResolveOptions,
): CustomerProtocolV2[] {
  return getCustomerProtocols(companyId, customerId, {
    includeArchived: options?.includeArchived ?? false,
  });
}

/**
 * A single customer protocol by id, scoped to a company and customer. Archived
 * protocols resolve to null unless `includeArchived` is true. Protocols owned by
 * a different customer resolve to null.
 */
export function resolveCustomerProtocol(
  companyId: string,
  customerId: string,
  customerProtocolId: string,
  options?: ResolveOptions,
): CustomerProtocolV2 | null {
  const protocol = getCustomerProtocol(companyId, customerProtocolId);
  if (!protocol || protocol.customerId !== customerId) return null;
  if (protocol.isArchived && !options?.includeArchived) return null;
  return protocol;
}

/**
 * Ordered sections for a customer protocol, scoped to a company and customer.
 * Returns an empty array when the protocol is unknown or not owned by the
 * company/customer.
 */
export function resolveCustomerProtocolSections(
  companyId: string,
  customerId: string,
  customerProtocolId: string,
): CustomerProtocolSection[] {
  const protocol = getCustomerProtocol(companyId, customerProtocolId);
  if (!protocol || protocol.customerId !== customerId) return [];
  return getCustomerProtocolSections(customerProtocolId);
}

/**
 * Resolves the customer protocol linked to a service/work order (Phase 3D),
 * scoped to a company and customer. Unlike {@link resolveCustomerProtocol}, this
 * includes archived protocols so a service that was linked before the protocol
 * was archived still resolves its (now-archived) protocol for display. Returns
 * null when there is no link, the protocol is unknown, or it belongs to a
 * different company/customer — enforcing the customer-scoped link validation.
 */
export function resolveCustomerProtocolForService(
  companyId: string,
  customerId: string,
  customerProtocolId: string | null | undefined,
): CustomerProtocolV2 | null {
  if (!customerProtocolId) return null;
  return resolveCustomerProtocol(companyId, customerId, customerProtocolId, {
    includeArchived: true,
  });
}

/**
 * Ordered items for a customer protocol section, scoped to a company and
 * customer. Returns an empty array when the section is unknown or not owned by
 * the company/customer.
 */
export function resolveCustomerProtocolItems(
  companyId: string,
  customerId: string,
  sectionId: string,
): CustomerProtocolItem[] {
  const section = getCustomerProtocolSection(sectionId);
  if (
    !section ||
    section.companyId !== companyId ||
    section.customerId !== customerId
  ) {
    return [];
  }
  return getCustomerProtocolItems(sectionId);
}
