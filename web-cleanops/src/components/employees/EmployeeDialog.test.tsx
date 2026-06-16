import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { Employee } from "@/types";

const useAppMock = vi.fn();
vi.mock("@/context/AppContext", () => ({
  useApp: () => useAppMock(),
}));

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

const createEmployeeMock = vi.fn();
const updateEmployeeMock = vi.fn();
const useEmployeeMutationsMock = vi.fn();
vi.mock("@/hooks/use-employee-mutations", () => ({
  useEmployeeMutations: (companyId: string) => useEmployeeMutationsMock(companyId),
}));

vi.mock("@/lib/store", () => ({
  saveEmployees: vi.fn(),
}));

import { saveEmployees } from "@/lib/store";
import { EmployeeDialog } from "./EmployeeDialog";

const COMPANY = "cmp_nordlys";

const existingEmployee: Employee = {
  id: "emp_existing",
  companyId: COMPANY,
  name: "Existing Employee",
  email: "existing@example.com",
  title: "Cleaner",
  status: "active",
  teamIds: [],
  userId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const legacyAppFns = {
  createEmployee: vi.fn(),
  updateEmployee: vi.fn(),
  createEmployeeWithLogin: vi.fn(),
  createLoginForEmployee: vi.fn(),
  assignUserRole: vi.fn(),
};

function setApp(overrides: Record<string, unknown> = {}): void {
  useAppMock.mockReturnValue({
    teams: [],
    users: [],
    employees: [],
    roles: [],
    employeeLanguages: [],
    postalCities: [],
    currentUser: { id: "usr_admin", role: "company_admin", companyId: COMPANY, name: "Admin" },
    ...legacyAppFns,
    ...overrides,
  });
}

function renderDialog(props: Partial<React.ComponentProps<typeof EmployeeDialog>> = {}) {
  const onOpenChange = vi.fn();
  render(
    <EmployeeDialog
      open
      onOpenChange={onOpenChange}
      companyId={COMPANY}
      employee={null}
      {...props}
    />,
  );
  return { onOpenChange };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  setApp();
  createEmployeeMock.mockResolvedValue({ ...existingEmployee, id: "emp_created" });
  updateEmployeeMock.mockResolvedValue(existingEmployee);
  useEmployeeMutationsMock.mockReturnValue({
    createEmployee: createEmployeeMock,
    updateEmployee: updateEmployeeMock,
    isPending: false,
    error: null,
  });
});

describe("EmployeeDialog EMP-A1 submit path", () => {
  it("creates an employee through Supabase mutations only and closes after success", async () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");
    const { onOpenChange } = renderDialog();

    fireEvent.change(screen.getByLabelText(/Full name/i), {
      target: { value: "Nora Nyberg" },
    });
    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: "nora@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add employee/i }));

    await waitFor(() => expect(createEmployeeMock).toHaveBeenCalledTimes(1));
    expect(createEmployeeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY,
        name: "Nora Nyberg",
        email: "nora@example.com",
        teamIds: [],
        userId: null,
      }),
    );
    expect(updateEmployeeMock).not.toHaveBeenCalled();
    expect(legacyAppFns.createEmployee).not.toHaveBeenCalled();
    expect(legacyAppFns.createEmployeeWithLogin).not.toHaveBeenCalled();
    expect(legacyAppFns.updateEmployee).not.toHaveBeenCalled();
    expect(saveEmployees).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Employee added" }),
    );
    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
    sessionGetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("updates an employee through Supabase mutations only", async () => {
    const { onOpenChange } = renderDialog({ employee: existingEmployee });

    fireEvent.change(screen.getByLabelText(/Full name/i), {
      target: { value: "Edited Employee" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() => expect(updateEmployeeMock).toHaveBeenCalledTimes(1));
    expect(updateEmployeeMock).toHaveBeenCalledWith({
      employeeId: existingEmployee.id,
      patch: expect.objectContaining({
        name: "Edited Employee",
        email: existingEmployee.email,
        teamIds: [],
      }),
    });
    expect(createEmployeeMock).not.toHaveBeenCalled();
    expect(legacyAppFns.updateEmployee).not.toHaveBeenCalled();
    expect(legacyAppFns.createEmployee).not.toHaveBeenCalled();
    expect(saveEmployees).not.toHaveBeenCalled();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Employee updated" }),
    );
  });

  it("keeps the dialog open and shows an error when Supabase create fails", async () => {
    createEmployeeMock.mockRejectedValueOnce(new Error("Supabase employee write failed"));
    const { onOpenChange } = renderDialog();

    fireEvent.change(screen.getByLabelText(/Full name/i), {
      target: { value: "Nora Nyberg" },
    });
    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: "nora@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add employee/i }));

    await waitFor(() => expect(screen.getByText("Supabase employee write failed")).toBeInTheDocument());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(legacyAppFns.createEmployee).not.toHaveBeenCalled();
    expect(legacyAppFns.createEmployeeWithLogin).not.toHaveBeenCalled();
    expect(saveEmployees).not.toHaveBeenCalled();
  });

  it("fails closed when company context is missing", async () => {
    useEmployeeMutationsMock.mockReturnValue({
      createEmployee: vi.fn().mockRejectedValue(new Error("Employee save requires a company context.")),
      updateEmployee: updateEmployeeMock,
      isPending: false,
      error: null,
    });
    const { onOpenChange } = renderDialog({ companyId: "" });

    fireEvent.change(screen.getByLabelText(/Full name/i), {
      target: { value: "Nora Nyberg" },
    });
    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: "nora@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add employee/i }));

    await waitFor(() =>
      expect(screen.getByText("Employee save requires a company context.")).toBeInTheDocument(),
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(legacyAppFns.createEmployee).not.toHaveBeenCalled();
    expect(saveEmployees).not.toHaveBeenCalled();
  });
});
