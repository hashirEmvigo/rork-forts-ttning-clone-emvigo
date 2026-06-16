import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { User, WorkOrder, WorkOrderServiceRow } from "@/types";

/**
 * CORE-WRITES-WORKORDERS-A1.2.4a — Change date/time for one-time service rows.
 * This surface is deliberately separate from normal Edit Service Row and only
 * sends serviceDate/plannedStartTime/plannedEndTime through the narrow mutation.
 */
const mocks = vi.hoisted(() => ({
  changeOneTimeServiceRowDateTime: vi.fn(),
  updateServiceRow: vi.fn(),
  legacyUpdateWorkOrderServiceRow: vi.fn(),
  legacyAddWorkOrderServiceRow: vi.fn(),
  verifyUpdatedWorkOrderServiceRowReadableFromSupabase: vi.fn(),
  saveWorkOrders: vi.fn(),
  mirrorWorkOrderWrites: vi.fn(),
  mirrorCustomerWrites: vi.fn(),
  toast: vi.fn(),
  hasPermission: vi.fn(),
  currentUser: {
    id: "usr_admin",
    name: "Admin User",
    role: "company_admin",
    companyId: "cmp_stad",
    email: "admin@example.com",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
  } as User,
}));

vi.mock("@/context/AppContext", () => ({
  useApp: () => ({
    currentUser: mocks.currentUser,
    customers: [],
    employees: [],
    updateWorkOrderServiceRow: mocks.legacyUpdateWorkOrderServiceRow,
    addWorkOrderServiceRow: mocks.legacyAddWorkOrderServiceRow,
    hasPermission: mocks.hasPermission,
  }),
}));

vi.mock("@/hooks/use-work-order-mutations", () => ({
  useWorkOrderMutations: () => ({
    createWorkOrder: vi.fn(),
    addServiceRow: vi.fn(),
    updateServiceRow: mocks.updateServiceRow,
    changeOneTimeServiceRowDateTime: mocks.changeOneTimeServiceRowDateTime,
    isPending: false,
    error: null,
  }),
}));

