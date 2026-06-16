import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  serviceSelect: vi.fn(),
  serviceEq: vi.fn(),
  serviceMaybeSingle: vi.fn(),
  parentSelect: vi.fn(),
  parentEq: vi.fn(),
  parentMaybeSingle: vi.fn(),
  rowSelect: vi.fn(),
  rowWorkOrderEq: vi.fn(),
  rowCompanyEq: vi.fn(),
  loadCompanyUuidMap: vi.fn(),
  makeId: vi.fn(),
  saveWorkOrders: vi.fn(),
  mirrorWorkOrderWrites: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: mocks.from,
    rpc: mocks.rpc,
  },
}));

vi.mock("@/lib/store", () => ({
  makeId: mocks.makeId,
  saveWorkOrders: mocks.saveWorkOrders,
}));

vi.mock("./customerMigration", () => ({
  loadCompanyUuidMap: mocks.loadCompanyUuidMap,
}));

vi.mock("@/lib/data/workOrderDualWrite", () => ({
  mirrorWorkOrderWrites: mocks.mirrorWorkOrderWrites,
}));

import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveWorkOrders } from "@/lib/store";
import { mirrorWorkOrderWrites } from "@/lib/data/workOrderDualWrite";
import {
  addWorkOrderServiceRowInSupabase,
  archiveWorkOrderServiceRowInSupabase,
  removeWorkOrderServiceRowInSupabase,
  rescheduleOneTimeServiceRowInSupabase,
  restoreWorkOrderServiceRowInSupabase,
  verifyAddedWorkOrderServiceRowReadableFromSupabase,
  verifyRemovedWorkOrderServiceRowReadableFromSupabase,
  verifyUpdatedWorkOrderServiceRowReadableFromSupabase,
} from "./supabaseWorkOrderRepository";

const COMPANY = "cmp_stad";
const COMPANY_UUID = "00000000-0000-4000-8000-000000000101";
const WORK_ORDER_ID = "wo_1";
const SERVICE_ID = "svc_1";

const parentOrder = {
  id: WORK_ORDER_ID,
  companyId: COMPANY,
  customerId: "cust_1",
  number: "WO-1001",
  status: "draft",
  notes: [],
  serviceRows: [],
  activity: [],
  mediaPlacements: [],
  createdAt: "2026-06-05T00:00:00.000Z",
  updatedAt: "2026-06-05T00:00:00.000Z",
} as const;

function serviceRow() {
  return {
    id: "worow_generated",
    sourceServiceId: SERVICE_ID,
    serviceName: "Deep Clean",
    articleNumber: "A-10",
    categoryName: "Cleaning",
    serviceType: "Cleaning",
    quantity: 2,
    unit: "hour",
    price: 500,
    vat: 25,
    status: "planned" as const,
    notes: "Bring supplies",
    serviceDate: "2026-06-10",
    serviceEndDate: undefined,
    plannedStartTime: "09:00",
    plannedEndTime: "11:00",
    assignedEmployeeIds: ["emp_1"],
    unassignedEmployeeSlots: 1,
    recurrenceInterval: "one_time" as const,
    sortOrder: 0,
    archived: false,
    createdAt: expect.any(String),
    updatedAt: expect.any(String),
  };
}

function flatServiceRowReadRow(row = serviceRow(), overrides: Record<string, unknown> = {}) {
  return {
    data: row,
    legacy_id: row.id,
    company_legacy_id: COMPANY,
    work_order_legacy_id: WORK_ORDER_ID,
    service_name: row.serviceName,
    article_number: row.articleNumber ?? null,
    status: row.status,
    archived: Boolean(row.archived),
    service_date: row.serviceDate ?? null,
    service_end_date: row.serviceEndDate ?? null,
    planned_start_time: row.plannedStartTime ?? null,
    planned_end_time: row.plannedEndTime ?? null,
    recurrence_interval: row.recurrenceInterval ?? "one_time",
    assigned_employee_ids: row.assignedEmployeeIds ?? [],
    unassigned_employee_slots: row.unassignedEmployeeSlots ?? 0,
    sort_order: row.sortOrder ?? 0,
    variation_count: 0,
    deleted_at: null,
    updated_at: "2026-06-05T00:00:00.000Z",
    ...overrides,
  };
}

function setupSupabaseTables(row = serviceRow()): void {
  mocks.from.mockImplementation((table: string) => {
    if (table === "services") return { select: mocks.serviceSelect };
    if (table === "work_orders") return { select: mocks.parentSelect };
    if (table === "work_order_service_rows") return { select: mocks.rowSelect };
    throw new Error(`Unexpected table ${table}`);
  });

  mocks.serviceSelect.mockReturnValue({ eq: mocks.serviceEq });
  mocks.serviceEq.mockReturnValue({ maybeSingle: mocks.serviceMaybeSingle });

  mocks.parentSelect.mockReturnValue({ eq: mocks.parentEq });
  mocks.parentEq.mockReturnValue({ maybeSingle: mocks.parentMaybeSingle });

  mocks.rowSelect.mockReturnValue({ eq: mocks.rowWorkOrderEq });
  mocks.rowWorkOrderEq.mockReturnValue({ eq: mocks.rowCompanyEq });
  mocks.rowCompanyEq.mockResolvedValue({
    data: [flatServiceRowReadRow(row)],
    error: null,
  });
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) {
    mock.mockReset();
  }
  const row = serviceRow();
  setupSupabaseTables(row);
  mocks.loadCompanyUuidMap.mockResolvedValue(new Map([[COMPANY, COMPANY_UUID]]));
  mocks.makeId.mockImplementation((prefix: string) => `${prefix}_generated`);
  mocks.serviceMaybeSingle.mockResolvedValue({
    data: { company_legacy_id: COMPANY, deleted_at: null },
    error: null,
  });
  const updatedParent = { ...parentOrder, serviceRows: [row], updatedAt: "2026-06-05T01:00:00.000Z" };
  mocks.rpc.mockResolvedValue({
    data: { workOrder: updatedParent, serviceRow: row, serviceRowCount: 1, generatedBookingCount: 1 },
    error: null,
  });
  mocks.parentMaybeSingle.mockResolvedValue({
    data: {
      data: updatedParent,
      company_legacy_id: COMPANY,
      service_row_count: 1,
      deleted_at: null,
    },
    error: null,
  });
});

