/**
 * Work Order export / backout snapshot tooling (P5J · WO-6).
 *
 * Before the Work Order source-of-truth cut-over, we capture a complete,
 * verifiable snapshot of the localStorage work orders so the system always has a
 * documented, executable backout path. Unlike Customers, the Work Order
 * aggregate spans TWO stores, so the snapshot captures both:
 *   • work orders (parent + nested service rows + EMBEDDED variations),
 *   • the SEPARATE occurrence-exception store.
 *
 * The snapshot:
 *   • exports every current localStorage work order + occurrence exception
 *     (lossless),
 *   • stamps an ISO timestamp,
 *   • records per-company work-order counts + the company id set,
 *   • records aggregate service-row, variation and exception totals,
 *   • computes a stable content checksum so two snapshots can be compared and
 *     drift after cut-over is provable.
 *
 * READ-ONLY against localStorage — this never mutates work-order data. The
 * latest snapshot's lightweight META (counts + checksum + timestamp, NOT the
 * full records) is persisted under a dedicated key so the Super Admin monitoring
 * panel can show "last export snapshot" across reloads. The full records live in
 * the returned object (and an in-memory handle) for rollback / debugging.
 */
import { getWorkOrders, getBookingOccurrenceExceptions } from "@/lib/store";
import type { WorkOrder, BookingOccurrenceException } from "@/types";

/** Per-company work-order count within a backout snapshot. */
export interface WorkOrderBackoutCompanyCount {
  companyId: string;
  count: number;
}

/** Lightweight, persistable metadata describing a backout snapshot. */
export interface WorkOrderBackoutMeta {
  /** ISO timestamp the snapshot was taken. */
  at: string;
  /** Total work-order records captured. */
  total: number;
  /** Aggregate nested service rows across all captured work orders. */
  serviceRowTotal: number;
  /** Aggregate embedded variations across all captured service rows. */
  variationTotal: number;
  /** Total occurrence exceptions captured (separate store). */
  exceptionTotal: number;
  /** Per-company work-order counts (sorted by company id). */
  perCompany: WorkOrderBackoutCompanyCount[];
  /** Distinct app-facing company ids present in the snapshot. */
  companyIds: string[];
  /** Stable content checksum over the captured work orders + exceptions. */
  checksum: string;
}

/** A full backout snapshot — META plus the lossless records. */
export interface WorkOrderBackoutSnapshot extends WorkOrderBackoutMeta {
  /** The complete localStorage work-order records at snapshot time. */
  workOrders: WorkOrder[];
  /** The complete localStorage occurrence-exception records at snapshot time. */
  exceptions: BookingOccurrenceException[];
}

/** localStorage key holding the latest snapshot META (not the full records). */
const BACKOUT_META_KEY = "cleanops:workOrders:backout:meta";

/**
 * Stable, order-independent FNV-1a checksum over the work orders + exceptions.
 * Sorting by id first makes the checksum independent of array order, so
 * re-exporting an unchanged dataset yields the same value (drift-revealing,
 * cheap, no crypto).
 */
function checksumWorkOrders(
  workOrders: WorkOrder[],
  exceptions: BookingOccurrenceException[],
): string {
  const orderedWo = [...workOrders].sort((a, b) => a.id.localeCompare(b.id));
  const orderedEx = [...exceptions].sort((a, b) => a.id.localeCompare(b.id));
  const json = JSON.stringify({ wo: orderedWo, ex: orderedEx });
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i += 1) {
    hash ^= json.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts (keeps it in 32-bit range).
    hash = Math.imul(hash, 0x01000193);
  }
  // Unsigned hex, plus the record counts as a guard against same-hash collisions.
  return `${(hash >>> 0).toString(16).padStart(8, "0")}-${workOrders.length}-${exceptions.length}`;
}

