import {
  CHECKLIST_V2_SCHEMA_VERSION,
  DEFAULT_CHECKLIST_TEMPLATE_SPECS,
  normalizeChecklistTemplateName,
  sortChecklistItems,
  sortChecklistSections,
  sortChecklistTemplates,
  type ChecklistItem,
  type ChecklistSection,
  type ChecklistTemplateV2,
  type TemplateAudience,
} from "@/types";
import { makeId } from "@/lib/store";

/**
 * Checklist Manager V2 — Template / Section / Item persistence (Phase 2).
 *
 * Like {@link floorPresetStore.ts} and {@link checklistCategoryStore.ts}, this
 * is a backend-shaped abstraction over localStorage so it can be swapped for
 * Supabase tables without touching callers. It establishes the data foundation
 * only — no execution, completion tracking, signatures or protocol runtime.
 *
 * Hierarchy: Template → Section → Item. Sections and items are owned children;
 * they are hard-deleted with their parent (templates use soft-delete archive).
 *
 * Invariants enforced here (not in future UI):
 *  - Company isolation: every row carries `companyId`; reads are scoped.
 *  - Deterministic ordering via the `sort*` helpers.
 *  - Template soft-delete: archiving hides a template from active lists but keeps
 *    it (and its sections/items) for historical references.
 *  - Template names are unique within a company (case-insensitive, trimmed).
 *  - Defaults are seeded lazily the first time a company is read, so existing
 *    companies gain templates without a migration step.
 */

const TEMPLATES_KEY = "cleanops.checklistTemplates";
const SECTIONS_KEY = "cleanops.checklistSections";
const ITEMS_KEY = "cleanops.checklistItems";

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
 * Normalizes persisted templates to the scope model (Global Template
 * Foundation). Records written before scope existed always had a `companyId`,
 * so they migrate to `scope: "company"`; any with a null/empty companyId are
 * treated as `global`. Lazy and idempotent — no data loss, no migration step.
 */
function normalizeScope(rows: ChecklistTemplateV2[]): ChecklistTemplateV2[] {
  return rows.map((t) => {
    const schemaVersion =
      typeof t.schemaVersion === "number" ? t.schemaVersion : 1;
    if (t.scope === "global" || t.scope === "company") {
      return t.schemaVersion === schemaVersion ? t : { ...t, schemaVersion };
    }
    return {
      ...t,
      scope: t.companyId ? "company" : "global",
      schemaVersion,
    } as ChecklistTemplateV2;
  });
}

const readTemplates = (): ChecklistTemplateV2[] =>
  normalizeScope(readJson<ChecklistTemplateV2>(TEMPLATES_KEY));
const readSections = (): ChecklistSection[] =>
  readJson<ChecklistSection>(SECTIONS_KEY);
const readItems = (): ChecklistItem[] => readJson<ChecklistItem>(ITEMS_KEY);

const writeTemplates = (rows: ChecklistTemplateV2[]): void => {
  writeJson(TEMPLATES_KEY, rows);
};
const writeSections = (rows: ChecklistSection[]): void => {
  writeJson(SECTIONS_KEY, rows);
};
const writeItems = (rows: ChecklistItem[]): void => {
  writeJson(ITEMS_KEY, rows);
};

/**
 * Builds the default template set (with nested sections and items) for a
 * company from {@link DEFAULT_CHECKLIST_TEMPLATE_SPECS}, assigning ids and
 * stepped `sortOrder`s. Returns the three row collections to persist together.
 */
