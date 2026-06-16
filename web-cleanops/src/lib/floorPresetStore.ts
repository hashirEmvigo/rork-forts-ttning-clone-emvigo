import {
  DEFAULT_FLOOR_PRESET_SPECS,
  normalizeFloorPresetName,
  sortFloorPresets,
  type FloorPreset,
} from "@/types";
import { makeId } from "@/lib/store";

/**
 * Checklist Manager V2 — Floor Preset persistence (Phase 1 Foundation).
 *
 * Like {@link mediaStore.ts}, this is a backend-shaped abstraction over
 * localStorage so it can be swapped for a Supabase table without touching
 * callers. This ticket establishes the model, default seeding and CRUD/archive
 * helpers only — no UI consumes it yet.
 *
 * Invariants enforced here (not in future UI):
 *  - Company isolation: every preset belongs to a company; reads are scoped.
 *  - Deterministic ordering via {@link sortFloorPresets}.
 *  - Soft-delete: archiving hides a preset from active lists but keeps it for
 *    historical references.
 *  - Defaults are seeded lazily the first time a company is read, so existing
 *    companies gain presets without a migration step.
 */

const FLOOR_PRESETS_KEY = "cleanops.floorPresets";

function readPresets(): FloorPreset[] {
  try {
    const raw = localStorage.getItem(FLOOR_PRESETS_KEY);
    return raw ? (JSON.parse(raw) as FloorPreset[]) : [];
  } catch {
    return [];
  }
}

function writePresets(presets: FloorPreset[]): void {
  try {
    localStorage.setItem(FLOOR_PRESETS_KEY, JSON.stringify(presets));
  } catch (err) {
    console.error("Failed to persist floor presets", err);
  }
}

/**
 * Builds the default preset set for a company from
 * {@link DEFAULT_FLOOR_PRESET_SPECS}, assigning ids and a stepped `sortOrder`.
 */
