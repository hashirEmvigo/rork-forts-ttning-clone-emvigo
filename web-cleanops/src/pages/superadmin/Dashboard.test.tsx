import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import * as React from "react";

import type { Company, User } from "@/types";
import type { AdminProfileRosterRow } from "@/lib/profile";

const mocks = vi.hoisted(() => ({
  useApp: vi.fn(),
  profiles: [] as AdminProfileRosterRow[],
}));

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/companies/CompanyDialog", () => ({
  CompanyDialog: () => null,
}));

vi.mock("@/context/AppContext", () => ({
  useApp: () => mocks.useApp(),
}));

vi.mock("@/hooks/use-directory-profiles", () => ({
  useDirectoryProfiles: () => ({ profiles: mocks.profiles, isLoading: false }),
}));

import SuperAdminDashboard from "./Dashboard";

const superAdmin: User = {
  id: "usr_super",
  companyId: null,
  name: "Super Admin",
  email: "super@platform.io",
  role: "super_admin",
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const companies: Company[] = [
  { id: "cmp_stad", name: "Städalliansen Sverige AB", status: "active", createdAt: "2026-01-02T00:00:00.000Z" },
  { id: "cmp_two", name: "Second Active AB", status: "active", createdAt: "2026-01-03T00:00:00.000Z" },
  { id: "cmp_off", name: "Dormant AB", status: "inactive", createdAt: "2026-01-01T00:00:00.000Z" },
];

/** 6 profiles total, 3 of which are company_admin across companies. */
const profiles: AdminProfileRosterRow[] = [
  { id: "p_super", companyId: null, companyName: null, baseRole: "super_admin", fullName: "Super Admin", email: "super@platform.io", status: "active" },
  { id: "p_admin_a1", companyId: "cmp_stad", companyName: "Städalliansen", baseRole: "company_admin", fullName: "Nadiia Onysko", email: "nadiia@stadalliansen.se", status: "active" },
  { id: "p_admin_a2", companyId: "cmp_stad", companyName: "Städalliansen", baseRole: "company_admin", fullName: "Sebastian Åkerman", email: "sebastian@stadalliansen.se", status: "active" },
  { id: "p_admin_b1", companyId: "cmp_two", companyName: "Second Active AB", baseRole: "company_admin", fullName: "Bo Admin", email: "bo@second.se", status: "active" },
  { id: "p_emp", companyId: "cmp_stad", companyName: "Städalliansen", baseRole: "employee", fullName: "Somnath Uma", email: "somnath@stadalliansen.se", status: "active" },
  { id: "p_cust", companyId: "cmp_two", companyName: "Second Active AB", baseRole: "customer", fullName: "Portal Customer", email: "portal@second.se", status: "active" },
];

function setApp(overrides: Record<string, unknown> = {}): void {
  mocks.useApp.mockReturnValue({
    currentUser: superAdmin,
    companies,
    // Empty localStorage users on purpose: counts must come from profiles.
    users: [],
    hasPermission: vi.fn(() => true),
    ...overrides,
  });
}

function renderDashboard(): void {
  render(
    <MemoryRouter>
      <SuperAdminDashboard />
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
  setApp();
});

describe("Super Admin Overview counts", () => {
  it("shows 2 active companies", () => {
    renderDashboard();
    expectCardValue("Active companies", "2");
  });

  it("counts company admins from Supabase profiles across all companies (3)", () => {
    renderDashboard();
    expectCardValue("Company admins", "3");
  });

  it("counts total users as every Supabase profile (6), not the empty users collection", () => {
    renderDashboard();
    expectCardValue("Total users", "6");
  });

  it("does not show 0 users / 0 company admins when profiles exist", () => {
    renderDashboard();
    const usersColumn = screen.getByText("Total users").parentElement as HTMLElement;
    expect(within(usersColumn).queryByText("0")).not.toBeInTheDocument();
    const adminsColumn = screen.getByText("Company admins").parentElement as HTMLElement;
    expect(within(adminsColumn).queryByText("0")).not.toBeInTheDocument();
  });
});
