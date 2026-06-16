import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

/**
 * Slice 11D — the Settings tabs now render as the shared icon-above-label tile
 * menu (`PageMenuTiles`) with short labels. These tests prove the tile menu
 * renders, short labels replace the long legacy ones, selection switches
 * content, deep-linking still works, and — critically — that role/permission
 * gating is unchanged: Super-Admin-only tiles never appear for a Company Admin
 * and a Company Admin never receives the Navigation & Menus tile.
 */

const mocks = vi.hoisted(() => ({
  role: "super_admin" as "super_admin" | "company_admin",
  companyId: null as string | null,
  permissions: new Set<string>(),
}));

vi.mock("@/context/AppContext", () => ({
  useApp: () => ({
    currentUser: {
      id: "u1",
      name: "Test User",
      role: mocks.role,
      companyId: mocks.companyId,
      email: "test@example.com",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    roles: [],
    hasPermission: (permission: string) => mocks.permissions.has(permission),
  }),
}));

vi.mock("@/lib/companyRoleSeed", () => ({ selectCompanyRoles: () => [] }));

// Layout + header → lightweight wrappers (the real DashboardLayout pulls the
// whole sidebar/nav; we only test the Settings tab menu here).
vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/dashboard/PageHeader", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock("@/components/AccessDenied", () => ({
  AccessDenied: () => <div data-testid="access-denied">Access denied</div>,
}));

// Each panel is stubbed to a small marker so we can assert which tab's content
// is mounted without dragging in its data/network dependencies. Factories are
// inlined (not a shared helper) to avoid a vi.mock hoisting TDZ.
vi.mock("@/components/roles/RolesPanel", () => ({ RolesPanel: () => <div data-testid="panel-roles" /> }));
vi.mock("@/components/roles/SuperAdminRolesView", () => ({ SuperAdminRolesView: () => <div data-testid="panel-super-roles" /> }));
vi.mock("@/components/roles/CompanyUsersPanel", () => ({ CompanyUsersPanel: () => <div data-testid="panel-company-users" /> }));
vi.mock("@/components/modules/ModulesPanel", () => ({ ModulesPanel: () => <div data-testid="panel-modules" /> }));
vi.mock("@/components/modules/PlatformModulesPanel", () => ({ PlatformModulesPanel: () => <div data-testid="panel-platform-modules" /> }));
vi.mock("@/components/modules/CategoriesPanel", () => ({ CategoriesPanel: () => <div data-testid="panel-categories" /> }));
vi.mock("@/components/settings/ChecklistSettingsOverview", () => ({ ChecklistSettingsOverview: () => <div data-testid="panel-checklists" /> }));
vi.mock("@/components/settings/CompanySetupPanel", () => ({ CompanySetupPanel: () => <div data-testid="panel-setup" /> }));
vi.mock("@/components/settings/ServicesPanel", () => ({ ServicesPanel: () => <div data-testid="panel-services" /> }));
vi.mock("@/components/settings/TimeCodesPanel", () => ({ TimeCodesPanel: () => <div data-testid="panel-time-codes" /> }));
vi.mock("@/components/settings/PayrollExportPanel", () => ({ PayrollExportPanel: () => <div data-testid="panel-payroll" /> }));
vi.mock("@/components/settings/WorkOrderSettingsPanel", () => ({ WorkOrderSettingsPanel: () => <div data-testid="panel-work-orders" /> }));
vi.mock("@/components/settings/AOSettingsPanel", () => ({ AOSettingsPanel: () => <div data-testid="panel-ao" /> }));
vi.mock("@/components/settings/TimeReportSettingsPanel", () => ({ TimeReportSettingsPanel: () => <div data-testid="panel-time-reporting" /> }));
vi.mock("@/components/settings/TimeSettingsPanel", () => ({ TimeSettingsPanel: () => <div data-testid="panel-time" /> }));
vi.mock("@/components/settings/CustomerAssignmentPanel", () => ({ CustomerAssignmentPanel: () => <div data-testid="panel-assignment" /> }));
vi.mock("@/components/settings/EmployeeLanguagesPanel", () => ({ EmployeeLanguagesPanel: () => <div data-testid="panel-employee" /> }));
vi.mock("@/components/audit/AuditLogPanel", () => ({ AuditLogPanel: () => <div data-testid="panel-audit" /> }));
vi.mock("@/components/settings/NavigationMenuPanel", () => ({ NavigationMenuPanel: () => <div data-testid="panel-navigation" /> }));
vi.mock("@/components/settings/EntitlementValidationPanel", () => ({ EntitlementValidationPanel: () => <div data-testid="panel-entitlement" /> }));
vi.mock("@/components/settings/EntitlementResolverCutoverPanel", () => ({ EntitlementResolverCutoverPanel: () => <div data-testid="panel-entitlement-cutover" /> }));

import Settings from "./Settings";

const SUPER_ADMIN_PERMS = [
  "settings.manage",
  "roles.manage",
  "services.manage",
  "settings.timecodes.view",
  "payroll.export.view",
  "navigation.manage",
];

