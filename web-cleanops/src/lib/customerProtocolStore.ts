import {
  CHECKLIST_V2_SCHEMA_VERSION,
  normalizeCustomerProtocolName,
  sortCustomerProtocolItems,
  sortCustomerProtocolSections,
  sortCustomerProtocols,
  type CustomerProtocolItem,
  type CustomerProtocolSection,
  type CustomerProtocolV2,
} from "@/types";
import { makeId } from "@/lib/store";

/**
 * Checklist Manager V2 — Customer Protocol Library persistence (Phase 3C).
 *
 * Like the Phase 1/2/3A stores ({@link checklistTemplateStore.ts},
 * {@link protocolRunStore.ts}), this is a backend-shaped abstraction over
 * localStorage so it can be swapped for Supabase tables without touching
 * callers. It manages editable customer-specific protocol definitions —
 * NOT execution runs (no completion status, signatures, photos or deviations).
 *
 * Hierarchy: CustomerProtocolV2 → CustomerProtocolSection → CustomerProtocolItem.
 * Sections and items are owned children; they are hard-deleted with their parent
 * (protocols use soft-delete archive).
 *
 * Invariants enforced here (not in future UI):
 *  - Company AND customer isolation: every row carries `companyId` + `customerId`;
 *    reads are scoped by both.
 *  - Deterministic ordering via the `sort*` helpers.
 *  - Protocol soft-delete: archiving hides a protocol from active lists but keeps
 *    it (and its sections/items) for historical references.
 *  - Protocol names are unique within a customer (case-insensitive, trimmed).
 *  - Unlike templates, customer protocols are NOT lazily seeded — they only
 *    exist once created (typically via {@link customerProtocolGenerator}).
 */

const PROTOCOLS_KEY = "cleanops.customerProtocolsV2";
const SECTIONS_KEY = "cleanops.customerProtocolSections";
const ITEMS_KEY = "cleanops.customerProtocolItems";

function readJson<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function writeJson<T>(key: string, value: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error(`Failed to persist ${key}`, err);
  }
}

/**
 * Normalizes persisted protocols to the current schema version (Phase 4A,
 * Ticket 55). Records written before versioning had no `schemaVersion`; they
 * are treated as version 1. Lazy and idempotent — no migration step.
 */
function normalizeProtocols(rows: CustomerProtocolV2[]): CustomerProtocolV2[] {
  return rows.map((p) =>
    typeof p.schemaVersion === "number" ? p : { ...p, schemaVersion: 1 },
  );
}

const readProtocols = (): CustomerProtocolV2[] =>
  normalizeProtocols(readJson<CustomerProtocolV2>(PROTOCOLS_KEY));
const readSections = (): CustomerProtocolSection[] =>
  readJson<CustomerProtocolSection>(SECTIONS_KEY);
const readItems = (): CustomerProtocolItem[] =>
  readJson<CustomerProtocolItem>(ITEMS_KEY);

const writeProtocols = (rows: CustomerProtocolV2[]): void => {
  writeJson(PROTOCOLS_KEY, rows);
};
const writeSections = (rows: CustomerProtocolSection[]): void => {
  writeJson(SECTIONS_KEY, rows);
};
const writeItems = (rows: CustomerProtocolItem[]): void => {
  writeJson(ITEMS_KEY, rows);
};

/* -------------------------------------------------------------------------- */
/* Protocols                                                                   */
/* -------------------------------------------------------------------------- */

/** A snapshotted item to persist under a section (ids are assigned by the store). */
export interface CreateCustomerProtocolItemInput {
  sourceItemId?: string;
  title: string;
  description?: string;
  required: boolean;
  sortOrder: number;
}

/** A snapshotted section to persist under a protocol (ids are assigned by the store). */
export interface CreateCustomerProtocolSectionInput {
  sourceSectionId?: string;
  title: string;
  sortOrder: number;
  items: CreateCustomerProtocolItemInput[];
}

/**
 * A complete, deep-copied protocol ready to persist. The
 * {@link customerProtocolGenerator} builds this from a template; the store
 * assigns ids. Sections/items may be empty for a blank protocol.
 */
export interface CreateCustomerProtocolInput {
  customerId: string;
  sourceTemplateId: string;
  sourceTemplateName: string;
  sourceTemplateVersion: number;
  name: string;
  description?: string;
  categoryIds?: string[];
  floorPresetIds?: string[];
  sections?: CreateCustomerProtocolSectionInput[];
}

