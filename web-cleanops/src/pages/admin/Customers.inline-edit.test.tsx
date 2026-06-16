import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

import type { Area, Customer, PostalCity, User } from "@/types";

const mocks = vi.hoisted(() => ({
  useApp: vi.fn(),
  useCustomerListSource: vi.fn(),
  updateCustomerMutation: vi.fn(),
  createCustomerMutation: vi.fn(),
  archiveCustomerMutation: vi.fn(),
  restoreCustomerMutation: vi.fn(),
  localUpdateCustomer: vi.fn(),
  localCreateCustomer: vi.fn(),
  localDeleteCustomer: vi.fn(),
  localArchiveCustomer: vi.fn(),
  hydrateCustomersFromRemote: vi.fn(),
  startViewAsCustomer: vi.fn(),
  saveCustomers: vi.fn(),
  mirrorCustomerWrites: vi.fn(),
  mirrorUserWrites: vi.fn(),
  createProfile: vi.fn(),
  toast: vi.fn(),
  fetchDependencyContext: vi.fn(),
}));

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/customers/CustomerDialog", () => ({
  CustomerDialog: () => null,
}));

vi.mock("@/components/customers/CustomerAreaSetupDialog", () => ({
  CustomerAreaSetupDialog: () => null,
}));

vi.mock("@/components/checklist/CustomerProtocolsWorkspace", () => ({
  CustomerProtocolsWorkspace: () => null,
}));

vi.mock("@/components/customer/CustomerMediaLibrary", () => ({
  CustomerMediaLibrary: () => null,
}));

vi.mock("@/pages/admin/CustomerCard", () => ({
  ContactInformationTab: () => <div>Contact tab deferred in this test</div>,
  NotesTab: () => <div>Notes tab deferred in this test</div>,
  SchedulingTab: () => <div>Scheduling tab deferred in this test</div>,
}));

vi.mock("@/context/AppContext", () => ({
  useApp: () => mocks.useApp(),
}));

vi.mock("@/hooks/use-customer-list-source", () => ({
  useCustomerListSource: (...args: unknown[]) => mocks.useCustomerListSource(...args),
}));

vi.mock("@/hooks/use-customer-mutations", () => ({
  useCustomerMutations: () => ({
    createCustomer: mocks.createCustomerMutation,
    updateCustomer: mocks.updateCustomerMutation,
    archiveCustomer: mocks.archiveCustomerMutation,
    restoreCustomer: mocks.restoreCustomerMutation,
    isPending: false,
    error: null,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/lib/data/customerDeleteDependencies", () => ({
  fetchCustomerDeleteDependencyContext: (...args: unknown[]) => mocks.fetchDependencyContext(...args),
}));

vi.mock("@/lib/store", () => ({
  makeId: vi.fn((prefix: string) => `${prefix}_test`),
  saveCustomers: mocks.saveCustomers,
}));

vi.mock("@/lib/data/customerDualWrite", () => ({
  mirrorCustomerWrites: mocks.mirrorCustomerWrites,
}));

vi.mock("@/lib/data/userDualWrite", () => ({
  mirrorUserWrites: mocks.mirrorUserWrites,
}));

vi.mock("@/lib/profile", () => ({
  createProfile: mocks.createProfile,
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
    <select value={value ?? ""} onChange={(event) => onValueChange?.(event.target.value)}>
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

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
    className,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    className?: string;
  }) => (
    <button type="button" className={className} onClick={onClick}>
      {children}
    </button>
  ),
}));

import Customers from "./Customers";

const COMPANY = "cmp_stad";

