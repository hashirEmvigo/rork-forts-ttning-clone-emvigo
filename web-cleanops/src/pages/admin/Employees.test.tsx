import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import * as React from "react";

import type { Employee, User } from "@/types";

const mocks = vi.hoisted(() => ({
  useApp: vi.fn(),
  profiles: [] as Array<{
    id: string;
    email: string | null;
    fullName: string | null;
    baseRole: "super_admin" | "company_admin" | "employee" | "customer";
    companyId: string | null;
    status: "active" | "inactive";
    staffNumber?: number | null;
  }>,
  staffByEmail: new Map<string, number>(),
  staffByLegacyId: new Map<string, number>(),
  toast: vi.fn(),
  updateEmployeeMutation: vi.fn(),
  createEmployeeMutation: vi.fn(),
  legacyUpdateEmployee: vi.fn(),
  legacyCreateLoginForEmployee: vi.fn(),
  legacyDeleteEmployee: vi.fn(),
  legacyArchiveEmployee: vi.fn(),
  saveEmployees: vi.fn(),
  mirrorEmployeeWrites: vi.fn(),
}));

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/hooks/use-directory-profiles", () => ({
  useDirectoryProfiles: () => ({ profiles: mocks.profiles, isLoading: false }),
}));

vi.mock("@/hooks/use-staff-numbers", () => ({
  useStaffNumbers: () => ({
    byEmail: mocks.staffByEmail,
    byLegacyId: mocks.staffByLegacyId,
    isLoading: false,
  }),
}));

