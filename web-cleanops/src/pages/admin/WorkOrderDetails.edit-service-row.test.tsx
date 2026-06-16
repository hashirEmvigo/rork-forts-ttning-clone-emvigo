import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { User, WorkOrder, WorkOrderServiceRow } from "@/types";

/**
 * CORE-WRITES-WORKORDERS-A1.2.3 — Edit service row via the transactional
 * `update_work_order_service_row` RPC only. The dialog must:
 *  - send only the allowlisted, non-date/time fields,
 *  - close only after the RPC succeeds AND a fresh Supabase read verifies it,
 *  - keep itself open with a recoverable error on RPC or verification failure,
 *  - never touch a legacy AppContext mutator, localStorage, or a dual-write mirror.
 */
const mocks = vi.hoisted(() => ({
  updateServiceRow: vi.fn(),
  legacyUpdateWorkOrderServiceRow: vi.fn(),
  legacyAddWorkOrderServiceRow: vi.fn(),
  verifyUpdatedWorkOrderServiceRowReadableFromSupabase: vi.fn(),
  saveWorkOrders: vi.fn(),
  mirrorWorkOrderWrites: vi.fn(),
  mirrorCustomerWrites: vi.fn(),
  toast: vi.fn(),
  hasPermission: vi.fn(),
  getDurationSettingsFor: vi.fn(),
  getWorkOrderSettingsFor: vi.fn(),
  isCompanyEntitledToService: vi.fn(),
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
    customers: [
      {
        id: "cust_1",
        companyId: "cmp_stad",
        name: "Acme Offices",
        customerNumber: "C-1001",
        email: "contact@example.com",
        status: "active",
        userIds: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    employees: [],
    updateWorkOrderServiceRow: mocks.legacyUpdateWorkOrderServiceRow,
    addWorkOrderServiceRow: mocks.legacyAddWorkOrderServiceRow,
    getDurationSettingsFor: mocks.getDurationSettingsFor,
    systemSettings: { allowPreferredTimeEvaluation: false },
    getWorkOrderSettingsFor: mocks.getWorkOrderSettingsFor,
    isCompanyEntitledToService: mocks.isCompanyEntitledToService,
    hasPermission: mocks.hasPermission,
  }),
}));

