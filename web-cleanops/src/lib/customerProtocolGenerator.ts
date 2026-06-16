import {
  getItems,
  getSections,
  getTemplateForCompany,
} from "@/lib/checklistTemplateStore";
import {
  createCustomerProtocol,
  type CreateCustomerProtocolSectionInput,
} from "@/lib/customerProtocolStore";
import type { CustomerProtocolV2 } from "@/types";

/**
 * Creates a blank, editable customer protocol with no template source and no
 * sections/items (Phase 3D "create empty protocol" shortcut). Source provenance
 * fields are left empty since there is no originating template. Returns null if
 * the name is empty or clashes with an existing protocol for the customer.
 */
export function createBlankCustomerProtocol(
  companyId: string,
  customerId: string,
  options: { name: string; description?: string },
): CustomerProtocolV2 | null {
  return createCustomerProtocol(companyId, {
    customerId,
    sourceTemplateId: "",
    sourceTemplateName: "",
    sourceTemplateVersion: 0,
    name: options.name,
    description: options.description,
    categoryIds: [],
    floorPresetIds: [],
    sections: [],
  });
}

/**
 * Checklist Manager V2 — Customer Protocol generator (Phase 3C).
 *
 * Creates a customer-specific, editable {@link CustomerProtocolV2} (Protocol →
 * Section → Item) by deep-copying a company-level {@link ChecklistTemplateV2}.
 *
 * Independence guarantee: every value is deep-copied into independent rows with
 * fresh ids, so afterwards:
 *  - Changes to the template NEVER affect the created customer protocol.
 *  - Changes to the customer protocol NEVER affect the template.
 *
 * Provenance is retained (sourceTemplateId/Name/Version on the protocol, and
 * sourceSectionId/sourceItemId on the copied rows) without holding live
 * references. Reads go through the resolver/store; writes go through
 * {@link customerProtocolStore}.
 */

export interface GenerateCustomerProtocolOptions {
  /** Override the protocol name; defaults to the template name. */
  name?: string;
  /** Override the protocol description; defaults to the template description. */
  description?: string;
}

/**
 * Generates a customer protocol from a template, scoped to a company + customer.
 * The source may be the company's own template OR a (read-only) global library
 * template — either way the structure is deep-copied into independent rows.
 * Returns null if the template does not exist / is archived, or if the name
 * clashes with an existing protocol for that customer.
 *
 * Copy rules:
 *  - Copy `sourceTemplateId`, `sourceTemplateName`, `sourceTemplateVersion`.
 *  - Carry the template's `categoryIds` / `floorPresetIds` as starting values.
 *  - Deep-copy every section title and item (title/description/required), each
 *    recording its originating template id as `sourceSectionId` / `sourceItemId`.
 *  - Preserve the template's section/item ordering as stepped `sortOrder`s.
 */
export function generateCustomerProtocol(
  companyId: string,
  customerId: string,
  templateId: string,
  options?: GenerateCustomerProtocolOptions,
): CustomerProtocolV2 | null {
  const template = getTemplateForCompany(companyId, templateId);
  if (!template || template.isArchived) return null;

  const sections: CreateCustomerProtocolSectionInput[] = getSections(
    template.id,
  ).map((section, sectionIndex) => ({
    sourceSectionId: section.id,
    title: section.title,
    sortOrder: sectionIndex * 10,
    items: getItems(section.id).map((item, itemIndex) => ({
      sourceItemId: item.id,
      title: item.title,
      description: item.description,
      required: item.required,
      sortOrder: itemIndex * 10,
    })),
  }));

  return createCustomerProtocol(companyId, {
    customerId,
    sourceTemplateId: template.id,
    sourceTemplateName: template.name,
    sourceTemplateVersion: template.version ?? 1,
    name: options?.name?.trim() || template.name,
    description: options?.description ?? template.description,
    categoryIds: [...template.categoryIds],
    floorPresetIds: [...template.floorPresetIds],
    sections,
  });
}
