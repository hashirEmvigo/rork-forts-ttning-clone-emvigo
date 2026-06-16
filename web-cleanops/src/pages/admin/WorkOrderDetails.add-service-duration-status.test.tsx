import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Service, ServiceCategory, User, WorkOrder, WorkOrderServiceRow } from "@/types";

/**
 * WORKORDERS-UX-A1.3 — Add Service panel duration behavior + Status preview.
 *
 * Quick start and Quick duration are coupled: a chosen quick duration is
 * preserved when the start time changes (end recalculated), while a manual
 * Planned end edit clears the active quick duration. The Employees column also
 * renders a read-only Status preview (Customer fit / Employee fit) that never
 * blocks saving. This file uses the REAL QuickDurationHelper (not mocked) so the
 * coupling can be exercised end to end.
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
  customerSchedulingPreferences: null as import("@/types").CustomerSchedulingPreferences | null,
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
        schedulingPreferences: mocks.customerSchedulingPreferences ?? undefined,
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

// NOTE: QuickDurationHelper is intentionally NOT mocked here so the quick
// start/duration coupling can be exercised against the real component.

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

const startInput = (): HTMLInputElement => screen.getByLabelText("Planned start time") as HTMLInputElement;
const endInput = (): HTMLInputElement => screen.getByLabelText("Planned end time") as HTMLInputElement;
// 120 min = "2 h · 120 min" preset, 60 min = "1 h · 60 min" preset.
const twoHourPreset = (): HTMLElement => screen.getByTitle("2 h · 120 min");
const oneHourPreset = (): HTMLElement => screen.getByTitle("1 h · 60 min");

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.hasPermission.mockReturnValue(true);
  mocks.getServicesForCompany.mockReturnValue([service]);
  mocks.getServiceCategoriesForCompany.mockReturnValue([category]);
  mocks.getCompanyServiceFavorites.mockReturnValue([]);
  mocks.isServiceFavorite.mockReturnValue(false);
  mocks.toggleServiceFavorite.mockReturnValue({ ok: true });
  mocks.getDurationSettingsFor.mockReturnValue({ presetMinutes: [60, 120] });
  mocks.customerSchedulingPreferences = null;
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

describe("WORKORDERS-UX-A1.3 quick start + duration coupling", () => {
  it("keeps Quick duration disabled until Planned start exists", async () => {
    renderPanel();
    await selectServiceAndFillDate();
    expect(twoHourPreset()).toBeDisabled();
    fireEvent.change(startInput(), { target: { value: "08:00" } });
    expect(twoHourPreset()).not.toBeDisabled();
  });

  it("sets the correct Planned end from start + selected quick duration", async () => {
    renderPanel();
    await selectServiceAndFillDate();
    fireEvent.change(startInput(), { target: { value: "08:00" } });
    fireEvent.click(twoHourPreset());
    expect(endInput().value).toBe("10:00");
  });

  it("preserves the selected duration and recalculates Planned end when start changes", async () => {
    renderPanel();
    await selectServiceAndFillDate();
    fireEvent.change(startInput(), { target: { value: "08:00" } });
    fireEvent.click(twoHourPreset());
    expect(endInput().value).toBe("10:00");
    // Changing start to 09:00 must keep the 2 h duration → 11:00, not 10:00.
    fireEvent.change(startInput(), { target: { value: "09:00" } });
    expect(endInput().value).toBe("11:00");
  });

  it("recalculates Planned end when the quick duration changes after start", async () => {
    renderPanel();
    await selectServiceAndFillDate();
    fireEvent.change(startInput(), { target: { value: "08:00" } });
    fireEvent.click(twoHourPreset());
    expect(endInput().value).toBe("10:00");
    fireEvent.click(oneHourPreset());
    expect(endInput().value).toBe("09:00");
  });

  it("keeps manual Planned end input working and clears the active quick duration", async () => {
    renderPanel();
    await selectServiceAndFillDate();
    fireEvent.change(startInput(), { target: { value: "08:00" } });
    fireEvent.click(twoHourPreset());
    expect(twoHourPreset()).toHaveAttribute("aria-pressed", "true");

    // Manual end edit overrides + deactivates the quick duration.
    fireEvent.change(endInput(), { target: { value: "12:30" } });
    expect(endInput().value).toBe("12:30");
    expect(twoHourPreset()).toHaveAttribute("aria-pressed", "false");

    // Quick duration no longer active, so changing start must NOT move end.
    fireEvent.change(startInput(), { target: { value: "09:00" } });
    expect(endInput().value).toBe("12:30");
  });
});

describe("WORKORDERS-UX-A1.3 Status preview", () => {
  it("renders a Status section with Customer fit and Employee fit below Employees", async () => {
    renderPanel();
    await selectServiceAndFillDate();
    const status = screen.getByLabelText("Status");
    expect(status).toBeInTheDocument();
    const employeesHeading = screen.getByRole("heading", { name: /^employees$/i });
    // Status sits after the Employees heading in the same column.
    expect(employeesHeading.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Customer fit")).toBeInTheDocument();
    expect(screen.getByText("Employee fit")).toBeInTheDocument();
  });

  it("renders Day and Time rows for both Customer fit and Employee fit", async () => {
    renderPanel();
    await selectServiceAndFillDate();
    const status = screen.getByLabelText("Status");
    // Two "Day" + two "Time" labels (one per fit section).
    const within = (text: string): number =>
      Array.from(status.querySelectorAll("span")).filter((el) => el.textContent === text).length;
    expect(within("Day")).toBe(2);
    expect(within("Time")).toBe(2);
  });

  it("shows Not enough data when preferences/date are missing and does not block saving", async () => {
    const { onClose, onServiceAdded } = renderPanel();
    await selectServiceAndFillDate();
    const status = screen.getByLabelText("Status");
    expect(status.textContent).toContain("Not enough data");

    // Status is preview-only — saving still goes through the RPC and closes.
    fireEvent.click(screen.getByRole("button", { name: /^add service$/i }));
    await waitFor(() => expect(mocks.addServiceRow).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mocks.hydrateWorkOrderFromRemote).toHaveBeenCalledWith({ ...order, serviceRows: [addedRow] });
    expect(onServiceAdded).toHaveBeenCalledWith({ ...order, serviceRows: [addedRow] });
    expect(mocks.legacyAddWorkOrderServiceRow).not.toHaveBeenCalled();
    expect(mocks.saveWorkOrders).not.toHaveBeenCalled();
  });

  it("uses preferred recurring windows as Optimal for normal Add Service", async () => {
    mocks.customerSchedulingPreferences = {
      version: 2,
      preferredRecurringWindows: [
        { id: "pref_1", day: "wednesday", startTime: "08:00", endTime: "12:00" },
      ],
      acceptableRecurringWindows: [],
      acceptableTemporaryWindows: [],
      temporaryReschedulingPriority: [],
      preferredDays: [],
      secondaryDays: [],
      absencePriority: [],
    };
    renderPanel();
    await selectServiceAndFillDate();
    fireEvent.change(startInput(), { target: { value: "09:00" } });
    fireEvent.change(endInput(), { target: { value: "11:00" } });

    expect(screen.getByLabelText("Status").textContent).toContain("Optimal");
  });

  it("uses acceptable recurring windows as Acceptable for normal Add Service", async () => {
    mocks.customerSchedulingPreferences = {
      version: 2,
      preferredRecurringWindows: [
        { id: "pref_1", day: "wednesday", startTime: "07:00", endTime: "08:00" },
      ],
      acceptableRecurringWindows: [
        { id: "acc_1", day: "wednesday", startTime: "08:00", endTime: "12:00" },
      ],
      acceptableTemporaryWindows: [],
      temporaryReschedulingPriority: [],
      preferredDays: [],
      secondaryDays: [],
      absencePriority: [],
    };
    renderPanel();
    await selectServiceAndFillDate();
    fireEvent.change(startInput(), { target: { value: "09:00" } });
    fireEvent.change(endInput(), { target: { value: "11:00" } });

    expect(screen.getByLabelText("Status").textContent).toContain("Acceptable");
  });

  it("does not use acceptable temporary windows for normal Add Service", async () => {
    mocks.customerSchedulingPreferences = {
      version: 2,
      preferredRecurringWindows: [],
      acceptableRecurringWindows: [],
      acceptableTemporaryWindows: [
        { id: "temp_1", day: "wednesday", startTime: "08:00", endTime: "12:00" },
      ],
      temporaryReschedulingPriority: [],
      preferredDays: [],
      secondaryDays: [],
      absencePriority: [],
    };
    renderPanel();
    await selectServiceAndFillDate();
    fireEvent.change(startInput(), { target: { value: "09:00" } });
    fireEvent.change(endInput(), { target: { value: "11:00" } });

    expect(screen.getByLabelText("Status").textContent).toContain("Not enough data");
    expect(screen.getByLabelText("Status").textContent).not.toContain("Optimal");
    expect(screen.getByLabelText("Status").textContent).not.toContain("Acceptable");
  });
});
