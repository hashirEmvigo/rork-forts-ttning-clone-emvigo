import {
  CHECKLIST_V2_SCHEMA_VERSION,
  sortProtocolRunItems,
  sortProtocolRunSections,
  type ProtocolRunItem,
  type ProtocolRunItemStatus,
  type ProtocolRunSection,
  type ProtocolRunStatus,
  type ProtocolRunV2,
} from "@/types";
import { makeId } from "@/lib/store";

/**
 * Checklist Manager V2 — Protocol run (execution snapshot) persistence (Phase 3A).
 *
 * Like the Phase 1/2 stores ({@link floorPresetStore.ts},
 * {@link checklistTemplateStore.ts}), this is a backend-shaped abstraction over
 * localStorage so it can be swapped for Supabase tables without touching callers.
 * It establishes the execution data foundation only — no UI, no booking or
 * work-order integration, no photos/signatures/deviations.
 *
 * Hierarchy: ProtocolRunV2 → ProtocolRunSection → ProtocolRunItem. Sections and
 * items are owned children, deleted with their parent run (runs are never
 * hard-deleted here; they transition to `cancelled`).
 *
 * Invariants enforced here (not in future UI):
 *  - Company isolation: every row carries `companyId`; reads are scoped.
 *  - Deterministic ordering via the `sort*` helpers.
 *  - Snapshot integrity: rows are written once at creation; mutation is limited
 *    to run status and per-item completion status, never the snapshot content.
 *  - Unlike templates, runs are NOT lazily seeded — they only exist once
 *    generated from a template.
 */

const RUNS_KEY = "cleanops.protocolRuns";
const RUN_SECTIONS_KEY = "cleanops.protocolRunSections";
const RUN_ITEMS_KEY = "cleanops.protocolRunItems";

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
 * Normalizes persisted runs to the current schema version. Runs written before
 * versioning (Phase 4A, Ticket 55) had no `schemaVersion`; they are treated as
 * version 1. Lazy and idempotent — no migration step, no data loss.
 */
function normalizeRuns(rows: ProtocolRunV2[]): ProtocolRunV2[] {
  return rows.map((r) =>
    typeof r.schemaVersion === "number" ? r : { ...r, schemaVersion: 1 },
  );
}

const readRuns = (): ProtocolRunV2[] =>
  normalizeRuns(readJson<ProtocolRunV2>(RUNS_KEY));
const writeRuns = (rows: ProtocolRunV2[]): void => writeJson(RUNS_KEY, rows);
const readRunSections = (): ProtocolRunSection[] =>
  readJson<ProtocolRunSection>(RUN_SECTIONS_KEY);
const writeRunSections = (rows: ProtocolRunSection[]): void =>
  writeJson(RUN_SECTIONS_KEY, rows);
const readRunItems = (): ProtocolRunItem[] =>
  readJson<ProtocolRunItem>(RUN_ITEMS_KEY);
const writeRunItems = (rows: ProtocolRunItem[]): void =>
  writeJson(RUN_ITEMS_KEY, rows);

/* -------------------------------------------------------------------------- */
/* Creation                                                                    */
/* -------------------------------------------------------------------------- */

/** A snapshotted item to persist under a section (ids are assigned by the store). */
export interface CreateProtocolRunItemInput {
  title: string;
  description?: string;
  required: boolean;
  sortOrder: number;
}

/** A snapshotted section to persist under a run (ids are assigned by the store). */
export interface CreateProtocolRunSectionInput {
  title: string;
  sortOrder: number;
  items: CreateProtocolRunItemInput[];
}

/**
 * A complete, deep-copied snapshot ready to persist. The {@link protocolRunGenerator}
 * builds this from a template; the store assigns ids and initializes runtime
 * fields (all items start `pending`).
 */
