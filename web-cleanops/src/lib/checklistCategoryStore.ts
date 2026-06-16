import {
  CHECKLIST_CATEGORY_TYPES,
  DEFAULT_CHECKLIST_CATEGORY_SPECS,
  normalizeChecklistCategoryName,
  sortChecklistCategories,
  type ChecklistCategory,
  type ChecklistCategoryType,
} from "@/types";
import { makeId } from "@/lib/store";

/**
 * Checklist Manager V2 — Category persistence (Phase 1 Foundation).
 *
 * Like {@link floorPresetStore.ts} and {@link mediaStore.ts}, this is a
 * backend-shaped abstraction over localStorage so it can be swapped for a
 * Supabase table without touching callers. This ticket establishes the model,
 * default seeding and CRUD/archive helpers only — no UI consumes it yet.
 *
 * Invariants enforced here (not in future UI):
 *  - Company isolation: every category belongs to a company; reads are scoped.
 *  - Type partitioning: a name may repeat across types but is unique within a
 *    (company, type) pair (case-insensitive, trimmed).
 *  - Deterministic ordering via {@link sortChecklistCategories}, per type.
 *  - Soft-delete: archiving hides a category from active lists but keeps it for
 *    historical references.
 *  - Defaults are seeded lazily the first time a (company, type) is read, so
 *    existing companies gain categories without a migration step.
 */

const CHECKLIST_CATEGORIES_KEY = "cleanops.checklistCategories";

function readCategories(): ChecklistCategory[] {
  try {
    const raw = localStorage.getItem(CHECKLIST_CATEGORIES_KEY);
    return raw ? (JSON.parse(raw) as ChecklistCategory[]) : [];
  } catch {
    return [];
  }
}

function writeCategories(categories: ChecklistCategory[]): void {
  try {
    localStorage.setItem(CHECKLIST_CATEGORIES_KEY, JSON.stringify(categories));
  } catch (err) {
    console.error("Failed to persist checklist categories", err);
  }
}

/**
 * Builds the default category set for a (company, type) from
 * {@link DEFAULT_CHECKLIST_CATEGORY_SPECS}, assigning ids and a stepped
 * `sortOrder`.
 */
export function defaultChecklistCategories(
  companyId: string,
  type: ChecklistCategoryType,
): ChecklistCategory[] {
  const now = new Date().toISOString();
  return DEFAULT_CHECKLIST_CATEGORY_SPECS[type].map((spec, index) => ({
    id: makeId("ccat"),
    companyId,
    type,
    name: spec.name,
    description: spec.description,
    sortOrder: index * 10,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    originType: "seed" as const,
    version: 1,
  }));
}

/**
 * Lazily seeds default categories for a (company, type) that has none persisted
 * (active or archived). Returns that pair's categories (existing or freshly
 * seeded). Seeding is independent per type so adding a new type later still
 * back-fills existing companies.
 */
function ensureSeeded(
  companyId: string,
  type: ChecklistCategoryType,
): ChecklistCategory[] {
  const all = readCategories();
  const owned = all.filter((c) => c.companyId === companyId && c.type === type);
  if (owned.length > 0) return owned;

  const seeded = defaultChecklistCategories(companyId, type);
  writeCategories([...all, ...seeded]);
  return seeded;
}

/**
 * Returns a company's categories for a type, sorted by `sortOrder`. Archived
 * categories are excluded unless `includeArchived` is true. Seeds defaults on
 * first use.
 */
export function getChecklistCategories(
  companyId: string,
  type: ChecklistCategoryType,
  options?: { includeArchived?: boolean },
): ChecklistCategory[] {
  const owned = ensureSeeded(companyId, type);
  const filtered = options?.includeArchived
    ? owned
    : owned.filter((c) => !c.isArchived);
  return sortChecklistCategories(filtered);
}

/** Active categories only (the default list used by future pickers). */
export function getActiveChecklistCategories(
  companyId: string,
  type: ChecklistCategoryType,
): ChecklistCategory[] {
  return getChecklistCategories(companyId, type, { includeArchived: false });
}

/** All categories of a type including archived ones — for historical references. */
export function getAllChecklistCategories(
  companyId: string,
  type: ChecklistCategoryType,
): ChecklistCategory[] {
  return getChecklistCategories(companyId, type, { includeArchived: true });
}

/**
 * Seeds and returns every category type for a company, keyed by type. Useful for
 * a future overview screen that summarizes all category groups at once.
 */
export function getAllChecklistCategoriesByType(
  companyId: string,
  options?: { includeArchived?: boolean },
): Record<ChecklistCategoryType, ChecklistCategory[]> {
  const result = {} as Record<ChecklistCategoryType, ChecklistCategory[]>;
  for (const type of CHECKLIST_CATEGORY_TYPES) {
    result[type] = getChecklistCategories(companyId, type, options);
  }
  return result;
}

/** Looks up a single category by id, scoped to a company. */
export function getChecklistCategory(
  companyId: string,
  categoryId: string,
): ChecklistCategory | null {
  return (
    readCategories().find(
      (c) => c.id === categoryId && c.companyId === companyId,
    ) ?? null
  );
}