function perCompanyCounts(workOrders: WorkOrder[]): WorkOrderBackoutCompanyCount[] {
  const counts = new Map<string, number>();
  for (const w of workOrders) {
    counts.set(w.companyId, (counts.get(w.companyId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([companyId, count]) => ({ companyId, count }))
    .sort((a, b) => a.companyId.localeCompare(b.companyId));
}

function countServiceRows(workOrders: WorkOrder[]): number {
  return workOrders.reduce((sum, w) => sum + (w.serviceRows?.length ?? 0), 0);
}

function countVariations(workOrders: WorkOrder[]): number {
  return workOrders.reduce(
    (sum, w) =>
      sum + (w.serviceRows ?? []).reduce((s, r) => s + (r.variations?.length ?? 0), 0),
    0,
  );
}

/**
 * Scopes the occurrence-exception store to a company via each exception's parent
 * service row's owning work order (exceptions carry no companyId of their own —
 * exactly like the migration tool + dual-write mirror).
 */
function scopeExceptions(
  exceptions: BookingOccurrenceException[],
  workOrders: WorkOrder[],
  companyId: string | null,
): BookingOccurrenceException[] {
  if (companyId === null) return exceptions;
  const rowCompany = new Map<string, string>();
  for (const w of workOrders) {
    for (const r of w.serviceRows ?? []) rowCompany.set(r.id, w.companyId);
  }
  return exceptions.filter((e) => rowCompany.get(e.parentServiceRowId) === companyId);
}

/** In-memory handle to the most recent full snapshot (records included). */
let lastSnapshot: WorkOrderBackoutSnapshot | null = null;

/**
 * Captures a backout snapshot of the current localStorage work orders + the
 * separate occurrence-exception store.
 *
 * @param options.companyId Restrict the snapshot to a single app-facing company.
 * @param options.persistMeta When true (default), writes the lightweight META to
 *   localStorage so the monitoring panel can read it after a reload.
 */
export function exportWorkOrderBackout(options?: {
  companyId?: string | null;
  persistMeta?: boolean;
}): WorkOrderBackoutSnapshot {
  const companyId = options?.companyId ?? null;
  const persistMeta = options?.persistMeta ?? true;

  const allWorkOrders = getWorkOrders();
  const allExceptions = getBookingOccurrenceExceptions();
  const workOrders =
    companyId === null ? allWorkOrders : allWorkOrders.filter((w) => w.companyId === companyId);
  const exceptions = scopeExceptions(allExceptions, allWorkOrders, companyId);
  const perCompany = perCompanyCounts(workOrders);

  const snapshot: WorkOrderBackoutSnapshot = {
    at: new Date().toISOString(),
    total: workOrders.length,
    serviceRowTotal: countServiceRows(workOrders),
    variationTotal: countVariations(workOrders),
    exceptionTotal: exceptions.length,
    perCompany,
    companyIds: perCompany.map((p) => p.companyId),
    checksum: checksumWorkOrders(workOrders, exceptions),
    workOrders,
    exceptions,
  };

  lastSnapshot = snapshot;

  if (persistMeta && typeof localStorage !== "undefined") {
    const meta: WorkOrderBackoutMeta = {
      at: snapshot.at,
      total: snapshot.total,
      serviceRowTotal: snapshot.serviceRowTotal,
      variationTotal: snapshot.variationTotal,
      exceptionTotal: snapshot.exceptionTotal,
      perCompany: snapshot.perCompany,
      companyIds: snapshot.companyIds,
      checksum: snapshot.checksum,
    };
    try {
      localStorage.setItem(BACKOUT_META_KEY, JSON.stringify(meta));
    } catch {
      // Persisting the META is best-effort; the snapshot is still returned.
    }
  }

  return snapshot;
}

/** Returns the in-memory full snapshot from this session, if one was taken. */
export function getLastWorkOrderBackout(): WorkOrderBackoutSnapshot | null {
  return lastSnapshot;
}

/** Reads the persisted lightweight META (survives reloads), or null. */
export function getWorkOrderBackoutMeta(): WorkOrderBackoutMeta | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(BACKOUT_META_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WorkOrderBackoutMeta;
  } catch {
    return null;
  }
}

/**
 * Re-checksums the CURRENT localStorage work orders + exceptions and compares
 * against a prior snapshot's checksum — proves whether localStorage has diverged
 * since the snapshot (e.g. after a cut-over period). Used by the post-cut-over
 * validation and the rollback drill.
 */
export function verifyWorkOrderBackout(
  snapshot: WorkOrderBackoutMeta,
  options?: { companyId?: string | null },
): {
  matches: boolean;
  currentChecksum: string;
  currentTotal: number;
  currentExceptionTotal: number;
} {
  const companyId = options?.companyId ?? null;
  const allWorkOrders = getWorkOrders();
  const allExceptions = getBookingOccurrenceExceptions();
  const workOrders =
    companyId === null ? allWorkOrders : allWorkOrders.filter((w) => w.companyId === companyId);
  const exceptions = scopeExceptions(allExceptions, allWorkOrders, companyId);
  const currentChecksum = checksumWorkOrders(workOrders, exceptions);
  return {
    matches: currentChecksum === snapshot.checksum,
    currentChecksum,
    currentTotal: workOrders.length,
    currentExceptionTotal: exceptions.length,
  };
}

// Expose console handles in development for manual export / verification.
// Merges with the handles already attached by the other data-layer modules.
if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    exportWorkOrderBackout,
    getLastWorkOrderBackout,
    getWorkOrderBackoutMeta,
    verifyWorkOrderBackout,
  };
}