const COMPANY_ADMIN_PERMS = [
  "settings.manage",
  "roles.manage",
  "services.manage",
  "settings.timecodes.view",
  "payroll.export.view",
  "checklists.settings.view",
  // NOTE: no navigation.manage — Company Admin must never see Navigation & Menus.
];

function asSuperAdmin(perms: string[] = SUPER_ADMIN_PERMS) {
  mocks.role = "super_admin";
  mocks.companyId = null;
  mocks.permissions = new Set(perms);
}

function asCompanyAdmin(perms: string[] = COMPANY_ADMIN_PERMS) {
  mocks.role = "company_admin";
  mocks.companyId = "cmp_1";
  mocks.permissions = new Set(perms);
}

function renderSettings(path = "/settings") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Settings />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  asSuperAdmin();
});

afterEach(() => {
  cleanup();
});

describe("Settings tabs — tile menu (Slice 11D)", () => {
  it("renders the Settings tabs as the shared tile menu with icon + label", () => {
    renderSettings();
    const tiles = screen.getByTestId("settings-menu-tiles");
    const rolesTile = within(tiles).getByTestId("page-menu-tile-roles");
    expect(within(rolesTile).getByTestId("page-menu-tile-icon-roles")).toBeInTheDocument();
    expect(rolesTile).toHaveTextContent("Roles");
  });

  it("uses short labels and drops the long legacy labels (Super Admin)", () => {
    renderSettings();
    const tiles = screen.getByTestId("settings-menu-tiles");
    for (const label of ["Roles", "Modules", "Services", "Time Codes", "Payroll", "Categories", "Menus", "Audit", "Entitlements"]) {
      expect(within(tiles).getByRole("tab", { name: label })).toBeInTheDocument();
    }
    for (const legacy of ["Roles & Permissions", "Module Categories", "Navigation & Menus", "Audit Log", "Entitlement Validation"]) {
      expect(within(tiles).queryByRole("tab", { name: legacy })).not.toBeInTheDocument();
    }
  });

  it("marks the default Roles tab active and shows its panel", () => {
    renderSettings();
    expect(screen.getByRole("tab", { name: "Roles" })).toHaveAttribute("data-state", "active");
    expect(screen.getByTestId("panel-super-roles")).toBeInTheDocument();
  });

  it("switches content when another tile is selected", () => {
    renderSettings();
    expect(screen.queryByTestId("panel-platform-modules")).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Modules" }));
    expect(screen.getByRole("tab", { name: "Modules" })).toHaveAttribute("data-state", "active");
    expect(screen.getByTestId("panel-platform-modules")).toBeInTheDocument();
  });

  it("keeps a fixed tile size so long labels never distort the layout", () => {
    renderSettings();
    const tile = screen.getByTestId("page-menu-tile-entitlement_validation");
    expect(tile).toHaveClass("w-[88px]", "h-20");
    expect(tile).toHaveAttribute("title", "Entitlements");
    expect(screen.getByTestId("page-menu-tile-icon-entitlement_validation")).toHaveClass("h-5", "w-5");
  });

  it("opens the Navigation & Menus (Menus) tab directly via ?tab=navigation", () => {
    renderSettings("/settings?tab=navigation");
    expect(screen.getByRole("tab", { name: "Menus" })).toHaveAttribute("data-state", "active");
    expect(screen.getByTestId("panel-navigation")).toBeInTheDocument();
  });
});

describe("Settings tabs — permission gating stays authoritative", () => {
  it("hides Super-Admin-only tiles from a Company Admin", () => {
    asCompanyAdmin();
    renderSettings();
    const tiles = screen.getByTestId("settings-menu-tiles");
    // Super-Admin-only surfaces are absent.
    for (const superOnly of ["Categories", "Menus", "Entitlements"]) {
      expect(within(tiles).queryByRole("tab", { name: superOnly })).not.toBeInTheDocument();
    }
    // Company-scoped tiles are present.
    for (const companyTile of ["Checklists", "Media Library", "Work Orders", "Assignment", "Setup"]) {
      expect(within(tiles).getByRole("tab", { name: companyTile })).toBeInTheDocument();
    }
  });

  it("opens the Company Admin Media Library settings tile with the correct internal link", () => {
    asCompanyAdmin();
    renderSettings("/settings?tab=media_library");
    expect(screen.getByRole("tab", { name: "Media Library" })).toHaveAttribute("data-state", "active");
    expect(screen.getByRole("heading", { name: "Media Library", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Media Library" })).toHaveAttribute("href", "/settings/media");
  });

  it("never gives a Company Admin the Navigation & Menus tile even via deep link", () => {
    asCompanyAdmin();
    renderSettings("/settings?tab=navigation");
    expect(screen.queryByRole("tab", { name: "Menus" })).not.toBeInTheDocument();
    // Presentation-only navigation settings must not render for Company Admin.
    expect(screen.queryByTestId("panel-navigation")).not.toBeInTheDocument();
  });

  it("blocks the whole page without settings.manage", () => {
    asCompanyAdmin([]);
    renderSettings();
    expect(screen.getByTestId("access-denied")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-menu-tiles")).not.toBeInTheDocument();
  });
});