vi.mock("@/lib/data/supabaseWorkOrderRepository", () => ({
  verifyAddedWorkOrderServiceRowReadableFromSupabase: vi.fn(),
  verifyUpdatedWorkOrderServiceRowReadableFromSupabase:
    mocks.verifyUpdatedWorkOrderServiceRowReadableFromSupabase,
  supabaseWorkOrderRepository: {},
  listFullWorkOrdersFromSupabase: vi.fn(),
  fetchScheduleIntervalFromSupabase: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/lib/store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/store")>("@/lib/store");
  return {
    ...actual,
    makeId: vi.fn((prefix: string) => `${prefix}_generated`),
    saveWorkOrders: mocks.saveWorkOrders,
  };
});

vi.mock("@/lib/data/workOrderDualWrite", () => ({
  mirrorWorkOrderWrites: mocks.mirrorWorkOrderWrites,
}));

vi.mock("@/lib/data/customerDualWrite", () => ({
  mirrorCustomerWrites: mocks.mirrorCustomerWrites,
}));

vi.mock("@/components/ui/time-picker", () => ({
  TimePicker: ({
    value,
    onChange,
    "aria-label": ariaLabel,
  }: {
    value?: string;
    onChange?: (value: string) => void;
    "aria-label"?: string;
  }) => (
    <input
      aria-label={ariaLabel ?? "Time"}
      value={value ?? ""}
      onChange={(event) => onChange?.(event.currentTarget.value)}
    />
  ),
}));

import { ChangeDateTimeDialog } from "./WorkOrderDetails";

const order: WorkOrder = {
  id: "wo_1",
  companyId: "cmp_stad",
  customerId: "cust_1",
  number: "WO-1001",
  title: "Weekly cleaning",
  status: "draft",
  notes: [],
  serviceRows: [],
  activity: [],
  mediaPlacements: [],
  createdAt: "2026-06-05T00:00:00.000Z",
  updatedAt: "2026-06-05T00:00:00.000Z",
};

const row: WorkOrderServiceRow = {
  id: "worow_1",
  sourceServiceId: "svc_1",
  serviceName: "Deep Clean",
  articleNumber: "A-10",
  categoryName: "Cleaning",
  serviceType: "Cleaning",
  quantity: 2,
  unit: "hour",
  price: 500,
  vat: 25,
  status: "planned",
  serviceDate: "2026-06-10",
  plannedStartTime: "09:00",
  plannedEndTime: "11:00",
  assignedEmployeeIds: [],
  unassignedEmployeeSlots: 1,
  recurrenceInterval: "one_time",
  sortOrder: 0,
  archived: false,
  createdAt: "2026-06-05T00:00:00.000Z",
  updatedAt: "2026-06-05T00:00:00.000Z",
};

const EXPECTED_PATCH = {
  serviceDate: "2026-06-12",
  plannedStartTime: "10:00",
  plannedEndTime: "12:30",
};

function renderDialog(targetRow: WorkOrderServiceRow | null = row, onClose = vi.fn()): ReturnType<typeof vi.fn> {
  render(<ChangeDateTimeDialog order={order} row={targetRow} onClose={onClose} />);
  return onClose;
}

function expectNoLegacyServiceRowPersistence(): void {
  expect(mocks.updateServiceRow).not.toHaveBeenCalled();
  expect(mocks.legacyUpdateWorkOrderServiceRow).not.toHaveBeenCalled();
  expect(mocks.legacyAddWorkOrderServiceRow).not.toHaveBeenCalled();
  expect(mocks.saveWorkOrders).not.toHaveBeenCalled();
  expect(mocks.mirrorWorkOrderWrites).not.toHaveBeenCalled();
  expect(mocks.mirrorCustomerWrites).not.toHaveBeenCalled();
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.hasPermission.mockReturnValue(true);
  mocks.changeOneTimeServiceRowDateTime.mockResolvedValue({
    workOrder: { ...order, serviceRows: [{ ...row, ...EXPECTED_PATCH }] },
    serviceRow: { ...row, ...EXPECTED_PATCH },
    serviceRowCount: 1,
  });
  mocks.verifyUpdatedWorkOrderServiceRowReadableFromSupabase.mockResolvedValue({
    ...order,
    serviceRows: [{ ...row, ...EXPECTED_PATCH }],
  });
});

