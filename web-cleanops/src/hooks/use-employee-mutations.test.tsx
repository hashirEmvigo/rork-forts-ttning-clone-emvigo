import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { Employee } from "@/types";

vi.mock("@/lib/data/supabaseEmployeeRepository", () => ({
  createEmployeeInSupabase: vi.fn(),
  updateEmployeeInSupabase: vi.fn(),
}));

vi.mock("@/lib/data/employeeDirectoryRefresh", () => ({
  bumpEmployeeDirectoryRefresh: vi.fn(),
}));

vi.mock("@/lib/store", () => ({
  saveEmployees: vi.fn(),
}));

import {
  createEmployeeInSupabase,
  updateEmployeeInSupabase,
} from "@/lib/data/supabaseEmployeeRepository";
import { bumpEmployeeDirectoryRefresh } from "@/lib/data/employeeDirectoryRefresh";
import { saveEmployees } from "@/lib/store";
import { useEmployeeMutations } from "./use-employee-mutations";

const COMPANY = "cmp_nordlys";

const employee: Employee = {
  id: "emp_1",
  companyId: COMPANY,
  name: "Nora Nyberg",
  email: "nora@example.com",
  status: "active",
  teamIds: [],
  userId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const createMock = vi.mocked(createEmployeeInSupabase);
const updateMock = vi.mocked(updateEmployeeInSupabase);
const refreshMock = vi.mocked(bumpEmployeeDirectoryRefresh);
const saveEmployeesMock = vi.mocked(saveEmployees);

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
  createMock.mockResolvedValue(employee);
  updateMock.mockResolvedValue(employee);
});

describe("useEmployeeMutations", () => {
  it("creates employees through Supabase only and invalidates the employee directory", async () => {
    const { wrapper, invalidateSpy } = createWrapper();
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");
    const { result } = renderHook(() => useEmployeeMutations(COMPANY), { wrapper });

    await result.current.createEmployee({
      companyId: "ignored-by-hook",
      name: "Nora Nyberg",
      email: "nora@example.com",
      teamIds: [],
    });

    expect(createMock).toHaveBeenCalledWith({
      companyId: COMPANY,
      name: "Nora Nyberg",
      email: "nora@example.com",
      teamIds: [],
    });
    expect(updateMock).not.toHaveBeenCalled();
    expect(saveEmployeesMock).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["employee-directory"] }));
    // Staff ID lookups + shared profile roster are refreshed too, so a new
    // employee shows its allocated Staff ID immediately (no hard refresh).
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["employee-staff-numbers"] }),
    );
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["directory-profiles-roster"] }),
    );
    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
    sessionGetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("updates employees through Supabase only", async () => {
    const { wrapper, invalidateSpy } = createWrapper();
    const { result } = renderHook(() => useEmployeeMutations(COMPANY), { wrapper });

    await result.current.updateEmployee({
      employeeId: "emp_1",
      patch: { name: "Updated Employee" },
    });

    expect(updateMock).toHaveBeenCalledWith(COMPANY, "emp_1", { name: "Updated Employee" });
    expect(createMock).not.toHaveBeenCalled();
    expect(saveEmployeesMock).not.toHaveBeenCalled();
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["employee-directory"] }));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["employee-staff-numbers"] }),
    );
  });

  it("fails closed when company context is missing", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useEmployeeMutations(" "), { wrapper });

    await expect(
      result.current.createEmployee({
        companyId: COMPANY,
        name: "Blocked",
        email: "blocked@example.com",
        teamIds: [],
      }),
    ).rejects.toThrow(/company context/i);

    expect(createMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(saveEmployeesMock).not.toHaveBeenCalled();
  });

  it("does not refresh the directory when Supabase write fails", async () => {
    createMock.mockRejectedValueOnce(new Error("supabase failed"));
    const { wrapper, invalidateSpy } = createWrapper();
    const { result } = renderHook(() => useEmployeeMutations(COMPANY), { wrapper });

    await expect(
      result.current.createEmployee({
        companyId: COMPANY,
        name: "Nora Nyberg",
        email: "nora@example.com",
        teamIds: [],
      }),
    ).rejects.toThrow("supabase failed");

    expect(refreshMock).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(saveEmployeesMock).not.toHaveBeenCalled();
  });
});
