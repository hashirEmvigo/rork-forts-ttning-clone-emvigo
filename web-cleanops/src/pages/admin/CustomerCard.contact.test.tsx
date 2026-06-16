import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";

import type { Customer } from "@/types";

const mocks = vi.hoisted(() => ({
  updateCustomer: vi.fn(),
  localUpdateCustomer: vi.fn(),
  localCreateCustomer: vi.fn(),
  saveCustomers: vi.fn(),
  mirrorCustomerWrites: vi.fn(),
  mirrorUserWrites: vi.fn(),
  createProfile: vi.fn(),
  toast: vi.fn(),
  makeId: vi.fn(),
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
    },
    areas: [{ id: "area_1", companyId: "cmp_stad", name: "Bergen", isActive: true, createdAt: "2026-01-01T00:00:00.000Z" }],
    postalCities: [],
    employees: [],
    autoAreaFromPostalCityEnabled: false,
    hasPermission: vi.fn(() => true),
    updateCustomer: mocks.localUpdateCustomer,
    createCustomer: mocks.localCreateCustomer,
    getCustomerWorkOrders: vi.fn(() => []),
    getCustomerInvoices: vi.fn(() => []),
    getUserPermissions: vi.fn(() => []),
    hydrateCustomerFromRemote: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-customer-mutations", () => ({
  useCustomerMutations: () => ({
    createCustomer: vi.fn(),
    updateCustomer: mocks.updateCustomer,
    isPending: false,
    error: null,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/lib/store", () => ({
  makeId: mocks.makeId,
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

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    disabled,
    onCheckedChange,
  }: {
    checked?: boolean;
    disabled?: boolean;
    onCheckedChange?: (value: boolean) => void;
  }) => (
    <input
      type="checkbox"
      checked={checked ?? false}
      disabled={disabled}
      onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
    />
  ),
}));

import { ContactInformationTab } from "./CustomerCard";

const baseCustomer: Customer = {
  id: "cust_1",
  companyId: "cmp_stad",
  name: "Old Customer",
  customerNumber: "C-1001",
  email: "old@example.com",
  status: "active",
  customerType: "commercial",
  customerSegment: "b2b",
  phone: "+47 55 00 00 00",
  mainContact: "Old Manager",
  areaId: "area_1",
  area: "Bergen",
  tags: ["Legacy"],
  addresses: [
    {
      id: "addr_1",
      label: "Old HQ",
      street: "Old Street 1",
      postalCode: "5000",
      country: "Norway",
      isInvoice: true,
      isDelivery: false,
    },
  ],
  contacts: [
    {
      id: "con_1",
      name: "Jane Primary",
      email: "jane@example.com",
      phone: "+47 1",
      isPrimary: true,
      isContactPerson: true,
      isInvoiceResponsible: true,
      isAgreementResponsible: true,
    },
    {
      id: "con_2",
      name: "John Backup",
      email: "john@example.com",
      phone: "+47 2",
      isPrimary: false,
      isContactPerson: true,
      isInvoiceResponsible: false,
      isAgreementResponsible: false,
    },
  ],
  userIds: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function renderTab(customer: Customer = baseCustomer): void {
  render(<ContactInformationTab customer={customer} />);
}

function expectNoLegacyPersistence(): void {
  expect(mocks.localUpdateCustomer).not.toHaveBeenCalled();
  expect(mocks.localCreateCustomer).not.toHaveBeenCalled();
  expect(mocks.saveCustomers).not.toHaveBeenCalled();
  expect(mocks.mirrorCustomerWrites).not.toHaveBeenCalled();
  expect(mocks.mirrorUserWrites).not.toHaveBeenCalled();
  expect(mocks.createProfile).not.toHaveBeenCalled();
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.makeId.mockReturnValue("clog_1");
  mocks.updateCustomer.mockResolvedValue({ ...baseCustomer, name: "Updated Customer" });
});

