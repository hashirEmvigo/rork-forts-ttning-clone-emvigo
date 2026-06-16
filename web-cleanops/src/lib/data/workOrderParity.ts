/**
 * WO-0 parity validation (development-only).
 *
 * The Work Orders analogue of {@link import("./parity").validateWave0Parity}.
 * Confirms the localStorage adapter faithfully represents the current Work Order
 * aggregate — parent rows, the nested service rows, the embedded variations and
 * the SEPARATE occurrence-exception store — so a later Supabase adapter can be
 * swapped in behind the same contract with confidence.
 *
 * It performs only read operations, mutates nothing, and is exposed on
 * `window.__cleanopsData` in development for manual inspection. No schema, no
 * migration, no UI switch — this is the WO-0 safety net.
 */
import { getWorkOrders, getBookingOccurrenceExceptions } from "@/lib/store";
import { getVariationStatus } from "@/types";
import type { WorkOrderServiceRow } from "@/types";
import { localDataLayer } from "./localStorageAdapters";
import type {
  WorkOrderVariationSummary,
  WorkOrderServiceRowSummary,
} from "./types";

/** Outcome of a single Work Order parity dimension. */
export interface WorkOrderParityCheck {
  dimension: string;
  ok: boolean;
  /** Records counted from the existing store getter (company-scoped). */
  sourceCount: number;
  /** Records produced by the adapter for the same scope. */
  adapterCount: number;
  /** Human-readable notes for any mismatch. */
  notes: string[];
}

