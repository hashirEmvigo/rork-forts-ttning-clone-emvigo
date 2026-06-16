import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import type { Customer, User } from "@/types";

const mocks = vi.hoisted(() => ({
  customer: null as Customer | null,
  permissions: ["customer_protocols.view", "customer_protocols.create", "customer_protocols.edit", "customer_protocols.archive", "users.manage"],
  getCustomerWorkOrders: vi.fn(() => []),
  getCustomerInvoices: vi.fn(() => []),
  hydrateCustomerFromRemote: vi.fn(),
  navigate: vi.fn(),
  protocolActive: [] as unknown[],
  useNavigationMenu: vi.fn(),
}));

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// The Customer Card menu now consumes the navigation registry/override layer
// (Slice 11B). The hook uses React Query under the hood; mock it (these tests
// render the page without a QueryClientProvider) and feed it the resolved
// registry defaults so the menu matches its registered presentation.
vi.mock("@/hooks/use-navigation-config-admin", () => ({
  useNavigationMenu: () => mocks.useNavigationMenu(),
}));

vi.mock("@/components/customer/CustomerProtocolsPanel", () => ({
  CustomerProtocolsPanel: ({ canManage }: { canManage: boolean }) => (
    <div data-testid="customer-protocols-panel">
      Cleaning protocols workspace {canManage ? "manageable" : "read-only"}
    </div>
  ),
}));

vi.mock("@/components/customer/CustomerAgreementsPanel", () => ({
  CustomerAgreementsPanel: () => <div data-testid="customer-agreements-panel">Agreements workspace</div>,
}));

vi.mock("@/components/customer/CustomerMediaLibrary", () => ({
  CustomerMediaLibrary: () => <div data-testid="customer-media-library">Media workspace</div>,
}));

vi.mock("@/hooks/use-customer-detail-source", () => ({
  useCustomerDetailSource: () => ({
    customer: mocks.customer ?? undefined,
    loading: false,
    source: "local",
    error: null,
    shadow: null,
  }),
}));

vi.mock("@/hooks/use-work-order-list-source", () => ({
  useWorkOrderListSource: () => ({
    workOrders: mocks.getCustomerWorkOrders(),
    source: "supabase",
    loading: false,
    error: null,
    shadow: null,
  }),
}));

