import {
  resolveChecklistTemplate,
  resolveCustomerProtocol,
  resolveCustomerProtocolSections,
  resolveCustomerProtocolItems,
} from "@/lib/checklistSettingsResolver";
import { getItems, getSections } from "@/lib/checklistTemplateStore";
import {
  createRun,
  type CreateProtocolRunSectionInput,
} from "@/lib/protocolRunStore";
import type { ProtocolRunV2 } from "@/types";

/**
 * Checklist Manager V2 — Protocol run generator (Phase 3A).
 *
 * Transforms an editable {@link ChecklistTemplateV2} (Template → Section → Item)
 * into an executable {@link ProtocolRunV2} snapshot (Run → RunSection → RunItem).
 *
 * Snapshot guarantee: every value is deep-copied into independent run rows with
 * fresh ids, so later edits to the template (or its sections/items) NEVER affect
 * a run that was already generated. The generator never holds references back to
 * template rows.
 *
 * Reads go through the resolver/store (the stable read path); writes go through
 * {@link protocolRunStore}. No booking/work-order integration logic lives here —
 * the optional ids are pass-through context only.
 */

export interface GenerateProtocolRunOptions {
  /** Actor generating the run (recorded as `generatedBy`). */
  generatedBy: string;
  /** Optional originating booking (stored as context only). */
  bookingId?: string;
  /** Optional originating work order (stored as context only). */
  workOrderId?: string;
  /**
   * Execution anchor (Phase 4A): the visit occurrence this run belongs to.
   * Pass-through context only — the generator does not create occurrences.
   */
  visitOccurrenceId?: string;
  /** Employees to assign to the generated run (team-shared; Phase 4A). */
  assignedEmployeeIds?: string[];
}

/**
 * Generates a protocol run snapshot from a template, scoped to a company.
 * Returns null if the template does not exist for the company (archived
 * templates are not generatable — they resolve to null by default).
 *
 * Generation rules:
 *  - Copy the template name and version onto the run.
 *  - Deep-copy every section title and item (title/description/required).
 *  - Preserve the template's section/item ordering as stepped `sortOrder`s.
 *  - Initialize all items as `pending` (handled by the store).
 */
export function generateProtocolRun(
  companyId: string,
  templateId: string,
  options: GenerateProtocolRunOptions,
): ProtocolRunV2 | null {
  const template = resolveChecklistTemplate(companyId, templateId);
  if (!template) return null;

  const sections: CreateProtocolRunSectionInput[] = getSections(
    template.id,
  ).map((section, sectionIndex) => ({
    title: section.title,
    sortOrder: sectionIndex * 10,
    items: getItems(section.id).map((item, itemIndex) => ({
      title: item.title,
      description: item.description,
      required: item.required,
      sortOrder: itemIndex * 10,
    })),
  }));

  return createRun(companyId, {
    sourceTemplateId: template.id,
    sourceTemplateName: template.name,
    sourceTemplateVersion: template.version ?? 1,
    bookingId: options.bookingId,
    workOrderId: options.workOrderId,
    visitOccurrenceId: options.visitOccurrenceId,
    assignedEmployeeIds: options.assignedEmployeeIds,
    generatedBy: options.generatedBy,
    status: "draft",
    sections,
  });
}

export interface GenerateProtocolRunFromCustomerProtocolOptions
  extends GenerateProtocolRunOptions {
  /**
   * Allow generating from an archived customer protocol. The AO action surfaces
   * a warning first; the store/generator does not block archived protocols when
   * this is true. Defaults to false (archived protocols are not generatable).
   */
  allowArchived?: boolean;
}

/**
 * Generates a protocol run snapshot from a customer-specific
 * {@link CustomerProtocolV2} (the operational AO path, Phase 3E), scoped to a
 * company + customer. This is preferred over {@link generateProtocolRun} for
 * operational work: customer protocols are the real operational definitions.
 *
 * Returns null when the protocol does not exist, belongs to a different
 * company/customer (cross-customer guard), or is archived and `allowArchived`
 * is not set.
 *
 * Snapshot guarantee: every section title and item is deep-copied into
 * independent run rows with fresh ids, so later edits to the customer protocol
 * NEVER affect a run already generated. Template provenance is preserved from
 * the customer protocol (sourceTemplateId/Name/Version) alongside the customer
 * protocol id/name, for traceability.
 */
export function generateProtocolRunFromCustomerProtocol(
  companyId: string,
  customerId: string,
  customerProtocolId: string,
  options: GenerateProtocolRunFromCustomerProtocolOptions,
): ProtocolRunV2 | null {
  const protocol = resolveCustomerProtocol(
    companyId,
    customerId,
    customerProtocolId,
    { includeArchived: true },
  );
  if (!protocol) return null;
  if (protocol.isArchived && !options.allowArchived) return null;

  const sections: CreateProtocolRunSectionInput[] = resolveCustomerProtocolSections(
    companyId,
    customerId,
    protocol.id,
  ).map((section, sectionIndex) => ({
    title: section.title,
    sortOrder: sectionIndex * 10,
    items: resolveCustomerProtocolItems(companyId, customerId, section.id).map(
      (item, itemIndex) => ({
        title: item.title,
        description: item.description,
        required: item.required,
        sortOrder: itemIndex * 10,
      }),
    ),
  }));

  return createRun(companyId, {
    sourceTemplateId: protocol.sourceTemplateId,
    sourceTemplateName: protocol.sourceTemplateName,
    sourceTemplateVersion: protocol.sourceTemplateVersion,
    sourceCustomerProtocolId: protocol.id,
    sourceCustomerProtocolName: protocol.name,
    customerId,
    bookingId: options.bookingId,
    workOrderId: options.workOrderId,
    visitOccurrenceId: options.visitOccurrenceId,
    assignedEmployeeIds: options.assignedEmployeeIds,
    generatedBy: options.generatedBy,
    status: "draft",
    sections,
  });
}
