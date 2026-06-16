import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import * as React from "react";

import type { Customer, Employee, User } from "@/types";
import type { AdminProfileRosterRow } from "@/lib/profile";

const mocks = vi.hoisted(() => ({
  useApp: vi.fn(),
  profiles: [] as AdminProfileRosterRow[],
  sourcedCustomers: [] as Customer[],
}));

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/users/UserDialog", () => ({
  UserDialog: () => null,
}));

vi.mock("@/context/AppContext", () => ({
  useApp: () => mocks.useApp(),
}));

vi.mock("@/hooks/use-directory-profiles", () => ({
  useDirectoryProfiles: () => ({ profiles: mocks.profiles, isLoading: false }),
}));

vi.mock("@/hooks/use-customer-list-source", () => ({
  useCustomerListSource: () => ({
    customers: mocks.sourcedCustomers,
    source: "supabase",
    loading: false,
    error: null,
    shadow: null,
  }),
}));

import CompanyAdminDashboard from "./Dashboard";

const COMPANY = "cmp_stad";
const OTHER_COMPANY = "cmp_other";

const sebastian: User = {
  id: "usr_sebastian",
  companyId: COMPANY,
  name: "Sebastian Åkerman",
  email: "sebastian@stadalliansen.se",
  role: "company_admin",
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
};

/**
 * Two company admins, one employee profile, plus out-of-company / non-admin noise.
 * `createdAt` is set so "Recently added members" ordering is deterministic:
 * within the company, Portal Customer (02-10) is newest and Somnath (01-15) is
 * oldest. The out-of-company admin (03-01) is the newest overall and must be
 * excluded by company scoping.
 */
const profiles: AdminProfileRosterRow[] = [
  { id: "p_nadiia", companyId: COMPANY, companyName: "Städalliansen", baseRole: "company_admin", fullName: "Nadiia Onysko", email: "nadiia@stadalliansen.se", status: "active", createdAt: "2026-02-01T00:00:00.000Z" },
  { id: "p_sebastian", companyId: COMPANY, companyName: "Städalliansen", baseRole: "company_admin", fullName: "Sebastian Åkerman", email: "sebastian@stadalliansen.se", status: "active", createdAt: "2026-02-05T00:00:00.000Z" },
  { id: "p_somnath", companyId: COMPANY, companyName: "Städalliansen", baseRole: "employee", fullName: "Somnath Uma", email: "somnath@stadalliansen.se", status: "active", createdAt: "2026-01-15T00:00:00.000Z" },
  { id: "p_other_admin", companyId: OTHER_COMPANY, companyName: "Other AB", baseRole: "company_admin", fullName: "Other Admin", email: "other@other.se", status: "active", createdAt: "2026-03-01T00:00:00.000Z" },
  { id: "p_customer_login", companyId: COMPANY, companyName: "Städalliansen", baseRole: "customer", fullName: "Portal Customer", email: "portal@client.se", status: "active", createdAt: "2026-02-10T00:00:00.000Z" },
];

const employees: Employee[] = [
  { id: "emp_somnath", companyId: COMPANY, name: "Somnath Uma", email: "somnath@stadalliansen.se", status: "active", teamIds: [], createdAt: "2026-01-02T00:00:00.000Z" },
  { id: "emp_other", companyId: OTHER_COMPANY, name: "Out Of Scope", email: "oos@other.se", status: "active", teamIds: [], createdAt: "2026-01-02T00:00:00.000Z" },
];

const customers: Customer[] = [
  { id: "cust_one", companyId: COMPANY, name: "Only Customer", customerNumber: "C-1", email: "one@client.se", status: "active", userIds: [], createdAt: "2026-01-03T00:00:00.000Z" },
  { id: "cust_other", companyId: OTHER_COMPANY, name: "Other Customer", customerNumber: "C-1", email: "other@client.se", status: "active", userIds: [], createdAt: "2026-01-03T00:00:00.000Z" },
];