/**
 * Persists a new customer protocol with its (optional) snapshotted sections and
 * items. Names must be unique within the customer (case-insensitive, trimmed)
 * across active and archived protocols; a duplicate returns null.
 */
export function createCustomerProtocol(
  companyId: string,
  input: CreateCustomerProtocolInput,
): CustomerProtocolV2 | null {
  const name = input.name.trim();
  if (!name) return null;

  const allProtocols = readProtocols();
  const normalized = normalizeCustomerProtocolName(name);
  const clash = allProtocols.some(
    (p) =>
      p.companyId === companyId &&
      p.customerId === input.customerId &&
      normalizeCustomerProtocolName(p.name) === normalized,
  );
  if (clash) return null;

  const now = new Date().toISOString();
  const protocolId = makeId("cprot");
  const protocol: CustomerProtocolV2 = {
    id: protocolId,
    companyId,
    customerId: input.customerId,
    sourceTemplateId: input.sourceTemplateId,
    sourceTemplateName: input.sourceTemplateName,
    sourceTemplateVersion: input.sourceTemplateVersion,
    name,
    description: input.description?.trim() || undefined,
    categoryIds: input.categoryIds ?? [],
    floorPresetIds: input.floorPresetIds ?? [],
    isArchived: false,
    schemaVersion: CHECKLIST_V2_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
  };

  const sections: CustomerProtocolSection[] = [];
  const items: CustomerProtocolItem[] = [];
  (input.sections ?? []).forEach((sectionInput) => {
    const sectionId = makeId("cpsec");
    sections.push({
      id: sectionId,
      companyId,
      customerId: input.customerId,
      customerProtocolId: protocolId,
      sourceSectionId: sectionInput.sourceSectionId,
      title: sectionInput.title,
      sortOrder: sectionInput.sortOrder,
      createdAt: now,
      updatedAt: now,
    });
    sectionInput.items.forEach((itemInput) => {
      items.push({
        id: makeId("cpitm"),
        companyId,
        customerId: input.customerId,
        customerProtocolId: protocolId,
        sectionId,
        sourceItemId: itemInput.sourceItemId,
        title: itemInput.title,
        description: itemInput.description,
        required: itemInput.required,
        sortOrder: itemInput.sortOrder,
        createdAt: now,
        updatedAt: now,
      });
    });
  });

  writeProtocols([...allProtocols, protocol]);
  writeSections([...readSections(), ...sections]);
  writeItems([...readItems(), ...items]);
  return protocol;
}

/**
 * Returns a customer's protocols, sorted. Archived protocols are excluded unless
 * `includeArchived` is true.
 */
export function getCustomerProtocols(
  companyId: string,
  customerId: string,
  options?: { includeArchived?: boolean },
): CustomerProtocolV2[] {
  const owned = readProtocols().filter(
    (p) => p.companyId === companyId && p.customerId === customerId,
  );
  const filtered = options?.includeArchived
    ? owned
    : owned.filter((p) => !p.isArchived);
  return sortCustomerProtocols(filtered);
}

/** Looks up a single protocol by id, scoped to a company. */
export function getCustomerProtocol(
  companyId: string,
  customerProtocolId: string,
): CustomerProtocolV2 | null {
  return (
    readProtocols().find(
      (p) => p.id === customerProtocolId && p.companyId === companyId,
    ) ?? null
  );
}

export interface UpdateCustomerProtocolInput {
  name?: string;
  description?: string;
  categoryIds?: string[];
  floorPresetIds?: string[];
}

/**
 * Updates a protocol's editable metadata in place. Renaming to a name already
 * used by another protocol for the same customer is rejected (returns null).
 */
export function updateCustomerProtocol(
  companyId: string,
  customerProtocolId: string,
  input: UpdateCustomerProtocolInput,
): CustomerProtocolV2 | null {
  const all = readProtocols();
  const target = all.find(
    (p) => p.id === customerProtocolId && p.companyId === companyId,
  );
  if (!target) return null;

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return null;
    const normalized = normalizeCustomerProtocolName(name);
    const clash = all.some(
      (p) =>
        p.companyId === companyId &&
        p.customerId === target.customerId &&
        p.id !== customerProtocolId &&
        normalizeCustomerProtocolName(p.name) === normalized,
    );
    if (clash) return null;
  }

  const updated: CustomerProtocolV2 = {
    ...target,
    name: input.name !== undefined ? input.name.trim() : target.name,
    description:
      input.description !== undefined
        ? input.description.trim() || undefined
        : target.description,
    categoryIds: input.categoryIds ?? target.categoryIds,
    floorPresetIds: input.floorPresetIds ?? target.floorPresetIds,
    updatedAt: new Date().toISOString(),
  };
  writeProtocols(all.map((p) => (p.id === customerProtocolId ? updated : p)));
  return updated;
}