vi.mock("@/hooks/use-work-order-mutations", () => ({
  useWorkOrderMutations: () => ({
    createWorkOrder: vi.fn(),
    addServiceRow: vi.fn(),
    updateServiceRow: mocks.updateServiceRow,
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

vi.mock("@/components/ui/select", () => {
  const Select = ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children: React.ReactNode;
  }) => (
    <select aria-label="Select" value={value ?? ""} onChange={(event) => onValueChange?.(event.target.value)}>
      {children}
    </select>
  );
  const SelectContent = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  const SelectItem = ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  );
  return {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    SelectValue: () => null,
  };
});

vi.mock("@/components/ui/time-picker", () => ({
  TimePicker: ({
    value,
    onChange,
    disabled,
    "aria-label": ariaLabel,
  }: {
    value?: string;
    onChange?: (value: string) => void;
    disabled?: boolean;
    "aria-label"?: string;
  }) => (
    <input
      aria-label={ariaLabel ?? "Time"}
      value={value ?? ""}
      disabled={disabled}
      onChange={(event) => onChange?.(event.currentTarget.value)}
    />
  ),
}));

vi.mock("@/components/ui/quick-duration-helper", () => ({
  QuickDurationHelper: () => null,
}));

import { EditServiceDialog } from "./WorkOrderDetails";

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

// Normal Edit Service Row patches only safe commercial fields. The service
// snapshot fields (name / article / category / type) are locked, and date/time
// and recurrence editing belong to later slices, so none of them appear here.
const EXPECTED_BASE_PATCH = {
  quantity: 2,
  unit: "hour",
  price: 500,
  vat: 25,
  status: "planned" as const,
  notes: null,
};

function renderDialog(onClose = vi.fn()): ReturnType<typeof vi.fn> {
  render(<EditServiceDialog order={order} row={row} onClose={onClose} />);
  return onClose;
}

function expectNoLegacyServiceRowPersistence(): void {
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
  mocks.getDurationSettingsFor.mockReturnValue({ presetMinutes: [] });
  mocks.getWorkOrderSettingsFor.mockReturnValue({ preferredTimeEvaluationEnabled: false });
  mocks.isCompanyEntitledToService.mockReturnValue(false);
  mocks.updateServiceRow.mockResolvedValue({
    workOrder: { ...order, serviceRows: [row] },
    serviceRow: row,
    serviceRowCount: 1,
  });
  mocks.verifyUpdatedWorkOrderServiceRowReadableFromSupabase.mockResolvedValue({
    ...order,
    serviceRows: [row],
  });
});

describe("CORE-WRITES-WORKORDERS-A1.2.3 EditServiceDialog", () => {
  it("locks the service snapshot fields so they cannot be edited as free text", () => {
    renderDialog();

    const serviceNameInput = screen.getByLabelText("Service name (locked)");
    const articleInput = screen.getByLabelText("Article number (locked)");
    const categoryInput = screen.getByLabelText("Category (locked)");
    const serviceTypeInput = screen.getByLabelText("Service type (locked)");

    expect(serviceNameInput).toBeDisabled();
    expect(serviceNameInput).toHaveAttribute("readonly");
    expect(articleInput).toBeDisabled();
    expect(articleInput).toHaveAttribute("readonly");
    expect(categoryInput).toBeDisabled();
    expect(categoryInput).toHaveAttribute("readonly");
    expect(serviceTypeInput).toBeDisabled();
    expect(serviceTypeInput).toHaveAttribute("readonly");
  });

  it("uses the sectioned card design shared with Add Service", () => {
    renderDialog();
    expect(screen.getByRole("heading", { name: /^service$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /date & time/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /unit & price/i })).toBeInTheDocument();
  });

  it("keeps date, time and recurrence locked/read-only in normal edit", () => {
    renderDialog();
    const serviceDate = screen.getByLabelText("Service date (locked)");
    const plannedStart = screen.getByLabelText("Planned start (locked)");
    const plannedEnd = screen.getByLabelText("Planned end (locked)");
    const recurrence = screen.getByLabelText("Recurrence (locked)");
    expect(serviceDate).toBeDisabled();
    expect(serviceDate).toHaveAttribute("readonly");
    expect(plannedStart).toBeDisabled();
    expect(plannedEnd).toBeDisabled();
    expect(recurrence).toBeDisabled();
  });

  it("edits safe fields through the RPC, sends only allowlisted fields, and closes after verification", async () => {
    const localGetSpy = vi.spyOn(Storage.prototype, "getItem");
    const localSetSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");
    const onClose = renderDialog();

    fireEvent.change(screen.getByDisplayValue("2"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(mocks.updateServiceRow).toHaveBeenCalledTimes(1));
    const expectedPatch = { ...EXPECTED_BASE_PATCH, quantity: 3 };
    expect(mocks.updateServiceRow).toHaveBeenCalledWith({
      companyId: "cmp_stad",
      workOrderId: "wo_1",
      serviceRowId: "worow_1",
      patch: expectedPatch,
    });
    // Snapshot, date/time and recurrence fields must never be in the patch.
    const sentPatch = mocks.updateServiceRow.mock.calls[0][0].patch;
    expect(sentPatch).not.toHaveProperty("serviceName");
    expect(sentPatch).not.toHaveProperty("articleNumber");
    expect(sentPatch).not.toHaveProperty("categoryName");
    expect(sentPatch).not.toHaveProperty("serviceType");
    expect(sentPatch).not.toHaveProperty("recurrenceInterval");
    expect(sentPatch).not.toHaveProperty("serviceDate");
    expect(sentPatch).not.toHaveProperty("serviceEndDate");
    expect(sentPatch).not.toHaveProperty("plannedStartTime");
    expect(sentPatch).not.toHaveProperty("plannedEndTime");

    expect(mocks.verifyUpdatedWorkOrderServiceRowReadableFromSupabase).toHaveBeenCalledWith({
      companyId: "cmp_stad",
      workOrderId: "wo_1",
      serviceRowId: "worow_1",
      expectedPatch,
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mocks.toast).toHaveBeenCalledWith({ title: "Service updated" });
    expectNoLegacyServiceRowPersistence();
    expect(localGetSpy).not.toHaveBeenCalled();
    expect(localSetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();

    localGetSpy.mockRestore();
    localSetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("keeps the dialog open and shows an inline error when the RPC fails", async () => {
    mocks.updateServiceRow.mockRejectedValueOnce(new Error("RPC blocked by RLS"));
    const onClose = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByText("RPC blocked by RLS")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.verifyUpdatedWorkOrderServiceRowReadableFromSupabase).not.toHaveBeenCalled();
    expectNoLegacyServiceRowPersistence();
  });

  it("keeps the dialog open when fresh Supabase verification cannot confirm the update", async () => {
    mocks.verifyUpdatedWorkOrderServiceRowReadableFromSupabase.mockRejectedValueOnce(
      new Error("Flat child read mismatch"),
    );
    const onClose = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByText("Flat child read mismatch")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.updateServiceRow).toHaveBeenCalledTimes(1);
    expectNoLegacyServiceRowPersistence();
  });

  it("fails closed before mutation when work-order company scope is missing", async () => {
    render(<EditServiceDialog order={{ ...order, companyId: "" }} row={row} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByText(/company and work order context/i)).toBeInTheDocument();
    expect(mocks.updateServiceRow).not.toHaveBeenCalled();
    expect(mocks.verifyUpdatedWorkOrderServiceRowReadableFromSupabase).not.toHaveBeenCalled();
    expectNoLegacyServiceRowPersistence();
  });
});
