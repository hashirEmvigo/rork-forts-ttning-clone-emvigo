import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Service, ServiceCategory, User, WorkOrder, WorkOrderServiceRow } from "@/types";

const mocks = vi.hoisted(() => ({
  addServiceRow: vi.fn(),
  legacyAddWorkOrderServiceRow: vi.fn(),
  hydrateWorkOrderFromRemote: vi.fn(),
  verifyAddedWorkOrderServiceRowReadableFromSupabase: vi.fn(),
  saveWorkOrders: vi.fn(),
  saveBookingQueue: vi.fn(),
  mirrorWorkOrderWrites: vi.fn(),
  mirrorCustomerWrites: vi.fn(),
  toast: vi.fn(),
  hasPermission: vi.fn(),
  getServicesForCompany: vi.fn(),
  getServiceCategoriesForCompany: vi.fn(),
  getCompanyServiceFavorites: vi.fn(),
  isServiceFavorite: vi.fn(),
  toggleServiceFavorite: vi.fn(),
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
    employees: [
      {
        id: "emp_1",
        companyId: "cmp_stad",
        name: "Cleaner One",
        email: "cleaner@example.com",
        status: "active",
        teamIds: [],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    getServicesForCompany: mocks.getServicesForCompany,
    getServiceCategoriesForCompany: mocks.getServiceCategoriesForCompany,
    getCompanyServiceFavorites: mocks.getCompanyServiceFavorites,
    isServiceFavorite: mocks.isServiceFavorite,
    toggleServiceFavorite: mocks.toggleServiceFavorite,
    addWorkOrderServiceRow: mocks.legacyAddWorkOrderServiceRow,
    hydrateWorkOrderFromRemote: mocks.hydrateWorkOrderFromRemote,
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
    addServiceRow: mocks.addServiceRow,
    isPending: false,
    error: null,
  }),
}));