/** Sets the archived flag on a protocol. Returns the updated protocol or null. */
function setProtocolArchived(
  companyId: string,
  customerProtocolId: string,
  isArchived: boolean,
): CustomerProtocolV2 | null {
  const all = readProtocols();
  const target = all.find(
    (p) => p.id === customerProtocolId && p.companyId === companyId,
  );
  if (!target) return null;
  if (target.isArchived === isArchived) return target;

  const updated: CustomerProtocolV2 = {
    ...target,
    isArchived,
    updatedAt: new Date().toISOString(),
  };
  writeProtocols(all.map((p) => (p.id === customerProtocolId ? updated : p)));
  return updated;
}

/** Archives a protocol (soft-delete) — bindings and content are preserved. */
export function archiveCustomerProtocol(
  companyId: string,
  customerProtocolId: string,
): CustomerProtocolV2 | null {
  return setProtocolArchived(companyId, customerProtocolId, true);
}

/** Restores an archived protocol back into the active list. */
export function restoreCustomerProtocol(
  companyId: string,
  customerProtocolId: string,
): CustomerProtocolV2 | null {
  return setProtocolArchived(companyId, customerProtocolId, false);
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                    */
/* -------------------------------------------------------------------------- */

/** Returns a protocol's sections, sorted by `sortOrder`. */
export function getCustomerProtocolSections(
  customerProtocolId: string,
): CustomerProtocolSection[] {
  return sortCustomerProtocolSections(
    readSections().filter((s) => s.customerProtocolId === customerProtocolId),
  );
}

/** Looks up a single section by id. */
export function getCustomerProtocolSection(
  sectionId: string,
): CustomerProtocolSection | null {
  return readSections().find((s) => s.id === sectionId) ?? null;
}

export interface CreateCustomerProtocolSectionMetaInput {
  title: string;
}

/**
 * Creates a section under a protocol, appended after existing sections. Returns
 * null if the protocol does not exist or the title is empty.
 */
export function createCustomerProtocolSection(
  customerProtocolId: string,
  input: CreateCustomerProtocolSectionMetaInput,
): CustomerProtocolSection | null {
  const title = input.title.trim();
  if (!title) return null;

  const protocol = readProtocols().find((p) => p.id === customerProtocolId);
  if (!protocol) return null;

  const all = readSections();
  const siblings = all.filter((s) => s.customerProtocolId === customerProtocolId);
  const maxSortOrder = siblings.reduce(
    (max, s) => Math.max(max, s.sortOrder),
    -10,
  );
  const now = new Date().toISOString();
  const section: CustomerProtocolSection = {
    id: makeId("cpsec"),
    companyId: protocol.companyId,
    customerId: protocol.customerId,
    customerProtocolId,
    title,
    sortOrder: maxSortOrder + 10,
    createdAt: now,
    updatedAt: now,
  };
  writeSections([...all, section]);
  return section;
}

export interface UpdateCustomerProtocolSectionInput {
  title?: string;
  sortOrder?: number;
}

/** Updates a section's editable fields in place. */
export function updateCustomerProtocolSection(
  sectionId: string,
  input: UpdateCustomerProtocolSectionInput,
): CustomerProtocolSection | null {
  const all = readSections();
  const target = all.find((s) => s.id === sectionId);
  if (!target) return null;

  if (input.title !== undefined && !input.title.trim()) return null;

  const updated: CustomerProtocolSection = {
    ...target,
    title: input.title !== undefined ? input.title.trim() : target.title,
    sortOrder: input.sortOrder ?? target.sortOrder,
    updatedAt: new Date().toISOString(),
  };
  writeSections(all.map((s) => (s.id === sectionId ? updated : s)));
  return updated;
}

/**
 * Hard-deletes a section and all of its items (sections are owned children of a
 * protocol, not independently archived). Returns true if a section was removed.
 */
export function deleteCustomerProtocolSection(sectionId: string): boolean {
  const all = readSections();
  if (!all.some((s) => s.id === sectionId)) return false;
  writeSections(all.filter((s) => s.id !== sectionId));
  writeItems(readItems().filter((i) => i.sectionId !== sectionId));
  return true;
}

/** Persists a new ordering for a protocol's sections. */
export function reorderCustomerProtocolSections(
  customerProtocolId: string,
  orderedIds: string[],
): CustomerProtocolSection[] {
  const all = readSections();
  const orderIndex = new Map(orderedIds.map((id, index) => [id, index]));
  const now = new Date().toISOString();
  const next = all.map((s) => {
    if (s.customerProtocolId !== customerProtocolId) return s;
    const index = orderIndex.get(s.id);
    if (index === undefined) return s;
    return { ...s, sortOrder: index * 10, updatedAt: now };
  });
  writeSections(next);
  return getCustomerProtocolSections(customerProtocolId);
}

/* -------------------------------------------------------------------------- */
/* Items                                                                       */
/* -------------------------------------------------------------------------- */

/** Returns a section's items, sorted by `sortOrder`. */
export function getCustomerProtocolItems(
  sectionId: string,
): CustomerProtocolItem[] {
  return sortCustomerProtocolItems(
    readItems().filter((i) => i.sectionId === sectionId),
  );
}

/** Looks up a single item by id. */
export function getCustomerProtocolItem(
  itemId: string,
): CustomerProtocolItem | null {
  return readItems().find((i) => i.id === itemId) ?? null;
}

export interface CreateCustomerProtocolItemMetaInput {
  title: string;
  description?: string;
  required?: boolean;
}

/**
 * Creates an item under a section, appended after existing items. Returns null
 * if the section does not exist or the title is empty.
 */
export function createCustomerProtocolItem(
  sectionId: string,
  input: CreateCustomerProtocolItemMetaInput,
): CustomerProtocolItem | null {
  const title = input.title.trim();
  if (!title) return null;

  const section = readSections().find((s) => s.id === sectionId);
  if (!section) return null;

  const all = readItems();
  const siblings = all.filter((i) => i.sectionId === sectionId);
  const maxSortOrder = siblings.reduce(
    (max, i) => Math.max(max, i.sortOrder),
    -10,
  );
  const now = new Date().toISOString();
  const item: CustomerProtocolItem = {
    id: makeId("cpitm"),
    companyId: section.companyId,
    customerId: section.customerId,
    customerProtocolId: section.customerProtocolId,
    sectionId,
    title,
    description: input.description?.trim() || undefined,
    required: input.required ?? false,
    sortOrder: maxSortOrder + 10,
    createdAt: now,
    updatedAt: now,
  };
  writeItems([...all, item]);
  return item;
}

export interface UpdateCustomerProtocolItemInput {
  title?: string;
  description?: string;
  required?: boolean;
  sortOrder?: number;
}

/** Updates an item's editable fields in place. */
export function updateCustomerProtocolItem(
  itemId: string,
  input: UpdateCustomerProtocolItemInput,
): CustomerProtocolItem | null {
  const all = readItems();
  const target = all.find((i) => i.id === itemId);
  if (!target) return null;

  if (input.title !== undefined && !input.title.trim()) return null;

  const updated: CustomerProtocolItem = {
    ...target,
    title: input.title !== undefined ? input.title.trim() : target.title,
    description:
      input.description !== undefined
        ? input.description.trim() || undefined
        : target.description,
    required: input.required ?? target.required,
    sortOrder: input.sortOrder ?? target.sortOrder,
    updatedAt: new Date().toISOString(),
  };
  writeItems(all.map((i) => (i.id === itemId ? updated : i)));
  return updated;
}

/** Hard-deletes an item. Returns true if an item was removed. */
export function deleteCustomerProtocolItem(itemId: string): boolean {
  const all = readItems();
  if (!all.some((i) => i.id === itemId)) return false;
  writeItems(all.filter((i) => i.id !== itemId));
  return true;
}

/** Persists a new ordering for a section's items. */
export function reorderCustomerProtocolItems(
  sectionId: string,
  orderedIds: string[],
): CustomerProtocolItem[] {
  const all = readItems();
  const orderIndex = new Map(orderedIds.map((id, index) => [id, index]));
  const now = new Date().toISOString();
  const next = all.map((i) => {
    if (i.sectionId !== sectionId) return i;
    const index = orderIndex.get(i.id);
    if (index === undefined) return i;
    return { ...i, sortOrder: index * 10, updatedAt: now };
  });
  writeItems(next);
  return getCustomerProtocolItems(sectionId);
}
