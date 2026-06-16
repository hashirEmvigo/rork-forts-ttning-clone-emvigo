import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

import type { User, WorkOrder } from "@/types";

const mocks = vi.hoisted(() => ({
  createWorkOrder: vi.fn(),
  legacyCreateWorkOrder: vi.fn(),
  setWorkOrderActive: vi.fn(),
  hydrateWorkOrderFromRemote: vi.fn(),
  hasPermission: vi.fn(),
  getCustomerWorkOrders: vi.fn(),
  saveWorkOrders: vi.fn(),
  mirrorWorkOrderWrites: vi.fn(),
  saveBookingQueue: vi.fn(),
  insert: vi.fn(),
  listFullWorkOrdersFromSupabase: vi.fn(),
  listSourceWorkOrders: [] as WorkOrder[],
  toast: vi.fn(),
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
    getCustomerWorkOrders: mocks.getCustomerWorkOrders,
    createWorkOrder: mocks.legacyCreateWorkOrder,
    setWorkOrderActive: mocks.setWorkOrderActive,
    hasPermission: mocks.hasPermission,
    hydrateWorkOrderFromRemote: mocks.hydrateWorkOrderFromRemote,
  }),
}));

vi.mock("@/hooks/use-work-order-mutations", () => ({
  useWorkOrderMutations: () => ({
    createWorkOrder: mocks.createWorkOrder,
    isPending: false,
    error: null,
  }),
}));

vi.mock("@/hooks/use-work-order-list-source", () => ({
  useWorkOrderListSource: () => ({
    workOrders: mocks.listSourceWorkOrders,
    source: "supabase",
    loading: false,
    error: null,
    shadow: null,
  }),
}));

vi.mock("@/lib/data/supabaseWorkOrderRepository", () => ({
  supabaseWorkOrderRepository: {},
  listFullWorkOrdersFromSupabase: mocks.listFullWorkOrdersFromSupabase,
  fetchScheduleIntervalFromSupabase: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/lib/data/workOrderDualWrite", () => ({
  mirrorWorkOrderWrites: mocks.mirrorWorkOrderWrites,
}));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: vi.fn((table: string) => {
      if (["app_users", "profiles", "auth.users", "work_order_service_rows", "work_order_occurrence_exceptions"].includes(table)) {
        throw new Error(`Unexpected table mutation ${table}`);
      }
      return { insert: mocks.insert };
    }),
  },
}));

vi.mock("@/lib/store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/store")>("@/lib/store");
  return {
    ...actual,
    makeId: vi.fn((prefix: string) => `${prefix}_generated`),
    saveWorkOrders: mocks.saveWorkOrders,
  };
});

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
    <select aria-label="Status" value={value ?? ""} onChange={(event) => onValueChange?.(event.target.value)}>
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

import { countActiveCustomerWorkOrders, WorkOrdersTab } from "./CustomerCard";

const createdWorkOrder: WorkOrder = {
  id: "wo_created",
  companyId: "cmp_stad",
  customerId: "cust_1",
  number: "WO-1007",
  title: "New AO",
  status: "planned",
  createdBy: "usr_admin",
  createdByName: "Admin User",
  notes: [],
  serviceRows: [],
  activity: [],
  mediaPlacements: [],
  createdAt: "2026-06-05T10:00:00.000Z",
  updatedAt: "2026-06-05T10:00:00.000Z",
};

function renderWorkOrdersTab(companyId = "cmp_stad", customerId = "cust_1"): void {
  render(
    <MemoryRouter>
      <WorkOrdersTab companyId={companyId} customerId={customerId} />
    </MemoryRouter>,
  );
}

function expectNoLegacyPersistence(): void {
  expect(mocks.legacyCreateWorkOrder).not.toHaveBeenCalled();
  expect(mocks.saveWorkOrders).not.toHaveBeenCalled();
  expect(mocks.mirrorWorkOrderWrites).not.toHaveBeenCalled();
  expect(mocks.saveBookingQueue).not.toHaveBeenCalled();
  expect(mocks.insert).not.toHaveBeenCalled();
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
  mocks.hasPermission.mockReturnValue(true);
  mocks.getCustomerWorkOrders.mockReturnValue([]);
  mocks.createWorkOrder.mockResolvedValue(createdWorkOrder);
  mocks.listSourceWorkOrders = [];
  mocks.listFullWorkOrdersFromSupabase.mockResolvedValue([createdWorkOrder]);
});