describe("CORE-WRITES-WORKORDERS-A1.2.1 Supabase service-row RPC repository", () => {
  it("adds one service row and requires generated booking ledger rows through the transactional RPC", async () => {
    const localGetSpy = vi.spyOn(Storage.prototype, "getItem");
    const localSetSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");

    const result = await addWorkOrderServiceRowInSupabase({
      companyId: COMPANY,
      workOrderId: WORK_ORDER_ID,
      sourceServiceId: SERVICE_ID,
      serviceName: " Deep Clean ",
      articleNumber: " A-10 ",
      categoryName: " Cleaning ",
      serviceType: " Cleaning ",
      quantity: 2,
      unit: " hour ",
      price: 500,
      vat: 25,
      status: "planned",
      notes: " Bring supplies ",
      serviceDate: "2026-06-10",
      serviceEndDate: null,
      plannedStartTime: "09:00",
      plannedEndTime: "11:00",
      assignedEmployeeIds: ["emp_1"],
      unassignedEmployeeSlots: 1,
      recurrenceInterval: "one_time",
    });

    expect(mocks.from).toHaveBeenCalledWith("services");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("add_work_order_service_row", {
      input: {
        company_id: COMPANY_UUID,
        company_legacy_id: COMPANY,
        work_order_legacy_id: WORK_ORDER_ID,
        row: expect.objectContaining({
          id: "worow_generated",
          sourceServiceId: SERVICE_ID,
          serviceName: "Deep Clean",
          articleNumber: "A-10",
          categoryName: "Cleaning",
          serviceType: "Cleaning",
          quantity: 2,
          unit: "hour",
          price: 500,
          vat: 25,
          status: "planned",
          notes: "Bring supplies",
          serviceDate: "2026-06-10",
          plannedStartTime: "09:00",
          plannedEndTime: "11:00",
          assignedEmployeeIds: ["emp_1"],
          unassignedEmployeeSlots: 1,
          recurrenceInterval: "one_time",
          sortOrder: 0,
          archived: false,
        }),
      },
    });
    expect(result.serviceRow.id).toBe("worow_generated");
    expect(result.serviceRowCount).toBe(1);
    expect(result.generatedBookingCount).toBe(1);
    expect(saveWorkOrders).not.toHaveBeenCalled();
    expect(mirrorWorkOrderWrites).not.toHaveBeenCalled();
    expect(localGetSpy).not.toHaveBeenCalled();
    expect(localSetSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();

    localGetSpy.mockRestore();
    localSetSpy.mockRestore();
    sessionGetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("fails closed before RPC when company/work-order/service scope is missing", async () => {
    await expect(
      addWorkOrderServiceRowInSupabase({
        companyId: " ",
        workOrderId: WORK_ORDER_ID,
        sourceServiceId: SERVICE_ID,
        serviceName: "Deep Clean",
        quantity: 1,
        status: "planned",
        serviceDate: "2026-06-10",
      }),
    ).rejects.toThrow(/company context/i);

    await expect(
      addWorkOrderServiceRowInSupabase({
        companyId: COMPANY,
        workOrderId: " ",
        sourceServiceId: SERVICE_ID,
        serviceName: "Deep Clean",
        quantity: 1,
        status: "planned",
        serviceDate: "2026-06-10",
      }),
    ).rejects.toThrow(/work order id/i);

    await expect(
      addWorkOrderServiceRowInSupabase({
        companyId: COMPANY,
        workOrderId: WORK_ORDER_ID,
        sourceServiceId: " ",
        serviceName: "Deep Clean",
        quantity: 1,
        status: "planned",
        serviceDate: "2026-06-10",
      }),
    ).rejects.toThrow(/selected service id/i);

    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("fails closed when the selected service belongs to another company", async () => {
    mocks.serviceMaybeSingle.mockResolvedValueOnce({
      data: { company_legacy_id: "cmp_other", deleted_at: null },
      error: null,
    });

    await expect(
      addWorkOrderServiceRowInSupabase({
        companyId: COMPANY,
        workOrderId: WORK_ORDER_ID,
        sourceServiceId: SERVICE_ID,
        serviceName: "Deep Clean",
        quantity: 1,
        status: "planned",
        serviceDate: "2026-06-10",
      }),
    ).rejects.toThrow(/target company scope/i);

    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns a controlled failure on Supabase add RPC errors without local recovery", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "TEST RLS blocked add" },
    });

    await expect(
      addWorkOrderServiceRowInSupabase({
        companyId: COMPANY,
        workOrderId: WORK_ORDER_ID,
        sourceServiceId: SERVICE_ID,
        serviceName: "Deep Clean",
        quantity: 1,
        status: "planned",
        serviceDate: "2026-06-10",
      }),
    ).rejects.toThrow("[workOrders] Supabase add-service RPC failed: TEST RLS blocked add");

    expect(saveWorkOrders).not.toHaveBeenCalled();
    expect(mirrorWorkOrderWrites).not.toHaveBeenCalled();
  });

  it("rejects Supabase add RPC responses that do not report generated booking ledger rows", async () => {
    const row = serviceRow();
    mocks.rpc.mockResolvedValueOnce({
      data: {
        workOrder: { ...parentOrder, serviceRows: [row] },
        serviceRow: row,
        serviceRowCount: 1,
        generatedBookingCount: 0,
      },
      error: null,
    });

    await expect(
      addWorkOrderServiceRowInSupabase({
        companyId: COMPANY,
        workOrderId: WORK_ORDER_ID,
        sourceServiceId: SERVICE_ID,
        serviceName: "Deep Clean",
        quantity: 1,
        status: "planned",
        serviceDate: "2026-06-10",
      }),
    ).rejects.toThrow(/did not generate booking ledger rows/i);
  });

  it("rejects Supabase add RPC responses where parent and returned service-row data drift", async () => {
    const parentRow = serviceRow();
    const staleReturnedRow = { ...parentRow, serviceName: "Stale Clean" };
    mocks.rpc.mockResolvedValueOnce({
      data: {
        workOrder: { ...parentOrder, serviceRows: [parentRow] },
        serviceRow: staleReturnedRow,
        serviceRowCount: 1,
      },
      error: null,
    });

    await expect(
      addWorkOrderServiceRowInSupabase({
        companyId: COMPANY,
        workOrderId: WORK_ORDER_ID,
        sourceServiceId: SERVICE_ID,
        serviceName: "Deep Clean",
        quantity: 1,
        status: "planned",
        serviceDate: "2026-06-10",
      }),
    ).rejects.toThrow(/returned service-row data does not match parent aggregate/i);
  });

  it("verifies a second-browser Supabase read through parent and flat child sources", async () => {
    const verified = await verifyAddedWorkOrderServiceRowReadableFromSupabase({
      companyId: COMPANY,
      workOrderId: WORK_ORDER_ID,
      serviceRowId: "worow_generated",
      expectedServiceRow: serviceRow(),
    });

    expect(verified.serviceRows).toHaveLength(1);
    expect(mocks.from).toHaveBeenCalledWith("work_orders");
    expect(mocks.from).toHaveBeenCalledWith("work_order_service_rows");
    expect(mocks.rowWorkOrderEq).toHaveBeenCalledWith("work_order_legacy_id", WORK_ORDER_ID);
    expect(mocks.rowCompanyEq).toHaveBeenCalledWith("company_legacy_id", COMPANY);
  });

  it("allows Add Service when legacy embedded parent rows do not have flat-row counterparts", async () => {
    const localGetSpy = vi.spyOn(Storage.prototype, "getItem");
    const localSetSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");
    const legacyEmbeddedOnlyRow = {
      ...serviceRow(),
      id: "worow_legacy_embedded_only",
      serviceName: "Legacy Embedded Service",
      serviceDate: "2026-06-01",
      plannedStartTime: "08:00",
      plannedEndTime: "09:00",
    };
    const newRow = serviceRow();
    const parentWithLegacyRow = {
      ...parentOrder,
      serviceRows: [legacyEmbeddedOnlyRow, newRow],
      updatedAt: "2026-06-05T01:00:00.000Z",
    };
    mocks.rpc.mockResolvedValueOnce({
      data: { workOrder: parentWithLegacyRow, serviceRow: newRow, serviceRowCount: 2, generatedBookingCount: 1 },
      error: null,
    });
    mocks.parentMaybeSingle.mockResolvedValueOnce({
      data: {
        data: parentWithLegacyRow,
        company_legacy_id: COMPANY,
        service_row_count: 2,
        deleted_at: null,
      },
      error: null,
    });
    mocks.rowCompanyEq.mockResolvedValueOnce({
      data: [flatServiceRowReadRow(newRow)],
      error: null,
    });

    const result = await addWorkOrderServiceRowInSupabase({
      companyId: COMPANY,
      workOrderId: WORK_ORDER_ID,
      sourceServiceId: SERVICE_ID,
      serviceName: "Deep Clean",
      quantity: 2,
      status: "planned",
      serviceDate: "2026-06-10",
      plannedStartTime: "09:00",
      plannedEndTime: "11:00",
      assignedEmployeeIds: ["emp_1"],
      unassignedEmployeeSlots: 1,
    });

    expect(result.serviceRow.id).toBe("worow_generated");
    expect(result.serviceRowCount).toBe(2);
    expect(result.generatedBookingCount).toBe(1);
    expect(saveWorkOrders).not.toHaveBeenCalled();
    expect(mirrorWorkOrderWrites).not.toHaveBeenCalled();
    expect(localGetSpy).not.toHaveBeenCalled();
    expect(localSetSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();

    localGetSpy.mockRestore();
    localSetSpy.mockRestore();
    sessionGetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("rejects verification when the newly added row is missing from the parent aggregate", async () => {
    const legacyEmbeddedOnlyRow = {
      ...serviceRow(),
      id: "worow_legacy_embedded_only",
      serviceName: "Legacy Embedded Service",
    };
    mocks.parentMaybeSingle.mockResolvedValueOnce({
      data: {
        data: { ...parentOrder, serviceRows: [legacyEmbeddedOnlyRow] },
        company_legacy_id: COMPANY,
        service_row_count: 1,
        deleted_at: null,
      },
      error: null,
    });
    await expect(
      verifyAddedWorkOrderServiceRowReadableFromSupabase({
        companyId: COMPANY,
        workOrderId: WORK_ORDER_ID,
        serviceRowId: "worow_generated",
        expectedServiceRow: serviceRow(),
      }),
    ).rejects.toThrow(/parent work order does not include it yet/i);
  });

  it("rejects verification when the newly added row is missing from the flat table", async () => {
    mocks.rowCompanyEq.mockResolvedValueOnce({ data: [], error: null });

    await expect(
      verifyAddedWorkOrderServiceRowReadableFromSupabase({
        companyId: COMPANY,
        workOrderId: WORK_ORDER_ID,
        serviceRowId: "worow_generated",
        expectedServiceRow: serviceRow(),
      }),
    ).rejects.toThrow(/flat service-row read path/i);
  });

  it("rejects verification when the parent aggregate drifts from the returned row", async () => {
    const returnedRow = serviceRow();
    const staleParentRow = { ...returnedRow, serviceName: "Stale Clean" };
    mocks.parentMaybeSingle.mockResolvedValueOnce({
      data: {
        data: { ...parentOrder, serviceRows: [staleParentRow] },
        company_legacy_id: COMPANY,
        service_row_count: 1,
        deleted_at: null,
      },
      error: null,
    });
    mocks.rowCompanyEq.mockResolvedValueOnce({
      data: [flatServiceRowReadRow(staleParentRow)],
      error: null,
    });

    await expect(
      verifyAddedWorkOrderServiceRowReadableFromSupabase({
        companyId: COMPANY,
        workOrderId: WORK_ORDER_ID,
        serviceRowId: "worow_generated",
        expectedServiceRow: returnedRow,
      }),
    ).rejects.toThrow(/parent aggregate service-row data does not match/i);
  });

  it("rejects verification when the flat child data drifts from the parent aggregate", async () => {
    const parentRow = serviceRow();
    const staleFlatRow = { ...parentRow, serviceName: "Stale Clean" };
    mocks.parentMaybeSingle.mockResolvedValueOnce({
      data: {
        data: { ...parentOrder, serviceRows: [parentRow] },
        company_legacy_id: COMPANY,
        service_row_count: 1,
        deleted_at: null,
      },
      error: null,
    });
    mocks.rowCompanyEq.mockResolvedValueOnce({
      data: [flatServiceRowReadRow(staleFlatRow, { service_name: "Deep Clean" })],
      error: null,
    });

    await expect(
      verifyAddedWorkOrderServiceRowReadableFromSupabase({
        companyId: COMPANY,
        workOrderId: WORK_ORDER_ID,
        serviceRowId: "worow_generated",
        expectedServiceRow: parentRow,
      }),
    ).rejects.toThrow(/data does not match parent aggregate/i);
  });

  it("rejects verification when the flat child schedule index drifts from the parent aggregate", async () => {
    const parentRow = serviceRow();
    mocks.parentMaybeSingle.mockResolvedValueOnce({
      data: {
        data: { ...parentOrder, serviceRows: [parentRow] },
        company_legacy_id: COMPANY,
        service_row_count: 1,
        deleted_at: null,
      },
      error: null,
    });
    mocks.rowCompanyEq.mockResolvedValueOnce({
      data: [flatServiceRowReadRow(parentRow, { service_date: "2026-06-11" })],
      error: null,
    });

    await expect(
      verifyAddedWorkOrderServiceRowReadableFromSupabase({
        companyId: COMPANY,
        workOrderId: WORK_ORDER_ID,
        serviceRowId: "worow_generated",
        expectedServiceRow: parentRow,
      }),
    ).rejects.toThrow(/service-date index/i);
  });

  it("rejects verification when the flat child status index drifts from the parent aggregate", async () => {
    const parentRow = serviceRow();
    mocks.parentMaybeSingle.mockResolvedValueOnce({
      data: {
        data: { ...parentOrder, serviceRows: [parentRow] },
        company_legacy_id: COMPANY,
        service_row_count: 1,
        deleted_at: null,
      },
      error: null,
    });
    mocks.rowCompanyEq.mockResolvedValueOnce({
      data: [flatServiceRowReadRow(parentRow, { status: "cancelled" })],
      error: null,
    });

    await expect(
      verifyAddedWorkOrderServiceRowReadableFromSupabase({
        companyId: COMPANY,
        workOrderId: WORK_ORDER_ID,
        serviceRowId: "worow_generated",
        expectedServiceRow: parentRow,
      }),
    ).rejects.toThrow(/status index/i);
  });

  it("fails closed on Supabase parent verification read errors", async () => {
    mocks.parentMaybeSingle.mockResolvedValueOnce({ data: null, error: { message: "TEST parent read blocked" } });

    await expect(
      verifyAddedWorkOrderServiceRowReadableFromSupabase({
        companyId: COMPANY,
        workOrderId: WORK_ORDER_ID,
        serviceRowId: "worow_generated",
        expectedServiceRow: serviceRow(),
      }),
    ).rejects.toThrow("[workOrders] Supabase service-row verification failed: TEST parent read blocked");

    expect(saveWorkOrders).not.toHaveBeenCalled();
    expect(mirrorWorkOrderWrites).not.toHaveBeenCalled();
  });

  it("fails closed on Supabase flat verification read errors", async () => {
    mocks.rowCompanyEq.mockResolvedValueOnce({ data: null, error: { message: "TEST flat read blocked" } });

    await expect(
      verifyAddedWorkOrderServiceRowReadableFromSupabase({
        companyId: COMPANY,
        workOrderId: WORK_ORDER_ID,
        serviceRowId: "worow_generated",
        expectedServiceRow: serviceRow(),
      }),
    ).rejects.toThrow("[workOrders] Supabase flat service-row verification failed: TEST flat read blocked");

    expect(saveWorkOrders).not.toHaveBeenCalled();
    expect(mirrorWorkOrderWrites).not.toHaveBeenCalled();
  });

  it("treats clean empty Supabase verification as empty, not locally recoverable", async () => {
    mocks.parentMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    await expect(
      verifyAddedWorkOrderServiceRowReadableFromSupabase({
        companyId: COMPANY,
        workOrderId: WORK_ORDER_ID,
        serviceRowId: "worow_generated",
        expectedServiceRow: serviceRow(),
      }),
    ).rejects.toThrow(/parent work order is not readable/i);

    expect(saveWorkOrders).not.toHaveBeenCalled();
    expect(mirrorWorkOrderWrites).not.toHaveBeenCalled();
  });
});

describe("CORE-WRITES-WORKORDERS-A1.2.4a one-time Change date/time repository", () => {
  it("updates only serviceDate/plannedStartTime/plannedEndTime through the existing update RPC", async () => {
    const localGetSpy = vi.spyOn(Storage.prototype, "getItem");
    const localSetSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");
    const updatedRow = {
      ...serviceRow(),
      serviceDate: "2026-06-12",
      plannedStartTime: "10:00",
      plannedEndTime: "12:30",
    };
    mocks.rpc.mockResolvedValueOnce({
      data: {
        workOrder: { ...parentOrder, serviceRows: [updatedRow] },
        serviceRow: updatedRow,
        serviceRowCount: 1,
      },
      error: null,
    });

    const result = await rescheduleOneTimeServiceRowInSupabase({
      companyId: COMPANY,
      workOrderId: WORK_ORDER_ID,
      serviceRowId: "worow_generated",
      recurrenceInterval: "one_time",
      serviceDate: " 2026-06-12 ",
      plannedStartTime: "10:00",
      plannedEndTime: "12:30",
    });

    expect(result.serviceRow.serviceDate).toBe("2026-06-12");
    expect(mocks.rpc).toHaveBeenCalledWith("update_work_order_service_row", {
      input: {
        company_id: COMPANY_UUID,
        company_legacy_id: COMPANY,
        work_order_legacy_id: WORK_ORDER_ID,
        service_row_legacy_id: "worow_generated",
        patch: {
          serviceDate: "2026-06-12",
          plannedStartTime: "10:00",
          plannedEndTime: "12:30",
          updatedAt: expect.any(String),
        },
      },
    });
    const sentPatch = mocks.rpc.mock.calls[0][1].input.patch;
    expect(sentPatch).not.toHaveProperty("serviceEndDate");
    expect(sentPatch).not.toHaveProperty("recurrenceInterval");
    expect(sentPatch).not.toHaveProperty("assignedEmployeeIds");
    expect(sentPatch).not.toHaveProperty("variations");
    expect(saveWorkOrders).not.toHaveBeenCalled();
    expect(mirrorWorkOrderWrites).not.toHaveBeenCalled();
    expect(localGetSpy).not.toHaveBeenCalled();
    expect(localSetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();

    localGetSpy.mockRestore();
    localSetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("fails closed for recurring rows and blocked extra fields before RPC", async () => {
    await expect(
      rescheduleOneTimeServiceRowInSupabase({
        companyId: COMPANY,
        workOrderId: WORK_ORDER_ID,
        serviceRowId: "worow_generated",
        recurrenceInterval: "weekly",
        serviceDate: "2026-06-12",
      }),
    ).rejects.toThrow(/recurring services/i);

    await expect(
      rescheduleOneTimeServiceRowInSupabase({
        companyId: COMPANY,
        workOrderId: WORK_ORDER_ID,
        serviceRowId: "worow_generated",
        recurrenceInterval: "one_time",
        serviceDate: "2026-06-12",
        serviceEndDate: "2026-06-20",
      } as Parameters<typeof rescheduleOneTimeServiceRowInSupabase>[0] & { serviceEndDate: string }),
    ).rejects.toThrow(/serviceEndDate/);

    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns a controlled failure on Supabase update RPC errors without local recovery", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "TEST RLS blocked update" },
    });

    await expect(
      rescheduleOneTimeServiceRowInSupabase({
        companyId: COMPANY,
        workOrderId: WORK_ORDER_ID,
        serviceRowId: "worow_generated",
        recurrenceInterval: "one_time",
        serviceDate: "2026-06-12",
        plannedStartTime: "10:00",
        plannedEndTime: "12:30",
      }),
    ).rejects.toThrow("[workOrders] Supabase update-service RPC failed: TEST RLS blocked update");

    expect(saveWorkOrders).not.toHaveBeenCalled();
    expect(mirrorWorkOrderWrites).not.toHaveBeenCalled();
  });

  it("rejects Supabase update RPC responses where parent and returned service-row data drift", async () => {
    const parentRow = {
      ...serviceRow(),
      serviceDate: "2026-06-12",
      plannedStartTime: "10:00",
      plannedEndTime: "12:30",
    };
    const staleReturnedRow = { ...parentRow, plannedStartTime: "09:30" };
    mocks.rpc.mockResolvedValueOnce({
      data: {
        workOrder: { ...parentOrder, serviceRows: [parentRow] },
        serviceRow: staleReturnedRow,
        serviceRowCount: 1,
      },
      error: null,
    });

    await expect(
      rescheduleOneTimeServiceRowInSupabase({
        companyId: COMPANY,
        workOrderId: WORK_ORDER_ID,
        serviceRowId: "worow_generated",
        recurrenceInterval: "one_time",
        serviceDate: "2026-06-12",
        plannedStartTime: "10:00",
        plannedEndTime: "12:30",
      }),
    ).rejects.toThrow(/returned service-row data does not match parent aggregate/i);
  });

  it("rejects invalid service dates and time ranges before RPC", async () => {
    await expect(
      rescheduleOneTimeServiceRowInSupabase({
        companyId: COMPANY,
        workOrderId: WORK_ORDER_ID,
        serviceRowId: "worow_generated",
        recurrenceInterval: "one_time",
        serviceDate: "2026-02-31",
      }),
    ).rejects.toThrow(/valid YYYY-MM-DD/i);

    await expect(
      rescheduleOneTimeServiceRowInSupabase({
        companyId: COMPANY,
        workOrderId: WORK_ORDER_ID,
        serviceRowId: "worow_generated",
        recurrenceInterval: "one_time",
        serviceDate: "2026-06-12",
        plannedStartTime: "10:00",
        plannedEndTime: "10:00",
      }),
    ).rejects.toThrow(/after planned start/i);

    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("verifies parent aggregate, flat child data, flat schedule indexes and service_row_count", async () => {
    const updatedRow = {
      ...serviceRow(),
      serviceDate: "2026-06-12",
      plannedStartTime: "10:00",
      plannedEndTime: "12:30",
    };
    mocks.parentMaybeSingle.mockResolvedValueOnce({
      data: {
        data: { ...parentOrder, serviceRows: [updatedRow] },
        company_legacy_id: COMPANY,
        service_row_count: 1,
        deleted_at: null,
      },
      error: null,
    });
    mocks.rowCompanyEq.mockResolvedValueOnce({
      data: [
        {
          data: updatedRow,
          company_legacy_id: COMPANY,
          work_order_legacy_id: WORK_ORDER_ID,
          service_name: "Deep Clean",
          article_number: "A-10",
          status: "planned",
          archived: false,
          service_date: "2026-06-12",
          service_end_date: null,
          planned_start_time: "10:00",
          planned_end_time: "12:30",
          recurrence_interval: "one_time",
          assigned_employee_ids: ["emp_1"],
          unassigned_employee_slots: 1,
          sort_order: 0,
          deleted_at: null,
        },
      ],
      error: null,
    });

    const verified = await verifyUpdatedWorkOrderServiceRowReadableFromSupabase({
      companyId: COMPANY,
      workOrderId: WORK_ORDER_ID,
      serviceRowId: "worow_generated",
      expectedPatch: {
        serviceDate: "2026-06-12",
        plannedStartTime: "10:00",
        plannedEndTime: "12:30",
      },
    });

    expect(verified.serviceRows[0].serviceDate).toBe("2026-06-12");
    expect(mocks.from).toHaveBeenCalledWith("work_orders");
    expect(mocks.from).toHaveBeenCalledWith("work_order_service_rows");
  });

  it("rejects fresh-read verification when the flat schedule index is stale", async () => {
    const updatedRow = {
      ...serviceRow(),
      serviceDate: "2026-06-12",
      plannedStartTime: "10:00",
      plannedEndTime: "12:30",
    };
    mocks.parentMaybeSingle.mockResolvedValueOnce({
      data: {
        data: { ...parentOrder, serviceRows: [updatedRow] },
        company_legacy_id: COMPANY,
        service_row_count: 1,
        deleted_at: null,
      },
      error: null,
    });
    mocks.rowCompanyEq.mockResolvedValueOnce({
      data: [
        {
          data: updatedRow,
          company_legacy_id: COMPANY,
          work_order_legacy_id: WORK_ORDER_ID,
          service_name: "Deep Clean",
          article_number: "A-10",
          status: "planned",
          archived: false,
          service_date: "2026-06-10",
          service_end_date: null,
          planned_start_time: "10:00",
          planned_end_time: "12:30",
          recurrence_interval: "one_time",
          assigned_employee_ids: ["emp_1"],
          unassigned_employee_slots: 1,
          sort_order: 0,
          deleted_at: null,
        },
      ],
      error: null,
    });

    await expect(
      verifyUpdatedWorkOrderServiceRowReadableFromSupabase({
        companyId: COMPANY,
        workOrderId: WORK_ORDER_ID,
        serviceRowId: "worow_generated",
        expectedPatch: {
          serviceDate: "2026-06-12",
          plannedStartTime: "10:00",
          plannedEndTime: "12:30",
        },
      }),
    ).rejects.toThrow(/date index/i);
  });
});

describe("AO-2B service-row archive/restore repository", () => {
  it("archives through the existing update RPC and keeps parent/returned row parity", async () => {
    const localGetSpy = vi.spyOn(Storage.prototype, "getItem");
    const localSetSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");
    const archivedRow = {
      ...serviceRow(),
      archived: true,
    };
    mocks.rpc.mockResolvedValueOnce({
      data: {
        workOrder: { ...parentOrder, serviceRows: [archivedRow] },
        serviceRow: archivedRow,
        serviceRowCount: 1,
      },
      error: null,
    });

    const result = await archiveWorkOrderServiceRowInSupabase({
      companyId: COMPANY,
      workOrderId: WORK_ORDER_ID,
      serviceRowId: "worow_generated",
    });

    expect(result.serviceRow.archived).toBe(true);
    expect(result.workOrder.serviceRows[0].archived).toBe(true);
    expect(result.serviceRowCount).toBe(1);
    expect(mocks.rpc).toHaveBeenCalledWith("update_work_order_service_row", {
      input: {
        company_id: COMPANY_UUID,
        company_legacy_id: COMPANY,
        work_order_legacy_id: WORK_ORDER_ID,
        service_row_legacy_id: "worow_generated",
        patch: {
          archived: true,
          updatedAt: expect.any(String),
        },
      },
    });
    expect(saveWorkOrders).not.toHaveBeenCalled();
    expect(mirrorWorkOrderWrites).not.toHaveBeenCalled();
    expect(localGetSpy).not.toHaveBeenCalled();
    expect(localSetSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();

    localGetSpy.mockRestore();
    localSetSpy.mockRestore();
    sessionGetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("restores through the existing update RPC and keeps parent/returned row parity", async () => {
    const restoredRow = {
      ...serviceRow(),
      archived: false,
    };
    mocks.rpc.mockResolvedValueOnce({
      data: {
        workOrder: { ...parentOrder, serviceRows: [restoredRow] },
        serviceRow: restoredRow,
        serviceRowCount: 1,
      },
      error: null,
    });

    const result = await restoreWorkOrderServiceRowInSupabase({
      companyId: COMPANY,
      workOrderId: WORK_ORDER_ID,
      serviceRowId: "worow_generated",
    });

    expect(result.serviceRow.archived).toBe(false);
    expect(result.workOrder.serviceRows[0].archived).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledWith("update_work_order_service_row", {
      input: {
        company_id: COMPANY_UUID,
        company_legacy_id: COMPANY,
        work_order_legacy_id: WORK_ORDER_ID,
        service_row_legacy_id: "worow_generated",
        patch: {
          archived: false,
          updatedAt: expect.any(String),
        },
      },
    });
    expect(saveWorkOrders).not.toHaveBeenCalled();
    expect(mirrorWorkOrderWrites).not.toHaveBeenCalled();
  });

  it("verifies archived parent aggregate and flat child parity after fresh Supabase read", async () => {
    const archivedRow = {
      ...serviceRow(),
      archived: true,
    };
    mocks.parentMaybeSingle.mockResolvedValueOnce({
      data: {
        data: { ...parentOrder, serviceRows: [archivedRow] },
        company_legacy_id: COMPANY,
        service_row_count: 1,
        deleted_at: null,
      },
      error: null,
    });
    mocks.rowCompanyEq.mockResolvedValueOnce({
      data: [
        {
          data: archivedRow,
          company_legacy_id: COMPANY,
          work_order_legacy_id: WORK_ORDER_ID,
          service_name: "Deep Clean",
          article_number: "A-10",
          status: "planned",
          archived: true,
          service_date: "2026-06-10",
          service_end_date: null,
          planned_start_time: "09:00",
          planned_end_time: "11:00",
          recurrence_interval: "one_time",
          assigned_employee_ids: ["emp_1"],
          unassigned_employee_slots: 1,
          sort_order: 0,
          deleted_at: null,
        },
      ],
      error: null,
    });

    const verified = await verifyUpdatedWorkOrderServiceRowReadableFromSupabase({
      companyId: COMPANY,
      workOrderId: WORK_ORDER_ID,
      serviceRowId: "worow_generated",
      expectedPatch: { archived: true },
    });

    expect(verified.serviceRows[0].archived).toBe(true);
    expect(mocks.from).toHaveBeenCalledWith("work_orders");
    expect(mocks.from).toHaveBeenCalledWith("work_order_service_rows");
  });

  it("rejects archive verification when the flat archived index drifts from the parent aggregate", async () => {
    const archivedRow = {
      ...serviceRow(),
      archived: true,
    };
    mocks.parentMaybeSingle.mockResolvedValueOnce({
      data: {
        data: { ...parentOrder, serviceRows: [archivedRow] },
        company_legacy_id: COMPANY,
        service_row_count: 1,
        deleted_at: null,
      },
      error: null,
    });
    mocks.rowCompanyEq.mockResolvedValueOnce({
      data: [
        {
          data: archivedRow,
          company_legacy_id: COMPANY,
          work_order_legacy_id: WORK_ORDER_ID,
          service_name: "Deep Clean",
          article_number: "A-10",
          status: "planned",
          archived: false,
          service_date: "2026-06-10",
          service_end_date: null,
          planned_start_time: "09:00",
          planned_end_time: "11:00",
          recurrence_interval: "one_time",
          assigned_employee_ids: ["emp_1"],
          unassigned_employee_slots: 1,
          sort_order: 0,
          deleted_at: null,
        },
      ],
      error: null,
    });

    await expect(
      verifyUpdatedWorkOrderServiceRowReadableFromSupabase({
        companyId: COMPANY,
        workOrderId: WORK_ORDER_ID,
        serviceRowId: "worow_generated",
        expectedPatch: { archived: true },
      }),
    ).rejects.toThrow(/archived index/i);
  });

  it("returns a controlled failure on Supabase archive RPC errors without local recovery", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "TEST archived field blocked" },
    });

    await expect(
      archiveWorkOrderServiceRowInSupabase({
        companyId: COMPANY,
        workOrderId: WORK_ORDER_ID,
        serviceRowId: "worow_generated",
      }),
    ).rejects.toThrow("[workOrders] Supabase update-service RPC failed: TEST archived field blocked");

    expect(saveWorkOrders).not.toHaveBeenCalled();
    expect(mirrorWorkOrderWrites).not.toHaveBeenCalled();
  });

  it("treats clean empty Supabase archive verification as empty, not locally recoverable", async () => {
    mocks.parentMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    await expect(
      verifyUpdatedWorkOrderServiceRowReadableFromSupabase({
        companyId: COMPANY,
        workOrderId: WORK_ORDER_ID,
        serviceRowId: "worow_generated",
        expectedPatch: { archived: true },
      }),
    ).rejects.toThrow(/parent work order is not readable/i);

    expect(saveWorkOrders).not.toHaveBeenCalled();
    expect(mirrorWorkOrderWrites).not.toHaveBeenCalled();
  });
});

describe("WorkOrder service-row remove repository", () => {
  it("removes an unprotected service row through the Supabase remove RPC and verifies active read paths", async () => {
    const localGetSpy = vi.spyOn(Storage.prototype, "getItem");
    const localSetSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");
    const removedRow = serviceRow();
    const removedParent = { ...parentOrder, serviceRows: [], updatedAt: "2026-06-05T01:00:00.000Z" };
    mocks.rpc.mockResolvedValueOnce({
      data: { workOrder: removedParent, serviceRow: removedRow, serviceRowCount: 0 },
      error: null,
    });
    mocks.parentMaybeSingle.mockResolvedValueOnce({
      data: {
        data: removedParent,
        company_legacy_id: COMPANY,
        service_row_count: 0,
        deleted_at: null,
      },
      error: null,
    });
    mocks.rowCompanyEq.mockResolvedValueOnce({
      data: [flatServiceRowReadRow(removedRow, { deleted_at: "2026-06-05T01:00:00.000Z" })],
      error: null,
    });

    const result = await removeWorkOrderServiceRowInSupabase({
      companyId: COMPANY,
      workOrderId: WORK_ORDER_ID,
      serviceRowId: "worow_generated",
    });

    expect(result.workOrder.serviceRows).toEqual([]);
    expect(result.serviceRow.id).toBe("worow_generated");
    expect(result.serviceRowCount).toBe(0);
    expect(mocks.rpc).toHaveBeenCalledWith("remove_work_order_service_row", {
      input: {
        company_id: COMPANY_UUID,
        company_legacy_id: COMPANY,
        work_order_legacy_id: WORK_ORDER_ID,
        service_row_legacy_id: "worow_generated",
      },
    });
    expect(saveWorkOrders).not.toHaveBeenCalled();
    expect(mirrorWorkOrderWrites).not.toHaveBeenCalled();
    expect(localGetSpy).not.toHaveBeenCalled();
    expect(localSetSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();

    localGetSpy.mockRestore();
    localSetSpy.mockRestore();
    sessionGetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("fails closed on Supabase remove RPC errors without local recovery", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "TEST protected history blocked" },
    });

    await expect(
      removeWorkOrderServiceRowInSupabase({
        companyId: COMPANY,
        workOrderId: WORK_ORDER_ID,
        serviceRowId: "worow_generated",
      }),
    ).rejects.toThrow("[workOrders] Supabase remove-service RPC failed: TEST protected history blocked");

    expect(saveWorkOrders).not.toHaveBeenCalled();
    expect(mirrorWorkOrderWrites).not.toHaveBeenCalled();
  });

  it("rejects remove RPC responses where the parent still includes the removed row", async () => {
    const row = serviceRow();
    mocks.rpc.mockResolvedValueOnce({
      data: {
        workOrder: { ...parentOrder, serviceRows: [row] },
        serviceRow: row,
        serviceRowCount: 1,
      },
      error: null,
    });

    await expect(
      removeWorkOrderServiceRowInSupabase({
        companyId: COMPANY,
        workOrderId: WORK_ORDER_ID,
        serviceRowId: "worow_generated",
      }),
    ).rejects.toThrow(/still includes the removed service row/i);
  });

  it("verifies removed service rows are absent from parent aggregate and active flat reads", async () => {
    const removedParent = { ...parentOrder, serviceRows: [], updatedAt: "2026-06-05T01:00:00.000Z" };
    mocks.parentMaybeSingle.mockResolvedValueOnce({
      data: {
        data: removedParent,
        company_legacy_id: COMPANY,
        service_row_count: 0,
        deleted_at: null,
      },
      error: null,
    });
    mocks.rowCompanyEq.mockResolvedValueOnce({
      data: [flatServiceRowReadRow(serviceRow(), { deleted_at: "2026-06-05T01:00:00.000Z" })],
      error: null,
    });

    const verified = await verifyRemovedWorkOrderServiceRowReadableFromSupabase({
      companyId: COMPANY,
      workOrderId: WORK_ORDER_ID,
      serviceRowId: "worow_generated",
    });

    expect(verified.serviceRows).toEqual([]);
    expect(mocks.from).toHaveBeenCalledWith("work_orders");
    expect(mocks.from).toHaveBeenCalledWith("work_order_service_rows");
  });

  it("rejects removal verification when parent aggregate still includes the row", async () => {
    const row = serviceRow();
    mocks.parentMaybeSingle.mockResolvedValueOnce({
      data: {
        data: { ...parentOrder, serviceRows: [row] },
        company_legacy_id: COMPANY,
        service_row_count: 1,
        deleted_at: null,
      },
      error: null,
    });

    await expect(
      verifyRemovedWorkOrderServiceRowReadableFromSupabase({
        companyId: COMPANY,
        workOrderId: WORK_ORDER_ID,
        serviceRowId: "worow_generated",
      }),
    ).rejects.toThrow(/parent work order still includes it/i);
  });

  it("rejects removal verification when the active flat read path still includes the row", async () => {
    const removedParent = { ...parentOrder, serviceRows: [], updatedAt: "2026-06-05T01:00:00.000Z" };
    mocks.parentMaybeSingle.mockResolvedValueOnce({
      data: {
        data: removedParent,
        company_legacy_id: COMPANY,
        service_row_count: 0,
        deleted_at: null,
      },
      error: null,
    });
    mocks.rowCompanyEq.mockResolvedValueOnce({
      data: [flatServiceRowReadRow(serviceRow())],
      error: null,
    });

    await expect(
      verifyRemovedWorkOrderServiceRowReadableFromSupabase({
        companyId: COMPANY,
        workOrderId: WORK_ORDER_ID,
        serviceRowId: "worow_generated",
      }),
    ).rejects.toThrow(/flat service-row read path still includes it/i);
  });
});

describe("AO-2A service-row authority regression guards", () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repositoryPath = path.resolve(__dirname, "./supabaseWorkOrderRepository.ts");
  const repositorySource = readFileSync(repositoryPath, "utf8");
  const selectedSliceSource = repositorySource.slice(
    repositorySource.indexOf("function parseAddServiceRowRpcResult"),
    repositorySource.indexOf("export async function listFullWorkOrdersFromSupabase"),
  );

  it("keeps the selected add/update service-row seam off browser storage and local mirrors", () => {
    expect(selectedSliceSource).not.toMatch(/localStorage\s*\./i);
    expect(selectedSliceSource).not.toMatch(/sessionStorage\s*\./i);
    expect(selectedSliceSource).not.toMatch(/saveWorkOrders\s*\(/);
    expect(selectedSliceSource).not.toMatch(/mirrorWorkOrderWrites\s*\(/);
  });

  it("does not access unrelated protected write domains from the selected service-row seam", () => {
    const forbiddenTableCalls = [
      "booking_queue",
      "work_order_occurrence_exceptions",
      "mission_staff_sessions",
      "mission_log_events",
      "time_allocations",
      "payroll",
      "invoice",
    ];

    for (const table of forbiddenTableCalls) {
      expect(selectedSliceSource).not.toMatch(new RegExp(`\\.from\\(\\s*["']${table}["']`, "i"));
      expect(selectedSliceSource).not.toMatch(new RegExp(`\\.rpc\\(\\s*["'][^"']*${table}`, "i"));
    }
  });

  it("does not introduce local fallback, backout bridge or offline recovery language in the selected seam", () => {
    expect(selectedSliceSource).not.toMatch(/fallback/i);
    expect(selectedSliceSource).not.toMatch(/backout/i);
    expect(selectedSliceSource).not.toMatch(/bridge/i);
    expect(selectedSliceSource).not.toMatch(/offline/i);
  });

  it("keeps the checked-in update RPC migration allowlisted for archive/restore only through archived boolean", () => {
    const migrationPath = path.resolve(
      __dirname,
      "../../../supabase/migrations/0038_update_work_order_service_row_archived_rpc.sql",
    );
    const migrationSource = readFileSync(migrationPath, "utf8");

    expect(migrationSource).toMatch(/'archived'/);
    expect(migrationSource).toMatch(/jsonb_typeof\(patch -> 'archived'\) <> 'boolean'/);
    expect(migrationSource).toMatch(/archived = coalesce\(\(patched_row ->> 'archived'\)::boolean, false\)/);
    expect(migrationSource).not.toMatch(/booking_queue/i);
    expect(migrationSource).not.toMatch(/mission_log_entries/i);
    expect(migrationSource).not.toMatch(/time_reports/i);
  });

  it("keeps the checked-in remove RPC migration scoped to service-row removal and protected-history guards", () => {
    const migrationPath = path.resolve(
      __dirname,
      "../../../supabase/migrations/0039_remove_work_order_service_row_rpc.sql",
    );
    const migrationSource = readFileSync(migrationPath, "utf8");

    expect(migrationSource).toMatch(/create or replace function public\.remove_work_order_service_row/);
    expect(migrationSource).toMatch(/service_row_count = jsonb_array_length\(next_rows\)/);
    expect(migrationSource).toMatch(/from public\.time_reports/);
    expect(migrationSource).toMatch(/from public\.mission_log_entries/);
    expect(migrationSource).toMatch(/set deleted_at = removed_at/);
    expect(migrationSource).not.toMatch(/delete\s+from/i);
    expect(migrationSource).not.toMatch(/from public\.booking_queue/i);
    expect(migrationSource).not.toMatch(/from public\.work_order_occurrence_exceptions/i);
    expect(migrationSource).not.toMatch(/payroll_basis/i);
    expect(migrationSource).not.toMatch(/invoice_basis/i);
  });
});