export function defaultChecklistTemplates(companyId: string): {
  templates: ChecklistTemplateV2[];
  sections: ChecklistSection[];
  items: ChecklistItem[];
} {
  const now = new Date().toISOString();
  const templates: ChecklistTemplateV2[] = [];
  const sections: ChecklistSection[] = [];
  const items: ChecklistItem[] = [];

  DEFAULT_CHECKLIST_TEMPLATE_SPECS.forEach((templateSpec, tIndex) => {
    const templateId = makeId("ctpl");
    templates.push({
      id: templateId,
      companyId,
      name: templateSpec.name,
      description: templateSpec.description,
      categoryIds: [],
      floorPresetIds: [],
      sortOrder: tIndex * 10,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
      scope: "company",
      originType: "seed",
      version: 1,
      schemaVersion: CHECKLIST_V2_SCHEMA_VERSION,
    });

    templateSpec.sections.forEach((sectionSpec, sIndex) => {
      const sectionId = makeId("csec");
      sections.push({
        id: sectionId,
        templateId,
        companyId,
        title: sectionSpec.title,
        sortOrder: sIndex * 10,
        createdAt: now,
        updatedAt: now,
      });

      sectionSpec.items.forEach((itemSpec, iIndex) => {
        items.push({
          id: makeId("citm"),
          sectionId,
          templateId,
          companyId,
          title: itemSpec.title,
          description: itemSpec.description,
          required: itemSpec.required ?? false,
          sortOrder: iIndex * 10,
          createdAt: now,
          updatedAt: now,
        });
      });
    });
  });

  return { templates, sections, items };
}

/**
 * Lazily seeds default templates for a company that has none persisted (active
 * or archived). Returns the company's templates (existing or freshly seeded).
 */
function ensureSeeded(companyId: string): ChecklistTemplateV2[] {
  const all = readTemplates();
  const owned = all.filter((t) => t.companyId === companyId);
  if (owned.length > 0) return owned;

  const seeded = defaultChecklistTemplates(companyId);
  writeTemplates([...all, ...seeded.templates]);
  writeSections([...readSections(), ...seeded.sections]);
  writeItems([...readItems(), ...seeded.items]);
  return seeded.templates;
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Returns a company's templates, sorted by `sortOrder`. Archived templates are
 * excluded unless `includeArchived` is true. Seeds defaults on first use.
 */
export function getTemplates(
  companyId: string,
  options?: { includeArchived?: boolean },
): ChecklistTemplateV2[] {
  const owned = ensureSeeded(companyId);
  const filtered = options?.includeArchived
    ? owned
    : owned.filter((t) => !t.isArchived);
  return sortChecklistTemplates(filtered);
}

/** Active templates only. */
export function getActiveTemplates(companyId: string): ChecklistTemplateV2[] {
  return getTemplates(companyId, { includeArchived: false });
}

/** All templates including archived ones — for historical references. */
export function getAllTemplates(companyId: string): ChecklistTemplateV2[] {
  return getTemplates(companyId, { includeArchived: true });
}

/** Looks up a single template by id, scoped to a company. */
export function getTemplate(
  companyId: string,
  templateId: string,
): ChecklistTemplateV2 | null {
  return (
    readTemplates().find(
      (t) => t.id === templateId && t.companyId === companyId,
    ) ?? null
  );
}

export interface CreateChecklistTemplateInput {
  name: string;
  description?: string;
  audience?: TemplateAudience;
  categoryIds?: string[];
  floorPresetIds?: string[];
}

/**
 * Creates a template for a company, appended after existing templates. Names
 * must be unique within the company (case-insensitive, trimmed) across active
 * and archived templates; a duplicate returns null instead of creating.
 */
export function createTemplate(
  companyId: string,
  input: CreateChecklistTemplateInput,
): ChecklistTemplateV2 | null {
  const name = input.name.trim();
  if (!name) return null;

  // Seed first so the new template appends after any defaults.
  ensureSeeded(companyId);
  const all = readTemplates();
  const owned = all.filter((t) => t.companyId === companyId);
  const normalized = normalizeChecklistTemplateName(name);
  if (
    owned.some((t) => normalizeChecklistTemplateName(t.name) === normalized)
  ) {
    return null;
  }

  const maxSortOrder = owned.reduce((max, t) => Math.max(max, t.sortOrder), -10);
  const now = new Date().toISOString();
  const template: ChecklistTemplateV2 = {
    id: makeId("ctpl"),
    companyId,
    scope: "company",
    name,
    description: input.description?.trim() || undefined,
    audience: input.audience,
    categoryIds: input.categoryIds ?? [],
    floorPresetIds: input.floorPresetIds ?? [],
    sortOrder: maxSortOrder + 10,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    originType: "company",
    version: 1,
    schemaVersion: CHECKLIST_V2_SCHEMA_VERSION,
  };
  writeTemplates([...all, template]);
  return template;
}

export interface UpdateChecklistTemplateInput {
  name?: string;
  description?: string;
  audience?: TemplateAudience;
  categoryIds?: string[];
  floorPresetIds?: string[];
  sortOrder?: number;
}

/**
 * Updates a template's editable fields in place. Renaming to a name already
 * used by another template in the same company is rejected (returns null).
 */
export function updateTemplate(
  companyId: string,
  templateId: string,
  input: UpdateChecklistTemplateInput,
): ChecklistTemplateV2 | null {
  const all = readTemplates();
  const target = all.find(
    (t) => t.id === templateId && t.companyId === companyId,
  );
  if (!target) return null;

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return null;
    const normalized = normalizeChecklistTemplateName(name);
    const clash = all.some(
      (t) =>
        t.companyId === companyId &&
        t.id !== templateId &&
        normalizeChecklistTemplateName(t.name) === normalized,
    );
    if (clash) return null;
  }

  const updated: ChecklistTemplateV2 = {
    ...target,
    name: input.name !== undefined ? input.name.trim() : target.name,
    description:
      input.description !== undefined
        ? input.description.trim() || undefined
        : target.description,
    audience: input.audience ?? target.audience,
    categoryIds: input.categoryIds ?? target.categoryIds,
    floorPresetIds: input.floorPresetIds ?? target.floorPresetIds,
    sortOrder: input.sortOrder ?? target.sortOrder,
    updatedAt: new Date().toISOString(),
  };
  writeTemplates(all.map((t) => (t.id === templateId ? updated : t)));
  return updated;
}