describe("CORE-WRITES-WORKORDERS-A1.1 Customer Card Create AO", () => {
  it("creates an AO through the Supabase work-order mutation only after a fresh Supabase read can see it", async () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");

    renderWorkOrdersTab();

    fireEvent.click(screen.getByRole("button", { name: /create new work order/i }));
    fireEvent.change(screen.getByPlaceholderText(/spring deep clean/i), {
      target: { value: "  New AO  " },
    });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "planned" } });
    fireEvent.click(screen.getByRole("button", { name: /^create work order$/i }));

    await waitFor(() => expect(mocks.createWorkOrder).toHaveBeenCalledTimes(1));
    expect(mocks.createWorkOrder).toHaveBeenCalledWith({
      companyId: "cmp_stad",
      customerId: "cust_1",
      title: "New AO",
      status: "planned",
      startDate: undefined,
      endDate: undefined,
      createdBy: "usr_admin",
      createdByName: "Admin User",
    });
    await waitFor(() => expect(mocks.listFullWorkOrdersFromSupabase).toHaveBeenCalledWith("cmp_stad"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mocks.hydrateWorkOrderFromRemote).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Work order created" }));
    expectNoLegacyPersistence();
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
    sessionGetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("keeps the dialog open and shows an inline error when Supabase insert fails", async () => {
    mocks.createWorkOrder.mockRejectedValueOnce(new Error("Supabase insert failed"));
    renderWorkOrdersTab();

    fireEvent.click(screen.getByRole("button", { name: /create new work order/i }));
    fireEvent.change(screen.getByPlaceholderText(/spring deep clean/i), {
      target: { value: "Retry AO" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create work order$/i }));

    expect(await screen.findByText("Supabase insert failed")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Retry AO")).toBeInTheDocument();
    expect(mocks.hydrateWorkOrderFromRemote).not.toHaveBeenCalled();
    expect(mocks.listFullWorkOrdersFromSupabase).not.toHaveBeenCalled();
    expectNoLegacyPersistence();
  });

  it("keeps the dialog open and does not show local-only success when insert succeeds but Supabase read verification fails", async () => {
    mocks.listFullWorkOrdersFromSupabase.mockResolvedValueOnce([]);
    renderWorkOrdersTab();

    fireEvent.click(screen.getByRole("button", { name: /create new work order/i }));
    fireEvent.change(screen.getByPlaceholderText(/spring deep clean/i), {
      target: { value: "Unreadable AO" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create work order$/i }));

    expect(await screen.findByText(/did not return it yet/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Unreadable AO")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mocks.hydrateWorkOrderFromRemote).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Work order created" }));
    expectNoLegacyPersistence();
  });

  it("renders created AO rows from the Supabase list source without local hydration", () => {
    mocks.getCustomerWorkOrders.mockReturnValue([]);
    mocks.listSourceWorkOrders = [createdWorkOrder];

    renderWorkOrdersTab();

    expect(screen.getByText("WO-1007")).toBeInTheDocument();
    expect(screen.getByText("New AO")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^open$/i })).toBeInTheDocument();
    expect(mocks.hydrateWorkOrderFromRemote).not.toHaveBeenCalled();
    expectNoLegacyPersistence();
  });

  it("does not expose the Open AO action when the same detail route permission is missing", () => {
    mocks.getCustomerWorkOrders.mockReturnValue([]);
    mocks.listSourceWorkOrders = [createdWorkOrder];
    mocks.hasPermission.mockImplementation((permission: string) => permission !== "users.manage");

    renderWorkOrdersTab();

    expect(screen.getByText("WO-1007")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^open$/i })).not.toBeInTheDocument();
    expectNoLegacyPersistence();
  });

  it("does not count a created AO when the Supabase list source does not return it", () => {
    expect(countActiveCustomerWorkOrders([])).toBe(0);
    expect(countActiveCustomerWorkOrders([createdWorkOrder])).toBe(1);
  });

  it("fails closed through the mutation boundary when company scope is missing", async () => {
    mocks.createWorkOrder.mockRejectedValueOnce(
      new Error("Work order create requires a selected company context."),
    );
    renderWorkOrdersTab("", "cust_1");

    fireEvent.click(screen.getByRole("button", { name: /create new work order/i }));
    fireEvent.click(screen.getByRole("button", { name: /^create work order$/i }));

    expect(await screen.findByText(/selected company context/i)).toBeInTheDocument();
    expect(mocks.createWorkOrder).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "", customerId: "cust_1" }),
    );
    expectNoLegacyPersistence();
  });

  it("uses the target customer's company scope for super admin creates", async () => {
    mocks.currentUser = {
      ...mocks.currentUser,
      role: "super_admin",
      companyId: null,
    } as User;
    renderWorkOrdersTab("cmp_target_customer", "cust_target");

    fireEvent.click(screen.getByRole("button", { name: /create new work order/i }));
    fireEvent.click(screen.getByRole("button", { name: /^create work order$/i }));

    await waitFor(() => expect(mocks.createWorkOrder).toHaveBeenCalledTimes(1));
    expect(mocks.createWorkOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "cmp_target_customer",
        customerId: "cust_target",
        createdBy: "usr_admin",
      }),
    );
    await waitFor(() => expect(mocks.listFullWorkOrdersFromSupabase).toHaveBeenCalledWith("cmp_target_customer"));
    expectNoLegacyPersistence();
  });
});
