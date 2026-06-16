import { beforeEach, describe, expect, it } from "vitest";

import {
  getWorkOrders,
  saveWorkOrders,
  getBookingOccurrenceExceptions,
  saveBookingOccurrenceExceptions,
} from "@/lib/store";
import { makeOccurrenceKey } from "@/types";
import type {
  WorkOrder,
  WorkOrderServiceRow,
  RecurringVariation,
  BookingOccurrenceException,
} from "@/types";
import { localDataLayer } from "./localStorageAdapters";
import { validateWorkOrderParity } from "./workOrderParity";

/**
 * WO-0 validation (P5B). Confirms the localStorage adapter faithfully represents
 * the current Work Order aggregate (parent + service rows + embedded variations
 * + the separate occurrence-exception store), so a later Supabase adapter can be
 * swapped in behind the same contract with confidence.
 *
 * Seeded work orders carry NO service rows at rest (rows are user-created at
 * runtime), so the nested-structure checks build a realistic fixture by adding
 * service rows + an embedded variation to a seeded order and an exception to the
 * separate store, then assert adapter parity against it.
 */
const SEEDED_COMPANY = "cmp_nordlys";

beforeEach(() => {
  localStorage.clear();
});

/** A schedule-critical service row with one embedded variation. */
function makeRow(id: string, sortOrder: number, archived = false): WorkOrderServiceRow {
  const variation: RecurringVariation = {
    id: `${id}-var-1`,
    name: "Every 4th week",
    frequency: "every_n_weeks",
    interval: 4,
    startTime: "08:00",
    endTime: "10:00",
    enabled: true,
    status: "active",
    appliesFrom: "2026-01-01",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  return {
    id,
    serviceName: `Service ${sortOrder}`,
    articleNumber: `ART-${sortOrder}`,
    quantity: 1,
    status: "planned",
    serviceDate: "2026-06-01",
    serviceEndDate: null,
    plannedStartTime: "08:00",
    plannedEndTime: "12:00",
    recurrenceInterval: "weekly",
    assignedEmployeeIds: ["emp_a", "emp_b"],
    unassignedEmployeeSlots: 1,
    variations: [variation],
    sortOrder,
    archived,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** Adds two live rows + one archived row to the first seeded work order. */
function seedWorkOrderWithRows(): { order: WorkOrder; liveRowCount: number } {
  const orders = getWorkOrders();
  const target = orders.find((w) => w.companyId === SEEDED_COMPANY);
  if (!target) throw new Error("expected a seeded work order");
  const withRows: WorkOrder = {
    ...target,
    serviceRows: [makeRow("row-2", 2), makeRow("row-1", 1), makeRow("row-arch", 3, true)],
  };
  saveWorkOrders(orders.map((w) => (w.id === target.id ? withRows : w)));
  return { order: withRows, liveRowCount: 2 };
}

describe("WO-0 parity — validateWorkOrderParity()", () => {
  it("passes for every dimension across all companies (seeded data)", async () => {
    const report = await validateWorkOrderParity();
    for (const check of report.checks) {
      expect(check.notes, `${check.dimension}: ${check.notes.join(", ")}`).toEqual([]);
      expect(check.ok, check.dimension).toBe(true);
    }
    expect(report.ok).toBe(true);
  });

  it("passes with a nested fixture (rows + variation + exception)", async () => {
    const { order } = seedWorkOrderWithRows();
    const exception: BookingOccurrenceException = {
      id: "exc-1",
      occurrenceKey: makeOccurrenceKey("row-1", "2026-06-15"),
      parentServiceRowId: "row-1",
      occurrenceDate: "2026-06-15",
      status: "rescheduled",
      overrideOccurrenceDate: "2026-06-16",
      overrideStartTime: "09:00",
      overrideEndTime: "11:00",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    };
    saveBookingOccurrenceExceptions([exception]);

    const report = await validateWorkOrderParity(SEEDED_COMPANY);
    for (const check of report.checks) {
      expect(check.notes, `${check.dimension}: ${check.notes.join(", ")}`).toEqual([]);
      expect(check.ok, check.dimension).toBe(true);
    }
    // The fixture made the nested checks meaningful.
    expect(report.checks.find((c) => c.dimension === "workOrders.variations")?.sourceCount).toBe(3);
    expect(report.checks.find((c) => c.dimension === "workOrders.exceptions")?.sourceCount).toBe(1);
    // Parity must hold even though companyId === order.companyId.
    expect(order.companyId).toBe(SEEDED_COMPANY);
  });
});

describe("WO-0 adapter — service rows", () => {
  it("returns live rows by default and includes archived on request", async () => {
    const { order, liveRowCount } = seedWorkOrderWithRows();

    const live = await localDataLayer.workOrders.listServiceRows(order.id, {
      companyId: SEEDED_COMPANY,
    });
    expect(live.total).toBe(liveRowCount);

    const all = await localDataLayer.workOrders.listServiceRows(order.id, {
      companyId: SEEDED_COMPANY,
      includeArchived: true,
    });
    expect(all.total).toBe(3);
  });

  it("orders service-row summaries by sortOrder", async () => {
    const { order } = seedWorkOrderWithRows();
    const result = await localDataLayer.workOrders.listServiceRows(order.id, {
      companyId: SEEDED_COMPANY,
      includeArchived: true,
    });
    const orders = result.items.map((r) => r.sortOrder);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it("projects schedule-critical fields and the variation count", async () => {
    const { order } = seedWorkOrderWithRows();
    const result = await localDataLayer.workOrders.listServiceRows(order.id, {
      companyId: SEEDED_COMPANY,
    });
    const row1 = result.items.find((r) => r.id === "row-1");
    expect(row1).toBeDefined();
    expect(row1?.serviceDate).toBe("2026-06-01");
    expect(row1?.recurrenceInterval).toBe("weekly");
    expect(row1?.assignedEmployeeIds).toEqual(["emp_a", "emp_b"]);
    expect(row1?.unassignedEmployeeSlots).toBe(1);
    expect(row1?.variationCount).toBe(1);
  });

  it("enforces company scope (foreign company yields no rows)", async () => {
    const { order } = seedWorkOrderWithRows();
    const blocked = await localDataLayer.workOrders.listServiceRows(order.id, {
      companyId: "cmp_does_not_exist",
    });
    expect(blocked.total).toBe(0);
  });
});

describe("WO-0 adapter — occurrence exceptions", () => {
  it("count equals the separate exception store (unscoped)", async () => {
    const result = await localDataLayer.workOrders.listOccurrenceExceptions();
    expect(result.total).toBe(getBookingOccurrenceExceptions().length);
  });

  it("maps parentServiceRowId to the summary serviceRowId and scopes by company", async () => {
    seedWorkOrderWithRows();
    saveBookingOccurrenceExceptions([
      {
        id: "exc-1",
        occurrenceKey: makeOccurrenceKey("row-1", "2026-06-15"),
        parentServiceRowId: "row-1",
        occurrenceDate: "2026-06-15",
        status: "cancelled",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    ]);
    const scopedRes = await localDataLayer.workOrders.listOccurrenceExceptions({
      companyId: SEEDED_COMPANY,
    });
    expect(scopedRes.total).toBe(1);
    expect(scopedRes.items[0].serviceRowId).toBe("row-1");

    const foreign = await localDataLayer.workOrders.listOccurrenceExceptions({
      companyId: "cmp_does_not_exist",
    });
    expect(foreign.total).toBe(0);
  });
});

describe("WO-0 adapter — work order summaries", () => {
  it("resolves customerDisplayName for seeded work orders", async () => {
    const result = await localDataLayer.workOrders.listSummaries({ companyId: SEEDED_COMPANY });
    expect(result.total).toBeGreaterThan(0);
    for (const summary of result.items) {
      expect(typeof summary.customerDisplayName).toBe("string");
    }
  });
});