vi.mock("@/hooks/use-customer-protocol-read-model", () => ({
  useCustomerProtocolReadModel: () => ({
    aggregates: [],
    protocols: mocks.protocolActive,
    active: mocks.protocolActive,
    archived: [],
    counts: {},
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/hooks/use-work-order-mutations", () => ({
  useWorkOrderMutations: () => ({
    createWorkOrder: vi.fn(),
    isPending: false,
    error: null,
  }),
}));

vi.mock("@/hooks/use-customer-mutations", () => ({
  useCustomerMutations: () => ({
    createCustomer: vi.fn(),
    updateCustomer: vi.fn(),
    archiveCustomer: vi.fn(),
    restoreCustomer: vi.fn(),
    isPending: false,
    error: null,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/data/supabaseWorkOrderRepository", () => ({
  listFullWorkOrdersFromSupabase: vi.fn(async () => []),
}));

vi.mock("@/lib/mediaStore", () => ({
  getMediaAsset: vi.fn(() => null),
}));

vi.mock("@/context/AppContext", () => ({
  useApp: () => ({
    currentUser: {
      id: "usr_admin",
      name: "Admin User",
      role: "company_admin",
      companyId: "cmp_stad",
      email: "admin@example.com",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
    } as User,
    customers: mocks.customer ? [mocks.customer] : [],
    companies: [{ id: "cmp_stad", name: "Stad AS" }],
    areas: [],
    postalCities: [],
    employees: [],
    areaScopedAccessEnabled: false,
    autoAreaFromPostalCityEnabled: false,
    getCustomerWorkOrders: mocks.getCustomerWorkOrders,
    getCustomerInvoices: mocks.getCustomerInvoices,
    getUserPermissions: vi.fn(() => mocks.permissions),
    hydrateCustomerFromRemote: mocks.hydrateCustomerFromRemote,
    hasPermission: vi.fn(() => true),
    setWorkOrderActive: vi.fn(() => ({ ok: true })),
  }),
}));

import CustomerCard from "./CustomerCard";
import { resolveNavigationGroup } from "@/lib/navigation/navigationRegistry";

const baseCustomer: Customer = {
  id: "cust_1",
  companyId: "cmp_stad",
  name: "Bergen Offices",
  customerNumber: "C-1001",
  email: "office@example.com",
  status: "active",
  customerType: "commercial",
  customerSegment: "b2b",
  userIds: [],
  cardNotes: [
    {
      id: "note_1",
      type: "admin",
      title: "Door code note",
      content: "Use side entrance.",
      authorId: "usr_admin",
      authorName: "Admin User",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      status: "active",
    },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function renderCustomerCard(path = "/customers/cust_1"): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/customers/:customerId" element={<CustomerCard />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.customer = baseCustomer;
  mocks.permissions = ["customer_protocols.view", "customer_protocols.create", "customer_protocols.edit", "customer_protocols.archive", "users.manage"];
  mocks.getCustomerWorkOrders.mockReturnValue([]);
  mocks.getCustomerInvoices.mockReturnValue([]);
  mocks.protocolActive = [];
  mocks.useNavigationMenu.mockReturnValue(
    resolveNavigationGroup("customer_card", [], { hasPermission: () => true }),
  );
});

describe("CustomerCard navigation UX", () => {
  it("renders the simplified icon-and-label top navigation", () => {
    renderCustomerCard();

    const nav = screen.getByTestId("customer-card-icon-tabs");
    expect(nav).toHaveClass("grid");
    expect(nav).toHaveClass("auto-cols-[92px]");

    const visibleTabs = [
      "Contact",
      "Work-order",
      "Days & Times",
      "Cleaning Protocol",
      "Reports",
      "Invoice",
      "Notes",
      "Keys & Alarm",
      "Media",
      "My Request",
      "Log",
    ];

    for (const label of visibleTabs) {
      expect(within(nav).getByRole("tab", { name: label })).toBeInTheDocument();
    }

    expect(within(nav).queryByRole("tab", { name: "Agreements" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("tab", { name: "Cleaning Days & Times" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("tab", { name: "Cleaning Protocols & Reports" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("tab", { name: "Invoices" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("tab", { name: "Documents / Media" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("tab", { name: "Time Bank" })).not.toBeInTheDocument();

    for (const value of [
      "contact",
      "work_orders",
      "scheduling",
      "protocols",
      "reports",
      "invoices",
      "notes",
      "keys",
      "documents",
      "my_request",
      "log",
    ]) {
      expect(screen.getByTestId(`customer-tab-icon-${value}`)).toHaveClass("h-5", "w-5");
    }
  });

  it("keeps Cleaning Protocol as its own top-level workspace", () => {
    renderCustomerCard("/customers/cust_1?tab=protocols");

    expect(screen.getByRole("tab", { name: "Cleaning Protocol" })).toHaveAttribute("data-state", "active");
    expect(screen.getByTestId("customer-protocols-panel")).toBeInTheDocument();
    expect(screen.getByText(/cleaning protocols workspace manageable/i)).toBeInTheDocument();
    expect(screen.queryByText("Time reports")).not.toBeInTheDocument();
    expect(screen.queryByText("Time bank")).not.toBeInTheDocument();
  });

  it("groups reports, time reports, and time bank under Reports", () => {
    renderCustomerCard("/customers/cust_1?tab=reports");

    expect(screen.getByRole("tab", { name: "Reports" })).toHaveAttribute("data-state", "active");
    expect(screen.queryByTestId("customer-protocols-panel")).not.toBeInTheDocument();
    expect(screen.getByText("Time reports")).toBeInTheDocument();
    expect(screen.getByText("Time bank")).toBeInTheDocument();
    expect(screen.getByText(/time bank balance and history have moved under reports/i)).toBeInTheDocument();
  });

  it("routes old Time Bank deep links into the grouped Reports workspace", () => {
    renderCustomerCard("/customers/cust_1?tab=time_bank");

    expect(screen.getByRole("tab", { name: "Reports" })).toHaveAttribute("data-state", "active");
    expect(screen.getByText(/customer reports, time reports, and time bank history/i)).toBeInTheDocument();
  });

  it("shows missing setup indicators and neutral My Request count", () => {
    renderCustomerCard();

    expect(screen.getByTestId("customer-tab-missing-work_orders")).toBeInTheDocument();
    expect(screen.getByTestId("customer-tab-missing-scheduling")).toBeInTheDocument();
    expect(screen.getByTestId("customer-tab-missing-protocols")).toBeInTheDocument();
    expect(screen.getByTestId("customer-tab-missing-keys")).toBeInTheDocument();
    expect(screen.queryByTestId("customer-tab-missing-notes")).not.toBeInTheDocument();
    expect(screen.getByTestId("customer-tab-count-my_request")).toHaveTextContent("0");
    expect(screen.queryByTestId("customer-tab-missing-my_request")).not.toBeInTheDocument();
  });

  it("keeps the hidden Agreements workspace reachable by existing deep links", () => {
    renderCustomerCard("/customers/cust_1?tab=agreements");

    expect(screen.queryByRole("tab", { name: "Agreements" })).not.toBeInTheDocument();
    expect(screen.getByTestId("customer-agreements-panel")).toBeInTheDocument();
  });
});
