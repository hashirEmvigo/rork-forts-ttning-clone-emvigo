/**
 * Customer export / backout snapshot tooling (P4J · Wave 1F).
 *
 * Before the Customer source-of-truth cut-over, we capture a complete,
 * verifiable snapshot of the localStorage customers so the system always has a
 * documented, executable backout path. The snapshot:
 *   • exports every current localStorage customer record (lossless),
 *   • stamps an ISO timestamp,
 *   • records per-company record counts + the company id set,
 *   • computes a stable content checksum so two snapshots can be compared and
 *     drift after cut-over is provable.
 *
 * READ-ONLY against localStorage — this never mutates customer data. The latest
 * snapshot's lightweight META (counts + checksum + timestamp, NOT the full
 * records) is persisted under a dedicated key so the Super Admin monitoring
 * panel can show "last export snapshot" across reloads. The full records live in
 * the returned object (and an in-memory handle) for rollback / debugging.
 */
import { getCustomers } from "@/lib/store";
import type { Customer } from "@/types";

/** Per-company record count within a backout snapshot. */
export interface CustomerBackoutCompanyCount {
  companyId: string;
  count: number;
}

/** Lightweight, persistable metadata describing a backout snapshot. */
export interface CustomerBackoutMeta {
  /** ISO timestamp the snapshot was taken. */
  at: string;
  /** Total customer records captured. */
  total: number;
  /** Per-company record counts (sorted by company id). */
  perCompany: CustomerBackoutCompanyCount[];
  /** Distinct app-facing company ids present in the snapshot. */
  companyIds: string[];
  /** Stable content checksum over the captured records. */
  checksum: string;
}

/** A full backout snapshot — META plus the lossless customer records. */
export interface CustomerBackoutSnapshot extends CustomerBackoutMeta {
  /** The complete localStorage customer records at snapshot time. */
  records: Customer[];
}

/** localStorage key holding the latest snapshot META (not the full records). */
const BACKOUT_META_KEY = "cleanops:customers:backout:meta";

/**
 * Stable, order-independent FNV-1a checksum over the customer records. Sorting
 * by id first makes the checksum independent of array order, so re-exporting an
 * unchanged dataset yields the same value (drift-revealing, cheap, no crypto).
 */
function checksumCustomers(customers: Customer[]): string {
  const ordered = [...customers].sort((a, b) => a.id.localeCompare(b.id));
  const json = JSON.stringify(ordered);
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i += 1) {
    hash ^= json.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts (keeps it in 32-bit range).
    hash = Math.imul(hash, 0x01000193);
  }
  // Unsigned hex, plus the record count as a guard against same-hash collisions.
  return `${(hash >>> 0).toString(16).padStart(8, "0")}-${customers.length}`;
}

function perCompanyCounts(customers: Customer[]): CustomerBackoutCompanyCount[] {
  const counts = new Map<string, number>();
  for (const c of customers) {
    counts.set(c.companyId, (counts.get(c.companyId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([companyId, count]) => ({ companyId, count }))
    .sort((a, b) => a.companyId.localeCompare(b.companyId));
}

/** In-memory handle to the most recent full snapshot (records included). */
let lastSnapshot: CustomerBackoutSnapshot | null = null;

/**
 * Captures a backout snapshot of the current localStorage customers.
 *
 * @param options.companyId Restrict the snapshot to a single app-facing company.
 * @param options.persistMeta When true (default), writes the lightweight META to
 *   localStorage so the monitoring panel can read it after a reload.
 */
export function exportCustomerBackout(options?: {
  companyId?: string | null;
  persistMeta?: boolean;
}): CustomerBackoutSnapshot {
  const companyId = options?.companyId ?? null;
  const persistMeta = options?.persistMeta ?? true;

  const all = getCustomers();
  const records = companyId === null ? all : all.filter((c) => c.companyId === companyId);
  const perCompany = perCompanyCounts(records);

  const snapshot: CustomerBackoutSnapshot = {
    at: new Date().toISOString(),
    total: records.length,
    perCompany,
    companyIds: perCompany.map((p) => p.companyId),
    checksum: checksumCustomers(records),
    records,
  };

  lastSnapshot = snapshot;

  if (persistMeta && typeof localStorage !== "undefined") {
    const meta: CustomerBackoutMeta = {
      at: snapshot.at,
      total: snapshot.total,
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
export function getLastCustomerBackout(): CustomerBackoutSnapshot | null {
  return lastSnapshot;
}

/** Reads the persisted lightweight META (survives reloads), or null. */
export function getCustomerBackoutMeta(): CustomerBackoutMeta | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(BACKOUT_META_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CustomerBackoutMeta;
  } catch {
    return null;
  }
}

/**
 * Re-checksums the CURRENT localStorage customers and compares against a prior
 * snapshot's checksum — proves whether localStorage has diverged since the
 * snapshot (e.g. after a cut-over period). Used by the post-cut-over validation
 * and the rollback drill.
 */
export function verifyCustomerBackout(
  snapshot: CustomerBackoutMeta,
  options?: { companyId?: string | null },
): { matches: boolean; currentChecksum: string; currentTotal: number } {
  const companyId = options?.companyId ?? null;
  const all = getCustomers();
  const records = companyId === null ? all : all.filter((c) => c.companyId === companyId);
  const currentChecksum = checksumCustomers(records);
  return {
    matches: currentChecksum === snapshot.checksum,
    currentChecksum,
    currentTotal: records.length,
  };
}

// Expose console handles in development for manual export / verification.
// Merges with the handles already attached by the other data-layer modules.
if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const w = window as unknown as { __cleanopsData?: Record<string, unknown> };
  w.__cleanopsData = {
    ...(w.__cleanopsData ?? {}),
    exportCustomerBackout,
    getLastCustomerBackout,
    getCustomerBackoutMeta,
    verifyCustomerBackout,
  };
}
