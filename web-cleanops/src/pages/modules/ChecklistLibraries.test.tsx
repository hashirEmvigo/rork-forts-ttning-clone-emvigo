import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

/**
 * Slice 11E — the Checklist Libraries page-level section menu now renders as the
 * shared icon-above-label tile menu (`PageMenuTiles`) with short labels (Room
 * Library → Rooms, Cleaning Task Library → Tasks). These tests prove the tile
 * menu renders icon + label, the default Rooms section is active, selecting a
 * tile switches the rendered section, the fixed tile size keeps the layout
 * stable, and — critically — that the existing access control is unchanged
 * (the view permission + module access still gate the whole page).
 */

const mocks = vi.hoisted(() => ({
  role: "super_admin" as "super_admin" | "company_admin",
  permissions: new Set<string>(),
  canAccessModule: true,
  toast: vi.fn(),
}));

vi.mock("@/context/AppContext", () => ({
  useApp: () => ({
    currentUser: { id: "u1", role: mocks.role, companyId: mocks.role === "super_admin" ? null : "cmp_1" },
    hasPermission: (p: string) => mocks.permissions.has(p),
    canAccessModule: () => mocks.canAccessModule,
    getVisibleLibraryRooms: () => [],
    getVisibleLibraryTasks: () => [],
    canEditLibraryRoom: () => false,
    canEditLibraryTask: () => false,
    createLibraryRoom: vi.fn(),
    updateLibraryRoom: vi.fn(),
    setLibraryRoomArchived: vi.fn(),
    createLibraryTask: vi.fn(),
    updateLibraryTask: vi.fn(),
    setLibraryTaskArchived: vi.fn(),
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
vi.mock("@/components/checklist/LibraryRoomDialog", () => ({ LibraryRoomDialog: () => null }));
vi.mock("@/components/checklist/LibraryTaskDialog", () => ({ LibraryTaskDialog: () => null }));

import ChecklistLibraries from "./ChecklistLibraries";

function renderPage() {
  return render(
    <MemoryRouter>
      <ChecklistLibraries />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.role = "super_admin";
  mocks.permissions = new Set(["checklist_templates.view"]);
  mocks.canAccessModule = true;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ChecklistLibraries — section tile menu (Slice 11E)", () => {
  it("renders the section menu as the shared tile menu with icon + label", () => {
    renderPage();
    const tiles = screen.getByTestId("library-menu-tiles");
    const roomsTile = within(tiles).getByTestId("page-menu-tile-rooms");
    expect(within(roomsTile).getByTestId("page-menu-tile-icon-rooms")).toBeInTheDocument();
    expect(roomsTile).toHaveTextContent("Rooms");
    expect(within(tiles).getByRole("tab", { name: "Tasks" })).toBeInTheDocument();
  });

  it("marks Rooms active by default and shows its content", () => {
    renderPage();
    expect(screen.getByRole("tab", { name: "Rooms" })).toHaveAttribute("data-state", "active");
    expect(screen.getByText("No rooms found.")).toBeInTheDocument();
  });

  it("switches the rendered section when the Tasks tile is selected", () => {
    renderPage();
    expect(screen.queryByText("No tasks found.")).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Tasks" }));
    expect(screen.getByRole("tab", { name: "Tasks" })).toHaveAttribute("data-state", "active");
    expect(screen.getByText("No tasks found.")).toBeInTheDocument();
  });

  it("keeps a fixed tile size with consistent icon sizing for long-label safety", () => {
    renderPage();
    const tile = screen.getByTestId("page-menu-tile-tasks");
    expect(tile).toHaveClass("w-[88px]", "h-20");
    expect(tile).toHaveAttribute("title", "Tasks");
    expect(screen.getByTestId("page-menu-tile-icon-tasks")).toHaveClass("h-5", "w-5");
  });

  it("keeps access control authoritative — no view permission blocks the page", () => {
    mocks.permissions = new Set();
    renderPage();
    expect(screen.getByTestId("access-denied")).toBeInTheDocument();
    expect(screen.queryByTestId("library-menu-tiles")).not.toBeInTheDocument();
  });

  it("keeps access control authoritative — company user without module access is blocked", () => {
    mocks.role = "company_admin";
    mocks.permissions = new Set(["checklist_templates.view"]);
    mocks.canAccessModule = false;
    renderPage();
    expect(screen.getByTestId("access-denied")).toBeInTheDocument();
    expect(screen.queryByTestId("library-menu-tiles")).not.toBeInTheDocument();
  });
});