describe("CORE-WRITES-CUSTOMERS-A1.2.1 ContactInformationTab", () => {
  it("saves profile/details edits through the Supabase customer mutation only", async () => {
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: /edit customer details/i }));
    fireEvent.change(screen.getByDisplayValue("Old Customer"), {
      target: { value: "Updated Customer" },
    });
    fireEvent.change(screen.getByDisplayValue("old@example.com"), {
      target: { value: "updated@example.com" },
    });
    fireEvent.change(screen.getByDisplayValue("Old Manager"), {
      target: { value: "Updated Manager" },
    });
    fireEvent.change(screen.getByDisplayValue("Legacy"), {
      target: { value: "Priority, Office" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(mocks.updateCustomer).toHaveBeenCalledTimes(1));
    expect(mocks.updateCustomer).toHaveBeenCalledWith({
      customerId: "cust_1",
      companyId: "cmp_stad",
      patch: expect.objectContaining({
        name: "Updated Customer",
        email: "updated@example.com",
        mainContact: "Updated Manager",
        customerType: "commercial",
        areaId: "area_1",
        area: "Bergen",
        tags: ["Priority", "Office"],
        cardLog: expect.arrayContaining([
          expect.objectContaining({
            id: "clog_1",
            section: "Contact information",
            changedById: "usr_admin",
            source: "admin_portal",
          }),
        ]),
      }),
    });
    expect(screen.queryByDisplayValue("Updated Customer")).not.toBeInTheDocument();
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Customer updated" }),
    );
    expectNoLegacyPersistence();
  });

  it("keeps details edit mode open and shows an inline error when Supabase update fails", async () => {
    mocks.updateCustomer.mockRejectedValueOnce(new Error("Supabase update failed"));
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: /edit customer details/i }));
    fireEvent.change(screen.getByDisplayValue("Old Customer"), {
      target: { value: "Broken Customer" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText("Supabase update failed")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Broken Customer")).toBeInTheDocument();
    expectNoLegacyPersistence();
  });

  it("saves address edits through the Supabase customer mutation only", async () => {
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: /edit addresses/i }));
    fireEvent.change(screen.getByDisplayValue("Old HQ"), {
      target: { value: "New HQ" },
    });
    fireEvent.change(screen.getByDisplayValue("Old Street 1"), {
      target: { value: "New Street 9" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(mocks.updateCustomer).toHaveBeenCalledTimes(1));
    expect(mocks.updateCustomer).toHaveBeenCalledWith({
      customerId: "cust_1",
      companyId: "cmp_stad",
      patch: expect.objectContaining({
        addresses: [
          expect.objectContaining({
            id: "addr_1",
            label: "New HQ",
            street: "New Street 9",
            postalCode: "5000",
            country: "Norway",
            isInvoice: true,
            isDelivery: false,
          }),
        ],
        cardLog: expect.arrayContaining([
          expect.objectContaining({ section: "Addresses" }),
        ]),
      }),
    });
    expect(screen.queryByDisplayValue("New HQ")).not.toBeInTheDocument();
    expectNoLegacyPersistence();
  });

  it("saves contact-person edits through the Supabase customer mutation only", async () => {
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: /edit contact people/i }));
    fireEvent.change(screen.getByDisplayValue("John Backup"), {
      target: { value: "John Lead" },
    });
    const primaryCheckboxes = screen.getAllByLabelText(/primary contact/i);
    const invoiceCheckboxes = screen.getAllByLabelText(/invoice responsible/i);
    const agreementCheckboxes = screen.getAllByLabelText(/agreement responsible/i);
    fireEvent.click(primaryCheckboxes[1]);
    fireEvent.click(invoiceCheckboxes[1]);
    fireEvent.click(agreementCheckboxes[1]);
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(mocks.updateCustomer).toHaveBeenCalledTimes(1));
    const patch = mocks.updateCustomer.mock.calls[0][0].patch;
    expect(patch.contacts).toEqual([
      expect.objectContaining({
        id: "con_1",
        name: "Jane Primary",
        isPrimary: false,
        isInvoiceResponsible: false,
        isAgreementResponsible: false,
      }),
      expect.objectContaining({
        id: "con_2",
        name: "John Lead",
        isPrimary: true,
        isContactPerson: true,
        isInvoiceResponsible: true,
        isAgreementResponsible: true,
      }),
    ]);
    expect(patch.cardLog).toEqual(
      expect.arrayContaining([expect.objectContaining({ section: "Contact persons" })]),
    );
    expect(screen.queryByDisplayValue("John Lead")).not.toBeInTheDocument();
    expectNoLegacyPersistence();
  });
});