/** Sets the archived flag on a template. Returns the updated template or null. */
function setTemplateArchived(
  companyId: string,
  templateId: string,
  isArchived: boolean,
): ChecklistTemplateV2 | null {
  const all = readTemplates();
  const target = all.find(
    (t) => t.id === templateId && t.companyId === companyId,
  );
  if (!target) return null;
  if (target.isArchived === isArchived) return target;

  const updated: ChecklistTemplateV2 = {
    ...target,
    isArchived,
    updatedAt: new Date().toISOString(),
  };
  writeTemplates(all.map((t) => (t.id === templateId ? updated : t)));
  return updated;
}

/** Archives a template (soft-delete) — hidden from active lists, kept for history. */
export function archiveTemplate(
  companyId: string,
  templateId: string,
): ChecklistTemplateV2 | null {
  return setTemplateArchived(companyId, templateId, true);
}

/** Restores an archived template back into the active list. */
export function restoreTemplate(
  companyId: string,
  templateId: string,
): ChecklistTemplateV2 | null {
  return setTemplateArchived(companyId, templateId, false);
}

/**
 * Persists a new ordering for a company's templates. Accepts ordered ids and
 * rewrites `sortOrder` in steps of 10. Ids not owned by the company are ignored.
 */
export function reorderTemplates(
  companyId: string,
  orderedIds: string[],
): ChecklistTemplateV2[] {
  const all = readTemplates();
  const orderIndex = new Map(orderedIds.map((id, index) => [id, index]));
  const now = new Date().toISOString();
  const next = all.map((t) => {
    if (t.companyId !== companyId) return t;
    const index = orderIndex.get(t.id);
    if (index === undefined) return t;
    return { ...t, sortOrder: index * 10, updatedAt: now };
  });
  writeTemplates(next);
  return getAllTemplates(companyId);
}

/* -------------------------------------------------------------------------- */
/* Global templates (Global Template Foundation)                              */
/* -------------------------------------------------------------------------- */
/**
 * Global templates are system-owned (`scope: "global"`, `companyId: null`): a
 * read-only best-practice library for company admins, managed by the Super
 * Admin. They live in the same collections as company templates but are kept
 * strictly separate by scope so company reads never surface globals and vice
 * versa. Company templates are created from globals via a one-time deep copy
 * ({@link copyGlobalTemplateToCompany}) — never inheritance or synchronization.
 */

