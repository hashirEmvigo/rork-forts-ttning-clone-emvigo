import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

/**
 * Slice 11E — the Checklist Templates page-level section menu (shown to company
 * admins) now renders as the shared icon-above-label tile menu (`PageMenuTiles`):
 * My Templates / Available. These tests prove the tile menu renders icon +
 * label, the default section is active, selecting a tile switches the section,
 * the fixed tile size keeps the layout stable, the Super Admin still gets the
 * global grid (NOT the tile menu), and access control stays authoritative.
 */

const mocks = vi.hoisted(() => ({
  role: "company_admin" as "super_admin" | "company_admin",
  permissions: new Set<string>(),
  canAccessModule: true,
  toast: vi.fn(),
}));

vi.mock("@/context/AppContext", () => ({
  useApp: () => ({
    currentUser: { id: "u1", role: mocks.role, companyId: mocks.role === "super_admin" ? null : "cmp_1" },
    hasPermission: (p: string) => mocks.permissions.has(p),
    canAccessModule: () => mocks.canAccessModule,
    getVisibleTemplates: () => [],
    canEditTemplate: () => true,
    updateTemplate: vi.fn(),
    cloneTemplate: vi.fn(),
    getTemplateAdoption: () => undefined,
    setTemplateAdopted: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/dashboard/PageHeader", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock("@/components/checklist/ChecklistTabs", () => ({ ChecklistTabs: () => <nav data-testid="checklist-tabs" /> }));
vi.mock("@/components/AccessDenied", () => ({
  AccessDenied: () => <div data-testid="access-denied">Access denied</div>,
}));
vi.mock("@/components/checklist/TemplateDialog", () => ({ TemplateDialog: () => null }));

import ChecklistTemplates from "./ChecklistTemplates";

function renderPage() {
  return render(
    <MemoryRouter>
      <ChecklistTemplates />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.role = "company_admin";
  mocks.permissions = new Set(["checklist_templates.view"]);
  mocks.canAccessModule = true;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ChecklistTemplates — section tile menu (Slice 11E)", () => {
  it("renders the section menu as the shared tile menu with icon + label (company admin)", () => {
    renderPage();
    const tiles = screen.getByTestId("template-menu-tiles");
    const ownTile = within(tiles).getByTestId("page-menu-tile-own");
    expect(within(ownTile).getByTestId("page-menu-tile-icon-own")).toBeInTheDocument();
    expect(ownTile).toHaveTextContent("My Templates");
    expect(within(tiles).getByRole("tab", { name: "Available" })).toBeInTheDocument();
  });

  it("marks My Templates active by default and shows its content", () => {
    renderPage();
    expect(screen.getByRole("tab", { name: "My Templates" })).toHaveAttribute("data-state", "active");
    expect(screen.getByText(/No company templates yet/i)).toBeInTheDocument();
  });

  it("switches the rendered section when the Available tile is selected", () => {
    renderPage();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Available" }));
    expect(screen.getByRole("tab", { name: "Available" })).toHaveAttribute("data-state", "active");
    expect(screen.getByText(/No templates have been made available/i)).toBeInTheDocument();
  });

  it("keeps a fixed tile size with consistent icon sizing for long-label safety", () => {
    renderPage();
    const tile = screen.getByTestId("page-menu-tile-own");
    expect(tile).toHaveClass("w-[88px]", "h-20");
    expect(tile).toHaveAttribute("title", "My Templates");
    expect(screen.getByTestId("page-menu-tile-icon-own")).toHaveClass("h-5", "w-5");
  });

  it("shows the Super Admin the global grid, not the tile menu", () => {
    mocks.role = "super_admin";
    renderPage();
    expect(screen.queryByTestId("template-menu-tiles")).not.toBeInTheDocument();
    expect(screen.getByText(/No global templates yet/i)).toBeInTheDocument();
  });

  it("keeps access control authoritative — no view permission blocks the page", () => {
    mocks.permissions = new Set();
    renderPage();
    expect(screen.getByTestId("access-denied")).toBeInTheDocument();
    expect(screen.queryByTestId("template-menu-tiles")).not.toBeInTheDocument();
  });
});
