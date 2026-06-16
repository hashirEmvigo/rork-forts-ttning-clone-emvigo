import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { Customer } from "@/types";

vi.mock("@/lib/data/supabaseCustomerRepository", () => ({
  archiveCustomerInSupabase: vi.fn(),
  createCustomerInSupabase: vi.fn(),
  restoreCustomerInSupabase: vi.fn(),
  updateCustomerInSupabase: vi.fn(),
}));

vi.mock("@/lib/data/customerDirectoryRefresh", () => ({
  bumpCustomerDirectoryRefresh: vi.fn(),
}));

vi.mock("@/lib/store", () => ({
  saveCustomers: vi.fn(),
}));

vi.mock("@/lib/data/customerDualWrite", () => ({
  mirrorCustomerWrites: vi.fn(),
}));

vi.mock("@/lib/data/userDualWrite", () => ({
  mirrorUserWrites: vi.fn(),
}));

import {
  archiveCustomerInSupabase,
  createCustomerInSupabase,
  restoreCustomerInSupabase,
  updateCustomerInSupabase,
} from "@/lib/data/supabaseCustomerRepository";
import { bumpCustomerDirectoryRefresh } from "@/lib/data/customerDirectoryRefresh";
import { saveCustomers } from "@/lib/store";
import { mirrorCustomerWrites } from "@/lib/data/customerDualWrite";
import { mirrorUserWrites } from "@/lib/data/userDualWrite";
import { useCustomerMutations } from "./use-customer-mutations";

const COMPANY = "cmp_stad";

const customer: Customer = {
  id: "cust_1",
  companyId: COMPANY,
  name: "Smoke Customer",
  customerNumber: "C-1001",
  email: "contact@example.com",
  status: "active",
  customerType: "commercial",
  userIds: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const archiveCustomerMock = vi.mocked(archiveCustomerInSupabase);
const createCustomerMock = vi.mocked(createCustomerInSupabase);
const restoreCustomerMock = vi.mocked(restoreCustomerInSupabase);
const updateCustomerMock = vi.mocked(updateCustomerInSupabase);
const refreshMock = vi.mocked(bumpCustomerDirectoryRefresh);
const saveCustomersMock = vi.mocked(saveCustomers);
const mirrorCustomerWritesMock = vi.mocked(mirrorCustomerWrites);
const mirrorUserWritesMock = vi.mocked(mirrorUserWrites);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { wrapper, invalidateSpy };
}

beforeEach(() => {
  vi.clearAllMocks();
  archiveCustomerMock.mockResolvedValue({
    ...customer,
    status: "archived",
    archivedAt: "2026-06-05T00:00:00.000Z",
  });
  createCustomerMock.mockResolvedValue(customer);
  restoreCustomerMock.mockResolvedValue({ ...customer, status: "active", archivedAt: null });
  updateCustomerMock.mockResolvedValue(customer);
});

