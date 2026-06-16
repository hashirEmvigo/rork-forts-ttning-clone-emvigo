import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { WorkOrder, WorkOrderServiceRow } from "@/types";

vi.mock("@/lib/data/supabaseWorkOrderRepository", () => ({
  addWorkOrderServiceRowInSupabase: vi.fn(),
  archiveWorkOrderServiceRowInSupabase: vi.fn(),
  createWorkOrderInSupabase: vi.fn(),
  removeWorkOrderServiceRowInSupabase: vi.fn(),
  rescheduleOneTimeServiceRowInSupabase: vi.fn(),
  restoreWorkOrderServiceRowInSupabase: vi.fn(),
  updateWorkOrderServiceRowInSupabase: vi.fn(),
}));

vi.mock("@/lib/data/workOrderDirectoryRefresh", () => ({
  bumpWorkOrderDirectoryRefresh: vi.fn(),
}));

vi.mock("@/lib/store", () => ({
  saveWorkOrders: vi.fn(),
}));

vi.mock("@/lib/data/workOrderDualWrite", () => ({
  mirrorWorkOrderWrites: vi.fn(),
}));

vi.mock("@/lib/data/customerDualWrite", () => ({
  mirrorCustomerWrites: vi.fn(),
}));

import {
  archiveWorkOrderServiceRowInSupabase,
  createWorkOrderInSupabase,
  removeWorkOrderServiceRowInSupabase,
  rescheduleOneTimeServiceRowInSupabase,
  restoreWorkOrderServiceRowInSupabase,
  type SupabaseWorkOrderServiceRowUpdateResult,
} from "@/lib/data/supabaseWorkOrderRepository";
import { bumpWorkOrderDirectoryRefresh } from "@/lib/data/workOrderDirectoryRefresh";
import { saveWorkOrders } from "@/lib/store";
import { mirrorWorkOrderWrites } from "@/lib/data/workOrderDualWrite";
import { mirrorCustomerWrites } from "@/lib/data/customerDualWrite";
import { useWorkOrderMutations } from "./use-work-order-mutations";

const COMPANY = "cmp_stad";

const workOrder: WorkOrder = {
  id: "wo_1",
  companyId: COMPANY,
  customerId: "cust_1",
  number: "WO-1001",
  title: "Created AO",
  status: "draft",
  createdBy: "usr_admin",
  createdByName: "Admin User",
  notes: [],
  serviceRows: [],
  activity: [],
  mediaPlacements: [],
  createdAt: "2026-06-05T00:00:00.000Z",
  updatedAt: "2026-06-05T00:00:00.000Z",
};

const archiveServiceRowMock = vi.mocked(archiveWorkOrderServiceRowInSupabase);
const createWorkOrderMock = vi.mocked(createWorkOrderInSupabase);
const removeServiceRowMock = vi.mocked(removeWorkOrderServiceRowInSupabase);
const rescheduleOneTimeServiceRowMock = vi.mocked(rescheduleOneTimeServiceRowInSupabase);
const restoreServiceRowMock = vi.mocked(restoreWorkOrderServiceRowInSupabase);
const refreshMock = vi.mocked(bumpWorkOrderDirectoryRefresh);
const saveWorkOrdersMock = vi.mocked(saveWorkOrders);
const mirrorWorkOrderWritesMock = vi.mocked(mirrorWorkOrderWrites);
const mirrorCustomerWritesMock = vi.mocked(mirrorCustomerWrites);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { wrapper, invalidateSpy };
}