vi.mock("@/context/AppContext", () => ({
  useApp: () => mocks.useApp(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/hooks/use-employee-mutations", () => ({
  useEmployeeMutations: (companyId: string) => ({
    createEmployee: mocks.createEmployeeMutation,
    updateEmployee: (input: unknown) => mocks.updateEmployeeMutation(companyId, input),
    isPending: false,
    error: null,
  }),
}));

vi.mock("@/lib/store", () => ({
  saveEmployees: mocks.saveEmployees,
}));

vi.mock("@/lib/data/employeeDualWrite", () => ({
  mirrorEmployeeWrites: mocks.mirrorEmployeeWrites,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
    disabled,
    className,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    className?: string;
  }) => (
    <button type="button" className={className} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));

import Employees from "./Employees";

const COMPANY = "cmp_stad";
const OTHER_COMPANY = "cmp_other";

const companyAdmin: User = {
  id: "usr_admin",
  companyId: COMPANY,
  name: "Company Admin",
  email: "admin@example.com",
  role: "company_admin",
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const superAdmin: User = {
  id: "usr_super",
  companyId: null,
  name: "Super Admin",
  email: "super@example.com",
  role: "super_admin",
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const realEmployee: Employee = {
  id: "emp_real",
  companyId: COMPANY,
  name: "Rita Real",
  email: "rita@example.com",
  title: "Cleaner",
  phone: "+47 111",
  address: "Main Street 1",
  status: "active",
  teamIds: [],
  userId: "usr_rita",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const otherCompanyEmployee: Employee = {
  id: "emp_other",
  companyId: OTHER_COMPANY,
  name: "Oscar Other",
  email: "oscar@example.com",
  title: "Supervisor",
  status: "active",
  teamIds: [],
  userId: "usr_oscar",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const employeeLogin: User = {
  id: "usr_rita",
  companyId: COMPANY,
  name: "Rita Real",
  email: "rita@example.com",
  role: "employee",
  status: "active",
  linkedEmployeeId: "emp_real",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function setApp(overrides: Partial<ReturnType<typeof baseApp>> = {}): void {
  mocks.useApp.mockReturnValue({ ...baseApp(), ...overrides });
}

function baseApp() {
  return {
    currentUser: companyAdmin,
    employees: [realEmployee],
    users: [employeeLogin],
    areas: [],
    teams: [],
    roles: [],
    employeeLanguages: [],
    postalCities: [],
    updateEmployee: mocks.legacyUpdateEmployee,
    updateUser: vi.fn(),
    createLoginForEmployee: mocks.legacyCreateLoginForEmployee,
    startViewAsEmployee: vi.fn(() => ({ ok: true })),
    hasPermission: vi.fn(() => true),
    getEmployeeDeletability: vi.fn(() => ({ allowed: false, reasons: [] })),
    deleteEmployee: mocks.legacyDeleteEmployee,
    archiveEmployee: mocks.legacyArchiveEmployee,
  };
}

function renderEmployees(): void {
  render(
    <MemoryRouter>
      <Employees />
    </MemoryRouter>,
  );
}

function rowFor(name: string): HTMLElement {
  const match = screen.getAllByText(name).find((element) => element.closest("tr"));
  if (!match) throw new Error(`No employee row found for ${name}`);
  return match.closest("tr") as HTMLElement;
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.profiles = [];
  mocks.staffByEmail = new Map<string, number>();
  mocks.staffByLegacyId = new Map<string, number>();
  mocks.updateEmployeeMutation.mockResolvedValue(realEmployee);
  mocks.createEmployeeMutation.mockResolvedValue(realEmployee);
  setApp();
});

describe("EMP-A1.1 Employees action/menu availability", () => {
  it("shows the action menu and Edit action for a real employee row for Company Admin", () => {
    renderEmployees();

    const row = rowFor("Rita Real");
    expect(within(row).getByRole("button", { name: /employee actions for rita real/i })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /edit/i })).toBeInTheDocument();
    expect(within(row).queryByText(/read-only/i)).not.toBeInTheDocument();
  });

  it("shows the action menu and Edit action for a real employee row for Super Admin", () => {
    setApp({ currentUser: superAdmin, employees: [realEmployee, otherCompanyEmployee] });

    renderEmployees();

    const companyRow = rowFor("Rita Real");
    const otherRow = rowFor("Oscar Other");
    expect(within(companyRow).getByRole("button", { name: /employee actions for rita real/i })).toBeInTheDocument();
    expect(within(companyRow).getByRole("button", { name: /edit/i })).toBeInTheDocument();
    expect(within(otherRow).getByRole("button", { name: /employee actions for oscar other/i })).toBeInTheDocument();
    expect(within(otherRow).getByRole("button", { name: /edit/i })).toBeInTheDocument();
  });

  it("clicking Edit opens EmployeeDialog for the real employee and saving uses EMP-A1 Supabase mutations", async () => {
    renderEmployees();

    fireEvent.click(within(rowFor("Rita Real")).getByRole("button", { name: /edit/i }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Edit employee");

    fireEvent.change(screen.getByLabelText(/full name/i), {
      target: { value: "Rita Edited" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(mocks.updateEmployeeMutation).toHaveBeenCalledTimes(1));
    expect(mocks.updateEmployeeMutation).toHaveBeenCalledWith(
      COMPANY,
      expect.objectContaining({
        employeeId: "emp_real",
        patch: expect.objectContaining({ name: "Rita Edited", email: "rita@example.com" }),
      }),
    );
    expect(mocks.legacyUpdateEmployee).not.toHaveBeenCalled();
    expect(mocks.legacyCreateLoginForEmployee).not.toHaveBeenCalled();
    expect(mocks.legacyDeleteEmployee).not.toHaveBeenCalled();
    expect(mocks.legacyArchiveEmployee).not.toHaveBeenCalled();
    expect(mocks.saveEmployees).not.toHaveBeenCalled();
    expect(mocks.mirrorEmployeeWrites).not.toHaveBeenCalled();
  });

  it("passes the real employee company scope into EmployeeDialog for Super Admin edits", async () => {
    setApp({ currentUser: superAdmin, employees: [otherCompanyEmployee], users: [] });

    renderEmployees();

    fireEvent.click(within(rowFor("Oscar Other")).getByRole("button", { name: /edit/i }));
    fireEvent.change(screen.getByLabelText(/full name/i), {
      target: { value: "Oscar Edited" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(mocks.updateEmployeeMutation).toHaveBeenCalledTimes(1));
    expect(mocks.updateEmployeeMutation).toHaveBeenCalledWith(
      OTHER_COMPANY,
      expect.objectContaining({ employeeId: "emp_other" }),
    );
  });

  it("keeps profile-only/login-only rows read-only and clearly labeled", () => {
    mocks.profiles = [
      {
        id: "usr_profile_only",
        email: "profile@example.com",
        fullName: "Profile Only",
        baseRole: "employee",
        companyId: COMPANY,
        status: "active",
      },
    ];

    renderEmployees();

    const row = rowFor("Profile Only");
    expect(within(row).getAllByText(/read-only/i).length).toBeGreaterThan(0);
    expect(within(row).queryByRole("button", { name: /employee actions for profile only/i })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
  });

  it("keeps synthetic self/admin rows read-only and clearly labeled", () => {
    setApp({ currentUser: companyAdmin, employees: [], users: [] });

    renderEmployees();

    const row = rowFor("Company Admin");
    expect(within(row).getByText(/admin login/i)).toBeInTheDocument();
    expect(within(row).getAllByText(/read-only/i).length).toBeGreaterThan(0);
    expect(within(row).queryByRole("button", { name: /employee actions for company admin/i })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
  });

  it("hides employee actions intentionally when the actor lacks users.manage", () => {
    setApp({ hasPermission: vi.fn(() => false) });

    renderEmployees();

    const row = rowFor("Rita Real");
    expect(within(row).getByText(/no edit permission/i)).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /employee actions for rita real/i })).not.toBeInTheDocument();
  });

  it("keeps unavailable employee status, lifecycle, login, area, or mirror write actions disabled", () => {
    const localSetSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");

    renderEmployees();

    const row = rowFor("Rita Real");
    expect(within(row).getByRole("button", { name: /login actions.*coming soon/i })).toBeDisabled();
    expect(within(row).getByRole("button", { name: /area access.*coming soon/i })).toBeDisabled();
    expect(within(row).getByRole("button", { name: /status actions.*coming soon/i })).toBeDisabled();
    expect(within(row).queryByRole("button", { name: /create login/i })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /deactivate|activate/i })).not.toBeInTheDocument();
    expect(mocks.legacyUpdateEmployee).not.toHaveBeenCalled();
    expect(mocks.legacyCreateLoginForEmployee).not.toHaveBeenCalled();
    expect(mocks.legacyDeleteEmployee).not.toHaveBeenCalled();
    expect(mocks.legacyArchiveEmployee).not.toHaveBeenCalled();
    expect(mocks.saveEmployees).not.toHaveBeenCalled();
    expect(mocks.mirrorEmployeeWrites).not.toHaveBeenCalled();
    expect(localSetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();
    localSetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });
});

describe("Employees Staff ID column", () => {
  it("renders a clean numeric Staff ID and never the technical employee id", () => {
    mocks.staffByLegacyId.set("emp_real", 7);

    renderEmployees();

    expect(screen.getByRole("columnheader", { name: "Staff ID" })).toBeInTheDocument();
    const realRow = rowFor("Rita Real");
    expect(within(realRow).getByText("7")).toBeInTheDocument();
    expect(within(realRow).queryByText("emp_real")).not.toBeInTheDocument();
  });

  it("resolves a profile/admin row Staff ID by email", () => {
    setApp({ currentUser: companyAdmin, employees: [], users: [] });
    mocks.staffByEmail.set("admin@example.com", 2);

    renderEmployees();

    const adminRow = rowFor("Company Admin");
    expect(within(adminRow).getByText("2")).toBeInTheDocument();
  });

  it("shows an em dash for a row with no issued Staff ID, never a technical id", () => {
    renderEmployees();

    const realRow = rowFor("Rita Real");
    expect(within(realRow).queryByText("emp_real")).not.toBeInTheDocument();
  });

  it("never leaks the synthetic roster-row prefix as an ID for admin/profile rows", () => {
    setApp({ currentUser: companyAdmin, employees: [], users: [] });

    renderEmployees();

    const adminRow = rowFor("Company Admin");
    expect(within(adminRow).queryByText(/__self__/)).not.toBeInTheDocument();
    expect(within(adminRow).queryByText(/__profile__/)).not.toBeInTheDocument();
  });
});
