import {
  CHECKLIST_V2_SCHEMA_VERSION,
  sortVisitOccurrences,
  type VisitOccurrence,
  type VisitOccurrenceStatus,
} from "@/types";
import { makeId } from "@/lib/store";

/**
 * Checklist Manager V2 — Visit / occurrence persistence (Phase 4A, Ticket 52).
 *
 * A backend-shaped abstraction over localStorage (mirroring the other V2 stores)
 * for the lightweight execution anchor that sits between a customer protocol and
 * an executable run:
 *
 *   CustomerProtocolV2 → VisitOccurrence → ProtocolRunV2
 *
 * A recurring service produces many occurrences of the same work; each gets a
 * unique operational identity here so future Check-in / mobile execution /
 * reporting can attach runs (and multiple employees) to a specific occurrence.
 *
 * Foundation only — no scheduling UI, no employee UI. Invariants enforced here:
 *  - Company isolation: every row carries `companyId`; reads are scoped.
 *  - Customer scoping: every row carries `customerId`.
 *  - Schema versioning: rows are stamped with {@link CHECKLIST_V2_SCHEMA_VERSION}
 *    at creation and normalized on read.
 *  - Soft lifecycle: occurrences are never hard-deleted; they transition to
 *    `cancelled`.
 */

const VISITS_KEY = "cleanops.visitOccurrences";

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
 * Normalizes persisted occurrences to the current schema version. Records
 * written before versioning had no `schemaVersion`; they are treated as
 * version 1. Lazy and idempotent — no migration step, no data loss.
 */
function normalize(rows: VisitOccurrence[]): VisitOccurrence[] {
  return rows.map((v) =>
    typeof v.schemaVersion === "number" ? v : { ...v, schemaVersion: 1 },
  );
}

const readVisits = (): VisitOccurrence[] =>
  normalize(readJson<VisitOccurrence>(VISITS_KEY));
const writeVisits = (rows: VisitOccurrence[]): void =>
  writeJson(VISITS_KEY, rows);

/**
 * Fires the Supabase dual-write mirror (MISSION-1) for a localStorage write.
 * localStorage stays the synchronized backout copy: every mutation completes
 * against it BEFORE this runs. The mirror is gated by the cut-over flag, never
 * throws, and is fire-and-forget so the synchronous store API is unchanged.
 * Imported lazily to avoid pulling the Supabase client into pure store tests.
 */
function mirrorWrite(_prev: VisitOccurrence[], _next: VisitOccurrence[]): void {
  // Phase 1 safety: do not mirror browser-persisted Visit Occurrence data back
  // into Supabase from normal app runtime. A future reviewed server/API write
  // path can reintroduce non-authoritative caching explicitly.
}

/** Returns ALL visit occurrences across companies (migration / shadow tooling). */
export function getAllVisitOccurrences(): VisitOccurrence[] {
  return sortVisitOccurrences(readVisits());
}

/* -------------------------------------------------------------------------- */
/* Creation                                                                    */
/* -------------------------------------------------------------------------- */

export interface CreateVisitOccurrenceInput {
  customerId: string;
  workOrderId: string;
  serviceRowId: string;
  /** ISO date of the occurrence, e.g. "2026-06-03". */
  scheduledDate: string;
  /** Initial lifecycle status; defaults to `scheduled`. */
  status?: VisitOccurrenceStatus;
}

/** Persists a new visit occurrence (status defaults to `scheduled`). */
export function createVisitOccurrence(
  companyId: string,
  input: CreateVisitOccurrenceInput,
): VisitOccurrence {
  const now = new Date().toISOString();
  const visit: VisitOccurrence = {
    id: makeId("visit"),
    companyId,
    customerId: input.customerId,
    workOrderId: input.workOrderId,
    serviceRowId: input.serviceRowId,
    scheduledDate: input.scheduledDate,
    status: input.status ?? "scheduled",
    schemaVersion: CHECKLIST_V2_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
  };
  const prev = readVisits();
  const next = [...prev, visit];
  writeVisits(next);
  mirrorWrite(prev, next);
  return visit;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/** Returns a company's visit occurrences, ordered by scheduled date. */
export function getVisitOccurrences(companyId: string): VisitOccurrence[] {
  return sortVisitOccurrences(
    readVisits().filter((v) => v.companyId === companyId),
  );
}

/** Returns a customer's visit occurrences within a company, ordered. */
export function getVisitOccurrencesForCustomer(
  companyId: string,
  customerId: string,
): VisitOccurrence[] {
  return sortVisitOccurrences(
    readVisits().filter(
      (v) => v.companyId === companyId && v.customerId === customerId,
    ),
  );
}

/** Returns a work order's visit occurrences within a company, ordered. */
export function getVisitOccurrencesForWorkOrder(
  companyId: string,
  workOrderId: string,
): VisitOccurrence[] {
  return sortVisitOccurrences(
    readVisits().filter(
      (v) => v.companyId === companyId && v.workOrderId === workOrderId,
    ),
  );
}

/** Looks up a single visit occurrence by id, scoped to a company. */
export function getVisitOccurrence(
  companyId: string,
  visitOccurrenceId: string,
): VisitOccurrence | null {
  return (
    readVisits().find(
      (v) => v.id === visitOccurrenceId && v.companyId === companyId,
    ) ?? null
  );
}

/* -------------------------------------------------------------------------- */
/* Mutations (lifecycle status only)                                           */
/* -------------------------------------------------------------------------- */

/**
 * Updates a visit occurrence's lifecycle status. Setting `completed` stamps
 * `updatedAt`. Returns the updated occurrence or null when not found / wrong
 * company.
 */
export function updateVisitOccurrenceStatus(
  companyId: string,
  visitOccurrenceId: string,
  status: VisitOccurrenceStatus,
): VisitOccurrence | null {
  const all = readVisits();
  const target = all.find(
    (v) => v.id === visitOccurrenceId && v.companyId === companyId,
  );
  if (!target) return null;

  const updated: VisitOccurrence = {
    ...target,
    status,
    updatedAt: new Date().toISOString(),
  };
  const next = all.map((v) => (v.id === visitOccurrenceId ? updated : v));
  writeVisits(next);
  mirrorWrite(all, next);
  return updated;
}

/** Cancels a visit occurrence (soft lifecycle transition). */
export function cancelVisitOccurrence(
  companyId: string,
  visitOccurrenceId: string,
): VisitOccurrence | null {
  return updateVisitOccurrenceStatus(companyId, visitOccurrenceId, "cancelled");
}
