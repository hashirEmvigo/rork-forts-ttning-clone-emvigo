/**
 * Wave 0 parity validation (development-only).
 *
 * Confirms the localStorage adapters return exactly what the existing store
 * getters return — same count, same ids (company-scoped), same key summary
 * fields, and a working detail lookup. This is the safety net that lets later
 * waves swap in a Supabase adapter with confidence: a future "shadow read" can
 * reuse the same comparison to diff server vs local results before cut-over.
 *
 * There is no test harness wired for these adapters yet, so this ships as a
 * callable dev utility. It performs only read operations, mutates nothing, and
 * is exposed on `window.__cleanopsData` in development for manual inspection.
 */
import {
  getCustomers,
  getEmployees,
  getWorkOrders,
  getBookingQueue,
  getAuditEvents,
  getTimeReports,
} from "@/lib/store";
import { localDataLayer } from "./localStorageAdapters";

/** Outcome of a single entity's parity comparison. */
export interface ParityCheck {
  entity: string;
  /** True when every assertion below passed. */
  ok: boolean;
  /** Records from the existing getter (company-scoped, if a company was given). */
  getterCount: number;
  /** Summaries from the adapter for the same scope. */
  adapterCount: number;
  /** True when the id sets match exactly. */
  idsMatch: boolean;
  /** True when spot-checked summary fields match the source record. */
  fieldsMatch: boolean;
  /** True when getDetail returns the expected record for a sample id. */
  detailMatch: boolean;
  /** Human-readable notes for any mismatch. */
  notes: string[];
}

export interface ParityReport {
  ok: boolean;
  companyId: string | null | undefined;
  checks: ParityCheck[];
}

function idSetsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

function scoped<T extends { companyId: string | null }>(
  items: T[],
  companyId: string | null | undefined,
): T[] {
  return companyId === undefined ? items : items.filter((i) => i.companyId === companyId);
}

/**
 * Runs all Wave 0 parity checks for an optional company scope. When `companyId`
 * is omitted the comparison runs across all companies; pass an id to validate
 * company scoping specifically.
 */