beforeEach(() => {
  vi.clearAllMocks();
  createWorkOrderMock.mockResolvedValue(workOrder);
  const hydratedServiceRows: WorkOrderServiceRow[] = [
    {
      id: "worow_1",
      sourceServiceId: "svc_1",
      serviceName: "Deep Clean",
      quantity: 1,
      status: "planned",
      serviceDate: "2026-06-12",
      plannedStartTime: "10:00",
      plannedEndTime: "12:30",
      assignedEmployeeIds: [],
      unassignedEmployeeSlots: 0,
      recurrenceInterval: "one_time",
      sortOrder: 0,
      archived: false,
      createdAt: "2026-06-05T00:00:00.000Z",
      updatedAt: "2026-06-05T01:00:00.000Z",
    },
  ];
  const serviceRowResult: SupabaseWorkOrderServiceRowUpdateResult = {
    workOrder: {
      ...workOrder,
      serviceRows: hydratedServiceRows,
    },
    serviceRow: {
      id: "worow_1",
      sourceServiceId: "svc_1",
      serviceName: "Deep Clean",
      quantity: 1,
      status: "planned",
      serviceDate: "2026-06-12",
      plannedStartTime: "10:00",
      plannedEndTime: "12:30",
      assignedEmployeeIds: [],
      unassignedEmployeeSlots: 0,
      recurrenceInterval: "one_time",
      sortOrder: 0,
      archived: false,
      createdAt: "2026-06-05T00:00:00.000Z",
      updatedAt: "2026-06-05T01:00:00.000Z",
    },
    serviceRowCount: 1,
  };
  archiveServiceRowMock.mockResolvedValue({
    ...serviceRowResult,
    serviceRow: { ...serviceRowResult.serviceRow, archived: true },
    workOrder: {
      ...serviceRowResult.workOrder,
      serviceRows: hydratedServiceRows.map((row) => ({ ...row, archived: true })),
    },
  });
  removeServiceRowMock.mockResolvedValue({
    ...serviceRowResult,
    workOrder: { ...workOrder, serviceRows: [] },
    serviceRowCount: 0,
  });
  rescheduleOneTimeServiceRowMock.mockResolvedValue(serviceRowResult);
  restoreServiceRowMock.mockResolvedValue({
    ...serviceRowResult,
    serviceRow: { ...serviceRowResult.serviceRow, archived: false },
    workOrder: {
      ...serviceRowResult.workOrder,
      serviceRows: hydratedServiceRows.map((row) => ({ ...row, archived: false })),
    },
  });
});

describe("useWorkOrderMutations CORE-WRITES-WORKORDERS-A1.1", () => {
  it("creates work orders through Supabase only and refreshes the work-order directory", async () => {
    const { wrapper, invalidateSpy } = createWrapper();
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");
    const { result } = renderHook(
      () =>
        useWorkOrderMutations({
          companyId: COMPANY,
          canCreateWorkOrders: true,
        }),
      { wrapper },
    );

    await result.current.createWorkOrder({
      customerId: "cust_1",
      title: "Created AO",
      status: "draft",
      createdBy: "usr_admin",
      createdByName: "Admin User",
    });

    expect(createWorkOrderMock).toHaveBeenCalledWith({
      companyId: COMPANY,
      customerId: "cust_1",
      title: "Created AO",
      status: "draft",
      createdBy: "usr_admin",
      createdByName: "Admin User",
    });
    expect(saveWorkOrdersMock).not.toHaveBeenCalled();
    expect(mirrorWorkOrderWritesMock).not.toHaveBeenCalled();
    expect(mirrorCustomerWritesMock).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["work-order-directory"] }),
    );

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
    sessionGetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("fails closed without work-order create permission", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () =>
        useWorkOrderMutations({
          companyId: COMPANY,
          canCreateWorkOrders: false,
        }),
      { wrapper },
    );

    await expect(result.current.createWorkOrder({ customerId: "cust_1" })).rejects.toThrow(
      /permission/i,
    );

    expect(createWorkOrderMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("fails closed when company scope is missing", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () =>
        useWorkOrderMutations({
          companyId: null,
          canCreateWorkOrders: true,
        }),
      { wrapper },
    );

    await expect(result.current.createWorkOrder({ customerId: "cust_1" })).rejects.toThrow(
      /company context/i,
    );

    expect(createWorkOrderMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("uses an explicit target-customer company override when provided", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () =>
        useWorkOrderMutations({
          companyId: null,
          canCreateWorkOrders: true,
        }),
      { wrapper },
    );

    await result.current.createWorkOrder({
      companyId: "cmp_target_customer",
      customerId: "cust_target",
    });

    expect(createWorkOrderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "cmp_target_customer",
        customerId: "cust_target",
      }),
    );
  });
});

