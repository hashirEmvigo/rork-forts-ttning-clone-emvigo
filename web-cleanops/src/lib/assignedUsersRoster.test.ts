import { describe, expect, it, vi } from "vitest";

import {
  activeAssignedUsers,
  assignedUsersFromProfiles,
  companiesFromAssignedUserRoster,
} from "./assignedUsersRoster";
import type { AdminProfileRosterRow } from "./profile";

/** Builds a Supabase `profiles` roster row with sensible defaults. */
const profile = (patch: Partial<AdminProfileRosterRow>): AdminProfileRosterRow => ({
  id: patch.id ?? "prof_1",
  companyId: "companyId" in patch ? patch.companyId ?? null : "cmp_live",
  companyName: "companyName" in patch ? patch.companyName ?? null : "Live Company",
  companyStatus: patch.companyStatus ?? "active",
  baseRole: patch.baseRole ?? "employee",
  fullName: "fullName" in patch ? patch.fullName ?? null : "User One",
  email: "email" in patch ? patch.email ?? null : "user@example.com",
  status: patch.status ?? "active",
  createdAt: patch.createdAt ?? "2026-01-01T00:00:00.000Z",
  staffNumber: patch.staffNumber ?? null,
});

describe("assignedUsersRoster — profiles-sourced Roles & Permissions roster", () => {
  it("builds the assigned-user roster from the Supabase profiles backbone", () => {
    const roster = assignedUsersFromProfiles([
      profile({ id: "prof_admin", baseRole: "company_admin", fullName: "Company Admin" }),
      profile({ id: "prof_customer", baseRole: "customer", fullName: "Customer Login" }),
    ]);

    expect(roster.map((row) => row.name)).toEqual(["Company Admin", "Customer Login"]);
    expect(roster.map((row) => row.role)).toEqual(["company_admin", "customer"]);
    // Provenance: every row proves it came from profiles, never app_users/local users.
    expect(roster.every((row) => row.source === "profile")).toBe(true);
  });

  it("scopes to a single company and excludes other companies and platform super admins", () => {
    const roster = assignedUsersFromProfiles(
      [
        profile({ id: "prof_live", companyId: "cmp_live", baseRole: "company_admin" }),
        profile({ id: "prof_other", companyId: "cmp_other", baseRole: "employee" }),
        profile({ id: "prof_super", companyId: null, companyName: null, baseRole: "super_admin" }),
      ],
      "cmp_live",
    );

    expect(roster.map((row) => row.id)).toEqual(["prof_live"]);
  });

  it("returns every RLS-visible profile for the unscoped (super admin) view", () => {
    const roster = assignedUsersFromProfiles(
      [
        profile({ id: "prof_live", companyId: "cmp_live" }),
        profile({ id: "prof_other", companyId: "cmp_other" }),
        profile({ id: "prof_super", companyId: null, companyName: null, baseRole: "super_admin" }),
      ],
      undefined,
    );

    expect(roster.map((row) => row.id).sort()).toEqual(["prof_live", "prof_other", "prof_super"]);
  });

  it("collapses inactive and archived identities so they fall out of the active count", () => {
    const roster = assignedUsersFromProfiles([
      profile({ id: "prof_active", status: "active" }),
      profile({ id: "prof_inactive", status: "inactive" }),
      profile({ id: "prof_archived", status: "archived" }),
    ]);

    expect(activeAssignedUsers(roster).map((row) => row.id)).toEqual(["prof_active"]);
  });

  it("resolves Platform for company-less super admins and the company name otherwise", () => {
    const roster = assignedUsersFromProfiles([
      profile({ id: "prof_super", companyId: null, companyName: null, baseRole: "super_admin" }),
      profile({ id: "prof_admin", companyId: "cmp_live", companyName: "Städalliansen Sverige AB" }),
    ]);

    expect(roster.find((row) => row.id === "prof_super")?.companyName).toBe("Platform");
    expect(roster.find((row) => row.id === "prof_admin")?.companyName).toBe(
      "Städalliansen Sverige AB",
    );
  });

  it("derives company filter options (with status) from the profiles roster only", () => {
    const roster = assignedUsersFromProfiles([
      profile({ id: "prof_a", companyId: "cmp_live", companyName: "Live Company", companyStatus: "active" }),
      profile({ id: "prof_b", companyId: "cmp_live", companyName: "Live Company", companyStatus: "active" }),
      profile({ id: "prof_super", companyId: null, companyName: null, baseRole: "super_admin" }),
    ]);

    expect(companiesFromAssignedUserRoster(roster)).toEqual([
      { id: "cmp_live", name: "Live Company", status: "active" },
    ]);
  });

  it("does not depend on a stale local users array or read localStorage/sessionStorage", () => {
    // A dirty browser store must never influence Roles & Permissions counts.
    localStorage.setItem(
      "cleanops.users",
      JSON.stringify([{ id: "stale-local-user", role: "employee", status: "active" }]),
    );
    sessionStorage.setItem("cleanops.customers", JSON.stringify([{ id: "stale-local-customer" }]));
    const localGetItem = vi.spyOn(Storage.prototype, "getItem");

    try {
      const roster = assignedUsersFromProfiles([
        profile({ id: "prof_live", fullName: "Live Profile" }),
      ]);

      // Only the profile row appears; the stale local user is absent.
      expect(roster.map((row) => row.id)).toEqual(["prof_live"]);
      expect(roster.some((row) => row.id === "stale-local-user")).toBe(false);
      expect(localGetItem).not.toHaveBeenCalled();
    } finally {
      localGetItem.mockRestore();
      localStorage.removeItem("cleanops.users");
      sessionStorage.removeItem("cleanops.customers");
    }
  });

  it("excludes nothing structural for an empty roster (no rows, no crashes)", () => {
    expect(assignedUsersFromProfiles([])).toEqual([]);
    expect(assignedUsersFromProfiles([], "cmp_live")).toEqual([]);
  });
});
