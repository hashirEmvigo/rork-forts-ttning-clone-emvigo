import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Customer, User, WorkOrder } from "@/types";

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
  isCompanyEntitledToService: vi.fn(),
  addWorkOrderMediaPlacement: vi.fn(),
  setWorkOrderServiceRowArchived: vi.fn(),
  deleteWorkOrderServiceRow: vi.fn(),
  forceDeleteWorkOrderServiceRow: vi.fn(),
  reorderWorkOrderServiceRows: vi.fn(),
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

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/hooks/use-customer-mutations", () => ({
  useCustomerMutations: () => ({ updateCustomer: vi.fn() }),
}));

vi.mock("@/hooks/use-work-order-mutations", () => ({
  useWorkOrderMutations: () => ({
    createWorkOrder: vi.fn(),
    addServiceRow: vi.fn(),
    isPending: false,
    error: null,
  }),
}));

vi.mock("@/hooks/use-work-order-detail-source", () => ({
  useWorkOrderDetailSource: vi.fn((_localOrder, _workOrderId, _detailScope) => mocks.detailResult),
}));

vi.mock("@/lib/data/supabaseWorkOrderRepository", () => ({
  verifyAddedWorkOrderServiceRowReadableFromSupabase: vi.fn(),
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
    isCompanyEntitledToService: mocks.isCompanyEntitledToService,
    addWorkOrderMediaPlacement: mocks.addWorkOrderMediaPlacement,
    setWorkOrderServiceRowArchived: mocks.setWorkOrderServiceRowArchived,
    deleteWorkOrderServiceRow: mocks.deleteWorkOrderServiceRow,
    forceDeleteWorkOrderServiceRow: mocks.forceDeleteWorkOrderServiceRow,
    reorderWorkOrderServiceRows: mocks.reorderWorkOrderServiceRows,
  }),
}));

import { useWorkOrderDetailSource } from "@/hooks/use-work-order-detail-source";
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

const supabaseOnlyOrder: WorkOrder = {
  id: "wo_supabase_only",
  companyId: "cmp_stad",
  customerId: "cust_1",
  number: "WO-1007",
  title: "Supabase AO",
  status: "draft",
  notes: [],
  serviceRows: [],
  activity: [],
  mediaPlacements: [],
  createdAt: "2026-06-05T10:00:00.000Z",
  updatedAt: "2026-06-05T10:00:00.000Z",
};

function renderDetails(path = "/work-orders/wo_supabase_only"): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/work-orders/:workOrderId" element={<WorkOrderDetails />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.currentUser = {
    id: "usr_admin",
    name: "Admin User",
    role: "company_admin",
    companyId: "cmp_stad",
    email: "admin@example.com",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
  } as User;
  mocks.detailResult = {
    workOrder: null,
    source: "supabase",
    loading: false,
    error: null,
    shadow: null,
  };
  mocks.getWorkOrder.mockReturnValue(null);
  mocks.getTimeReportsForWorkOrder.mockReturnValue([]);
  mocks.hasPermission.mockReturnValue(true);
  mocks.getUserPermissions.mockReturnValue(["users.manage", "workOrders.view", "workOrders.manage"]);
  mocks.getServicesForCompany.mockReturnValue([]);
  mocks.getServiceCategoriesForCompany.mockReturnValue([]);
  mocks.getCompanyServiceFavorites.mockReturnValue([]);
  mocks.isServiceFavorite.mockReturnValue(false);
  mocks.getWorkOrderSettingsFor.mockReturnValue({ preferredTimeEvaluationEnabled: false });
  mocks.getTimeReportSettingsFor.mockReturnValue({ enabled: false });
  mocks.isCompanyEntitledToService.mockReturnValue(false);
});

describe("CORE-WRITES-WORKORDERS-A1.1.1 WorkOrderDetails access/detail", () => {
  it("opens a Supabase-created AO without local hydration for a Company Admin in the same company", async () => {
    mocks.detailResult = { ...mocks.detailResult, workOrder: supabaseOnlyOrder };

    renderDetails();

    expect(await screen.findByRole("heading", { name: "Supabase AO" })).toBeInTheDocument();
    expect(screen.getByText("WO-1007")).toBeInTheDocument();
    expect(vi.mocked(useWorkOrderDetailSource)).toHaveBeenCalledWith(
      null,
      "wo_supabase_only",
      "cmp_stad",
    );
    expect(mocks.hydrateWorkOrderFromRemote).toHaveBeenCalledWith(supabaseOnlyOrder);
  });

  it("opens a Supabase-created AO for Super Admin using RLS-visible unscoped detail read", async () => {
    mocks.currentUser = { ...mocks.currentUser, role: "super_admin", companyId: null } as User;
    mocks.detailResult = { ...mocks.detailResult, workOrder: supabaseOnlyOrder };

    renderDetails();

    expect(await screen.findByRole("heading", { name: "Supabase AO" })).toBeInTheDocument();
    expect(vi.mocked(useWorkOrderDetailSource)).toHaveBeenCalledWith(
      null,
      "wo_supabase_only",
      undefined,
    );
  });

  it("shows unavailable/not-found state, not Access Denied, when route permission passed but detail is missing", () => {
    renderDetails("/work-orders/wo_missing");

    expect(screen.getByRole("heading", { name: /work order unavailable/i })).toBeInTheDocument();
    expect(screen.queryByText("Access Denied")).not.toBeInTheDocument();
  });

  it("shows the Supabase detail read error in the unavailable state", () => {
    mocks.detailResult = {
      ...mocks.detailResult,
      error: "Supabase work-order detail read failed.",
    };

    renderDetails("/work-orders/wo_error");

    expect(screen.getByRole("heading", { name: /work order unavailable/i })).toBeInTheDocument();
    expect(screen.getByText("Supabase work-order detail read failed.")).toBeInTheDocument();
  });

  it("keeps Access Denied for a real company-scope mismatch after detail resolves", () => {
    mocks.detailResult = {
      ...mocks.detailResult,
      workOrder: { ...supabaseOnlyOrder, companyId: "cmp_other" },
    };

    renderDetails();

    expect(screen.getByText("Access Denied")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /work order unavailable/i })).not.toBeInTheDocument();
  });
});