/**
 * Deliberately misleading localStorage `users` collection: if the Overview ever
 * counted from here again, People/Customers would be wrong (it would read 5).
 */
const misleadingUsers: User[] = Array.from({ length: 5 }, (_, i) => ({
  id: `usr_noise_${i}`,
  companyId: COMPANY,
  name: `Noise ${i}`,
  email: `noise${i}@stadalliansen.se`,
  role: "customer" as const,
  status: "active" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
}));

function setApp(overrides: Record<string, unknown> = {}): void {
  mocks.useApp.mockReturnValue({
    currentUser: sebastian,
    companies: [{ id: COMPANY, name: "Städalliansen Sverige AB", status: "active", createdAt: "2026-01-01T00:00:00.000Z" }],
    users: misleadingUsers,
    employees,
    customers,
    ...overrides,
  });
}

function renderDashboard(): void {
  render(
    <MemoryRouter>
      <CompanyAdminDashboard />
    </MemoryRouter>,
  );
}

/** Asserts the StatCard with the given label shows the given value. */
function expectCardValue(label: string, value: string): void {
  const column = screen.getByText(label).parentElement as HTMLElement;
  expect(within(column).getByText(value)).toBeInTheDocument();
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.profiles = profiles;
  mocks.sourcedCustomers = customers;
  setApp();
});

describe("Company Admin Overview counts", () => {
  it("counts company admins from Supabase profiles scoped to the company (2)", () => {
    renderDashboard();
    expectCardValue("Company admins", "2");
  });

  it("counts employees from employee records scoped to the company (1)", () => {
    renderDashboard();
    expectCardValue("Employees", "1");
  });

  it("counts customers from the Customers list source scoped to the company (1)", () => {
    renderDashboard();
    expectCardValue("Customers", "1");
  });

  it("shows People as admins + employees + customers (4) and renames the Users card", () => {
    renderDashboard();
    expectCardValue("People", "4");
    expect(screen.queryByText("Total users")).not.toBeInTheDocument();
  });

  it("never derives counts from the localStorage users collection", () => {
    // users has 5 misleading rows; counts must stay 2 / 1 / 1 / 4 regardless.
    renderDashboard();
    expectCardValue("People", "4");
    expectCardValue("Customers", "1");
  });
});

describe("Company Admin Recently added members", () => {
  it("sources the list from the Supabase profile roster, scoped to the company", () => {
    renderDashboard();
    const list = screen.getByRole("list");
    expect(within(list).getByText("Sebastian Åkerman")).toBeInTheDocument();
    expect(within(list).getByText("Nadiia Onysko")).toBeInTheDocument();
    expect(within(list).getByText("Somnath Uma")).toBeInTheDocument();
    expect(within(list).getByText("Portal Customer")).toBeInTheDocument();
    // Profiles from other companies must never leak into this company's list.
    expect(within(list).queryByText("Other Admin")).not.toBeInTheDocument();
  });

  it("orders members newest-first by profile creation time", () => {
    renderDashboard();
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    // Portal Customer (2026-02-10) is the newest in-company profile.
    expect(within(items[0]).getByText("Portal Customer")).toBeInTheDocument();
    // Somnath (2026-01-15) is the oldest of the four shown.
    expect(within(items[3]).getByText("Somnath Uma")).toBeInTheDocument();
  });

  it("never sources the member list from the localStorage users collection", () => {
    // setApp() feeds 5 misleading `users` rows named "Noise N"; none may appear.
    renderDashboard();
    const list = screen.getByRole("list");
    expect(within(list).queryByText(/^Noise \d$/)).not.toBeInTheDocument();
  });

  it("shows the empty state when the company roster has no profiles", () => {
    mocks.profiles = [];
    renderDashboard();
    expect(screen.getByText(/No team members yet/i)).toBeInTheDocument();
  });
});