export interface CreateProtocolRunInput {
  sourceTemplateId: string;
  sourceTemplateName: string;
  sourceTemplateVersion: number;
  /** Set when the run is generated from a customer protocol (Phase 3E). */
  sourceCustomerProtocolId?: string;
  /** Snapshotted customer protocol name at generation time. */
  sourceCustomerProtocolName?: string;
  /** Customer the run belongs to when generated from a customer protocol. */
  customerId?: string;
  bookingId?: string;
  workOrderId?: string;
  /** Execution anchor (Phase 4A): the visit occurrence this run belongs to. */
  visitOccurrenceId?: string;
  /** Employees assigned to execute this run (Phase 4A); team-shared, not 1-per-employee. */
  assignedEmployeeIds?: string[];
  generatedBy: string;
  /** Initial lifecycle status; defaults to `draft`. */
  status?: ProtocolRunStatus;
  sections: CreateProtocolRunSectionInput[];
}

/**
 * Persists a new protocol run with its snapshotted sections and items. All
 * items are initialized to `pending`. Returns the created run.
 */
export function createRun(
  companyId: string,
  input: CreateProtocolRunInput,
): ProtocolRunV2 {
  const now = new Date().toISOString();
  const runId = makeId("prun");
  const run: ProtocolRunV2 = {
    id: runId,
    companyId,
    sourceTemplateId: input.sourceTemplateId,
    sourceTemplateName: input.sourceTemplateName,
    sourceTemplateVersion: input.sourceTemplateVersion,
    sourceCustomerProtocolId: input.sourceCustomerProtocolId,
    sourceCustomerProtocolName: input.sourceCustomerProtocolName,
    customerId: input.customerId,
    bookingId: input.bookingId,
    workOrderId: input.workOrderId,
    visitOccurrenceId: input.visitOccurrenceId,
    assignedEmployeeIds: input.assignedEmployeeIds
      ? [...input.assignedEmployeeIds]
      : undefined,
    schemaVersion: CHECKLIST_V2_SCHEMA_VERSION,
    status: input.status ?? "draft",
    generatedAt: now,
    generatedBy: input.generatedBy,
    createdAt: now,
    updatedAt: now,
  };

  const sections: ProtocolRunSection[] = [];
  const items: ProtocolRunItem[] = [];
  input.sections.forEach((sectionInput) => {
    const sectionId = makeId("prsec");
    sections.push({
      id: sectionId,
      companyId,
      runId,
      title: sectionInput.title,
      sortOrder: sectionInput.sortOrder,
    });
    sectionInput.items.forEach((itemInput) => {
      items.push({
        id: makeId("pritm"),
        companyId,
        runId,
        sectionId,
        title: itemInput.title,
        description: itemInput.description,
        required: itemInput.required,
        sortOrder: itemInput.sortOrder,
        status: "pending",
      });
    });
  });

  writeRuns([...readRuns(), run]);
  writeRunSections([...readRunSections(), ...sections]);
  writeRunItems([...readRunItems(), ...items]);
  return run;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Returns a company's runs, newest first (by `generatedAt`, then insertion
 * order). Ids are not monotonic ({@link makeId} is random-prefixed), so equal
 * `generatedAt` values (two runs created within the same millisecond) tie-break
 * on persisted insertion order — the later-written run is the newer one. This
 * keeps ordering deterministic instead of depending on random id comparison.
 */
export function getRuns(companyId: string): ProtocolRunV2[] {
  return readRuns()
    .map((run, index) => ({ run, index }))
    .filter(({ run }) => run.companyId === companyId)
    .sort((a, b) => {
      if (a.run.generatedAt !== b.run.generatedAt)
        return a.run.generatedAt < b.run.generatedAt ? 1 : -1;
      return b.index - a.index;
    })
    .map(({ run }) => run);
}

/** Looks up a single run by id, scoped to a company. */
export function getRun(
  companyId: string,
  runId: string,
): ProtocolRunV2 | null {
  return (
    readRuns().find((r) => r.id === runId && r.companyId === companyId) ?? null
  );
}

/** Returns a run's sections, ordered. Scoped to a company via the run. */
export function getRunSections(
  companyId: string,
  runId: string,
): ProtocolRunSection[] {
  return sortProtocolRunSections(
    readRunSections().filter(
      (s) => s.runId === runId && s.companyId === companyId,
    ),
  );
}

