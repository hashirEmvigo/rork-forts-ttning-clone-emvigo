import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Slice 11E — the Settings → Services section menu now renders as the shared
 * icon-above-label tile menu (`PageMenuTiles`): Catalog / Packages / Import &
 * Export. These tests prove the tile menu renders icon + label, the default
 * Catalog section is active, selecting a tile switches the rendered section, and
 * the fixed tile size keeps the layout stable. Data hooks + dialogs are stubbed
 * so we exercise the menu, not the catalog's data dependencies.
 */

const mocks = vi.hoisted(() => ({
  role: "super_admin" as "super_admin" | "company_admin",
  toast: vi.fn(),
}));

vi.mock("@/context/AppContext", () => ({
  useApp: () => ({
    currentUser: { id: "u1", role: mocks.role, companyId: null },
    getServiceScope: () => null,
    getScopedServiceCategories: () => [],
    getScopedServices: () => [],
    setServiceCategoryArchived: vi.fn(),
    setServiceArchived: vi.fn(),
    hardDeleteService: vi.fn(),
    servicePackages: [],
  }),
}));

vi.mock("@/hooks/use-article-number-series", () => ({
  useArticleNumberSeries: () => ({
    seriesByCategory: new Map(),
    configure: vi.fn(),
    isConfiguring: false,
  }),
}));
vi.mock("@/hooks/use-service-catalog-mutations", () => ({
  useServiceCatalogMutations: () => ({ applyPackage: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

// Dialogs are rendered closed; stub them so the menu test stays isolated.
vi.mock("@/components/settings/ServiceDialog", () => ({ ServiceDialog: () => null }));
vi.mock("@/components/settings/ServiceCategoryDialog", () => ({ ServiceCategoryDialog: () => null }));
vi.mock("@/components/settings/ServicePackageDialog", () => ({ ServicePackageDialog: () => null }));
vi.mock("@/components/settings/ArticleNumberSeriesDialog", () => ({ ArticleNumberSeriesDialog: () => null }));

import { ServicesPanel } from "./ServicesPanel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ServicesPanel — section tile menu (Slice 11E)", () => {
  beforeEach(() => {
    mocks.role = "super_admin";
    render(<ServicesPanel />);
  });

  it("renders the section menu as the shared tile menu with icon + label", () => {
    const tiles = screen.getByTestId("services-panel-tiles");
    const catalogTile = within(tiles).getByTestId("page-menu-tile-catalog");
    expect(within(catalogTile).getByTestId("page-menu-tile-icon-catalog")).toBeInTheDocument();
    expect(catalogTile).toHaveTextContent("Catalog");
  });

  it("renders all three sections", () => {
    const tiles = screen.getByTestId("services-panel-tiles");
    for (const label of ["Catalog", "Packages", "Import / Export"]) {
      expect(within(tiles).getByRole("tab", { name: label })).toBeInTheDocument();
    }
  });

  it("marks Catalog active by default and shows its content", () => {
    expect(screen.getByRole("tab", { name: "Catalog" })).toHaveAttribute("data-state", "active");
    // Empty scoped catalog → the catalog empty state.
    expect(screen.getByText(/No service categories yet/i)).toBeInTheDocument();
  });

  it("switches the rendered section when another tile is selected", () => {
    expect(screen.queryByText("Import services")).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Import / Export" }));
    expect(screen.getByRole("tab", { name: "Import / Export" })).toHaveAttribute(
      "data-state",
      "active",
    );
    expect(screen.getByText("Import services")).toBeInTheDocument();
    expect(screen.getByText("Export services")).toBeInTheDocument();
  });

  it("keeps a fixed tile size with consistent icon sizing for long-label safety", () => {
    const tile = screen.getByTestId("page-menu-tile-io");
    expect(tile).toHaveClass("w-[88px]", "h-20");
    expect(tile).toHaveAttribute("title", "Import / Export");
    expect(screen.getByTestId("page-menu-tile-icon-io")).toHaveClass("h-5", "w-5");
  });
});