describe("CORE-WRITES-WORKORDERS-A1.2.4a ChangeDateTimeDialog", () => {
  it("changes one-time row date/time through the narrow Supabase mutation and closes after verification", async () => {
    const localGetSpy = vi.spyOn(Storage.prototype, "getItem");
    const localSetSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");
    const onClose = renderDialog();

    fireEvent.change(screen.getByLabelText("Service date"), { target: { value: "2026-06-12" } });
    fireEvent.change(screen.getByLabelText("Planned start time"), { target: { value: "10:00" } });
    fireEvent.change(screen.getByLabelText("Planned end time"), { target: { value: "12:30" } });
    fireEvent.click(screen.getByRole("button", { name: /save date\/time/i }));

    await waitFor(() => expect(mocks.changeOneTimeServiceRowDateTime).toHaveBeenCalledTimes(1));
    expect(mocks.changeOneTimeServiceRowDateTime).toHaveBeenCalledWith({
      companyId: "cmp_stad",
      workOrderId: "wo_1",
      serviceRowId: "worow_1",
      recurrenceInterval: "one_time",
      ...EXPECTED_PATCH,
    });
    const sentPayload = mocks.changeOneTimeServiceRowDateTime.mock.calls[0][0];
    expect(Object.keys(sentPayload).sort()).toEqual([
      "companyId",
      "plannedEndTime",
      "plannedStartTime",
      "recurrenceInterval",
      "serviceDate",
      "serviceRowId",
      "workOrderId",
    ]);
    expect(sentPayload).not.toHaveProperty("serviceEndDate");
    expect(sentPayload).not.toHaveProperty("assignedEmployeeIds");
    expect(sentPayload).not.toHaveProperty("variations");

    expect(mocks.verifyUpdatedWorkOrderServiceRowReadableFromSupabase).toHaveBeenCalledWith({
      companyId: "cmp_stad",
      workOrderId: "wo_1",
      serviceRowId: "worow_1",
      expectedPatch: EXPECTED_PATCH,
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mocks.toast).toHaveBeenCalledWith({ title: "Date/time updated" });
    expectNoLegacyServiceRowPersistence();
    expect(localGetSpy).not.toHaveBeenCalled();
    expect(localSetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();

    localGetSpy.mockRestore();
    localSetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("fails closed for recurring rows before the mutation", async () => {
    const recurringRow: WorkOrderServiceRow = { ...row, recurrenceInterval: "weekly" };
    const onClose = renderDialog(recurringRow);

    fireEvent.click(screen.getByRole("button", { name: /save date\/time/i }));

    expect(await screen.findByText("Temporarily unavailable for recurring services.")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.changeOneTimeServiceRowDateTime).not.toHaveBeenCalled();
    expect(mocks.verifyUpdatedWorkOrderServiceRowReadableFromSupabase).not.toHaveBeenCalled();
    expectNoLegacyServiceRowPersistence();
  });

  it("rejects missing service date before mutation", async () => {
    renderDialog({ ...row, serviceDate: "" });

    fireEvent.click(screen.getByRole("button", { name: /save date\/time/i }));

    expect(await screen.findByText("Service date is required.")).toBeInTheDocument();
    expect(mocks.changeOneTimeServiceRowDateTime).not.toHaveBeenCalled();
    expect(mocks.verifyUpdatedWorkOrderServiceRowReadableFromSupabase).not.toHaveBeenCalled();
  });

  it("rejects invalid time ranges before mutation", async () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText("Planned start time"), { target: { value: "11:00" } });
    fireEvent.change(screen.getByLabelText("Planned end time"), { target: { value: "11:00" } });
    fireEvent.click(screen.getByRole("button", { name: /save date\/time/i }));

    await waitFor(() =>
      expect(screen.getAllByText("Planned end time must be after planned start time.").length).toBeGreaterThan(0),
    );
    expect(mocks.changeOneTimeServiceRowDateTime).not.toHaveBeenCalled();
    expect(mocks.verifyUpdatedWorkOrderServiceRowReadableFromSupabase).not.toHaveBeenCalled();
  });

  it("keeps the dialog open when the RPC fails", async () => {
    mocks.changeOneTimeServiceRowDateTime.mockRejectedValueOnce(new Error("RPC blocked by RLS"));
    const onClose = renderDialog();

    fireEvent.change(screen.getByLabelText("Service date"), { target: { value: "2026-06-12" } });
    fireEvent.click(screen.getByRole("button", { name: /save date\/time/i }));

    expect(await screen.findByText("RPC blocked by RLS")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.verifyUpdatedWorkOrderServiceRowReadableFromSupabase).not.toHaveBeenCalled();
    expectNoLegacyServiceRowPersistence();
  });

  it("keeps the dialog open when fresh Supabase verification fails", async () => {
    mocks.verifyUpdatedWorkOrderServiceRowReadableFromSupabase.mockRejectedValueOnce(
      new Error("Flat child read mismatch"),
    );
    const onClose = renderDialog();

    fireEvent.change(screen.getByLabelText("Service date"), { target: { value: "2026-06-12" } });
    fireEvent.click(screen.getByRole("button", { name: /save date\/time/i }));

    expect(await screen.findByText("Flat child read mismatch")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.changeOneTimeServiceRowDateTime).toHaveBeenCalledTimes(1);
    expectNoLegacyServiceRowPersistence();
  });
});