export interface WorkOrderParityReport {
  ok: boolean;
  companyId: string | null | undefined;
  checks: WorkOrderParityCheck[];
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

/** Live (non-archived) service rows for one work order. */
function liveRows(rows: WorkOrderServiceRow[] | undefined): WorkOrderServiceRow[] {
  return (rows ?? []).filter((r) => !r.archived);
}

/** The schedule-critical fields a service-row summary MUST carry for the resolver. */
const SCHEDULE_CRITICAL_KEYS: ReadonlyArray<keyof WorkOrderServiceRowSummary> = [
  "status",
  "archived",
  "serviceDate",
  "recurrenceInterval",
  "assignedEmployeeIds",
  "unassignedEmployeeSlots",
];

/**
 * Runs all WO-0 parity checks for an optional company scope. When `companyId`
 * is omitted the comparison runs across all companies; pass an id to validate
 * company scoping specifically.
 */
export async function validateWorkOrderParity(
  companyId?: string | null,
): Promise<WorkOrderParityReport> {
  const checks: WorkOrderParityCheck[] = [];
  const sourceOrders = scoped(getWorkOrders(), companyId);

  // 1 — Parent parity (count / ids / fields / customerDisplayName) ──
  {
    const result = await localDataLayer.workOrders.listSummaries({ companyId });
    const idsMatch = idSetsEqual(
      sourceOrders.map((w) => w.id),
      result.items.map((w) => w.id),
    );
    const notes: string[] = [];
    if (sourceOrders.length !== result.total) notes.push("count mismatch");
    if (!idsMatch) notes.push("id set mismatch");
    for (const w of sourceOrders) {
      const summary = result.items.find((s) => s.id === w.id);
      if (!summary) continue;
      if (
        summary.number !== w.number ||
        summary.status !== w.status ||
        summary.customerId !== w.customerId ||
        summary.companyId !== w.companyId
      ) {
        notes.push(`field mismatch on ${w.id}`);
      }
      if (summary.serviceRowCount !== (w.serviceRows?.length ?? 0)) {
        notes.push(`serviceRowCount mismatch on ${w.id}`);
      }
      // customerDisplayName must be a resolved string field (never undefined).
      if (typeof summary.customerDisplayName !== "string") {
        notes.push(`customerDisplayName missing on ${w.id}`);
      }
    }
    checks.push({
      dimension: "workOrders.parent",
      ok: notes.length === 0,
      sourceCount: sourceOrders.length,
      adapterCount: result.total,
      notes,
    });
  }

  // 2 — Detail parity ──
  {
    const sample = sourceOrders[0];
    const notes: string[] = [];
    if (sample) {
      const detail = await localDataLayer.workOrders.getDetail(sample.id, { companyId });
      if (!detail) notes.push("detail lookup returned null");
      else {
        if (detail.id !== sample.id) notes.push("detail id mismatch");
        if ((detail.serviceRows?.length ?? 0) !== (sample.serviceRows?.length ?? 0)) {
          notes.push("detail serviceRows count mismatch");
        }
      }
    }
    checks.push({
      dimension: "workOrders.detail",
      ok: notes.length === 0,
      sourceCount: sample ? 1 : 0,
      adapterCount: sample ? 1 : 0,
      notes,
    });
  }

  // 3 — Service-row parity (count / ids / schedule-critical fields) ──
  {
    let sourceRowTotal = 0;
    let adapterRowTotal = 0;
    const notes: string[] = [];
    for (const w of sourceOrders) {
      const expected = liveRows(w.serviceRows);
      sourceRowTotal += expected.length;
      const result = await localDataLayer.workOrders.listServiceRows(w.id, { companyId });
      adapterRowTotal += result.total;
      if (result.total !== expected.length) notes.push(`row count mismatch on ${w.id}`);
      if (!idSetsEqual(expected.map((r) => r.id), result.items.map((r) => r.id))) {
        notes.push(`row id mismatch on ${w.id}`);
      }
      for (const r of expected) {
        const summary = result.items.find((s) => s.id === r.id);
        if (!summary) continue;
        if (
          summary.serviceDate !== r.serviceDate ||
          summary.recurrenceInterval !== (r.recurrenceInterval ?? "one_time") ||
          summary.status !== r.status ||
          summary.plannedStartTime !== r.plannedStartTime ||
          summary.plannedEndTime !== r.plannedEndTime ||
          summary.unassignedEmployeeSlots !== (r.unassignedEmployeeSlots ?? 0) ||
          !idSetsEqual(summary.assignedEmployeeIds, r.assignedEmployeeIds ?? []) ||
          summary.variationCount !== (r.variations?.length ?? 0)
        ) {
          notes.push(`row field mismatch on ${r.id}`);
        }
      }
    }
    checks.push({
      dimension: "workOrders.serviceRows",
      ok: notes.length === 0,
      sourceCount: sourceRowTotal,
      adapterCount: adapterRowTotal,
      notes,
    });
  }

  // 4 — Variation parity (count / ids derivable from the embedded arrays) ──
  {
    const expected: WorkOrderVariationSummary[] = [];
    for (const w of sourceOrders) {
      for (const r of w.serviceRows ?? []) {
        for (const v of r.variations ?? []) {
          expected.push({
            id: v.id,
            serviceRowId: r.id,
            workOrderId: w.id,
            companyId: w.companyId,
            name: v.name,
            type: v.type,
            status: getVariationStatus(v),
            frequency: v.frequency,
            appliesFrom: v.appliesFrom,
            appliesUntil: v.appliesUntil,
          });
        }
      }
    }
    // Cross-check the count against the adapter's per-row variationCount sum.
    let adapterVariationTotal = 0;
    for (const w of sourceOrders) {
      const result = await localDataLayer.workOrders.listServiceRows(w.id, {
        companyId,
        includeArchived: true,
      });
      adapterVariationTotal += result.items.reduce((sum, r) => sum + r.variationCount, 0);
    }
    const notes: string[] = [];
    if (adapterVariationTotal !== expected.length) {
      notes.push("variationCount sum != embedded variation total");
    }
    if (expected.some((v) => !v.id || !v.frequency)) {
      notes.push("variation summary missing id/frequency");
    }
    checks.push({
      dimension: "workOrders.variations",
      ok: notes.length === 0,
      sourceCount: expected.length,
      adapterCount: adapterVariationTotal,
      notes,
    });
  }

  // 5 — Exception parity (separate store: count / ids / fields) ──
  {
    // Build the company-scoped expected set the same way the adapter resolves it.
    const rowCompany = new Map<string, string>();
    for (const w of getWorkOrders()) {
      for (const r of w.serviceRows ?? []) rowCompany.set(r.id, w.companyId);
    }
    const allExceptions = getBookingOccurrenceExceptions();
    const expected =
      companyId === undefined
        ? allExceptions
        : allExceptions.filter((e) => rowCompany.get(e.parentServiceRowId) === companyId);
    const result = await localDataLayer.workOrders.listOccurrenceExceptions({ companyId });
    const idsMatch = idSetsEqual(
      expected.map((e) => e.occurrenceKey),
      result.items.map((e) => e.occurrenceKey),
    );
    const notes: string[] = [];
    if (expected.length !== result.total) notes.push("exception count mismatch");
    if (!idsMatch) notes.push("exception occurrenceKey set mismatch");
    for (const e of expected) {
      const summary = result.items.find((s) => s.occurrenceKey === e.occurrenceKey);
      if (!summary) continue;
      if (
        summary.serviceRowId !== e.parentServiceRowId ||
        summary.status !== e.status ||
        summary.occurrenceDate !== e.occurrenceDate
      ) {
        notes.push(`exception field mismatch on ${e.occurrenceKey}`);
      }
    }
    checks.push({
      dimension: "workOrders.exceptions",
      ok: notes.length === 0,
      sourceCount: expected.length,
      adapterCount: result.total,
      notes,
    });
  }

  // 6 — Schedule-critical coverage (the row summary exposes every resolver field) ──
  {
    const notes: string[] = [];
    let sampledRows = 0;
    for (const w of sourceOrders) {
      const result = await localDataLayer.workOrders.listServiceRows(w.id, {
        companyId,
        includeArchived: true,
      });
      for (const summary of result.items) {
        sampledRows += 1;
        for (const key of SCHEDULE_CRITICAL_KEYS) {
          if (summary[key] === undefined) notes.push(`missing ${key} on ${summary.id}`);
        }
        // serviceDate is the required occurrence anchor.
        if (!summary.serviceDate) notes.push(`empty serviceDate on ${summary.id}`);
      }
    }
    checks.push({
      dimension: "workOrders.scheduleCriticalCoverage",
      ok: notes.length === 0,
      sourceCount: sampledRows,
      adapterCount: sampledRows,
      notes,
    });
  }

  return { ok: checks.every((c) => c.ok), companyId, checks };
}

// Expose a console handle in development for manual inspection.
if (import.meta.env.DEV === true && typeof window !== "undefined") {
  const handle = window as unknown as {
    __cleanopsData?: Record<string, unknown>;
  };
  handle.__cleanopsData = {
    ...(handle.__cleanopsData ?? {}),
    validateWorkOrderParity,
  };
}