vi.mock("@/lib/data/supabaseWorkOrderRepository", () => ({
  verifyAddedWorkOrderServiceRowReadableFromSupabase: mocks.verifyAddedWorkOrderServiceRowReadableFromSupabase,
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

vi.mock("@/components/ui/command", () => ({
  Command: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandInput: ({
    value,
    onValueChange,
    placeholder,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    placeholder?: string;
  }) => (
    <input
      aria-label="Search services"
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(event) => onValueChange?.(event.currentTarget.value)}
    />
  ),
  CommandList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandEmpty: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandItem: ({
    children,
    onSelect,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
  }) => (
    <div role="button" tabIndex={0} onClick={() => onSelect?.()}>
      {children}
    </div>
  ),
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

vi.mock("@/components/ui/quick-duration-helper", () => ({
  QuickDurationHelper: () => null,
}));

import { AddServiceDialog } from "./WorkOrderDetails";

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

const service: Service = {
  id: "svc_1",
  companyId: "cmp_stad",
  categoryId: "cat_1",
  name: "Deep Clean",
  articleNumber: "A-10",
  serviceType: "Cleaning",
  unit: "hour",
  billingType: "fixed",
  serviceBasisType: "billable",
  deductionEligible: false,
  deductionType: "none",
  price: 500,
  vat: 25,
  smsEnabled: false,
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const category: ServiceCategory = {
  id: "cat_1",
  companyId: "cmp_stad",
  name: "Cleaning",
  description: "",
  sortOrder: 0,
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const addedRow: WorkOrderServiceRow = {
  id: "worow_created",
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

function renderDialog(
  onOpenChange = vi.fn(),
  onServiceAdded = vi.fn(),
): { onOpenChange: ReturnType<typeof vi.fn>; onServiceAdded: ReturnType<typeof vi.fn> } {
  render(
    <AddServiceDialog
      order={order}
      open
      onOpenChange={onOpenChange}
      onServiceAdded={onServiceAdded}
    />,
  );
  return { onOpenChange, onServiceAdded };
}

async function selectServiceAndFillDate(): Promise<void> {
  fireEvent.change(screen.getByPlaceholderText(/search by name/i), { target: { value: "deep" } });
  fireEvent.click(screen.getByRole("button", { name: /deep clean/i }));
  const selectedPanel = screen.getByText("Deep Clean").closest("div");
  expect(selectedPanel).not.toBeNull();
  const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement | null;
  expect(dateInput).not.toBeNull();
  fireEvent.change(dateInput as HTMLInputElement, { target: { value: "2026-06-10" } });
}

function expectNoLegacyServiceRowPersistence(): void {
  expect(mocks.legacyAddWorkOrderServiceRow).not.toHaveBeenCalled();
  expect(mocks.saveWorkOrders).not.toHaveBeenCalled();
  expect(mocks.saveBookingQueue).not.toHaveBeenCalled();
  expect(mocks.mirrorWorkOrderWrites).not.toHaveBeenCalled();
  expect(mocks.mirrorCustomerWrites).not.toHaveBeenCalled();
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.hasPermission.mockReturnValue(true);
  mocks.getServicesForCompany.mockReturnValue([service]);
  mocks.getServiceCategoriesForCompany.mockReturnValue([category]);
  mocks.getCompanyServiceFavorites.mockReturnValue([]);
  mocks.isServiceFavorite.mockReturnValue(false);
  mocks.toggleServiceFavorite.mockReturnValue({ ok: true });
  mocks.getDurationSettingsFor.mockReturnValue({ presetMinutes: [] });
  mocks.getWorkOrderSettingsFor.mockReturnValue({ preferredTimeEvaluationEnabled: false });
  mocks.isCompanyEntitledToService.mockReturnValue(false);
  mocks.addServiceRow.mockResolvedValue({
    workOrder: { ...order, serviceRows: [addedRow] },
    serviceRow: addedRow,
    serviceRowCount: 1,
  });
  mocks.verifyAddedWorkOrderServiceRowReadableFromSupabase.mockResolvedValue({
    ...order,
    serviceRows: [addedRow],
  });
});

describe("CORE-WRITES-WORKORDERS-A1.2.1 AddServiceDialog", () => {
  it("adds a service row through the Supabase mutation and closes only after fresh verification", async () => {
    const localGetSpy = vi.spyOn(Storage.prototype, "getItem");
    const localSetSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");
    const { onOpenChange, onServiceAdded } = renderDialog();

    await selectServiceAndFillDate();
    fireEvent.click(screen.getByRole("button", { name: /^add service$/i }));

    await waitFor(() => expect(mocks.addServiceRow).toHaveBeenCalledTimes(1));
    expect(mocks.addServiceRow).toHaveBeenCalledWith({
      companyId: "cmp_stad",
      workOrderId: "wo_1",
      sourceServiceId: "svc_1",
      serviceName: "Deep Clean",
      articleNumber: "A-10",
      categoryName: "Cleaning",
      serviceType: "Cleaning",
      quantity: 1,
      unit: "hour",
      price: 500,
      vat: 25,
      status: "planned",
      notes: undefined,
      serviceDate: "2026-06-10",
      serviceEndDate: null,
      plannedStartTime: undefined,
      plannedEndTime: undefined,
      assignedEmployeeIds: [],
      unassignedEmployeeSlots: 1,
      recurrenceInterval: "one_time",
    });
    expect(mocks.verifyAddedWorkOrderServiceRowReadableFromSupabase).toHaveBeenCalledWith({
      companyId: "cmp_stad",
      workOrderId: "wo_1",
      serviceRowId: "worow_created",
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mocks.hydrateWorkOrderFromRemote).toHaveBeenCalledWith({ ...order, serviceRows: [addedRow] });
    expect(onServiceAdded).toHaveBeenCalledWith({ ...order, serviceRows: [addedRow] });
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Service added",
      description: "No employee was selected, so 1 open staffing slot was added.",
    });
    expectNoLegacyServiceRowPersistence();
    expect(localGetSpy).not.toHaveBeenCalled();
    expect(localSetSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();

    localGetSpy.mockRestore();
    localSetSpy.mockRestore();
    sessionGetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("keeps the dialog open and shows an inline error when the RPC fails", async () => {
    mocks.addServiceRow.mockRejectedValueOnce(new Error("RPC blocked by RLS"));
    const { onOpenChange, onServiceAdded } = renderDialog();

    await selectServiceAndFillDate();
    fireEvent.click(screen.getByRole("button", { name: /^add service$/i }));

    expect(await screen.findByText("RPC blocked by RLS")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(mocks.verifyAddedWorkOrderServiceRowReadableFromSupabase).not.toHaveBeenCalled();
    expect(mocks.hydrateWorkOrderFromRemote).not.toHaveBeenCalled();
    expect(onServiceAdded).not.toHaveBeenCalled();
    expectNoLegacyServiceRowPersistence();
  });

  it("keeps the dialog open when fresh Supabase verification cannot see the row", async () => {
    mocks.verifyAddedWorkOrderServiceRowReadableFromSupabase.mockRejectedValueOnce(
      new Error("Flat child read missing"),
    );
    const { onOpenChange, onServiceAdded } = renderDialog();

    await selectServiceAndFillDate();
    fireEvent.click(screen.getByRole("button", { name: /^add service$/i }));

    expect(await screen.findByText("Flat child read missing")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(mocks.addServiceRow).toHaveBeenCalledTimes(1);
    expect(mocks.hydrateWorkOrderFromRemote).not.toHaveBeenCalled();
    expect(onServiceAdded).not.toHaveBeenCalled();
    expectNoLegacyServiceRowPersistence();
  });

  it("fails closed before mutation when work-order company scope is missing", async () => {
    const onServiceAdded = vi.fn();
    render(
      <AddServiceDialog
        order={{ ...order, companyId: "" }}
        open
        onOpenChange={vi.fn()}
        onServiceAdded={onServiceAdded}
      />,
    );

    await selectServiceAndFillDate();
    fireEvent.click(screen.getByRole("button", { name: /^add service$/i }));

    expect(await screen.findByText(/selected company context/i)).toBeInTheDocument();
    expect(mocks.addServiceRow).not.toHaveBeenCalled();
    expect(mocks.verifyAddedWorkOrderServiceRowReadableFromSupabase).not.toHaveBeenCalled();
    expect(mocks.hydrateWorkOrderFromRemote).not.toHaveBeenCalled();
    expect(onServiceAdded).not.toHaveBeenCalled();
    expectNoLegacyServiceRowPersistence();
  });
});