describe("useWorkOrderMutations AO-2B archive/restore", () => {
  it("archives a service row through the Supabase repository helper only", async () => {
    const { wrapper, invalidateSpy } = createWrapper();
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");
    const { result } = renderHook(
      () =>
        useWorkOrderMutations({
          companyId: COMPANY,
          canCreateWorkOrders: true,
        }),
      { wrapper },
    );

    await result.current.archiveServiceRow({
      workOrderId: "wo_1",
      serviceRowId: "worow_1",
    });

    expect(archiveServiceRowMock).toHaveBeenCalledWith({
      companyId: COMPANY,
      workOrderId: "wo_1",
      serviceRowId: "worow_1",
    });
    expect(saveWorkOrdersMock).not.toHaveBeenCalled();
    expect(mirrorWorkOrderWritesMock).not.toHaveBeenCalled();
    expect(mirrorCustomerWritesMock).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["work-order-directory"] }),
    );

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
    sessionGetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("restores a service row through the Supabase repository helper only", async () => {
    const { wrapper, invalidateSpy } = createWrapper();
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");
    const { result } = renderHook(
      () =>
        useWorkOrderMutations({
          companyId: COMPANY,
          canCreateWorkOrders: true,
        }),
      { wrapper },
    );

    await result.current.restoreServiceRow({
      workOrderId: "wo_1",
      serviceRowId: "worow_1",
    });

    expect(restoreServiceRowMock).toHaveBeenCalledWith({
      companyId: COMPANY,
      workOrderId: "wo_1",
      serviceRowId: "worow_1",
    });
    expect(saveWorkOrdersMock).not.toHaveBeenCalled();
    expect(mirrorWorkOrderWritesMock).not.toHaveBeenCalled();
    expect(mirrorCustomerWritesMock).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["work-order-directory"] }),
    );

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
    sessionGetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("removes a service row through the Supabase repository helper only", async () => {
    const { wrapper, invalidateSpy } = createWrapper();
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");
    const { result } = renderHook(
      () =>
        useWorkOrderMutations({
          companyId: COMPANY,
          canCreateWorkOrders: true,
        }),
      { wrapper },
    );

    await result.current.removeServiceRow({
      workOrderId: "wo_1",
      serviceRowId: "worow_1",
    });

    expect(removeServiceRowMock).toHaveBeenCalledWith({
      companyId: COMPANY,
      workOrderId: "wo_1",
      serviceRowId: "worow_1",
    });
    expect(saveWorkOrdersMock).not.toHaveBeenCalled();
    expect(mirrorWorkOrderWritesMock).not.toHaveBeenCalled();
    expect(mirrorCustomerWritesMock).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["work-order-directory"] }),
    );

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
    sessionGetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("fails closed before archive/restore/remove mutation without permission", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () =>
        useWorkOrderMutations({
          companyId: COMPANY,
          canCreateWorkOrders: false,
        }),
      { wrapper },
    );

    await expect(
      result.current.archiveServiceRow({
        workOrderId: "wo_1",
        serviceRowId: "worow_1",
      }),
    ).rejects.toThrow(/permission/i);
    await expect(
      result.current.restoreServiceRow({
        workOrderId: "wo_1",
        serviceRowId: "worow_1",
      }),
    ).rejects.toThrow(/permission/i);
    await expect(
      result.current.removeServiceRow({
        workOrderId: "wo_1",
        serviceRowId: "worow_1",
      }),
    ).rejects.toThrow(/permission/i);

    expect(archiveServiceRowMock).not.toHaveBeenCalled();
    expect(restoreServiceRowMock).not.toHaveBeenCalled();
    expect(removeServiceRowMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

describe("useWorkOrderMutations CORE-WRITES-WORKORDERS-A1.2.4a", () => {
  it("changes one-time service-row date/time through the narrow Supabase method only", async () => {
    const { wrapper, invalidateSpy } = createWrapper();
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");
    const { result } = renderHook(
      () =>
        useWorkOrderMutations({
          companyId: COMPANY,
          canCreateWorkOrders: true,
        }),
      { wrapper },
    );

    await result.current.changeOneTimeServiceRowDateTime({
      workOrderId: "wo_1",
      serviceRowId: "worow_1",
      recurrenceInterval: "one_time",
      serviceDate: "2026-06-12",
      plannedStartTime: "10:00",
      plannedEndTime: "12:30",
    });

    expect(rescheduleOneTimeServiceRowMock).toHaveBeenCalledWith({
      companyId: COMPANY,
      workOrderId: "wo_1",
      serviceRowId: "worow_1",
      recurrenceInterval: "one_time",
      serviceDate: "2026-06-12",
      plannedStartTime: "10:00",
      plannedEndTime: "12:30",
    });
    expect(saveWorkOrdersMock).not.toHaveBeenCalled();
    expect(mirrorWorkOrderWritesMock).not.toHaveBeenCalled();
    expect(mirrorCustomerWritesMock).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["work-order-directory"] }),
    );

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("fails closed before date/time mutation without permission", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () =>
        useWorkOrderMutations({
          companyId: COMPANY,
          canCreateWorkOrders: false,
        }),
      { wrapper },
    );

    await expect(
      result.current.changeOneTimeServiceRowDateTime({
        workOrderId: "wo_1",
        serviceRowId: "worow_1",
        recurrenceInterval: "one_time",
        serviceDate: "2026-06-12",
      }),
    ).rejects.toThrow(/permission/i);

    expect(rescheduleOneTimeServiceRowMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
