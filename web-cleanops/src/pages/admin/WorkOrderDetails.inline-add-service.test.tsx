import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Service, ServiceCategory, User, WorkOrder, WorkOrderServiceRow } from "@/types";

/**
 * WORKORDERS-UX-A1 — Inline Add Service panel.
 *
 * The inline panel replaces the Add Service modal but reuses the exact same
 * Supabase-authoritative Add Service Row RPC + fresh read verification. It must
 * structure the entry form into Date & time / Employees / Unit & price sections
 * with a collapsed Summary / Preview, and never reach a legacy mutator.
 */
const mocks = vi.hoisted(() => ({
  addServiceRow: vi.fn(),
  legacyAddWorkOrderServiceRow: vi.fn(),
  hydrateWorkOrderFromRemote: vi.fn(),
  verifyAddedWorkOrderServiceRowReadableFromSupabase: vi.fn(),
  saveWorkOrders: vi.fn(),
  mirrorWorkOrderWrites: vi.fn(),
  toast: vi.fn(),
  hasPermission: vi.fn(),
  getServicesForCompany: vi.fn(),
  getServiceCategoriesForCompany: vi.fn(),
  getCompanyServiceFavorites: vi.fn(),
  isServiceFavorite: vi.fn(),
  toggleServiceFavorite: vi.fn(),
  getDurationSettingsFor: vi.fn(),
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
  verifyUpdatedWorkOrderServiceRowReadableFromSupabase: vi.fn(),
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

import { InlineAddServicePanel } from "./WorkOrderDetails";

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
  quantity: 1,
  unit: "hour",
  price: 500,
  vat: 25,
  status: "planned",
  serviceDate: "2026-06-10",
  assignedEmployeeIds: [],
  unassignedEmployeeSlots: 1,
  recurrenceInterval: "one_time",
  sortOrder: 0,
  archived: false,
  createdAt: "2026-06-05T00:00:00.000Z",
  updatedAt: "2026-06-05T00:00:00.000Z",
};

function renderPanel(
  onClose = vi.fn(),
  onServiceAdded = vi.fn(),
): { onClose: ReturnType<typeof vi.fn>; onServiceAdded: ReturnType<typeof vi.fn> } {
  render(<InlineAddServicePanel order={order} onClose={onClose} onServiceAdded={onServiceAdded} />);
  return { onClose, onServiceAdded };
}

async function selectServiceAndFillDate(): Promise<void> {
  fireEvent.change(screen.getByPlaceholderText(/search by name/i), { target: { value: "deep" } });
  fireEvent.click(screen.getByRole("button", { name: /deep clean/i }));
  const dateInput = screen.getByLabelText("Service date") as HTMLInputElement;
  fireEvent.change(dateInput, { target: { value: "2026-06-10" } });
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

describe("WORKORDERS-UX-A1 InlineAddServicePanel", () => {
  it("renders inline (not a modal) with an Add service heading", () => {
    renderPanel();
    expect(screen.getByRole("heading", { name: /^add service$/i })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the Date & time / Employees / Unit & price sections after selecting a service", async () => {
    renderPanel();
    await selectServiceAndFillDate();
    expect(screen.getByRole("heading", { name: /date & time/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^employees$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /unit & price/i })).toBeInTheDocument();
  });

  it("keeps the Summary / Preview collapsed by default and expands it on click", async () => {
    renderPanel();
    await selectServiceAndFillDate();
    expect(screen.queryByText(/price \(excl\. vat\)/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /summary \/ preview/i }));
    expect(screen.getByText(/price \(excl\. vat\)/i)).toBeInTheDocument();
  });

  it("saves through the Supabase mutation, hydrates the returned WorkOrder, and closes only after fresh verification", async () => {
    const { onClose, onServiceAdded } = renderPanel();
    await selectServiceAndFillDate();
    fireEvent.click(screen.getByRole("button", { name: /^add service$/i }));

    await waitFor(() => expect(mocks.addServiceRow).toHaveBeenCalledTimes(1));
    expect(mocks.verifyAddedWorkOrderServiceRowReadableFromSupabase).toHaveBeenCalledWith({
      companyId: "cmp_stad",
      workOrderId: "wo_1",
      serviceRowId: "worow_created",
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mocks.hydrateWorkOrderFromRemote).toHaveBeenCalledWith({ ...order, serviceRows: [addedRow] });
    expect(onServiceAdded).toHaveBeenCalledWith({ ...order, serviceRows: [addedRow] });
    expect(mocks.legacyAddWorkOrderServiceRow).not.toHaveBeenCalled();
    expect(mocks.saveWorkOrders).not.toHaveBeenCalled();
    expect(mocks.mirrorWorkOrderWrites).not.toHaveBeenCalled();
  });

  it("keeps the panel open with an inline error when the RPC fails", async () => {
    mocks.addServiceRow.mockRejectedValueOnce(new Error("RPC blocked by RLS"));
    const { onClose, onServiceAdded } = renderPanel();
    await selectServiceAndFillDate();
    fireEvent.click(screen.getByRole("button", { name: /^add service$/i }));

    expect(await screen.findByText("RPC blocked by RLS")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.hydrateWorkOrderFromRemote).not.toHaveBeenCalled();
    expect(onServiceAdded).not.toHaveBeenCalled();
    expect(mocks.legacyAddWorkOrderServiceRow).not.toHaveBeenCalled();
  });

  it("renders quick start hour choices and reveals quarter choices on click", async () => {
    renderPanel();
    await selectServiceAndFillDate();
    expect(screen.getByRole("button", { name: "08:00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "17:00" })).toBeInTheDocument();
    // Quarter options are not shown until an hour is picked.
    expect(screen.queryByRole("button", { name: "08:15" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "08:00" }));
    expect(screen.getByRole("button", { name: "08:15" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "08:30" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "08:45" })).toBeInTheDocument();
  });

  it("sets Planned start when a quick quarter is chosen, leaving Planned end untouched", async () => {
    renderPanel();
    await selectServiceAndFillDate();
    fireEvent.click(screen.getByRole("button", { name: "08:00" }));
    fireEvent.click(screen.getByRole("button", { name: "08:15" }));
    const startInput = screen.getByLabelText("Planned start time") as HTMLInputElement;
    const endInput = screen.getByLabelText("Planned end time") as HTMLInputElement;
    expect(startInput.value).toBe("08:15");
    expect(endInput.value).toBe("");
  });

  it("keeps the manual time input working alongside the quick picker", async () => {
    renderPanel();
    await selectServiceAndFillDate();
    const startInput = screen.getByLabelText("Planned start time") as HTMLInputElement;
    fireEvent.change(startInput, { target: { value: "09:30" } });
    expect(startInput.value).toBe("09:30");
  });

  it("shows the Duration as a field-like read-only element with helper minutes", async () => {
    renderPanel();
    await selectServiceAndFillDate();
    fireEvent.change(screen.getByLabelText("Planned start time"), { target: { value: "08:00" } });
    fireEvent.change(screen.getByLabelText("Planned end time"), { target: { value: "10:00" } });
    expect(screen.getByText("Duration")).toBeInTheDocument();
    expect(screen.getByText("2 h")).toBeInTheDocument();
    expect(screen.getByText("120 min")).toBeInTheDocument();
  });

  it("renders Service date and Recurrence next to each other at the top of Date & time", async () => {
    renderPanel();
    await selectServiceAndFillDate();
    const serviceDate = screen.getByLabelText("Service date");
    const dateTimeHeading = screen.getByRole("heading", { name: /date & time/i });
    const quickStart = screen.getByLabelText("Quick start time");
    // Service date sits at the very top of the section, before the quick controls.
    expect(dateTimeHeading.compareDocumentPosition(serviceDate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(serviceDate.compareDocumentPosition(quickStart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Recurrence select shares the same top row grid as Service date.
    const topRow = serviceDate.closest("div.grid");
    expect(topRow).not.toBeNull();
    expect(topRow?.querySelector("select")).not.toBeNull();
  });

  it("renders Quick start time above Planned start", async () => {
    renderPanel();
    await selectServiceAndFillDate();
    const quickStart = screen.getByLabelText("Quick start time");
    const plannedStart = screen.getByLabelText("Planned start time");
    expect(quickStart.compareDocumentPosition(plannedStart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders an employee search input and hides employees until searched", async () => {
    renderPanel();
    await selectServiceAndFillDate();
    expect(screen.getByLabelText("Search employee")).toBeInTheDocument();
    // Search-first: employees are not rendered as primary buttons by default.
    expect(screen.queryByText("Cleaner One")).not.toBeInTheDocument();
  });

  it("filters employees by search, selects as a chip, and removes the chip", async () => {
    renderPanel();
    await selectServiceAndFillDate();
    fireEvent.change(screen.getByLabelText("Search employee"), { target: { value: "clean" } });
    fireEvent.click(screen.getByRole("button", { name: /cleaner one/i }));
    expect(screen.getByLabelText("Selected employees")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /remove cleaner one/i }));
    expect(screen.queryByLabelText("Selected employees")).not.toBeInTheDocument();
  });

  it("shows No employees found when the search has no match", async () => {
    renderPanel();
    await selectServiceAndFillDate();
    fireEvent.change(screen.getByLabelText("Search employee"), { target: { value: "zzz" } });
    expect(screen.getByText(/no employees found/i)).toBeInTheDocument();
  });

  it("reserves a stable height for the quick start picker in both hour and quarter modes", async () => {
    renderPanel();
    await selectServiceAndFillDate();
    const hourChips = screen.getByRole("button", { name: "08:00" }).closest("div");
    expect(hourChips?.className).toMatch(/min-h-/);
    fireEvent.click(screen.getByRole("button", { name: "08:00" }));
    const quarterChips = screen.getByRole("button", { name: "08:15" }).closest("div");
    expect(quarterChips?.className).toMatch(/min-h-/);
  });

  it("shows the redesigned two-section summary without raw minutes", async () => {
    renderPanel();
    await selectServiceAndFillDate();
    fireEvent.change(screen.getByLabelText("Planned start time"), { target: { value: "08:00" } });
    fireEvent.change(screen.getByLabelText("Planned end time"), { target: { value: "10:00" } });
    fireEvent.click(screen.getByRole("button", { name: /summary \/ preview/i }));

    // Main booking section.
    expect(screen.getByText("Service")).toBeInTheDocument();
    expect(screen.getByText(/08:00.*10:00.*\(2 h\)/)).toBeInTheDocument();
    expect(screen.getByText("Total cleaning time")).toBeInTheDocument();
    expect(screen.getByText("Employee")).toBeInTheDocument();
    // Details section (these labels also exist as form fields, so allow >= 1).
    expect(screen.getAllByText("Recurrence").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Quantity").length).toBeGreaterThan(0);
    expect(screen.getByText(/price \(excl\. vat\)/i)).toBeInTheDocument();
    // No raw minutes in the summary time line.
    expect(screen.queryByText(/\(120 minutes\)/)).not.toBeInTheDocument();
  });
});
