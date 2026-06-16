import { describe, expect, it } from "vitest";

import { checkAreaScopedAccessActivation } from "./areaScopeActivation";
import type { Area, Customer, WorkOrder, WorkOrderServiceRow } from "@/types";

/**
 * Verifies the activation pre-check that gates Area Scoped Access: the feature
 * may only be enabled once every operationally active customer resolves to an
 * area. Inactive customers without future operational data must never block.
 */

const COMPANY = "cmp_nordlys";
const NOW = new Date("2026-06-01T00:00:00.000Z");

const areas: Area[] = [
  { id: "area_gbg", companyId: COMPANY, name: "Gothenburg", isActive: true, createdAt: "", updatedAt: "" },
];

function customer(over: Partial<Customer>): Customer {
  return {
    id: "c",
    companyId: COMPANY,
    name: "Cust",
    customerNumber: "C-1",
    email: "a@b.c",
    status: "active",
    userIds: [],
    createdAt: "",
    ...over,
  };
}

function row(over: Partial<WorkOrderServiceRow>): WorkOrderServiceRow {
  return {
    id: "r",
    serviceName: "Cleaning",
    quantity: 1,
    status: "planned",
    serviceDate: "2026-06-10",
    assignedEmployeeIds: [],
    unassignedEmployeeSlots: 0,
    sortOrder: 0,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

function workOrder(over: Partial<WorkOrder>): WorkOrder {
  return {
    id: "wo",
    companyId: COMPANY,
    customerId: "c",
    number: "WO-1",
    status: "planned",
    serviceRows: [],
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

function check(customers: Customer[], workOrders: WorkOrder[] = []) {
  return checkAreaScopedAccessActivation({ customers, workOrders, areas, now: NOW });
}

describe("checkAreaScopedAccessActivation", () => {
  it("allows activation when all active customers have an areaId", () => {
    const result = check([
      customer({ id: "c1", areaId: "area_gbg" }),
      customer({ id: "c2", areaId: "area_gbg" }),
    ]);
    expect(result.canEnable).toBe(true);
    expect(result.blockingCustomers).toEqual([]);
    expect(result.counts.blocking).toBe(0);
  });

  it("allows activation when a legacy free-text area resolves to a real area", () => {
    const result = check([customer({ id: "c1", area: "Gothenburg" })]);
    expect(result.canEnable).toBe(true);
  });

  it("blocks activation when an active customer has no area", () => {
    const result = check([customer({ id: "c1", status: "active" })]);
    expect(result.canEnable).toBe(false);
    expect(result.blockingCustomers).toEqual([
      { customerId: "c1", customerName: "Cust", reasons: ["active_customer"] },
    ]);
    expect(result.counts.activeCustomers).toBe(1);
  });

  it("does not block on an inactive customer with no operational data", () => {
    const result = check([customer({ id: "c1", status: "inactive" })]);
    expect(result.canEnable).toBe(true);
  });

  it("blocks an inactive customer that has an active service", () => {
    const result = check(
      [customer({ id: "c1", status: "inactive" })],
      [workOrder({ customerId: "c1", serviceRows: [row({ status: "in_progress" })] })],
    );
    expect(result.canEnable).toBe(false);
    expect(result.blockingCustomers[0].reasons).toContain("active_service");
    expect(result.counts.activeServices).toBe(1);
  });

  it("blocks an inactive customer that has a future booking", () => {
    const result = check(
      [customer({ id: "c1", status: "inactive" })],
      [
        workOrder({
          customerId: "c1",
          serviceRows: [row({ status: "planned", serviceDate: "2026-12-01" })],
        }),
      ],
    );
    expect(result.canEnable).toBe(false);
    expect(result.blockingCustomers[0].reasons).toContain("future_booking");
    expect(result.counts.futureBookings).toBe(1);
  });

  it("treats an open-ended recurring row as a future booking", () => {
    const result = check(
      [customer({ id: "c1", status: "inactive" })],
      [
        workOrder({
          customerId: "c1",
          serviceRows: [
            row({
              status: "planned",
              serviceDate: "2025-01-01",
              recurrenceInterval: "weekly",
              serviceEndDate: null,
            }),
          ],
        }),
      ],
    );
    expect(result.canEnable).toBe(false);
    expect(result.blockingCustomers[0].reasons).toContain("future_booking");
  });

  it("does not block an inactive customer whose only service is completed in the past", () => {
    const result = check(
      [customer({ id: "c1", status: "inactive" })],
      [
        workOrder({
          customerId: "c1",
          serviceRows: [row({ status: "completed", serviceDate: "2025-01-01" })],
        }),
      ],
    );
    expect(result.canEnable).toBe(true);
  });

  it("ignores service rows on inactive work orders", () => {
    const result = check(
      [customer({ id: "c1", status: "inactive" })],
      [
        workOrder({
          customerId: "c1",
          status: "inactive",
          serviceRows: [row({ status: "planned", serviceDate: "2026-12-01" })],
        }),
      ],
    );
    expect(result.canEnable).toBe(true);
  });

  it("reports each blocking customer once with all reasons", () => {
    const result = check(
      [customer({ id: "c1", status: "active" })],
      [
        workOrder({
          customerId: "c1",
          serviceRows: [row({ status: "planned", serviceDate: "2026-12-01" })],
        }),
      ],
    );
    expect(result.blockingCustomers).toHaveLength(1);
    expect(result.blockingCustomers[0].reasons).toEqual([
      "active_customer",
      "active_service",
      "future_booking",
    ]);
  });
});
