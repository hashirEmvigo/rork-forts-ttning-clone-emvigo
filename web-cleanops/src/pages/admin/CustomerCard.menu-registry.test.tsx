import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import type { Customer, User } from "@/types";
import {
  resolveNavigationGroup,
  type NavigationMenuOverride,
} from "@/lib/navigation/navigationRegistry";

/**
 * Slice 11B — the Customer Card menu now consumes the Navigation & Menu registry
 * + Super-Admin override layer. These tests prove the menu renders from registry
 * defaults, honours custom label / icon / sort order / visibility overrides,
 * falls back safely for a bad icon, keeps every existing runtime indicator
 * (active state, red "missing setup" dots, the My Request counter), keeps a
 * hidden section reachable by deep link (visibility is presentation only, never
 * a route gate), and that permission stays authoritative for the group.
 *
 * The page is rendered without a QueryClientProvider, so `useNavigationMenu`
 * (React Query under the hood) is mocked and fed the resolved registry/override
 * result per test — exactly how the live hook would resolve it.
 */

const mocks = vi.hoisted(() => ({
  customer: null as Customer | null,
  permissions: ["users.manage"],
  getCustomerWorkOrders: vi.fn(() => []),
  getCustomerInvoices: vi.fn(() => []),
  hydrateCustomerFromRemote: vi.fn(),
  protocolActive: [] as unknown[],
  useNavigationMenu: vi.fn(),
}));

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/customer/CustomerProtocolsPanel", () => ({
  CustomerProtocolsPanel: () => <div data-testid="customer-protocols-panel">Protocols</div>,
}));

vi.mock("@/components/customer/CustomerAgreementsPanel", () => ({
  CustomerAgreementsPanel: () => <div data-testid="customer-agreements-panel">Agreements</div>,
}));

vi.mock("@/components/customer/CustomerMediaLibrary", () => ({
  CustomerMediaLibrary: () => <div data-testid="customer-media-library">Media</div>,
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
  useWorkOrderMutations: () => ({ createWorkOrder: vi.fn(), isPending: false, error: null }),
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

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@/lib/data/supabaseWorkOrderRepository", () => ({
  listFullWorkOrdersFromSupabase: vi.fn(async () => []),
}));

vi.mock("@/lib/mediaStore", () => ({ getMediaAsset: vi.fn(() => null) }));

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

// The menu consumes the navigation registry/override layer; mock the hook and
// feed it the resolved result (registry × overrides, permission-filtered).
vi.mock("@/hooks/use-navigation-config-admin", () => ({
  useNavigationMenu: () => mocks.useNavigationMenu(),
}));

import CustomerCard from "./CustomerCard";

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
      title: "Door code",
      content: "Side entrance.",
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

/** Drives the mocked menu hook with the registry resolved against `overrides`. */
function setMenu(overrides: NavigationMenuOverride[] = []): void {
  mocks.useNavigationMenu.mockReturnValue(
    resolveNavigationGroup("customer_card", overrides, { hasPermission: () => true }),
  );
}

function renderCard(path = "/customers/cust_1"): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/customers/:customerId" element={<CustomerCard />} />
      </Routes>
    </MemoryRouter>,
  );
}

function nav(): HTMLElement {
  return screen.getByTestId("customer-card-icon-tabs");
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.customer = baseCustomer;
  mocks.permissions = ["users.manage"];
  mocks.getCustomerWorkOrders.mockReturnValue([]);
  mocks.getCustomerInvoices.mockReturnValue([]);
  mocks.protocolActive = [];
  setMenu();
});