/** Returns a section's items, ordered. Scoped to a company. */
export function getRunItems(
  companyId: string,
  sectionId: string,
): ProtocolRunItem[] {
  return sortProtocolRunItems(
    readRunItems().filter(
      (i) => i.sectionId === sectionId && i.companyId === companyId,
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* Mutations (status only — snapshot content is immutable)                     */
/* -------------------------------------------------------------------------- */

/**
 * Updates a run's lifecycle status. Setting `completed` stamps `completedAt`;
 * moving away from `completed` clears it. Returns the updated run or null.
 */
export function updateRunStatus(
  companyId: string,
  runId: string,
  status: ProtocolRunStatus,
): ProtocolRunV2 | null {
  const all = readRuns();
  const target = all.find((r) => r.id === runId && r.companyId === companyId);
  if (!target) return null;

  const now = new Date().toISOString();
  const updated: ProtocolRunV2 = {
    ...target,
    status,
    completedAt:
      status === "completed"
        ? (target.completedAt ?? now)
        : undefined,
    updatedAt: now,
  };
  writeRuns(all.map((r) => (r.id === runId ? updated : r)));
  return updated;
}

/** Optional metadata captured alongside an item status change. */
export interface UpdateItemStatusOptions {
  /** Actor completing the item (recorded for `done`). */
  completedBy?: string;
  /** Reason recorded when status is `skipped`. */
  skipReason?: string;
}

/**
 * Updates a single run item's completion status, scoped to a company via the
 * run. `done` stamps `completedAt`/`completedBy`; `skipped` records `skipReason`;
 * `pending`/`na` clear the completion fields. Returns the updated item or null.
 */
export function updateItemStatus(
  companyId: string,
  runId: string,
  itemId: string,
  status: ProtocolRunItemStatus,
  options?: UpdateItemStatusOptions,
): ProtocolRunItem | null {
  const all = readRunItems();
  const target = all.find(
    (i) => i.id === itemId && i.runId === runId && i.companyId === companyId,
  );
  if (!target) return null;

  const now = new Date().toISOString();
  const updated: ProtocolRunItem = {
    ...target,
    status,
    completedAt: status === "done" ? now : undefined,
    completedBy: status === "done" ? options?.completedBy : undefined,
    skipReason: status === "skipped" ? options?.skipReason : undefined,
  };
  writeRunItems(all.map((i) => (i.id === itemId ? updated : i)));
  return updated;
}

/** Cancels a run (soft lifecycle transition). Returns the updated run or null. */
export function cancelRun(
  companyId: string,
  runId: string,
): ProtocolRunV2 | null {
  return updateRunStatus(companyId, runId, "cancelled");
}

/* -------------------------------------------------------------------------- */
/* Visit binding & assignment reads (Phase 4A)                                 */
/* -------------------------------------------------------------------------- */

/**
 * Returns the runs bound to a visit occurrence, scoped to a company. One
 * occurrence can carry more than one run over its lifetime; callers decide how
 * to interpret multiples. Newest first (by `generatedAt`, then id).
 */
export function getRunsByVisitOccurrence(
  companyId: string,
  visitOccurrenceId: string,
): ProtocolRunV2[] {
  return getRuns(companyId).filter(
    (r) => r.visitOccurrenceId === visitOccurrenceId,
  );
}

/**
 * Replaces the set of employees assigned to a run (Phase 4A, Ticket 54). One
 * run is shared by a team — this never creates a run per employee. Duplicate
 * ids are de-duplicated; an empty array clears the assignment. Returns the
 * updated run or null when not found / wrong company.
 */
export function setRunAssignedEmployees(
  companyId: string,
  runId: string,
  employeeIds: string[],
): ProtocolRunV2 | null {
  const all = readRuns();
  const target = all.find((r) => r.id === runId && r.companyId === companyId);
  if (!target) return null;

  const deduped = Array.from(new Set(employeeIds));
  const updated: ProtocolRunV2 = {
    ...target,
    assignedEmployeeIds: deduped,
    updatedAt: new Date().toISOString(),
  };
  writeRuns(all.map((r) => (r.id === runId ? updated : r)));
  return updated;
}
