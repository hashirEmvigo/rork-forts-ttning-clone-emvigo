import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import * as React from "react";

import type { Customer } from "@/types";

const mocks = vi.hoisted(() => ({
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
  localCreateCustomer: vi.fn(),
  localUpdateCustomer: vi.fn(),
  toast: vi.fn(),
  saveCustomers: vi.fn(),
  mirrorCustomerWrites: vi.fn(),
  mirrorUserWrites: vi.fn(),
  createProfile: vi.fn(),
}));

vi.mock("@/context/AppContext", () => ({
  useApp: () => ({
    employees: [],
    areas: [],
    postalCities: [],
    autoAreaFromPostalCityEnabled: false,
    startViewAsCustomer: vi.fn(() => ({ ok: true })),
    hasPermission: vi.fn(() => true),
    createCustomer: mocks.localCreateCustomer,
    updateCustomer: mocks.localUpdateCustomer,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/hooks/use-customer-mutations", () => ({
  useCustomerMutations: () => ({
    createCustomer: mocks.createCustomer,
    updateCustomer: mocks.updateCustomer,
    isPending: false,
    error: null,
  }),
}));

vi.mock("@/lib/store", () => ({
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
    <select
      aria-label="Customer type"
      value={value ?? ""}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      <option value="">Select</option>
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
    SelectTrigger: () => null,
    SelectValue: () => null,
  };
});

import { CustomerDialog } from "./CustomerDialog";

const companyId = "cmp_stad";
const customer: Customer = {
  id: "cust_1",
  companyId,
  name: "Old Customer",
  customerNumber: "C-1001",
  email: "old@example.com",
  status: "active",
  customerType: "commercial",
  userIds: ["usr_existing"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function renderDialog(
  props: Partial<React.ComponentProps<typeof CustomerDialog>> = {},
  onOpenChange = vi.fn(),
): ReturnType<typeof vi.fn> {
  render(
    <MemoryRouter>
      <CustomerDialog
        open
        onOpenChange={onOpenChange}
        companyId={companyId}
        {...props}
      />
    </MemoryRouter>,
  );
  return onOpenChange;
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.createCustomer.mockResolvedValue({ ...customer, id: "cust_new", name: "Smoke Customer" });
  mocks.updateCustomer.mockResolvedValue({ ...customer, name: "Updated Customer" });
});

describe("CORE-WRITES-CUSTOMERS-A1.1 CustomerDialog", () => {
  it("awaits Supabase customer create before closing and does not use local persistence", async () => {
    const onCustomerCreated = vi.fn();
    const onOpenChange = renderDialog({ onCustomerCreated });

    fireEvent.change(screen.getByLabelText(/Customer name/i), {
      target: { value: "Smoke Customer" },
    });
    fireEvent.change(screen.getByLabelText(/Primary email/i), {
      target: { value: "contact@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/Customer type/i), {
      target: { value: "commercial" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create & start onboarding/i }));

    await waitFor(() =>
      expect(mocks.createCustomer).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Smoke Customer",
          email: "contact@example.com",
          customerType: "commercial",
          startOnboarding: true,
        }),
      ),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onCustomerCreated).toHaveBeenCalledWith("cust_new", "onboarding");
    expect(mocks.updateCustomer).not.toHaveBeenCalled();
    expect(mocks.localCreateCustomer).not.toHaveBeenCalled();
    expect(mocks.localUpdateCustomer).not.toHaveBeenCalled();
    expect(mocks.saveCustomers).not.toHaveBeenCalled();
    expect(mocks.mirrorCustomerWrites).not.toHaveBeenCalled();
    expect(mocks.mirrorUserWrites).not.toHaveBeenCalled();
    expect(mocks.createProfile).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Onboarding started" }));
  });

  it("keeps the dialog open and shows an error when Supabase customer create fails", async () => {
    mocks.createCustomer.mockRejectedValueOnce(new Error("Supabase write failed"));
    const onOpenChange = renderDialog();

    fireEvent.change(screen.getByLabelText(/Customer name/i), {
      target: { value: "Broken Customer" },
    });
    fireEvent.change(screen.getByLabelText(/Primary email/i), {
      target: { value: "broken@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/Customer type/i), {
      target: { value: "commercial" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create & start onboarding/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Supabase write failed");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(mocks.localCreateCustomer).not.toHaveBeenCalled();
    expect(mocks.saveCustomers).not.toHaveBeenCalled();
  });

  it("awaits Supabase customer update before closing and preserves login links without mutating them", async () => {
    const onOpenChange = renderDialog({ customer });

    fireEvent.change(screen.getByLabelText(/Customer name/i), {
      target: { value: "Updated Customer" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() =>
      expect(mocks.updateCustomer).toHaveBeenCalledWith({
        customerId: "cust_1",
        companyId,
        patch: expect.objectContaining({
          name: "Updated Customer",
          email: "old@example.com",
          customerType: "commercial",
        }),
      }),
    );
    expect(mocks.updateCustomer.mock.calls[0][0].patch).not.toHaveProperty("userIds");
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mocks.createCustomer).not.toHaveBeenCalled();
    expect(mocks.localUpdateCustomer).not.toHaveBeenCalled();
    expect(mocks.saveCustomers).not.toHaveBeenCalled();
  });
});