export function defaultFloorPresets(companyId: string): FloorPreset[] {
  const now = new Date().toISOString();
  return DEFAULT_FLOOR_PRESET_SPECS.map((spec, index) => ({
    id: makeId("floor"),
    companyId,
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
 * Lazily seeds default presets for a company that has none persisted (active or
 * archived). Returns the company's presets (existing or freshly seeded).
 */
function ensureSeeded(companyId: string): FloorPreset[] {
  const all = readPresets();
  const owned = all.filter((p) => p.companyId === companyId);
  if (owned.length > 0) return owned;

  const seeded = defaultFloorPresets(companyId);
  writePresets([...all, ...seeded]);
  return seeded;
}

/**
 * Returns a company's floor presets, sorted by `sortOrder`. Archived presets
 * are excluded unless `includeArchived` is true. Seeds defaults on first use.
 */
export function getFloorPresets(
  companyId: string,
  options?: { includeArchived?: boolean },
): FloorPreset[] {
  const owned = ensureSeeded(companyId);
  const filtered = options?.includeArchived
    ? owned
    : owned.filter((p) => !p.isArchived);
  return sortFloorPresets(filtered);
}

/** Active presets only (the default list used by future protocol pickers). */
export function getActiveFloorPresets(companyId: string): FloorPreset[] {
  return getFloorPresets(companyId, { includeArchived: false });
}

/** All presets including archived ones — for historical references. */
export function getAllFloorPresets(companyId: string): FloorPreset[] {
  return getFloorPresets(companyId, { includeArchived: true });
}

/** Looks up a single preset by id, scoped to a company. */
export function getFloorPreset(
  companyId: string,
  presetId: string,
): FloorPreset | null {
  return (
    readPresets().find(
      (p) => p.id === presetId && p.companyId === companyId,
    ) ?? null
  );
}

export interface CreateFloorPresetInput {
  name: string;
  description?: string;
  locale?: string;
  countryCode?: string;
}

/**
 * Creates a floor preset for a company, appended after existing presets. Names
 * must be unique within the company (case-insensitive, trimmed) across active
 * and archived presets; a duplicate returns null instead of silently creating.
 */
export function createFloorPreset(
  companyId: string,
  input: CreateFloorPresetInput,
): FloorPreset | null {
  const name = input.name.trim();
  if (!name) return null;

  const all = readPresets();
  const owned = all.filter((p) => p.companyId === companyId);
  const normalized = normalizeFloorPresetName(name);
  if (owned.some((p) => normalizeFloorPresetName(p.name) === normalized)) {
    return null;
  }

  const maxSortOrder = owned.reduce((max, p) => Math.max(max, p.sortOrder), -10);
  const now = new Date().toISOString();
  const preset: FloorPreset = {
    id: makeId("floor"),
    companyId,
    name,
    description: input.description?.trim() || undefined,
    sortOrder: maxSortOrder + 10,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    locale: input.locale,
    countryCode: input.countryCode,
    originType: "company",
    version: 1,
  };
  writePresets([...all, preset]);
  return preset;
}

export interface UpdateFloorPresetInput {
  name?: string;
  description?: string;
  sortOrder?: number;
  locale?: string;
  countryCode?: string;
}

/**
 * Updates a preset's editable fields in place. Renaming to a name already used
 * by another preset in the same company is rejected (returns null).
 */
export function updateFloorPreset(
  companyId: string,
  presetId: string,
  input: UpdateFloorPresetInput,
): FloorPreset | null {
  const all = readPresets();
  const target = all.find(
    (p) => p.id === presetId && p.companyId === companyId,
  );
  if (!target) return null;

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return null;
    const normalized = normalizeFloorPresetName(name);
    const clash = all.some(
      (p) =>
        p.companyId === companyId &&
        p.id !== presetId &&
        normalizeFloorPresetName(p.name) === normalized,
    );
    if (clash) return null;
  }

  const updated: FloorPreset = {
    ...target,
    name: input.name !== undefined ? input.name.trim() : target.name,
    description:
      input.description !== undefined
        ? input.description.trim() || undefined
        : target.description,
    sortOrder: input.sortOrder ?? target.sortOrder,
    locale: input.locale !== undefined ? input.locale : target.locale,
    countryCode:
      input.countryCode !== undefined ? input.countryCode : target.countryCode,
    updatedAt: new Date().toISOString(),
  };
  writePresets(all.map((p) => (p.id === presetId ? updated : p)));
  return updated;
}

/** Sets the archived flag on a preset. Returns the updated preset or null. */
function setArchived(
  companyId: string,
  presetId: string,
  isArchived: boolean,
): FloorPreset | null {
  const all = readPresets();
  const target = all.find(
    (p) => p.id === presetId && p.companyId === companyId,
  );
  if (!target) return null;
  if (target.isArchived === isArchived) return target;

  const updated: FloorPreset = {
    ...target,
    isArchived,
    updatedAt: new Date().toISOString(),
  };
  writePresets(all.map((p) => (p.id === presetId ? updated : p)));
  return updated;
}

/** Archives a preset (soft-delete) — hidden from active lists, kept for history. */
export function archiveFloorPreset(
  companyId: string,
  presetId: string,
): FloorPreset | null {
  return setArchived(companyId, presetId, true);
}

/** Restores an archived preset back into the active list. */
export function unarchiveFloorPreset(
  companyId: string,
  presetId: string,
): FloorPreset | null {
  return setArchived(companyId, presetId, false);
}

/**
 * Persists a new ordering for a company's presets. Accepts ordered ids and
 * rewrites `sortOrder` in steps of 10 — the persistence half of future
 * drag-and-drop reordering. Ids not belonging to the company are ignored.
 */
export function reorderFloorPresets(
  companyId: string,
  orderedIds: string[],
): FloorPreset[] {
  const all = readPresets();
  const orderIndex = new Map(orderedIds.map((id, index) => [id, index]));
  const now = new Date().toISOString();

  const next = all.map((p) => {
    if (p.companyId !== companyId) return p;
    const index = orderIndex.get(p.id);
    if (index === undefined) return p;
    return { ...p, sortOrder: index * 10, updatedAt: now };
  });
  writePresets(next);
  return getAllFloorPresets(companyId);
}