/** Builds the default global template library, mirroring the company seed. */
function defaultGlobalTemplates(): {
  templates: ChecklistTemplateV2[];
  sections: ChecklistSection[];
  items: ChecklistItem[];
} {
  const now = new Date().toISOString();
  const templates: ChecklistTemplateV2[] = [];
  const sections: ChecklistSection[] = [];
  const items: ChecklistItem[] = [];

  DEFAULT_CHECKLIST_TEMPLATE_SPECS.forEach((templateSpec, tIndex) => {
    const templateId = makeId("gtpl");
    templates.push({
      id: templateId,
      companyId: null,
      scope: "global",
      name: templateSpec.name,
      description: templateSpec.description,
      categoryIds: [],
      floorPresetIds: [],
      sortOrder: tIndex * 10,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
      originType: "global",
      version: 1,
      schemaVersion: CHECKLIST_V2_SCHEMA_VERSION,
    });

    templateSpec.sections.forEach((sectionSpec, sIndex) => {
      const sectionId = makeId("csec");
      sections.push({
        id: sectionId,
        templateId,
        companyId: null,
        title: sectionSpec.title,
        sortOrder: sIndex * 10,
        createdAt: now,
        updatedAt: now,
      });

      sectionSpec.items.forEach((itemSpec, iIndex) => {
        items.push({
          id: makeId("citm"),
          sectionId,
          templateId,
          companyId: null,
          title: itemSpec.title,
          description: itemSpec.description,
          required: itemSpec.required ?? false,
          sortOrder: iIndex * 10,
          createdAt: now,
          updatedAt: now,
        });
      });
    });
  });

  return { templates, sections, items };
}

/**
 * Lazily seeds the default global template library the first time globals are
 * read (none persisted yet). Returns the global templates (existing or seeded).
 */
function ensureGlobalSeeded(): ChecklistTemplateV2[] {
  const all = readTemplates();
  const globals = all.filter((t) => t.scope === "global");
  if (globals.length > 0) return globals;

  const seeded = defaultGlobalTemplates();
  writeTemplates([...all, ...seeded.templates]);
  writeSections([...readSections(), ...seeded.sections]);
  writeItems([...readItems(), ...seeded.items]);
  return seeded.templates;
}

/**
 * Returns the global template library, sorted by `sortOrder`. Archived globals
 * are excluded unless `includeArchived` is true. Seeds defaults on first use.
 */
export function getGlobalTemplates(options?: {
  includeArchived?: boolean;
}): ChecklistTemplateV2[] {
  const globals = ensureGlobalSeeded();
  const filtered = options?.includeArchived
    ? globals
    : globals.filter((t) => !t.isArchived);
  return sortChecklistTemplates(filtered);
}

/** Looks up a single global template by id. */
export function getGlobalTemplate(
  templateId: string,
): ChecklistTemplateV2 | null {
  return (
    readTemplates().find((t) => t.id === templateId && t.scope === "global") ??
    null
  );
}

/**
 * Resolves a template usable as a creation source for a company — either one of
 * the company's own templates or a (read-only) global template. Used by the
 * customer-protocol generator so protocols can be created from either tier.
 */
export function getTemplateForCompany(
  companyId: string,
  templateId: string,
): ChecklistTemplateV2 | null {
  return getTemplate(companyId, templateId) ?? getGlobalTemplate(templateId);
}

/** Creates a global template (Super Admin scope). Names are unique among globals. */
export function createGlobalTemplate(
  input: CreateChecklistTemplateInput,
): ChecklistTemplateV2 | null {
  const name = input.name.trim();
  if (!name) return null;

  ensureGlobalSeeded();
  const all = readTemplates();
  const globals = all.filter((t) => t.scope === "global");
  const normalized = normalizeChecklistTemplateName(name);
  if (globals.some((t) => normalizeChecklistTemplateName(t.name) === normalized)) {
    return null;
  }

  const maxSortOrder = globals.reduce((max, t) => Math.max(max, t.sortOrder), -10);
  const now = new Date().toISOString();
  const template: ChecklistTemplateV2 = {
    id: makeId("gtpl"),
    companyId: null,
    scope: "global",
    name,
    description: input.description?.trim() || undefined,
    audience: input.audience,
    categoryIds: input.categoryIds ?? [],
    floorPresetIds: input.floorPresetIds ?? [],
    sortOrder: maxSortOrder + 10,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    originType: "global",
    version: 1,
    schemaVersion: CHECKLIST_V2_SCHEMA_VERSION,
  };
  writeTemplates([...all, template]);
  return template;
}

