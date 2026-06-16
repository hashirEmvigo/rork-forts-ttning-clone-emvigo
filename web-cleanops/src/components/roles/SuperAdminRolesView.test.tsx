import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Slice 11E — the Super Admin Roles & Permissions section menu now renders as
 * the shared icon-above-label tile menu (`PageMenuTiles`) with short labels
 * (Role Templates → Templates, Company Assignments → Companies, Permission
 * Matrix → Matrix, Assigned Users → Users). These tests prove the tile menu
 * renders icon + label, the default section is active, selecting a tile switches
 * the rendered section, and the fixed tile size keeps long labels stable. Each
 * section panel is stubbed so we test the menu, not its data dependencies.
 */

vi.mock("@/context/AppContext", () => ({
  useApp: () => ({ roles: [] }),
}));

vi.mock("@/lib/companyRoleSeed", () => ({
  selectCustomGlobalTemplates: () => [],
}));

vi.mock("@/components/roles/RoleTemplatesGrid", () => ({
  RoleTemplatesGrid: () => <div data-testid="section-templates" />,
}));
vi.mock("@/components/roles/RolesPanel", () => ({
  RolesPanel: () => <div data-testid="section-custom-templates" />,
}));
vi.mock("@/components/roles/CompanyAssignmentsTable", () => ({
  CompanyAssignmentsTable: () => <div data-testid="section-companies" />,
}));
vi.mock("@/components/roles/PermissionMatrixTable", () => ({
  PermissionMatrixTable: () => <div data-testid="section-matrix" />,
}));
vi.mock("@/components/roles/AssignedUsersTable", () => ({
  AssignedUsersTable: () => <div data-testid="section-users" />,
}));

import { SuperAdminRolesView } from "./SuperAdminRolesView";

afterEach(() => {
  cleanup();
});

describe("SuperAdminRolesView — section tile menu (Slice 11E)", () => {
  beforeEach(() => {
    render(<SuperAdminRolesView />);
  });

  it("renders the section menu as the shared tile menu with icon + label", () => {
    const tiles = screen.getByTestId("roles-section-tiles");
    const templatesTile = within(tiles).getByTestId("page-menu-tile-templates");
    expect(within(templatesTile).getByTestId("page-menu-tile-icon-templates")).toBeInTheDocument();
    expect(templatesTile).toHaveTextContent("Templates");
  });

  it("uses the short labels for every section", () => {
    const tiles = screen.getByTestId("roles-section-tiles");
    for (const label of ["Templates", "Companies", "Matrix", "Users"]) {
      expect(within(tiles).getByRole("tab", { name: label })).toBeInTheDocument();
    }
  });

  it("marks Templates active by default and shows its section", () => {
    expect(screen.getByRole("tab", { name: "Templates" })).toHaveAttribute("data-state", "active");
    expect(screen.getByTestId("section-templates")).toBeInTheDocument();
  });

  it("switches the rendered section when another tile is selected", () => {
    expect(screen.queryByTestId("section-matrix")).not.toBeInTheDocument();
    // Radix Tabs activate on mousedown (matches the Calculator/Settings tab tests).
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Matrix" }));
    expect(screen.getByRole("tab", { name: "Matrix" })).toHaveAttribute("data-state", "active");
    expect(screen.getByTestId("section-matrix")).toBeInTheDocument();
  });

  it("keeps a fixed tile size with consistent icon sizing for long-label safety", () => {
    const tile = screen.getByTestId("page-menu-tile-companies");
    expect(tile).toHaveClass("w-[88px]", "h-20");
    expect(tile).toHaveAttribute("title", "Companies");
    expect(screen.getByTestId("page-menu-tile-icon-companies")).toHaveClass("h-5", "w-5");
  });
});