const companyAdmin: User = {
  id: "usr_admin",
  companyId: COMPANY,
  name: "Company Admin",
  email: "admin@example.com",
  role: "company_admin",
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const area: Area = {
  id: "area_north",
  companyId: COMPANY,
  name: "North Area",
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const postalCity: PostalCity = {
  id: "pcity_north",
  companyId: COMPANY,
  name: "North City",
  areaId: area.id,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const baseCustomer: Customer = {
  id: "cust_1",
  companyId: COMPANY,
  name: "Acme Offices",
  customerNumber: "C-1001",
  email: "old@example.com",
  phone: "+47 55 00 00 00",
  status: "active",
  customerType: "commercial",
  customerSegment: "b2b",
  postalCityId: postalCity.id,
  ownerId: "emp_owner",
  userIds: ["usr_customer_login"],
  addresses: [
    {
      id: "addr_1",
      street: "Old Street 1",
      postalCityId: postalCity.id,
      country: "Norway",
      isInvoice: true,
      isDelivery: false,
    },
  ],
  contacts: [
    {
      id: "con_1",
      name: "Primary Person",
      email: "primary@example.com",
      isPrimary: true,
      isContactPerson: true,
    },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function appState(customers: Customer[] = [baseCustomer], user: User = companyAdmin) {
  return {
    currentUser: user,
    customers,
    employees: [
      {
        id: "emp_owner",
        companyId: COMPANY,
        name: "Olivia Owner",
        email: "owner@example.com",
        status: "active" as const,
        teamIds: [],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    areas: [area],
    postalCities: [postalCity],
    areaScopedAccessEnabled: false,
    updateCustomer: mocks.localUpdateCustomer,
    createCustomer: mocks.localCreateCustomer,
    startViewAsCustomer: mocks.startViewAsCustomer,
    hasPermission: vi.fn((permission: string) =>
      ["customers.create", "customers.edit"].includes(permission),
    ),
    canAccessModule: vi.fn(() => false),
    deleteCustomer: mocks.localDeleteCustomer,
    archiveCustomer: mocks.localArchiveCustomer,
    hydrateCustomersFromRemote: mocks.hydrateCustomersFromRemote,
  };
}

function renderCustomers(customers: Customer[] = [baseCustomer], user: User = companyAdmin): void {
  mocks.useApp.mockReturnValue(appState(customers, user));
  mocks.useCustomerListSource.mockImplementation(
    (_localCustomers: Customer[], _companyId: string, options?: { includeArchived?: boolean }) => ({
      customers:
        options?.includeArchived === true
          ? customers
          : customers.filter((customer) => customer.status !== "archived"),
      source: "supabase",
      loading: false,
      error: null,
      shadow: null,
    }),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Customers />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function showAllCustomers(): void {
  fireEvent.click(screen.getAllByRole("button", { name: /all customers/i })[0]);
}

function rowFor(name: string): HTMLElement {
  const match = screen.getAllByText(name).find((element) => element.closest("tr"));
  if (!match) throw new Error(`No customer row found for ${name}`);
  return match.closest("tr") as HTMLElement;
}

function expectNoLegacyCustomerPersistence(): void {
  expect(mocks.localUpdateCustomer).not.toHaveBeenCalled();
  expect(mocks.localCreateCustomer).not.toHaveBeenCalled();
  expect(mocks.localDeleteCustomer).not.toHaveBeenCalled();
  expect(mocks.localArchiveCustomer).not.toHaveBeenCalled();
  expect(mocks.saveCustomers).not.toHaveBeenCalled();
  expect(mocks.mirrorCustomerWrites).not.toHaveBeenCalled();
  expect(mocks.mirrorUserWrites).not.toHaveBeenCalled();
  expect(mocks.createProfile).not.toHaveBeenCalled();
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.updateCustomerMutation.mockResolvedValue({ ...baseCustomer, email: "updated@example.com" });
  mocks.createCustomerMutation.mockResolvedValue(baseCustomer);
  mocks.archiveCustomerMutation.mockResolvedValue({
    ...baseCustomer,
    status: "archived",
    archivedAt: "2026-06-05T00:00:00.000Z",
  });
  mocks.restoreCustomerMutation.mockResolvedValue({
    ...baseCustomer,
    status: "active",
    archivedAt: null,
    updatedAt: "2026-06-05T00:00:00.000Z",
  });
  mocks.fetchDependencyContext.mockResolvedValue({
    counts: {
      workOrderCount: 0,
      missionCount: 0,
      bookingQueueCount: 0,
      missionLogEntryCount: 0,
      timeReportCount: 0,
      customerAgreementCount: 0,
      timeBankWalletCount: 0,
      visitOccurrenceCount: 0,
      customerProtocolCount: 0,
      protocolRunCount: 0,
      mediaAssetCount: 0,
      appUserLinkCount: 0,
    },
    validation: { allowed: true, blockingFactors: [], reasons: [] },
    source: "supabase",
    checkedAt: "2026-06-05T00:00:00.000Z",
  });
  mocks.startViewAsCustomer.mockReturnValue({ ok: true });
});

describe("CORE-WRITES-CUSTOMERS-A1.2.2 Customers inline row edits", () => {
  it("saves inline row edits through the Supabase mutation only", async () => {
    const localGetSpy = vi.spyOn(Storage.prototype, "getItem");
    const localSetSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");
    renderCustomers();
    showAllCustomers();

    fireEvent.click(screen.getByRole("button", { name: /edit mode/i }));
    const row = rowFor("Acme Offices");
    fireEvent.change(within(row).getByDisplayValue("+47 55 00 00 00"), {
      target: { value: "+47 99 88 77 66" },
    });
    fireEvent.change(within(row).getByDisplayValue("old@example.com"), {
      target: { value: "updated@example.com" },
    });
    fireEvent.change(within(row).getByDisplayValue("Old Street 1"), {
      target: { value: "New Street 2" },
    });
    fireEvent.click(within(row).getByRole("button", { name: /save row/i }));

    await waitFor(() => expect(mocks.updateCustomerMutation).toHaveBeenCalledTimes(1));
    expect(mocks.updateCustomerMutation).toHaveBeenCalledWith({
      customerId: "cust_1",
      companyId: COMPANY,
      patch: expect.objectContaining({
        phone: "+47 99 88 77 66",
        email: "updated@example.com",
        areaId: undefined,
        area: undefined,
        ownerId: "emp_owner",
        addresses: [
          expect.objectContaining({
            id: "addr_1",
            street: "New Street 2",
            postalCityId: postalCity.id,
            isInvoice: true,
          }),
        ],
      }),
    });
    expect(mocks.updateCustomerMutation.mock.calls[0][0].patch).not.toHaveProperty("userIds");
    expect(mocks.updateCustomerMutation.mock.calls[0][0].patch).not.toHaveProperty("contacts");
    expect(mocks.updateCustomerMutation.mock.calls[0][0].patch).not.toHaveProperty("mainContact");
    expectNoLegacyCustomerPersistence();
    expect(localGetSpy).not.toHaveBeenCalled();
    expect(localSetSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();

    localGetSpy.mockRestore();
    localSetSpy.mockRestore();
    sessionGetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("keeps row edit mode open and shows an inline error when Supabase update fails", async () => {
    mocks.updateCustomerMutation.mockRejectedValueOnce(new Error("Supabase update failed"));
    renderCustomers();
    showAllCustomers();

    fireEvent.click(screen.getByRole("button", { name: /edit mode/i }));
    const row = rowFor("Acme Offices");
    fireEvent.change(within(row).getByDisplayValue("old@example.com"), {
      target: { value: "broken@example.com" },
    });
    fireEvent.click(within(row).getByRole("button", { name: /save row/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Supabase update failed");
    expect(screen.getByDisplayValue("broken@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /done editing/i })).toBeInTheDocument();
    expectNoLegacyCustomerPersistence();
  });

  it("exits row edit mode only after successful Supabase update", async () => {
    renderCustomers();
    showAllCustomers();

    fireEvent.click(screen.getByRole("button", { name: /edit mode/i }));
    const row = rowFor("Acme Offices");
    fireEvent.change(within(row).getByDisplayValue("old@example.com"), {
      target: { value: "updated@example.com" },
    });
    fireEvent.click(within(row).getByRole("button", { name: /save row/i }));

    await waitFor(() => expect(mocks.updateCustomerMutation).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: /edit mode/i })).toBeInTheDocument());
    expect(screen.queryByDisplayValue("updated@example.com")).not.toBeInTheDocument();
    expectNoLegacyCustomerPersistence();
  });

  it("applies suggested area through the Supabase mutation only", async () => {
    renderCustomers();
    showAllCustomers();

    const row = rowFor("Acme Offices");
    expect(within(row).getByText(/suggested:/i)).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: /apply/i }));

    await waitFor(() => expect(mocks.updateCustomerMutation).toHaveBeenCalledTimes(1));
    expect(mocks.updateCustomerMutation).toHaveBeenCalledWith({
      customerId: "cust_1",
      companyId: COMPANY,
      patch: { areaId: "area_north", area: "North Area" },
    });
    expect(mocks.updateCustomerMutation.mock.calls[0][0].patch).not.toHaveProperty("userIds");
    expectNoLegacyCustomerPersistence();
  });

  it("fails closed when inline row save is missing customer id", async () => {
    renderCustomers([{ ...baseCustomer, id: "" }]);
    showAllCustomers();

    fireEvent.click(screen.getByRole("button", { name: /edit mode/i }));
    const row = rowFor("Acme Offices");
    fireEvent.click(within(row).getByRole("button", { name: /save row/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /customer update requires a customer id/i,
    );
    expect(mocks.updateCustomerMutation).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /done editing/i })).toBeInTheDocument();
    expectNoLegacyCustomerPersistence();
  });

  it("fails closed when suggested area apply is missing customer id", async () => {
    renderCustomers([{ ...baseCustomer, id: "" }]);
    showAllCustomers();

    const row = rowFor("Acme Offices");
    fireEvent.click(within(row).getByRole("button", { name: /apply/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /customer update requires a customer id/i,
    );
    expect(mocks.updateCustomerMutation).not.toHaveBeenCalled();
    expectNoLegacyCustomerPersistence();
  });
});

describe("Customers ID column", () => {
  it("renders an ID column showing the numeric customer number (C- prefix stripped)", () => {
    renderCustomers();
    showAllCustomers();

    expect(screen.getByRole("columnheader", { name: "ID" })).toBeInTheDocument();
    const row = rowFor("Acme Offices");
    // baseCustomer.customerNumber === "C-1001" → displayed as "1001".
    expect(within(row).getByText("1001")).toBeInTheDocument();
    expect(within(row).queryByText("C-1001")).not.toBeInTheDocument();
  });
});

describe("CORE-WRITES-CUSTOMERS-A1.3.1 Customers lifecycle archive", () => {
  function openArchiveModalFor(name: string): void {
    showAllCustomers();
    const row = rowFor(name);
    fireEvent.click(within(row).getByRole("button", { name: /archive/i }));
  }

  it("archives a customer through the Supabase mutation only and closes after success", async () => {
    const localGetSpy = vi.spyOn(Storage.prototype, "getItem");
    const localSetSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");
    renderCustomers();

    openArchiveModalFor("Acme Offices");
    expect(await screen.findByText(/no related records found/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete permanently/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^archive customer$/i }));

    await waitFor(() => expect(mocks.archiveCustomerMutation).toHaveBeenCalledTimes(1));
    expect(mocks.archiveCustomerMutation).toHaveBeenCalledWith({
      customerId: "cust_1",
      companyId: COMPANY,
    });
    await waitFor(() => expect(screen.queryByText("Archive customer?")).not.toBeInTheDocument());
    expectNoLegacyCustomerPersistence();
    expect(mocks.updateCustomerMutation).not.toHaveBeenCalled();
    expect(mocks.createCustomerMutation).not.toHaveBeenCalled();
    expect(mocks.restoreCustomerMutation).not.toHaveBeenCalled();
    expect(localGetSpy).not.toHaveBeenCalled();
    expect(localSetSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();

    localGetSpy.mockRestore();
    localSetSpy.mockRestore();
    sessionGetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("keeps the archive modal open and shows an error when Supabase archive fails", async () => {
    mocks.archiveCustomerMutation.mockRejectedValueOnce(new Error("Archive RLS blocked"));
    renderCustomers();

    openArchiveModalFor("Acme Offices");
    fireEvent.click(await screen.findByRole("button", { name: /^archive customer$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Archive RLS blocked");
    expect(screen.getByText("Archive customer?")).toBeInTheDocument();
    expectNoLegacyCustomerPersistence();
  });

  it("shows expanded dependency summary for used customers and exposes only archive", async () => {
    mocks.fetchDependencyContext.mockResolvedValueOnce({
      counts: {
        workOrderCount: 2,
        missionCount: 4,
        bookingQueueCount: 1,
        missionLogEntryCount: 1,
        timeReportCount: 1,
        customerAgreementCount: 1,
        timeBankWalletCount: 1,
        visitOccurrenceCount: 1,
        customerProtocolCount: 1,
        protocolRunCount: 1,
        mediaAssetCount: 1,
        appUserLinkCount: 1,
      },
      validation: {
        allowed: false,
        blockingFactors: ["has_work_orders", "has_missions"],
        reasons: [
          "This customer has one or more work orders.",
          "This customer has bookings, missions, or time reports.",
        ],
        blockedMessage: "Archive instead.",
      },
      source: "supabase",
      checkedAt: "2026-06-05T00:00:00.000Z",
    });
    renderCustomers();

    openArchiveModalFor("Acme Offices");

    expect(await screen.findByText(/12 related records found/i)).toBeInTheDocument();
    expect(screen.getByText("Work orders")).toBeInTheDocument();
    expect(screen.getByText("Customer agreements")).toBeInTheDocument();
    expect(screen.getByText("Time bank wallets")).toBeInTheDocument();
    expect(screen.getByText("Visit occurrences")).toBeInTheDocument();
    expect(screen.getByText("Customer protocols")).toBeInTheDocument();
    expect(screen.getByText("Protocol runs")).toBeInTheDocument();
    expect(screen.getByText("Media assets")).toBeInTheDocument();
    expect(screen.getByText("Portal links")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^archive customer$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete permanently/i })).not.toBeInTheDocument();
    expectNoLegacyCustomerPersistence();
  });

  it("fails closed when archive is missing customer scope", async () => {
    renderCustomers([{ ...baseCustomer, id: "" }]);

    openArchiveModalFor("Acme Offices");
    const archiveButton = await screen.findByRole("button", { name: /^archive customer$/i });

    expect(archiveButton).toBeDisabled();
    expect(mocks.archiveCustomerMutation).not.toHaveBeenCalled();
    expectNoLegacyCustomerPersistence();
  });

  it("restores archived customers through the Supabase mutation only and closes after success", async () => {
    const archivedCustomer: Customer = {
      ...baseCustomer,
      id: "cust_archived",
      name: "Archived Offices",
      customerNumber: "C-1099",
      status: "archived",
      archivedAt: "2026-06-05T00:00:00.000Z",
    };
    const localGetSpy = vi.spyOn(Storage.prototype, "getItem");
    const localSetSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");
    renderCustomers([baseCustomer, archivedCustomer]);

    fireEvent.click(screen.getAllByRole("button", { name: /archived/i })[0]);
    const row = rowFor("Archived Offices");
    expect(within(row).queryByRole("button", { name: /^activate$/i })).not.toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: /restore/i }));
    expect(await screen.findByText("Restore customer?")).toBeInTheDocument();
    expect(screen.getByText(/available in normal active lists and selectors again/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^restore customer$/i }));

    await waitFor(() => expect(mocks.restoreCustomerMutation).toHaveBeenCalledTimes(1));
    expect(mocks.restoreCustomerMutation).toHaveBeenCalledWith({
      customerId: "cust_archived",
      companyId: COMPANY,
    });
    await waitFor(() => expect(screen.queryByText("Restore customer?")).not.toBeInTheDocument());
    expect(mocks.archiveCustomerMutation).not.toHaveBeenCalled();
    expect(mocks.updateCustomerMutation).not.toHaveBeenCalled();
    expect(mocks.createCustomerMutation).not.toHaveBeenCalled();
    expectNoLegacyCustomerPersistence();
    expect(localGetSpy).not.toHaveBeenCalled();
    expect(localSetSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();

    localGetSpy.mockRestore();
    localSetSpy.mockRestore();
    sessionGetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("keeps the restore modal open and shows an error when Supabase restore fails", async () => {
    mocks.restoreCustomerMutation.mockRejectedValueOnce(new Error("Restore RLS blocked"));
    const archivedCustomer: Customer = {
      ...baseCustomer,
      id: "cust_archived",
      name: "Archived Offices",
      customerNumber: "C-1099",
      status: "archived",
      archivedAt: "2026-06-05T00:00:00.000Z",
    };
    renderCustomers([baseCustomer, archivedCustomer]);

    fireEvent.click(screen.getAllByRole("button", { name: /archived/i })[0]);
    const row = rowFor("Archived Offices");
    fireEvent.click(within(row).getByRole("button", { name: /restore/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^restore customer$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Restore RLS blocked");
    expect(screen.getByText("Restore customer?")).toBeInTheDocument();
    expectNoLegacyCustomerPersistence();
  });

  it("fails closed when restore is missing customer scope", async () => {
    const archivedCustomer: Customer = {
      ...baseCustomer,
      id: "",
      name: "Archived Offices",
      customerNumber: "C-1099",
      status: "archived",
      archivedAt: "2026-06-05T00:00:00.000Z",
    };
    renderCustomers([archivedCustomer]);

    fireEvent.click(screen.getAllByRole("button", { name: /archived/i })[0]);
    const row = rowFor("Archived Offices");
    fireEvent.click(within(row).getByRole("button", { name: /restore/i }));
    const restoreButton = await screen.findByRole("button", { name: /^restore customer$/i });

    expect(restoreButton).toBeDisabled();
    expect(mocks.restoreCustomerMutation).not.toHaveBeenCalled();
    expectNoLegacyCustomerPersistence();
  });

  it("hides archived customers from normal lists and shows them only with the Archived filter", async () => {
    const archivedCustomer: Customer = {
      ...baseCustomer,
      id: "cust_archived",
      name: "Archived Offices",
      customerNumber: "C-1099",
      status: "archived",
      archivedAt: "2026-06-05T00:00:00.000Z",
    };
    renderCustomers([baseCustomer, archivedCustomer]);

    showAllCustomers();
    expect(screen.getByText("Acme Offices")).toBeInTheDocument();
    expect(screen.queryByText("Archived Offices")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /archived/i })[0]);
    expect(await screen.findByText("Archived Offices")).toBeInTheDocument();
    expect(mocks.useCustomerListSource).toHaveBeenLastCalledWith(
      expect.any(Array),
      COMPANY,
      { includeArchived: true },
    );
  });

  it("shows restored customers in the normal active list and removes them from the Archived filter after refetch", async () => {
    const restoredCustomer: Customer = {
      ...baseCustomer,
      id: "cust_restored",
      name: "Restored Offices",
      customerNumber: "C-1098",
      status: "active",
      archivedAt: null,
    };
    renderCustomers([restoredCustomer]);

    showAllCustomers();
    expect(screen.getByText("Restored Offices")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /archived/i })[0]);
    expect(screen.queryByText("Restored Offices")).not.toBeInTheDocument();
  });
});