/** Updates a global template's editable fields (Super Admin scope). */
export function updateGlobalTemplate(
  templateId: string,
  input: UpdateChecklistTemplateInput,
): ChecklistTemplateV2 | null {
  const all = readTemplates();
  const target = all.find((t) => t.id === templateId && t.scope === "global");
  if (!target) return null;

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return null;
    const normalized = normalizeChecklistTemplateName(name);
    const clash = all.some(
      (t) =>
        t.scope === "global" &&
        t.id !== templateId &&
        normalizeChecklistTemplateName(t.name) === normalized,
    );
    if (clash) return null;
  }

  const updated: ChecklistTemplateV2 = {
    ...target,
    name: input.name !== undefined ? input.name.trim() : target.name,
    description:
      input.description !== undefined
        ? input.description.trim() || undefined
        : target.description,
    audience: input.audience ?? target.audience,
    categoryIds: input.categoryIds ?? target.categoryIds,
    floorPresetIds: input.floorPresetIds ?? target.floorPresetIds,
    sortOrder: input.sortOrder ?? target.sortOrder,
    updatedAt: new Date().toISOString(),
  };
  writeTemplates(all.map((t) => (t.id === templateId ? updated : t)));
  return updated;
}

/** Sets the archived flag on a global template (Super Admin scope). */
function setGlobalTemplateArchived(
  templateId: string,
  isArchived: boolean,
): ChecklistTemplateV2 | null {
  const all = readTemplates();
  const target = all.find((t) => t.id === templateId && t.scope === "global");
  if (!target) return null;
  if (target.isArchived === isArchived) return target;
  const updated: ChecklistTemplateV2 = {
    ...target,
    isArchived,
    updatedAt: new Date().toISOString(),
  };
  writeTemplates(all.map((t) => (t.id === templateId ? updated : t)));
  return updated;
}

/** Archives a global template (soft-delete). */
export function archiveGlobalTemplate(
  templateId: string,
): ChecklistTemplateV2 | null {
  return setGlobalTemplateArchived(templateId, true);
}

/** Restores an archived global template. */
export function restoreGlobalTemplate(
  templateId: string,
): ChecklistTemplateV2 | null {
  return setGlobalTemplateArchived(templateId, false);
}

/** Picks a company-unique name, appending " (Copy)" / " (Copy N)" on clash. */
function uniqueCompanyTemplateName(
  companyId: string,
  desired: string,
): string {
  const owned = readTemplates().filter((t) => t.companyId === companyId);
  const taken = new Set(
    owned.map((t) => normalizeChecklistTemplateName(t.name)),
  );
  const base = desired.trim();
  if (!taken.has(normalizeChecklistTemplateName(base))) return base;
  let suffix = 2;
  let candidate = `${base} (Copy)`;
  while (taken.has(normalizeChecklistTemplateName(candidate))) {
    candidate = `${base} (Copy ${suffix})`;
    suffix += 1;
  }
  return candidate;
}

export interface CopyGlobalTemplateOptions {
  /** Override the copied template's name; defaults to the global name. */
  name?: string;
}

/**
 * Deep-copies a global template (metadata, category/floor-preset bindings,
 * sections and items) into a company-owned, fully-editable template with fresh
 * ids. The result is completely independent: later edits to the global template
 * never affect the copy, and edits to the copy never affect the global. Source
 * provenance (`sourceGlobalTemplateId` / `sourceGlobalTemplateName`) is recorded
 * for information only — there is no active linkage. Returns null if the global
 * template does not exist (archived globals are not copyable).
 */