export interface CreateChecklistCategoryInput {
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  locale?: string;
  countryCode?: string;
}

/**
 * Creates a category for a (company, type), appended after existing categories
 * of that type. Names must be unique within the (company, type) pair
 * (case-insensitive, trimmed) across active and archived categories; a duplicate
 * returns null instead of silently creating.
 */
export function createChecklistCategory(
  companyId: string,
  type: ChecklistCategoryType,
  input: CreateChecklistCategoryInput,
): ChecklistCategory | null {
  const name = input.name.trim();
  if (!name) return null;

  const all = readCategories();
  const owned = all.filter((c) => c.companyId === companyId && c.type === type);
  const normalized = normalizeChecklistCategoryName(name);
  if (owned.some((c) => normalizeChecklistCategoryName(c.name) === normalized)) {
    return null;
  }

  const maxSortOrder = owned.reduce((max, c) => Math.max(max, c.sortOrder), -10);
  const now = new Date().toISOString();
  const category: ChecklistCategory = {
    id: makeId("ccat"),
    companyId,
    type,
    name,
    description: input.description?.trim() || undefined,
    sortOrder: maxSortOrder + 10,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    icon: input.icon,
    color: input.color,
    locale: input.locale,
    countryCode: input.countryCode,
    originType: "company",
    version: 1,
  };
  writeCategories([...all, category]);
  return category;
}

export interface UpdateChecklistCategoryInput {
  name?: string;
  description?: string;
  sortOrder?: number;
  icon?: string;
  color?: string;
  locale?: string;
  countryCode?: string;
}

/**
 * Updates a category's editable fields in place. Renaming to a name already used
 * by another category in the same (company, type) is rejected (returns null).
 * The `type` is immutable.
 */
export function updateChecklistCategory(
  companyId: string,
  categoryId: string,
  input: UpdateChecklistCategoryInput,
): ChecklistCategory | null {
  const all = readCategories();
  const target = all.find(
    (c) => c.id === categoryId && c.companyId === companyId,
  );
  if (!target) return null;

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return null;
    const normalized = normalizeChecklistCategoryName(name);
    const clash = all.some(
      (c) =>
        c.companyId === companyId &&
        c.type === target.type &&
        c.id !== categoryId &&
        normalizeChecklistCategoryName(c.name) === normalized,
    );
    if (clash) return null;
  }

  const updated: ChecklistCategory = {
    ...target,
    name: input.name !== undefined ? input.name.trim() : target.name,
    description:
      input.description !== undefined
        ? input.description.trim() || undefined
        : target.description,
    sortOrder: input.sortOrder ?? target.sortOrder,
    icon: input.icon !== undefined ? input.icon : target.icon,
    color: input.color !== undefined ? input.color : target.color,
    locale: input.locale !== undefined ? input.locale : target.locale,
    countryCode:
      input.countryCode !== undefined ? input.countryCode : target.countryCode,
    updatedAt: new Date().toISOString(),
  };
  writeCategories(all.map((c) => (c.id === categoryId ? updated : c)));
  return updated;
}

/** Sets the archived flag on a category. Returns the updated category or null. */
function setArchived(
  companyId: string,
  categoryId: string,
  isArchived: boolean,
): ChecklistCategory | null {
  const all = readCategories();
  const target = all.find(
    (c) => c.id === categoryId && c.companyId === companyId,
  );
  if (!target) return null;
  if (target.isArchived === isArchived) return target;

  const updated: ChecklistCategory = {
    ...target,
    isArchived,
    updatedAt: new Date().toISOString(),
  };
  writeCategories(all.map((c) => (c.id === categoryId ? updated : c)));
  return updated;
}

/** Archives a category (soft-delete) — hidden from active lists, kept for history. */
export function archiveChecklistCategory(
  companyId: string,
  categoryId: string,
): ChecklistCategory | null {
  return setArchived(companyId, categoryId, true);
}

/** Restores an archived category back into the active list. */
export function unarchiveChecklistCategory(
  companyId: string,
  categoryId: string,
): ChecklistCategory | null {
  return setArchived(companyId, categoryId, false);
}

/**
 * Persists a new ordering for a company's categories within a type. Accepts
 * ordered ids and rewrites `sortOrder` in steps of 10 — the persistence half of
 * future drag-and-drop reordering. Ids not belonging to the (company, type) are
 * ignored.
 */
export function reorderChecklistCategories(
  companyId: string,
  type: ChecklistCategoryType,
  orderedIds: string[],
): ChecklistCategory[] {
  const all = readCategories();
  const orderIndex = new Map(orderedIds.map((id, index) => [id, index]));
  const now = new Date().toISOString();

  const next = all.map((c) => {
    if (c.companyId !== companyId || c.type !== type) return c;
    const index = orderIndex.get(c.id);
    if (index === undefined) return c;
    return { ...c, sortOrder: index * 10, updatedAt: now };
  });
  writeCategories(next);
  return getAllChecklistCategories(companyId, type);
}