describe("CustomerCard menu — registry consumption", () => {
  it("renders every customer-card tile from the registry defaults", () => {
    renderCard();
    for (const label of [
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
    ]) {
      expect(within(nav()).getByRole("tab", { name: label })).toBeInTheDocument();
    }
  });

  it("shows a custom label override in the menu", () => {
    setMenu([
      { menuKey: "customer_card.contact", customLabel: "Kontakt TEST", customIcon: null, sortOrder: null, isVisible: true },
    ]);
    renderCard();
    expect(within(nav()).getByRole("tab", { name: "Kontakt TEST" })).toBeInTheDocument();
    expect(within(nav()).queryByRole("tab", { name: "Contact" })).not.toBeInTheDocument();
  });

  it("shows a custom icon override in the menu", () => {
    setMenu([
      { menuKey: "customer_card.contact", customLabel: null, customIcon: "Calculator", sortOrder: null, isVisible: true },
    ]);
    renderCard();
    expect(within(nav()).getByTestId("customer-tab-icon-contact")).toHaveClass("lucide-calculator");
  });

  it("applies a custom sort order override to the menu order", () => {
    setMenu([
      { menuKey: "customer_card.log", customLabel: null, customIcon: null, sortOrder: 5, isVisible: true },
    ]);
    renderCard();
    // sortOrder 5 floats Log ahead of Contact (default 10).
    expect(within(nav()).getAllByRole("tab")[0]).toHaveAccessibleName("Log");
  });

  it("hides an item from the menu when is_visible is false", () => {
    setMenu([
      { menuKey: "customer_card.keys_alarm", customLabel: null, customIcon: null, sortOrder: null, isVisible: false },
    ]);
    renderCard();
    expect(within(nav()).queryByRole("tab", { name: "Keys & Alarm" })).not.toBeInTheDocument();
    // Other tiles still render.
    expect(within(nav()).getByRole("tab", { name: "Contact" })).toBeInTheDocument();
  });

  it("keeps a hidden section reachable by deep link (visibility is presentation only)", () => {
    setMenu([
      { menuKey: "customer_card.keys_alarm", customLabel: null, customIcon: null, sortOrder: null, isVisible: false },
    ]);
    renderCard("/customers/cust_1?tab=keys");
    // Tile is hidden from the menu…
    expect(within(nav()).queryByRole("tab", { name: "Keys & Alarm" })).not.toBeInTheDocument();
    // …but the section/route is unaffected — its content still renders.
    expect(screen.getByText("Keys & Alarm Information will be added later.")).toBeInTheDocument();
  });

  it("falls back to the registry default icon for an invalid custom icon", () => {
    setMenu([
      { menuKey: "customer_card.contact", customLabel: null, customIcon: "NotARealIcon", sortOrder: null, isVisible: true },
    ]);
    renderCard();
    // Default contact icon is User → lucide-user.
    expect(within(nav()).getByTestId("customer-tab-icon-contact")).toHaveClass("lucide-user");
  });

  it("renders the hardcoded defaults when the override layer yields nothing", () => {
    mocks.useNavigationMenu.mockReturnValue([]);
    renderCard();
    expect(within(nav()).getByRole("tab", { name: "Contact" })).toBeInTheDocument();
    expect(within(nav()).getByRole("tab", { name: "Log" })).toBeInTheDocument();
  });

  it("preserves the active/selected state with a custom label", () => {
    setMenu([
      { menuKey: "customer_card.invoice", customLabel: "Faktura", customIcon: null, sortOrder: null, isVisible: true },
    ]);
    renderCard("/customers/cust_1?tab=invoices");
    expect(screen.getByRole("tab", { name: "Faktura" })).toHaveAttribute("data-state", "active");
  });

  it("preserves the red 'missing setup' indicator under a renamed work-order tile", () => {
    setMenu([
      { menuKey: "customer_card.work_order", customLabel: "Uppdrag", customIcon: null, sortOrder: null, isVisible: true },
    ]);
    renderCard();
    expect(within(nav()).getByRole("tab", { name: "Uppdrag" })).toBeInTheDocument();
    // No work orders on the base customer → the missing-setup dot still shows.
    expect(screen.getByTestId("customer-tab-missing-work_orders")).toBeInTheDocument();
  });

  it("preserves the neutral My Request counter", () => {
    renderCard();
    expect(screen.getByTestId("customer-tab-count-my_request")).toHaveTextContent("0");
  });

  it("keeps the tile layout stable with a long custom label", () => {
    const longLabel = "A very long custom menu label kept stable";
    setMenu([
      { menuKey: "customer_card.contact", customLabel: longLabel, customIcon: null, sortOrder: null, isVisible: true },
    ]);
    renderCard();
    // The tile still renders (single tab) with its fixed-width grid + icon intact.
    expect(within(nav()).getByRole("tab", { name: longLabel })).toBeInTheDocument();
    expect(nav()).toHaveClass("auto-cols-[92px]");
    expect(within(nav()).getByTestId("customer-tab-icon-contact")).toHaveClass("h-5", "w-5");
  });
});

describe("CustomerCard menu — permission stays authoritative", () => {
  it("a visible override never reveals a customer-card item the user lacks permission for", () => {
    const overrides: NavigationMenuOverride[] = [
      { menuKey: "customer_card.contact", customLabel: "X", customIcon: null, sortOrder: null, isVisible: true },
    ];
    // The customer_card items are gated on users.manage; without it the resolver
    // drops them regardless of a visible override.
    const resolved = resolveNavigationGroup("customer_card", overrides, { hasPermission: () => false });
    expect(resolved).toEqual([]);
  });
});