export function copyGlobalTemplateToCompany(
  companyId: string,
  globalTemplateId: string,
  options?: CopyGlobalTemplateOptions,
): ChecklistTemplateV2 | null {
  const source = getGlobalTemplate(globalTemplateId);
  if (!source || source.isArchived) return null;

  ensureSeeded(companyId);
  const allTemplates = readTemplates();
  const owned = allTemplates.filter((t) => t.companyId === companyId);
  const maxSortOrder = owned.reduce((max, t) => Math.max(max, t.sortOrder), -10);
  const now = new Date().toISOString();
  const newTemplateId = makeId("ctpl");

  const template: ChecklistTemplateV2 = {
    id: newTemplateId,
    companyId,
    scope: "company",
    name: uniqueCompanyTemplateName(companyId, options?.name ?? source.name),
    description: source.description,
    audience: source.audience,
    categoryIds: [...source.categoryIds],
    floorPresetIds: [...source.floorPresetIds],
    sortOrder: maxSortOrder + 10,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    originType: "company",
    sourceGlobalTemplateId: source.id,
    sourceGlobalTemplateName: source.name,
    version: 1,
    schemaVersion: CHECKLIST_V2_SCHEMA_VERSION,
  };

  const newSections: ChecklistSection[] = [];
  const newItems: ChecklistItem[] = [];
  getSections(source.id).forEach((section, sIndex) => {
    const newSectionId = makeId("csec");
    newSections.push({
      id: newSectionId,
      templateId: newTemplateId,
      companyId,
      title: section.title,
      sortOrder: sIndex * 10,
      createdAt: now,
      updatedAt: now,
    });
    getItems(section.id).forEach((item, iIndex) => {
      newItems.push({
        id: makeId("citm"),
        sectionId: newSectionId,
        templateId: newTemplateId,
        companyId,
        title: item.title,
        description: item.description,
        required: item.required,
        sortOrder: iIndex * 10,
        createdAt: now,
        updatedAt: now,
      });
    });
  });

  writeTemplates([...allTemplates, template]);
  writeSections([...readSections(), ...newSections]);
  writeItems([...readItems(), ...newItems]);
  return template;
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                    */
/* -------------------------------------------------------------------------- */

/** Returns a template's sections, sorted by `sortOrder`. */
export function getSections(templateId: string): ChecklistSection[] {
  return sortChecklistSections(
    readSections().filter((s) => s.templateId === templateId),
  );
}

/** Looks up a single section by id. */
export function getSection(sectionId: string): ChecklistSection | null {
  return readSections().find((s) => s.id === sectionId) ?? null;
}

export interface CreateChecklistSectionInput {
  title: string;
}

/**
 * Creates a section under a template, appended after existing sections. Returns
 * null if the template does not exist or the title is empty.
 */
export function createSection(
  templateId: string,
  input: CreateChecklistSectionInput,
): ChecklistSection | null {
  const title = input.title.trim();
  if (!title) return null;

  const template = readTemplates().find((t) => t.id === templateId);
  if (!template) return null;

  const all = readSections();
  const siblings = all.filter((s) => s.templateId === templateId);
  const maxSortOrder = siblings.reduce(
    (max, s) => Math.max(max, s.sortOrder),
    -10,
  );
  const now = new Date().toISOString();
  const section: ChecklistSection = {
    id: makeId("csec"),
    templateId,
    companyId: template.companyId,
    title,
    sortOrder: maxSortOrder + 10,
    createdAt: now,
    updatedAt: now,
  };
  writeSections([...all, section]);
  return section;
}

/**
 * Copies library rooms into a template as new sections (one section per room).
 * Only the section title is carried over — library rooms have no other metadata
 * compatible with the V2 section schema. Content is copied, never live-linked,
 * so later library edits never affect these sections. Returns the created
 * sections (skipping any with an empty title). Scope-agnostic: created sections
 * inherit the parent template's `companyId` via {@link createSection}, so this
 * is safe for both global and company templates.
 */
export function addSectionsFromLibrary(
  templateId: string,
  rooms: { title: string }[],
): ChecklistSection[] {
  const created: ChecklistSection[] = [];
  rooms.forEach((room) => {
    const section = createSection(templateId, { title: room.title });
    if (section) created.push(section);
  });
  return created;
}

export interface UpdateChecklistSectionInput {
  title?: string;
  sortOrder?: number;
}

/** Updates a section's editable fields in place. */
export function updateSection(
  sectionId: string,
  input: UpdateChecklistSectionInput,
): ChecklistSection | null {
  const all = readSections();
  const target = all.find((s) => s.id === sectionId);
  if (!target) return null;

  if (input.title !== undefined && !input.title.trim()) return null;

  const updated: ChecklistSection = {
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
 * template, not independently archived). Returns true if a section was removed.
 */
export function deleteSection(sectionId: string): boolean {
  const all = readSections();
  if (!all.some((s) => s.id === sectionId)) return false;
  writeSections(all.filter((s) => s.id !== sectionId));
  writeItems(readItems().filter((i) => i.sectionId !== sectionId));
  return true;
}

/** Persists a new ordering for a template's sections. */
export function reorderSections(
  templateId: string,
  orderedIds: string[],
): ChecklistSection[] {
  const all = readSections();
  const orderIndex = new Map(orderedIds.map((id, index) => [id, index]));
  const now = new Date().toISOString();
  const next = all.map((s) => {
    if (s.templateId !== templateId) return s;
    const index = orderIndex.get(s.id);
    if (index === undefined) return s;
    return { ...s, sortOrder: index * 10, updatedAt: now };
  });
  writeSections(next);
  return getSections(templateId);
}

/* -------------------------------------------------------------------------- */
/* Items                                                                       */
/* -------------------------------------------------------------------------- */

/** Returns a section's items, sorted by `sortOrder`. */
export function getItems(sectionId: string): ChecklistItem[] {
  return sortChecklistItems(
    readItems().filter((i) => i.sectionId === sectionId),
  );
}

/** Looks up a single item by id. */
export function getItem(itemId: string): ChecklistItem | null {
  return readItems().find((i) => i.id === itemId) ?? null;
}

export interface CreateChecklistItemInput {
  title: string;
  description?: string;
  required?: boolean;
}

/**
 * Creates an item under a section, appended after existing items. Returns null
 * if the section does not exist or the title is empty.
 */
export function createItem(
  sectionId: string,
  input: CreateChecklistItemInput,
): ChecklistItem | null {
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
  const item: ChecklistItem = {
    id: makeId("citm"),
    sectionId,
    templateId: section.templateId,
    companyId: section.companyId,
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

/**
 * Copies library tasks into a section as new items (one item per task). Carries
 * over the compatible fields — title, description and required — copying content
 * rather than live-linking, so later library edits never affect these items.
 * Returns the created items (skipping any with an empty title). Scope-agnostic
 * via {@link createItem}, so safe for global and company templates alike.
 */
export function addItemsFromLibrary(
  sectionId: string,
  tasks: { title: string; description?: string; required?: boolean }[],
): ChecklistItem[] {
  const created: ChecklistItem[] = [];
  tasks.forEach((task) => {
    const item = createItem(sectionId, {
      title: task.title,
      description: task.description,
      required: task.required ?? false,
    });
    if (item) created.push(item);
  });
  return created;
}

export interface UpdateChecklistItemInput {
  title?: string;
  description?: string;
  required?: boolean;
  sortOrder?: number;
}

/** Updates an item's editable fields in place. */
export function updateItem(
  itemId: string,
  input: UpdateChecklistItemInput,
): ChecklistItem | null {
  const all = readItems();
  const target = all.find((i) => i.id === itemId);
  if (!target) return null;

  if (input.title !== undefined && !input.title.trim()) return null;

  const updated: ChecklistItem = {
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
export function deleteItem(itemId: string): boolean {
  const all = readItems();
  if (!all.some((i) => i.id === itemId)) return false;
  writeItems(all.filter((i) => i.id !== itemId));
  return true;
}

/** Persists a new ordering for a section's items. */
export function reorderItems(
  sectionId: string,
  orderedIds: string[],
): ChecklistItem[] {
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
  return getItems(sectionId);
}