describe("useCustomerMutations CORE-WRITES-CUSTOMERS-A1.1", () => {
  it("creates customers through Supabase only and refreshes the customer directory", async () => {
    const { wrapper, invalidateSpy } = createWrapper();
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");
    const { result } = renderHook(
      () =>
        useCustomerMutations({
          companyId: COMPANY,
          canCreateCustomers: true,
          canEditCustomers: true,
        }),
      { wrapper },
    );

    await result.current.createCustomer({
      name: "Smoke Customer",
      email: "contact@example.com",
      customerType: "commercial",
      startOnboarding: true,
    });

    expect(createCustomerMock).toHaveBeenCalledWith({
      companyId: COMPANY,
      name: "Smoke Customer",
      email: "contact@example.com",
      customerType: "commercial",
      startOnboarding: true,
    });
    expect(updateCustomerMock).not.toHaveBeenCalled();
    expect(archiveCustomerMock).not.toHaveBeenCalled();
    expect(saveCustomersMock).not.toHaveBeenCalled();
    expect(mirrorCustomerWritesMock).not.toHaveBeenCalled();
    expect(mirrorUserWritesMock).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["customer-directory"] }),
    );

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
    sessionGetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("updates customers through Supabase only and refreshes the customer directory", async () => {
    const { wrapper, invalidateSpy } = createWrapper();
    const { result } = renderHook(
      () =>
        useCustomerMutations({
          companyId: COMPANY,
          canCreateCustomers: true,
          canEditCustomers: true,
        }),
      { wrapper },
    );

    await result.current.updateCustomer({
      customerId: "cust_1",
      patch: { name: "Updated Customer", email: "updated@example.com" },
    });

    expect(updateCustomerMock).toHaveBeenCalledWith(COMPANY, "cust_1", {
      name: "Updated Customer",
      email: "updated@example.com",
    });
    expect(createCustomerMock).not.toHaveBeenCalled();
    expect(archiveCustomerMock).not.toHaveBeenCalled();
    expect(saveCustomersMock).not.toHaveBeenCalled();
    expect(mirrorCustomerWritesMock).not.toHaveBeenCalled();
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["customer-directory"] }),
    );
  });

  it("updates Customer Card notes and scheduling through Supabase only and refreshes the customer directory", async () => {
    const { wrapper, invalidateSpy } = createWrapper();
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");
    const { result } = renderHook(
      () =>
        useCustomerMutations({
          companyId: COMPANY,
          canCreateCustomers: true,
          canEditCustomers: true,
        }),
      { wrapper },
    );

    await result.current.updateCustomer({
      customerId: "cust_1",
      patch: {
        cardNotes: [
          {
            id: "cnote_1",
            type: "admin",
            title: "Card note",
            content: "Card content",
            authorId: "usr_admin",
            authorName: "Admin",
            createdAt: "2026-02-01T00:00:00.000Z",
            updatedAt: "2026-02-01T00:00:00.000Z",
            status: "active",
          },
        ],
        schedulingPreferences: {
          preferredDays: [],
          secondaryDays: [],
          absencePriority: [
          "regular_employee_within_interval",
          "regular_employee_outside_interval",
          "regular_day_substitute_employee",
          "skip_visit_wait_regular_employee",
        ],
          schedulingNotes: "Prefer mornings",
          updatedAt: "2026-02-01T00:00:00.000Z",
        },
      },
    });

    expect(updateCustomerMock).toHaveBeenCalledWith(COMPANY, "cust_1", {
      cardNotes: [expect.objectContaining({ id: "cnote_1", title: "Card note" })],
      schedulingPreferences: expect.objectContaining({ schedulingNotes: "Prefer mornings" }),
    });
    expect(createCustomerMock).not.toHaveBeenCalled();
    expect(archiveCustomerMock).not.toHaveBeenCalled();
    expect(restoreCustomerMock).not.toHaveBeenCalled();
    expect(saveCustomersMock).not.toHaveBeenCalled();
    expect(mirrorCustomerWritesMock).not.toHaveBeenCalled();
    expect(mirrorUserWritesMock).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["customer-directory"] }),
    );

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
    sessionGetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("archives customers through Supabase only and refreshes the customer directory", async () => {
    const { wrapper, invalidateSpy } = createWrapper();
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");
    const { result } = renderHook(
      () =>
        useCustomerMutations({
          companyId: COMPANY,
          canCreateCustomers: true,
          canEditCustomers: true,
        }),
      { wrapper },
    );

    await result.current.archiveCustomer({ customerId: "cust_1" });

    expect(archiveCustomerMock).toHaveBeenCalledWith(COMPANY, "cust_1");
    expect(createCustomerMock).not.toHaveBeenCalled();
    expect(updateCustomerMock).not.toHaveBeenCalled();
    expect(saveCustomersMock).not.toHaveBeenCalled();
    expect(mirrorCustomerWritesMock).not.toHaveBeenCalled();
    expect(mirrorUserWritesMock).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["customer-directory"] }),
    );

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
    sessionGetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("restores archived customers through Supabase only and refreshes the customer directory", async () => {
    const { wrapper, invalidateSpy } = createWrapper();
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");
    const { result } = renderHook(
      () =>
        useCustomerMutations({
          companyId: COMPANY,
          canCreateCustomers: true,
          canEditCustomers: true,
        }),
      { wrapper },
    );

    await result.current.restoreCustomer({ customerId: "cust_1" });

    expect(restoreCustomerMock).toHaveBeenCalledWith(COMPANY, "cust_1");
    expect(createCustomerMock).not.toHaveBeenCalled();
    expect(updateCustomerMock).not.toHaveBeenCalled();
    expect(archiveCustomerMock).not.toHaveBeenCalled();
    expect(saveCustomersMock).not.toHaveBeenCalled();
    expect(mirrorCustomerWritesMock).not.toHaveBeenCalled();
    expect(mirrorUserWritesMock).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["customer-directory"] }),
    );

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
    sessionGetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("does not refresh when Supabase archive fails", async () => {
    archiveCustomerMock.mockRejectedValueOnce(new Error("archive failed"));
    const { wrapper, invalidateSpy } = createWrapper();
    const { result } = renderHook(
      () =>
        useCustomerMutations({
          companyId: COMPANY,
          canCreateCustomers: true,
          canEditCustomers: true,
        }),
      { wrapper },
    );

    await expect(result.current.archiveCustomer({ customerId: "cust_1" })).rejects.toThrow(
      "archive failed",
    );

    expect(refreshMock).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(saveCustomersMock).not.toHaveBeenCalled();
    expect(mirrorCustomerWritesMock).not.toHaveBeenCalled();
  });

  it("does not refresh when Supabase restore fails", async () => {
    restoreCustomerMock.mockRejectedValueOnce(new Error("restore failed"));
    const { wrapper, invalidateSpy } = createWrapper();
    const { result } = renderHook(
      () =>
        useCustomerMutations({
          companyId: COMPANY,
          canCreateCustomers: true,
          canEditCustomers: true,
        }),
      { wrapper },
    );

    await expect(result.current.restoreCustomer({ customerId: "cust_1" })).rejects.toThrow(
      "restore failed",
    );

    expect(refreshMock).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(saveCustomersMock).not.toHaveBeenCalled();
    expect(mirrorCustomerWritesMock).not.toHaveBeenCalled();
  });

  it("fails closed when company context is missing", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () =>
        useCustomerMutations({
          companyId: " ",
          canCreateCustomers: true,
          canEditCustomers: true,
        }),
      { wrapper },
    );

    await expect(
      result.current.createCustomer({
        name: "Blocked Customer",
        email: "blocked@example.com",
        customerType: "commercial",
      }),
    ).rejects.toThrow(/selected company context/i);

    await expect(
      result.current.updateCustomer({
        customerId: "cust_1",
        patch: { schedulingPreferences: { preferredDays: [], secondaryDays: [], absencePriority: [], schedulingNotes: "Blocked" } },
      }),
    ).rejects.toThrow(/selected company context/i);

    expect(createCustomerMock).not.toHaveBeenCalled();
    expect(updateCustomerMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("lets Super Admin writes proceed only when a selected company scope is supplied", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () =>
        useCustomerMutations({
          companyId: COMPANY,
          canCreateCustomers: true,
          canEditCustomers: true,
        }),
      { wrapper },
    );

    await result.current.createCustomer({
      name: "Super Scoped Customer",
      email: "super-scoped@example.com",
      customerType: "commercial",
    });

    expect(createCustomerMock).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: COMPANY }),
    );
  });

  it("does not refresh when Supabase customer write fails", async () => {
    createCustomerMock.mockRejectedValueOnce(new Error("supabase failed"));
    const { wrapper, invalidateSpy } = createWrapper();
    const { result } = renderHook(
      () =>
        useCustomerMutations({
          companyId: COMPANY,
          canCreateCustomers: true,
          canEditCustomers: true,
        }),
      { wrapper },
    );

    await expect(
      result.current.createCustomer({
        name: "Broken Customer",
        email: "broken@example.com",
        customerType: "commercial",
      }),
    ).rejects.toThrow("supabase failed");

    expect(refreshMock).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(saveCustomersMock).not.toHaveBeenCalled();
  });
});