export async function validateWave0Parity(
  companyId?: string | null,
): Promise<ParityReport> {
  const checks: ParityCheck[] = [];

  // Customers ──
  {
    const source = scoped(getCustomers(), companyId);
    const result = await localDataLayer.customers.listSummaries({ companyId });
    const idsMatch = idSetsEqual(source.map((c) => c.id), result.items.map((c) => c.id));
    const sample = source[0];
    const sampleSummary = sample
      ? result.items.find((c) => c.id === sample.id)
      : undefined;
    const fieldsMatch = !sample
      ? true
      : Boolean(
          sampleSummary &&
            sampleSummary.name === sample.name &&
            sampleSummary.customerNumber === sample.customerNumber &&
            sampleSummary.status === sample.status,
        );
    let detailMatch = true;
    if (sample) {
      const detail = await localDataLayer.customers.getDetail(sample.id, { companyId });
      detailMatch = detail?.id === sample.id;
    }
    const notes: string[] = [];
    if (source.length !== result.total) notes.push("count mismatch");
    if (!idsMatch) notes.push("id set mismatch");
    if (!fieldsMatch) notes.push("summary field mismatch");
    if (!detailMatch) notes.push("detail lookup mismatch");
    checks.push({
      entity: "customers",
      ok: source.length === result.total && idsMatch && fieldsMatch && detailMatch,
      getterCount: source.length,
      adapterCount: result.total,
      idsMatch,
      fieldsMatch,
      detailMatch,
      notes,
    });
  }

  // Employees ──
  {
    const source = scoped(getEmployees(), companyId);
    const result = await localDataLayer.employees.listSummaries({ companyId });
    const idsMatch = idSetsEqual(source.map((e) => e.id), result.items.map((e) => e.id));
    const sample = source[0];
    const sampleSummary = sample ? result.items.find((e) => e.id === sample.id) : undefined;
    const fieldsMatch = !sample
      ? true
      : Boolean(
          sampleSummary &&
            sampleSummary.name === sample.name &&
            sampleSummary.teamCount === sample.teamIds.length,
        );
    let detailMatch = true;
    if (sample) {
      const detail = await localDataLayer.employees.getDetail(sample.id, { companyId });
      detailMatch = detail?.id === sample.id;
    }
    const notes: string[] = [];
    if (source.length !== result.total) notes.push("count mismatch");
    if (!idsMatch) notes.push("id set mismatch");
    if (!fieldsMatch) notes.push("summary field mismatch");
    if (!detailMatch) notes.push("detail lookup mismatch");
    checks.push({
      entity: "employees",
      ok: source.length === result.total && idsMatch && fieldsMatch && detailMatch,
      getterCount: source.length,
      adapterCount: result.total,
      idsMatch,
      fieldsMatch,
      detailMatch,
      notes,
    });
  }

  // Work Orders ──
  {
    const source = scoped(getWorkOrders(), companyId);
    const result = await localDataLayer.workOrders.listSummaries({ companyId });
    const idsMatch = idSetsEqual(source.map((w) => w.id), result.items.map((w) => w.id));
    const sample = source[0];
    const sampleSummary = sample ? result.items.find((w) => w.id === sample.id) : undefined;
    const fieldsMatch = !sample
      ? true
      : Boolean(
          sampleSummary &&
            sampleSummary.number === sample.number &&
            sampleSummary.serviceRowCount === (sample.serviceRows?.length ?? 0),
        );
    let detailMatch = true;
    if (sample) {
      const detail = await localDataLayer.workOrders.getDetail(sample.id, { companyId });
      detailMatch = detail?.id === sample.id;
    }
    const notes: string[] = [];
    if (source.length !== result.total) notes.push("count mismatch");
    if (!idsMatch) notes.push("id set mismatch");
    if (!fieldsMatch) notes.push("summary field mismatch");
    if (!detailMatch) notes.push("detail lookup mismatch");
    checks.push({
      entity: "workOrders",
      ok: source.length === result.total && idsMatch && fieldsMatch && detailMatch,
      getterCount: source.length,
      adapterCount: result.total,
      idsMatch,
      fieldsMatch,
      detailMatch,
      notes,
    });
  }

  // Schedule (booking queue) ──
  {
    const source = scoped(getBookingQueue(), companyId);
    const result = await localDataLayer.schedule.listSummaries({ companyId });
    const idsMatch = idSetsEqual(source.map((b) => b.id), result.items.map((s) => s.visitId));
    const notes: string[] = [];
    if (source.length !== result.total) notes.push("count mismatch");
    if (!idsMatch) notes.push("id set mismatch");
    checks.push({
      entity: "schedule",
      ok: source.length === result.total && idsMatch,
      getterCount: source.length,
      adapterCount: result.total,
      idsMatch,
      fieldsMatch: true,
      detailMatch: true,
      notes,
    });
  }

  // Activity Log ──
  {
    const source = scoped(getAuditEvents(), companyId);
    const result = await localDataLayer.activityLog.listSummaries({ companyId });
    const idsMatch = idSetsEqual(source.map((e) => e.id), result.items.map((e) => e.id));
    const notes: string[] = [];
    if (source.length !== result.total) notes.push("count mismatch");
    if (!idsMatch) notes.push("id set mismatch");
    checks.push({
      entity: "activityLog",
      ok: source.length === result.total && idsMatch,
      getterCount: source.length,
      adapterCount: result.total,
      idsMatch,
      fieldsMatch: true,
      detailMatch: true,
      notes,
    });
  }

  // Time Reports ──
  {
    const source = scoped(getTimeReports(), companyId);
    const result = await localDataLayer.timeReports.listSummaries({ companyId });
    const idsMatch = idSetsEqual(source.map((r) => r.id), result.items.map((r) => r.id));
    const notes: string[] = [];
    if (source.length !== result.total) notes.push("count mismatch");
    if (!idsMatch) notes.push("id set mismatch");
    checks.push({
      entity: "timeReports",
      ok: source.length === result.total && idsMatch,
      getterCount: source.length,
      adapterCount: result.total,
      idsMatch,
      fieldsMatch: true,
      detailMatch: true,
      notes,
    });
  }

  return { ok: checks.every((c) => c.ok), companyId, checks };
}

// Expose a console handle in development for manual inspection.
if (import.meta.env.DEV === true && typeof window !== "undefined") {
  (
    window as unknown as { __cleanopsData: { validateWave0Parity: typeof validateWave0Parity } }
  ).__cleanopsData = { validateWave0Parity };
}
