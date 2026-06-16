import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProtectedRoute } from "@/components/ProtectedRoute";
import {
  COMPANY_MEDIA_LIBRARY_SETTINGS_PATH,
  COMPANY_MEDIA_LIBRARY_SETTINGS_VIEW_PERMISSION,
} from "@/lib/assets/companyMediaSettingsNav";
import type { CompanyAdminMediaItem, CompanyAdminMediaLibraryResult } from "@/lib/assets";
import type { Asset } from "@/lib/assets/assetTypes";
import type { UserRole } from "@/types";

const mocks = vi.hoisted(() => ({
  useApp: vi.fn(),
  listCompanyAdminMediaLibrary: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("@/context/AppContext", () => ({ useApp: () => mocks.useApp() }));
vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/dashboard/PageHeader", () => ({
  PageHeader: ({ title, description }: { title: string; description?: string }) => (
    <header>
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
    </header>
  ),
}));
vi.mock("@/components/AccessDenied", () => ({
  AccessDenied: () => <div data-testid="access-denied">Access denied</div>,
}));
vi.mock("@/lib/assets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/assets")>();
  return {
    ...actual,
    listCompanyAdminMediaLibrary: mocks.listCompanyAdminMediaLibrary,
  };
});

import CompanyMediaLibrarySettings from "./MediaLibrary";

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "asset_1",
    companyId: null,
    customerId: null,
    folderId: null,
    categoryId: "asset_cat_general",
    scope: "global_internal",
    visibility: "internal",
    assetType: "image",
    mimeType: "image/png",
    name: "image.png",
    title: "Image",
    description: null,
    altText: null,
    tags: [],
    storageBucket: "private-assets",
    storagePath: "global/internal/asset_1/original.png",
    publicUrl: null,
    thumbnailBucket: "private-assets",
    thumbnailPath: "global/internal/asset_1/thumb.webp",
    previewBucket: "private-assets",
    previewPath: "global/internal/asset_1/preview.webp",
    posterAssetId: null,
    width: 1600,
    height: 900,
    durationSeconds: null,
    fileSize: 4096,
    checksum: null,
    copiedFromAssetId: null,
    copiedFromAssetLegacyId: null,
    sourceAssetId: null,
    sourceAssetLegacyId: null,
    metadata: {},
    createdBy: "usr_1",
    updatedBy: null,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function item(
  assetOverrides: Partial<Asset>,
  itemOverrides: Partial<CompanyAdminMediaItem> = {},
): CompanyAdminMediaItem {
  const source = asset(assetOverrides);
  const isGlobal = !source.companyId;
  return {
    asset: source,
    urls: { thumbUrl: source.publicUrl ?? "https://cdn.example/thumb.png", fullUrl: source.publicUrl ?? "https://cdn.example/full.png" },
    library: isGlobal ? "global_library" : "company_library",
    isReadOnly: isGlobal,
    isArchived: Boolean(source.archivedAt),
    canSelect: !source.archivedAt,
    canArchive: !isGlobal && !source.archivedAt,
    availability: source.archivedAt ? "legacy_reference" : "selectable",
    ...itemOverrides,
  };
}

function library(overrides: Partial<CompanyAdminMediaLibraryResult> = {}): CompanyAdminMediaLibraryResult {
  const result = {
    globalItems: [
      item({
        id: "global_service",
        title: "Shared service hero",
        name: "shared-service.png",
        categoryId: "asset_cat_services",
        scope: "website_public",
        visibility: "public",
        storageBucket: "public-assets",
        publicUrl: "https://cdn.example/shared-service.png",
      }),
    ],
    companyItems: [
      item({
        id: "company_protocol",
        title: "Company protocol image",
        name: "company-protocol.png",
        companyId: "cmp_1",
        categoryId: "asset_cat_cleaning_protocols",
        scope: "company_internal",
      }),
    ],
  } satisfies Omit<CompanyAdminMediaLibraryResult, "allItems">;
  return {
    ...result,
    allItems: [...result.globalItems, ...result.companyItems],
    ...overrides,
  };
}

function setAppState(role: UserRole | null, permissions: string[] = ["settings.manage"]): void {
  const granted = new Set<string>(permissions);
  mocks.useApp.mockReturnValue({
    currentUser: role
      ? { id: "usr_test", name: "Test User", role, companyId: role === "company_admin" ? "cmp_1" : null }
      : null,
    isAuthRestoring: false,
    hasPermission: (permission: string) => granted.has(permission),
    canAccessModule: vi.fn(() => true),
    logout: mocks.logout,
  });
}

function renderPage(): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[COMPANY_MEDIA_LIBRARY_SETTINGS_PATH]}>
        <CompanyMediaLibrarySettings />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

function renderGuardedRoute(role: UserRole | null, permissions: string[] = ["settings.manage"]): void {
  setAppState(role, permissions);
  render(
    <MemoryRouter initialEntries={[COMPANY_MEDIA_LIBRARY_SETTINGS_PATH]}>
      <Routes>
        <Route
          path={COMPANY_MEDIA_LIBRARY_SETTINGS_PATH}
          element={
            <ProtectedRoute
              allow={["company_admin"]}
              requirePermission={COMPANY_MEDIA_LIBRARY_SETTINGS_VIEW_PERMISSION}
            >
              <div>Media Library route content</div>
            </ProtectedRoute>
          }
        />
        <Route path="/dashboard" element={<div>Dashboard page</div>} />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setAppState("company_admin");
  mocks.listCompanyAdminMediaLibrary.mockResolvedValue(library());
});

