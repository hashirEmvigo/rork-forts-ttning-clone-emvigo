import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Customer, User, WorkOrder, WorkOrderServiceRow } from "@/types";

/**
 * WORKORDERS-UX-A1 — Services tab layout cleanup.
 *
 * Toolbar order (Add Service left / Show archived right), the Duration column,
 * the reordered column header sequence, the inline (non-modal) Add Service
 * panel, and the customer-context sections rendered below the list.
 */
const mocks = vi.hoisted(() => ({
  currentUser: {
    id: "usr_admin",
    name: "Admin User",
    role: "company_admin",
    companyId: "cmp_stad",
    email: "admin@example.com",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
  } as User,
  detailResult: {
    workOrder: null as WorkOrder | null,
    source: "supabase" as const,
    loading: false,
    error: null as string | null,
    shadow: null,
  },
  getWorkOrder: vi.fn(),
  hydrateWorkOrderFromRemote: vi.fn(),
  getTimeReportsForWorkOrder: vi.fn(),
  hasPermission: vi.fn(),
  getUserPermissions: vi.fn(),
  updateWorkOrder: vi.fn(),
  addWorkOrderNote: vi.fn(),
  updateWorkOrderNote: vi.fn(),
  setWorkOrderNoteArchived: vi.fn(),
  getServicesForCompany: vi.fn(),
  getServiceCategoriesForCompany: vi.fn(),
  getCompanyServiceFavorites: vi.fn(),
  isServiceFavorite: vi.fn(),
  toggleServiceFavorite: vi.fn(),
  getWorkOrderSettingsFor: vi.fn(),
  getTimeReportSettingsFor: vi.fn(),
  getDurationSettingsFor: vi.fn(),
  isCompanyEntitledToService: vi.fn(),
  addWorkOrderMediaPlacement: vi.fn(),
  changeOneTimeServiceRowDateTime: vi.fn(),
  addServiceRow: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

vi.mock("@/components/workorder/WorkOrderImages", () => ({
  WorkOrderImages: () => <div data-testid="work-order-images" />,
}));

vi.mock("@/components/workorder/WorkOrderMediaPlacements", () => ({
  WorkOrderHeaderImages: () => <div data-testid="work-order-header-images" />,
  ServiceRowImages: () => <div data-testid="service-row-images" />,
}));

vi.mock("@/components/workorder/ServiceProtocolLink", () => ({
  ServiceProtocolLink: () => <div data-testid="service-protocol-link" />,
}));

vi.mock("@/components/notes/NotesCard", () => ({
  NotesCard: () => <div data-testid="notes-card" />,
}));

vi.mock("@/components/customer/CustomerSchedulingSummary", () => ({
  CustomerSchedulingSummary: ({ preferences }: { preferences?: { schedulingNotes?: string } | null }) => (
    <div data-testid="customer-scheduling-summary">{preferences?.schedulingNotes ?? "No preferences"}</div>
  ),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/hooks/use-customer-mutations", () => ({
  useCustomerMutations: () => ({ updateCustomer: vi.fn() }),
}));

vi.mock("@/hooks/use-work-order-mutations", () => ({
  useWorkOrderMutations: () => ({
    createWorkOrder: vi.fn(),
    addServiceRow: mocks.addServiceRow,
    updateServiceRow: vi.fn(),
    changeOneTimeServiceRowDateTime: mocks.changeOneTimeServiceRowDateTime,
    isPending: false,
    error: null,
  }),
}));

vi.mock("@/hooks/use-work-order-detail-source", () => ({
  useWorkOrderDetailSource: vi.fn((_localOrder, _workOrderId, _detailScope) => mocks.detailResult),
}));

vi.mock("@/lib/data/supabaseWorkOrderRepository", () => ({
  verifyAddedWorkOrderServiceRowReadableFromSupabase: vi.fn(),
  verifyUpdatedWorkOrderServiceRowReadableFromSupabase: vi.fn(),
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
  CommandItem: ({ children, onSelect }: { children: React.ReactNode; onSelect?: () => void }) => (
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

vi.mock("@/context/AppContext", () => ({
  useApp: () => ({
    currentUser: mocks.currentUser,
    customers,
    employees: [],
    users: [],
    timeReports: [],
    bookingOccurrenceExceptions: [],
    systemSettings: { allowPreferredTimeEvaluation: false },
    getWorkOrder: mocks.getWorkOrder,
    hydrateWorkOrderFromRemote: mocks.hydrateWorkOrderFromRemote,
    getTimeReportsForWorkOrder: mocks.getTimeReportsForWorkOrder,
    hasPermission: mocks.hasPermission,
    getUserPermissions: mocks.getUserPermissions,
    updateWorkOrder: mocks.updateWorkOrder,
    addWorkOrderNote: mocks.addWorkOrderNote,
    updateWorkOrderNote: mocks.updateWorkOrderNote,
    setWorkOrderNoteArchived: mocks.setWorkOrderNoteArchived,
    getServicesForCompany: mocks.getServicesForCompany,
    getServiceCategoriesForCompany: mocks.getServiceCategoriesForCompany,
    getCompanyServiceFavorites: mocks.getCompanyServiceFavorites,
    isServiceFavorite: mocks.isServiceFavorite,
    toggleServiceFavorite: mocks.toggleServiceFavorite,
    getWorkOrderSettingsFor: mocks.getWorkOrderSettingsFor,
    getTimeReportSettingsFor: mocks.getTimeReportSettingsFor,
    getDurationSettingsFor: mocks.getDurationSettingsFor,
    isCompanyEntitledToService: mocks.isCompanyEntitledToService,
    addWorkOrderMediaPlacement: mocks.addWorkOrderMediaPlacement,
  }),
}));

import WorkOrderDetails from "./WorkOrderDetails";

const customers: Customer[] = [
  {
    id: "cust_1",
    companyId: "cmp_stad",
    name: "Acme Offices",
    customerNumber: "C-1001",
    email: "contact@example.com",
    status: "active",
    userIds: [],
    schedulingPreferences: {
      version: 2,
      preferredRecurringWindows: [
        {
          id: "pref_monday",
          day: "monday",
          startTime: "09:00",
          endTime: "12:00",
          label: "Preferred recurring cleaning times",
        },
      ],
      acceptableRecurringWindows: [],
      acceptableTemporaryWindows: [],
      temporaryReschedulingPriority: [],
      preferredDays: [],
      secondaryDays: [],
      absencePriority: [],
      schedulingNotes: "Use saved V2 planning guidance",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as Customer,
];

const serviceRow: WorkOrderServiceRow = {
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

const orderWithRow: WorkOrder = {
  id: "wo_1",
  companyId: "cmp_stad",
  customerId: "cust_1",
  number: "WO-1001",
  title: "Weekly cleaning",
  status: "draft",
  notes: [],
  serviceRows: [serviceRow],
  activity: [],
  mediaPlacements: [],
  createdAt: "2026-06-05T00:00:00.000Z",
  updatedAt: "2026-06-05T00:00:00.000Z",
};

function renderDetails(): void {
  render(
    <MemoryRouter initialEntries={["/work-orders/wo_1"]}>
      <Routes>
        <Route path="/work-orders/:workOrderId" element={<WorkOrderDetails />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.detailResult = {
    workOrder: orderWithRow,
    source: "supabase",
    loading: false,
    error: null,
    shadow: null,
  };
  mocks.getWorkOrder.mockReturnValue(orderWithRow);
  mocks.getTimeReportsForWorkOrder.mockReturnValue([]);
  mocks.hasPermission.mockReturnValue(true);
  mocks.getUserPermissions.mockReturnValue(["workOrders.view", "workOrders.manage"]);
  mocks.getServicesForCompany.mockReturnValue([]);
  mocks.getServiceCategoriesForCompany.mockReturnValue([]);
  mocks.getCompanyServiceFavorites.mockReturnValue([]);
  mocks.isServiceFavorite.mockReturnValue(false);
  mocks.getWorkOrderSettingsFor.mockReturnValue({ preferredTimeEvaluationEnabled: false });
  mocks.getTimeReportSettingsFor.mockReturnValue({ enabled: false });
  mocks.getDurationSettingsFor.mockReturnValue({ presetMinutes: [] });
  mocks.isCompanyEntitledToService.mockReturnValue(false);
});

describe("WORKORDERS-UX-A1 Services tab layout", () => {
  it("places Add Service before Show archived services in the toolbar", () => {
    renderDetails();
    const addButton = screen.getByRole("button", { name: /add service/i });
    const archivedLabel = screen.getByText(/show archived services/i);
    expect(addButton.compareDocumentPosition(archivedLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders the reordered column headers with Duration as its own column", () => {
    renderDetails();
    const headers = screen
      .getAllByRole("columnheader")
      .map((h) => h.textContent?.trim())
      .filter((t) => t && t.length > 0);
    expect(headers).toEqual([
      "Service",
      "Date",
      "End",
      "Time",
      "Duration",
      "Total Time",
      "Employees",
      "Recurrence",
      "Qty",
      "Price",
      "Variations",
      "Actions",
    ]);
  });

  it("opens the inline Add Service panel (not a modal) when Add Service is clicked", () => {
    renderDetails();
    expect(screen.queryByRole("heading", { name: /^add service$/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /add service/i }));
    expect(screen.getByRole("heading", { name: /^add service$/i })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the customer cleaning days & times context section below the list", () => {
    renderDetails();
    const table = screen.getByRole("table");
    const schedulingSummary = screen.getByTestId("customer-scheduling-summary");
    expect(schedulingSummary).toHaveTextContent("Use saved V2 planning guidance");
    expect(table.compareDocumentPosition(schedulingSummary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps Add Service and Show archived in the same row as the section tabs", () => {
    renderDetails();
    const addButton = screen.getByRole("button", { name: /add service/i });
    const servicesTab = screen.getByRole("tab", { name: /services/i });
    const archivedLabel = screen.getByText(/show archived services/i);
    // Add Service shares the tab-list row container with the Services tab.
    const leftGroup = addButton.parentElement;
    expect(leftGroup?.contains(servicesTab)).toBe(true);
    // The full row (tabs + actions) also holds the right-side archived toggle.
    expect(leftGroup?.parentElement?.contains(archivedLabel)).toBe(true);
  });

  it("renders Protocol and Images sub-sections on the same row, collapsed by default", () => {
    renderDetails();
    const protocol = screen.getByRole("button", { name: /^protocol$/i });
    const images = screen.getByRole("button", { name: /^images$/i });
    const row = protocol.closest("div.grid");
    expect(row).not.toBeNull();
    expect(row?.contains(images)).toBe(true);
    // Protocol comes before Images, and both are collapsed (content not mounted).
    expect(protocol.compareDocumentPosition(images) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByTestId("service-protocol-link")).not.toBeInTheDocument();
  });
});
