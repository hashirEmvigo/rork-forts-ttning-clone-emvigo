import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Customer, Service, ServiceCategory, TimeReport, User, WorkOrder, WorkOrderServiceRow } from "@/types";

/**
 * CORE-WRITES-WORKORDERS-A1.2.2a-reset — service-row safety gate.
 *
 * Add Service Row stays on the accepted Supabase RPC path. Archive/restore use
 * the supported update-service RPC path for the `archived` flag. Delete/remove
 * uses the Supabase remove-service RPC after protected-history guards clear.
 * Remaining service-row mutations here stay gated and must never reach a legacy
 * AppContext mutator.
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
  timeReports: [] as TimeReport[],
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
  addServiceRow: vi.fn(),
  updateServiceRow: vi.fn(),
  changeOneTimeServiceRowDateTime: vi.fn(),
  archiveServiceRow: vi.fn(),
  restoreServiceRow: vi.fn(),
  removeServiceRow: vi.fn(),
  verifyAddedWorkOrderServiceRowReadableFromSupabase: vi.fn(),
  verifyRemovedWorkOrderServiceRowReadableFromSupabase: vi.fn(),
  verifyUpdatedWorkOrderServiceRowReadableFromSupabase: vi.fn(),
  // Legacy service-row mutators that must NOT be reachable for gated actions.
  updateWorkOrderServiceRow: vi.fn(),
  setWorkOrderServiceRowArchived: vi.fn(),
  deleteWorkOrderServiceRow: vi.fn(),
  forceDeleteWorkOrderServiceRow: vi.fn(),
  reorderWorkOrderServiceRows: vi.fn(),
  addWorkOrderServiceRow: vi.fn(),
  submitTimeReportCheckout: vi.fn(),
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
  CustomerSchedulingSummary: () => <div data-testid="customer-scheduling-summary" />,
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
    updateServiceRow: mocks.updateServiceRow,
    changeOneTimeServiceRowDateTime: mocks.changeOneTimeServiceRowDateTime,
    archiveServiceRow: mocks.archiveServiceRow,
    restoreServiceRow: mocks.restoreServiceRow,
    removeServiceRow: mocks.removeServiceRow,
    isPending: false,
    error: null,
  }),
}));

vi.mock("@/hooks/use-work-order-detail-source", () => ({
  useWorkOrderDetailSource: vi.fn((_localOrder, _workOrderId, _detailScope) => mocks.detailResult),
}));

vi.mock("@/lib/data/supabaseWorkOrderRepository", () => ({
  verifyAddedWorkOrderServiceRowReadableFromSupabase:
    mocks.verifyAddedWorkOrderServiceRowReadableFromSupabase,
  verifyRemovedWorkOrderServiceRowReadableFromSupabase:
    mocks.verifyRemovedWorkOrderServiceRowReadableFromSupabase,
  verifyUpdatedWorkOrderServiceRowReadableFromSupabase:
    mocks.verifyUpdatedWorkOrderServiceRowReadableFromSupabase,
}));

vi.mock("@/context/AppContext", () => ({
  useApp: () => ({
    currentUser: mocks.currentUser,
    customers,
    employees: [],
    users: [],
    timeReports: mocks.timeReports,
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
    updateWorkOrderServiceRow: mocks.updateWorkOrderServiceRow,
    setWorkOrderServiceRowArchived: mocks.setWorkOrderServiceRowArchived,
    deleteWorkOrderServiceRow: mocks.deleteWorkOrderServiceRow,
    forceDeleteWorkOrderServiceRow: mocks.forceDeleteWorkOrderServiceRow,
    reorderWorkOrderServiceRows: mocks.reorderWorkOrderServiceRows,
    addWorkOrderServiceRow: mocks.addWorkOrderServiceRow,
    submitTimeReportCheckout: mocks.submitTimeReportCheckout,
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
  serviceDate: "2026-05-01",
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

const addedServiceRow: WorkOrderServiceRow = {
  ...serviceRow,
  id: "worow_added",
  sourceServiceId: "svc_2",
  serviceName: "Window Wash",
  articleNumber: "A-20",
  serviceDate: "2026-06-10",
  sortOrder: 1,
  createdAt: "2026-06-06T00:00:00.000Z",
  updatedAt: "2026-06-06T00:00:00.000Z",
};

const serviceCatalogItem: Service = {
  id: "svc_2",
  companyId: "cmp_stad",
  categoryId: "cat_1",
  name: "Window Wash",
  articleNumber: "A-20",
  serviceType: "Cleaning",
  unit: "hour",
  billingType: "fixed",
  serviceBasisType: "billable",
  deductionEligible: false,
  deductionType: "none",
  price: 450,
  vat: 25,
  smsEnabled: false,
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const serviceCategory: ServiceCategory = {
  id: "cat_1",
  companyId: "cmp_stad",
  name: "Cleaning",
  description: "",
  sortOrder: 0,
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
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

const UNAVAILABLE_TOAST = {
  title: "Temporarily unavailable",
  description: "This action is being updated and is not available yet.",
  variant: "destructive" as const,
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

function expectNoLegacyServiceRowMutators(): void {
  expect(mocks.changeOneTimeServiceRowDateTime).not.toHaveBeenCalled();
  expect(mocks.updateWorkOrderServiceRow).not.toHaveBeenCalled();
  expect(mocks.setWorkOrderServiceRowArchived).not.toHaveBeenCalled();
  expect(mocks.deleteWorkOrderServiceRow).not.toHaveBeenCalled();
  expect(mocks.forceDeleteWorkOrderServiceRow).not.toHaveBeenCalled();
  expect(mocks.reorderWorkOrderServiceRows).not.toHaveBeenCalled();
  expect(mocks.addWorkOrderServiceRow).not.toHaveBeenCalled();
  expect(mocks.submitTimeReportCheckout).not.toHaveBeenCalled();
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.timeReports = [];
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
  mocks.addServiceRow.mockResolvedValue({
    workOrder: { ...orderWithRow, serviceRows: [serviceRow, addedServiceRow] },
    serviceRow: addedServiceRow,
    serviceRowCount: 2,
  });
  mocks.verifyAddedWorkOrderServiceRowReadableFromSupabase.mockResolvedValue({
    ...orderWithRow,
    serviceRows: [serviceRow, addedServiceRow],
  });
  mocks.updateServiceRow.mockResolvedValue({
    workOrder: orderWithRow,
    serviceRow,
    serviceRowCount: 1,
  });
  mocks.archiveServiceRow.mockResolvedValue({
    workOrder: { ...orderWithRow, serviceRows: [{ ...serviceRow, archived: true }] },
    serviceRow: { ...serviceRow, archived: true },
    serviceRowCount: 1,
  });
  mocks.restoreServiceRow.mockResolvedValue({
    workOrder: { ...orderWithRow, serviceRows: [{ ...serviceRow, archived: false }] },
    serviceRow: { ...serviceRow, archived: false },
    serviceRowCount: 1,
  });
  mocks.removeServiceRow.mockResolvedValue({
    workOrder: { ...orderWithRow, serviceRows: [] },
    serviceRow,
    serviceRowCount: 0,
  });
  mocks.verifyRemovedWorkOrderServiceRowReadableFromSupabase.mockResolvedValue({
    ...orderWithRow,
    serviceRows: [],
  });
  mocks.verifyUpdatedWorkOrderServiceRowReadableFromSupabase.mockResolvedValue({
    ...orderWithRow,
    serviceRows: [{ ...serviceRow, archived: true }],
  });
});

describe("CORE-WRITES-WORKORDERS-A1.2.2a-reset service-row safety gate", () => {
  it("renders the existing service row with Add Service available", () => {
    renderDetails();
    expect(screen.getByText("Deep Clean")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add service/i })).toBeInTheDocument();
  });

  it("renders a newly added service row immediately from the Supabase mutation result", async () => {
    const localGetSpy = vi.spyOn(Storage.prototype, "getItem");
    const localSetSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");
    mocks.getServicesForCompany.mockReturnValue([serviceCatalogItem]);
    mocks.getServiceCategoriesForCompany.mockReturnValue([serviceCategory]);

    renderDetails();
    fireEvent.click(screen.getByRole("button", { name: /add service/i }));
    fireEvent.change(screen.getByPlaceholderText(/search by name/i), { target: { value: "window" } });
    fireEvent.click(screen.getByRole("option", { name: /window wash/i }));
    fireEvent.change(screen.getByLabelText("Service date"), { target: { value: "2026-06-10" } });
    fireEvent.click(screen.getAllByRole("button", { name: /^add service$/i }).at(-1) as HTMLElement);

    await waitFor(() => expect(mocks.addServiceRow).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("Window Wash")).toBeInTheDocument());
    expect(mocks.verifyAddedWorkOrderServiceRowReadableFromSupabase).toHaveBeenCalledWith({
      companyId: "cmp_stad",
      workOrderId: "wo_1",
      serviceRowId: "worow_added",
    });
    expect(mocks.hydrateWorkOrderFromRemote).toHaveBeenCalledWith({
      ...orderWithRow,
      serviceRows: [serviceRow, addedServiceRow],
    });
    expect(mocks.addWorkOrderServiceRow).not.toHaveBeenCalled();
    expectNoLegacyServiceRowMutators();
    expect(localGetSpy).not.toHaveBeenCalled();
    expect(localSetSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();

    localGetSpy.mockRestore();
    localSetSpy.mockRestore();
    sessionGetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("opens the Edit dialog (A1.2.3 RPC path) without calling a legacy mutator", () => {
    renderDetails();
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument();
    expect(mocks.toast).not.toHaveBeenCalledWith(UNAVAILABLE_TOAST);
    expectNoLegacyServiceRowMutators();
  });

  it("archives a historical eligible service row through the supported Supabase archive path", async () => {
    const localGetSpy = vi.spyOn(Storage.prototype, "getItem");
    const localSetSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");
    const archivedOrder = { ...orderWithRow, serviceRows: [{ ...serviceRow, archived: true }] };
    mocks.verifyUpdatedWorkOrderServiceRowReadableFromSupabase.mockResolvedValueOnce(archivedOrder);

    renderDetails();
    fireEvent.click(screen.getByRole("button", { name: /^archive$/i }));

    expect(screen.getByText("Archive service?")).toBeInTheDocument();
    expect(screen.queryByText("This service is still active and cannot be archived.")).not.toBeInTheDocument();
    expect(screen.queryByText(/Archive\/restore requires/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /archive anyway/i }));

    await waitFor(() => expect(mocks.archiveServiceRow).toHaveBeenCalledTimes(1));
    expect(mocks.archiveServiceRow).toHaveBeenCalledWith({
      companyId: "cmp_stad",
      workOrderId: "wo_1",
      serviceRowId: "worow_1",
    });
    expect(mocks.verifyUpdatedWorkOrderServiceRowReadableFromSupabase).toHaveBeenCalledWith({
      companyId: "cmp_stad",
      workOrderId: "wo_1",
      serviceRowId: "worow_1",
      expectedPatch: { archived: true },
    });
    expect(mocks.hydrateWorkOrderFromRemote).toHaveBeenCalledWith(archivedOrder);
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Service archived",
      description: "Deep Clean has been archived.",
    });
    expect(mocks.toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringMatching(/RPC migration/i) }),
    );
    expectNoLegacyServiceRowMutators();
    expect(localGetSpy).not.toHaveBeenCalled();
    expect(localSetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();

    localGetSpy.mockRestore();
    localSetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("blocks a future service row with the business-rule message before archive mutation", () => {
    const futureRow = { ...serviceRow, serviceDate: "2099-05-01" };
    mocks.detailResult = {
      workOrder: {
        ...orderWithRow,
        serviceRows: [futureRow],
      },
      source: "supabase",
      loading: false,
      error: null,
      shadow: null,
    };
    mocks.getWorkOrder.mockReturnValue(mocks.detailResult.workOrder);

    renderDetails();
    fireEvent.click(screen.getByRole("button", { name: /^archive$/i }));

    expect(screen.getByText("Cannot archive service")).toBeInTheDocument();
    expect(screen.getByText("This service has future occurrences and cannot be archived yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /archive anyway/i })).not.toBeInTheDocument();
    expect(mocks.archiveServiceRow).not.toHaveBeenCalled();
    expect(mocks.restoreServiceRow).not.toHaveBeenCalled();
    expect(mocks.verifyUpdatedWorkOrderServiceRowReadableFromSupabase).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringMatching(/RPC migration/i) }),
    );
    expectNoLegacyServiceRowMutators();
  });

  it("restores an archived service row through the supported Supabase restore path", async () => {
    const restoredOrder = { ...orderWithRow, serviceRows: [{ ...serviceRow, archived: false }] };
    mocks.detailResult = {
      workOrder: {
        ...orderWithRow,
        serviceRows: [{ ...serviceRow, archived: true }],
      },
      source: "supabase",
      loading: false,
      error: null,
      shadow: null,
    };
    mocks.getWorkOrder.mockReturnValue(mocks.detailResult.workOrder);
    mocks.verifyUpdatedWorkOrderServiceRowReadableFromSupabase.mockResolvedValueOnce(restoredOrder);

    renderDetails();
    fireEvent.click(screen.getByLabelText(/show archived services/i));
    fireEvent.click(screen.getByRole("button", { name: /^restore$/i }));

    await waitFor(() => expect(mocks.restoreServiceRow).toHaveBeenCalledTimes(1));
    expect(mocks.restoreServiceRow).toHaveBeenCalledWith({
      companyId: "cmp_stad",
      workOrderId: "wo_1",
      serviceRowId: "worow_1",
    });
    expect(mocks.verifyUpdatedWorkOrderServiceRowReadableFromSupabase).toHaveBeenCalledWith({
      companyId: "cmp_stad",
      workOrderId: "wo_1",
      serviceRowId: "worow_1",
      expectedPatch: { archived: false },
    });
    expect(mocks.hydrateWorkOrderFromRemote).toHaveBeenCalledWith(restoredOrder);
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Service restored",
      description: "Deep Clean has been restored.",
    });
    expect(mocks.archiveServiceRow).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringMatching(/RPC migration/i) }),
    );
    expectNoLegacyServiceRowMutators();
  });

  it("removes an unprotected service row through the Supabase remove path after confirmation", async () => {
    const localGetSpy = vi.spyOn(Storage.prototype, "getItem");
    const localSetSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");

    renderDetails();
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    expect(screen.getByText("Delete service?")).toBeInTheDocument();
    expect(screen.queryByText("This action is being updated and is not available yet.")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /^delete$/i }).at(-1) as HTMLElement);

    await waitFor(() => expect(mocks.removeServiceRow).toHaveBeenCalledTimes(1));
    expect(mocks.removeServiceRow).toHaveBeenCalledWith({
      companyId: "cmp_stad",
      workOrderId: "wo_1",
      serviceRowId: "worow_1",
    });
    expect(mocks.verifyRemovedWorkOrderServiceRowReadableFromSupabase).toHaveBeenCalledWith({
      companyId: "cmp_stad",
      workOrderId: "wo_1",
      serviceRowId: "worow_1",
    });
    expect(mocks.hydrateWorkOrderFromRemote).toHaveBeenCalledWith({
      ...orderWithRow,
      serviceRows: [],
    });
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Service deleted",
      description: "Deep Clean has been removed.",
    });
    expectNoLegacyServiceRowMutators();
    expect(mocks.archiveServiceRow).not.toHaveBeenCalled();
    expect(mocks.restoreServiceRow).not.toHaveBeenCalled();
    expect(localGetSpy).not.toHaveBeenCalled();
    expect(localSetSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();

    localGetSpy.mockRestore();
    localSetSpy.mockRestore();
    sessionGetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("blocks Delete before Supabase remove when protected time-report history exists", () => {
    mocks.detailResult = {
      workOrder: orderWithRow,
      source: "supabase",
      loading: false,
      error: null,
      shadow: null,
    };
    mocks.getWorkOrder.mockReturnValue(orderWithRow);
    const protectedReport: TimeReport =
      {
        id: "tr_1",
        companyId: "cmp_stad",
        workOrderId: "wo_1",
        serviceRowId: "worow_1",
        jobName: "Deep Clean",
        employeeId: null,
        employeeName: "Unassigned",
        scheduledMinutes: 120,
        actualMinutes: 120,
        deviationMinutes: 0,
        bookingId: null,
        billableDeviationMinutes: 0,
        internalDeviationMinutes: 0,
        deviationReason: null,
        deviationComment: null,
        auditHistory: [],
        approvalStatus: "auto_approved",
        approvedBy: "System",
        approvedAt: "2026-05-01T10:00:00.000Z",
        submittedAt: "2026-05-01T10:00:00.000Z",
        createdAt: "2026-05-01T10:00:00.000Z",
        updatedAt: "2026-05-01T10:00:00.000Z",
      };
    mocks.timeReports = [protectedReport];
    mocks.getTimeReportsForWorkOrder.mockReturnValue([protectedReport]);

    renderDetails();
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    expect(screen.getByText("Cannot delete service")).toBeInTheDocument();
    expect(screen.getByText("This service has time reports.")).toBeInTheDocument();
    expect(mocks.removeServiceRow).not.toHaveBeenCalled();
    expectNoLegacyServiceRowMutators();
  });

  it("gates Check out / report time without a legacy time-report write", () => {
    renderDetails();
    fireEvent.click(screen.getByRole("button", { name: /check out/i }));
    expect(mocks.toast).toHaveBeenCalledWith(UNAVAILABLE_TOAST);
    expectNoLegacyServiceRowMutators();
  });

  it("opens Change date/time for a one-time row without calling a legacy mutator", () => {
    renderDetails();
    fireEvent.click(screen.getAllByRole("button", { name: /change date\/time/i })[0]);
    expect(screen.getByRole("button", { name: /save date\/time/i })).toBeInTheDocument();
    expect(mocks.toast).not.toHaveBeenCalledWith(UNAVAILABLE_TOAST);
    expectNoLegacyServiceRowMutators();
  });

  it("keeps recurring Change date/time gated before any mutation", () => {
    mocks.detailResult = {
      workOrder: {
        ...orderWithRow,
        serviceRows: [{ ...serviceRow, recurrenceInterval: "weekly" }],
      },
      source: "supabase",
      loading: false,
      error: null,
      shadow: null,
    };
    mocks.getWorkOrder.mockReturnValue(mocks.detailResult.workOrder);

    renderDetails();
    fireEvent.click(screen.getAllByRole("button", { name: /change date\/time/i })[0]);
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Temporarily unavailable",
      description: "Temporarily unavailable for recurring services.",
      variant: "destructive",
    });
    expectNoLegacyServiceRowMutators();
  });

  it("shows the END column and persists a recurring service end date from the plus button", async () => {
    const localGetSpy = vi.spyOn(Storage.prototype, "getItem");
    const localSetSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");
    const recurringRow: WorkOrderServiceRow = {
      ...serviceRow,
      recurrenceInterval: "weekly",
      serviceDate: "2026-05-01",
      serviceEndDate: null,
    };
    const updatedOrder: WorkOrder = {
      ...orderWithRow,
      serviceRows: [{ ...recurringRow, serviceEndDate: "2026-06-01" }],
    };
    mocks.detailResult = {
      workOrder: { ...orderWithRow, serviceRows: [recurringRow] },
      source: "supabase",
      loading: false,
      error: null,
      shadow: null,
    };
    mocks.getWorkOrder.mockReturnValue(mocks.detailResult.workOrder);
    mocks.verifyUpdatedWorkOrderServiceRowReadableFromSupabase.mockResolvedValueOnce(updatedOrder);

    renderDetails();
    expect(screen.getByRole("columnheader", { name: /^end$/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /add end date/i }));
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-06-01" } });
    fireEvent.click(screen.getAllByRole("button", { name: /^end service$/i }).at(-1) as HTMLElement);

    await waitFor(() => expect(mocks.updateServiceRow).toHaveBeenCalledTimes(1));
    expect(mocks.updateServiceRow).toHaveBeenCalledWith({
      companyId: "cmp_stad",
      workOrderId: "wo_1",
      serviceRowId: "worow_1",
      patch: { serviceEndDate: "2026-06-01" },
    });
    expect(mocks.verifyUpdatedWorkOrderServiceRowReadableFromSupabase).toHaveBeenCalledWith({
      companyId: "cmp_stad",
      workOrderId: "wo_1",
      serviceRowId: "worow_1",
      expectedPatch: { serviceEndDate: "2026-06-01" },
    });
    expect(mocks.hydrateWorkOrderFromRemote).toHaveBeenCalledWith(updatedOrder);
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Service end date saved",
      description: "Deep Clean now ends on 01 Jun 2026.",
    });
    expect(mocks.archiveServiceRow).not.toHaveBeenCalled();
    expect(mocks.restoreServiceRow).not.toHaveBeenCalled();
    expect(mocks.removeServiceRow).not.toHaveBeenCalled();
    expectNoLegacyServiceRowMutators();
    expect(localGetSpy).not.toHaveBeenCalled();
    expect(localSetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();

    localGetSpy.mockRestore();
    localSetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("gates quick assign without a legacy staffing write", () => {
    renderDetails();
    fireEvent.click(screen.getByRole("button", { name: /assign employees/i }));
    expect(mocks.toast).toHaveBeenCalledWith(UNAVAILABLE_TOAST);
    expectNoLegacyServiceRowMutators();
  });
});