describe("Company Admin Settings Media Library route", () => {
  it("lets a Company Admin with settings.manage access /settings/media", () => {
    renderGuardedRoute("company_admin", ["settings.manage"]);
    expect(screen.getByText("Media Library route content")).toBeInTheDocument();
  });

  it("blocks Super Admin and Company Admin users without settings.manage", () => {
    renderGuardedRoute("super_admin", ["settings.manage"]);
    expect(screen.getByText("Dashboard page")).toBeInTheDocument();

    renderGuardedRoute("company_admin", []);
    expect(screen.getAllByText("Dashboard page")).toHaveLength(2);
  });

  it("redirects signed-out visitors to login", () => {
    renderGuardedRoute(null, []);
    expect(screen.getByText("Login page")).toBeInTheDocument();
  });
});

describe("Company Admin Settings Media Library page", () => {
  it("renders scope filters and separates Global media from Internal media by default", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Media Library", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Manage company media and view global assets made available by Super Admin.")).toBeInTheDocument();

    const scopeFilter = screen.getByRole("group", { name: "Filter media by scope" });
    expect(within(scopeFilter).getByRole("button", { name: /All images/i })).toHaveAttribute("aria-pressed", "true");
    expect(within(scopeFilter).getByRole("button", { name: /Global media/i })).toHaveAttribute("aria-pressed", "false");
    expect(within(scopeFilter).getByRole("button", { name: /Internal media/i })).toHaveAttribute("aria-pressed", "false");

    const globalSection = screen.getByRole("heading", { name: "Global media" }).closest("section");
    const companySection = screen.getByRole("heading", { name: "Internal media" }).closest("section");
    expect(globalSection).not.toBeNull();
    expect(companySection).not.toBeNull();

    await waitFor(() => {
      expect(within(globalSection as HTMLElement).getByTestId("media-category-services")).toBeInTheDocument();
    });
    expect(within(globalSection as HTMLElement).getByText("Shared service hero")).toBeInTheDocument();
    expect(within(companySection as HTMLElement).getByTestId("media-category-cleaning_protocols")).toBeInTheDocument();
    expect(within(companySection as HTMLElement).getByText("Company protocol image")).toBeInTheDocument();
  });

  it("renders global assets as Global/read-only and does not expose archive/delete actions", async () => {
    renderPage();

    const globalSection = (await screen.findByRole("heading", { name: "Global media" })).closest("section") as HTMLElement;
    await waitFor(() => {
      expect(within(globalSection).getByText("Shared service hero")).toBeInTheDocument();
    });
    expect(within(globalSection).getAllByText("Global").length).toBeGreaterThan(0);
    expect(within(globalSection).getAllByText(/Read-only/i).length).toBeGreaterThan(0);
    expect(within(globalSection).getByText("Selectable")).toBeInTheDocument();
    expect(screen.queryByText("Public")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /archive|delete/i })).not.toBeInTheDocument();
  });

  it("keeps company upload/manage as a safe deferred foundation control", async () => {
    mocks.listCompanyAdminMediaLibrary.mockResolvedValueOnce(
      library({ companyItems: [], allItems: library().globalItems }),
    );
    renderPage();

    await screen.findByRole("heading", { name: "Internal media" });
    expect(screen.getByRole("button", { name: "Upload internal media coming later" })).toBeDisabled();
    expect(await screen.findByText(/Safe upload\/manage controls arrive in a later ticket/i)).toBeInTheDocument();
    expect(screen.getByText(/Company-level hiding of global assets will be added in a later slice/i)).toBeInTheDocument();
  });

  it("falls back unknown internal asset categories into General folder", async () => {
    mocks.listCompanyAdminMediaLibrary.mockResolvedValueOnce(
      library({
        companyItems: [
          item({
            id: "company_unknown",
            title: "Unsorted company logo",
            companyId: "cmp_1",
            categoryId: "unknown-category",
            scope: "company_internal",
          }),
        ],
      }),
    );

    renderPage();

    const companySection = (await screen.findByRole("heading", { name: "Internal media" })).closest("section") as HTMLElement;
    await waitFor(() => {
      expect(within(companySection).getByTestId("media-category-general")).toBeInTheDocument();
    });
    expect(within(companySection).getByText("Unsorted company logo")).toBeInTheDocument();
  });

  it("filters to only global Super Admin assets while preserving category grouping", async () => {
    renderPage();

    const scopeFilter = await screen.findByRole("group", { name: "Filter media by scope" });
    fireEvent.click(within(scopeFilter).getByRole("button", { name: "Global media" }));

    const globalSection = screen.getByRole("heading", { name: "Global media" }).closest("section") as HTMLElement;
    expect(within(globalSection).getByText("Shared service hero")).toBeInTheDocument();
    expect(within(globalSection).getByTestId("media-category-services")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Internal media" })).not.toBeInTheDocument();
    expect(screen.queryByText("Company protocol image")).not.toBeInTheDocument();
  });

  it("filters to only internal company-owned assets while preserving category grouping", async () => {
    renderPage();

    const scopeFilter = await screen.findByRole("group", { name: "Filter media by scope" });
    fireEvent.click(within(scopeFilter).getByRole("button", { name: "Internal media" }));

    const internalSection = screen.getByRole("heading", { name: "Internal media" }).closest("section") as HTMLElement;
    expect(within(internalSection).getByText("Company protocol image")).toBeInTheDocument();
    expect(within(internalSection).getByTestId("media-category-cleaning_protocols")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Global media" })).not.toBeInTheDocument();
    expect(screen.queryByText("Shared service hero")).not.toBeInTheDocument();
    expect(within(internalSection).getAllByText("Internal").length).toBeGreaterThan(0);
  });

  it("shows an AccessDenied fallback if the page is rendered outside the Company Admin guard", () => {
    setAppState("super_admin", ["settings.manage"]);
    renderPage();
    expect(screen.getByTestId("access-denied")).toBeInTheDocument();
  });
});
