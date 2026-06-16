import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

/**
 * Slice 11E — the Super Admin → Services page-level section menu now renders as
 * the shared icon-above-label tile menu (`PageMenuTiles`): Catalogue / Companies
 * / History / Billing. These tests prove the tile menu renders icon + label, the
 * default Catalogue section is active, selecting a tile switches the rendered
 * section, the fixed tile size keeps the layout stable, and the Super-Admin-only
 * access gate stays authoritative.
 */

const mocks = vi.hoisted(() => ({
  role: "super_admin" as "super_admin" | "company_admin",
  toast: vi.fn(),
}));

vi.mock("@/context/AppContext", () => ({
  useApp: () => ({
    currentUser: { id: "u1", role: mocks.role, companyId: mocks.role === "super_admin" ? null : "cmp_1" },
    companies: [],
    users: [],
    isServiceGloballyAvailable: () => false,
    isCompanyEntitledToService: () => false,
    getCompanyServiceEntitlement: () => null,
    getCompanyServiceStatus: () => "disabled",
    getEffectiveCompanyServiceStatus: () => "disabled",
    setServiceGlobalAvailability: vi.fn(),
    setCompanyServiceStatus: vi.fn(),
    evaluateMediaUploadGate: () => ({ limit: null, used: 0, remaining: 0, allowed: true }),
    getCompanyMediaUsage: () => ({ count: 0, storedBytes: 0 }),
    serviceEntitlementLog: [],
  }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/dashboard/PageHeader", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock("@/components/AccessDenied", () => ({
  AccessDenied: () => <div data-testid="access-denied">Access denied</div>,
}));

import Services from "./Services";

function renderPage() {
  return render(
    <MemoryRouter>
      <Services />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.role = "super_admin";
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Super Admin Services — section tile menu (Slice 11E)", () => {
  it("renders the section menu as the shared tile menu with icon + label", () => {
    renderPage();
    const tiles = screen.getByTestId("services-menu-tiles");
    const catalogueTile = within(tiles).getByTestId("page-menu-tile-catalogue");
    expect(within(catalogueTile).getByTestId("page-menu-tile-icon-catalogue")).toBeInTheDocument();
    expect(catalogueTile).toHaveTextContent("Catalogue");
  });

  it("renders all four sections", () => {
    renderPage();
    const tiles = screen.getByTestId("services-menu-tiles");
    for (const label of ["Catalogue", "Companies", "History", "Billing"]) {
      expect(within(tiles).getByRole("tab", { name: label })).toBeInTheDocument();
    }
  });

  it("marks Catalogue active by default", () => {
    renderPage();
    expect(screen.getByRole("tab", { name: "Catalogue" })).toHaveAttribute("data-state", "active");
  });

  it("switches the rendered section when the History tile is selected", () => {
    renderPage();
    expect(screen.queryByText(/No entitlement changes recorded yet/i)).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "History" }));
    expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute("data-state", "active");
    expect(screen.getByText(/No entitlement changes recorded yet/i)).toBeInTheDocument();
  });

  it("keeps a fixed tile size with consistent icon sizing for long-label safety", () => {
    renderPage();
    const tile = screen.getByTestId("page-menu-tile-catalogue");
    expect(tile).toHaveClass("w-[88px]", "h-20");
    expect(tile).toHaveAttribute("title", "Catalogue");
    expect(screen.getByTestId("page-menu-tile-icon-catalogue")).toHaveClass("h-5", "w-5");
  });

  it("keeps access control authoritative — blocks non Super Admin", () => {
    mocks.role = "company_admin";
    renderPage();
    expect(screen.getByTestId("access-denied")).toBeInTheDocument();
    expect(screen.queryByTestId("services-menu-tiles")).not.toBeInTheDocument();
  });
});
