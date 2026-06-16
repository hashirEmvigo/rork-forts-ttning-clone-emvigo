import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GlobalMediaItem } from "@/hooks/use-global-media-library";
import type { Asset } from "@/lib/assets/assetTypes";
import type { UserRole } from "@/types";

const mocks = vi.hoisted(() => ({
  useApp: vi.fn(),
  useGlobalMediaLibrary: vi.fn(),
  archive: vi.fn(),
  restore: vi.fn(),
  upload: vi.fn(),
  updateMeta: vi.fn(),
  setAsLoginBackground: vi.fn(),
  clearLoginBackground: vi.fn(),
  toast: vi.fn(),
  listAssetCategories: vi.fn(),
  listAssetFolders: vi.fn(),
}));

vi.mock("@/context/AppContext", () => ({ useApp: () => mocks.useApp() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/dashboard/PageHeader", () => ({
  PageHeader: ({ title, description, action }: { title: string; description?: string; action?: ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
      {action}
    </header>
  ),
}));
vi.mock("@/components/AccessDenied", () => ({
  AccessDenied: () => <div data-testid="access-denied">Access denied</div>,
}));
vi.mock("@/components/media/WebsiteImageryPanel", () => ({
  WebsiteImageryPanel: ({ publicImages }: { publicImages: GlobalMediaItem[] }) => (
    <div data-testid="website-imagery-panel">Selectable public images: {publicImages.length}</div>
  ),
}));
vi.mock("@/lib/assets", () => ({
  listAssetCategories: () => mocks.listAssetCategories(),
  listAssetFolders: () => mocks.listAssetFolders(),
}));
vi.mock("@/hooks/use-global-media-library", () => ({
  useGlobalMediaLibrary: () => mocks.useGlobalMediaLibrary(),
}));

import MediaCenter from "./MediaCenter";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

function makeAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "asset_active",
    companyId: null,
    customerId: null,
    folderId: null,
    categoryId: null,
    scope: "website_public",
    visibility: "public",
    assetType: "image",
    mimeType: "image/png",
    name: "hero.png",
    title: "Homepage hero",
    description: "Reusable website image",
    altText: null,
    tags: ["hero"],
    storageBucket: "public-assets",
    storagePath: "website/homepage/asset_active/original.png",
    publicUrl: "https://cdn.example/hero.png",
    thumbnailBucket: "public-assets",
    thumbnailPath: "website/homepage/asset_active/thumb.webp",
    previewBucket: "public-assets",
    previewPath: "website/homepage/asset_active/preview.webp",
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
    createdBy: "usr_sa",
    updatedBy: null,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeItem(asset: Asset): GlobalMediaItem {
  return {
    asset,
    urls: { thumbUrl: asset.publicUrl ?? null, fullUrl: asset.publicUrl ?? null },
    isPublic: asset.visibility === "public",
    isArchived: Boolean(asset.archivedAt),
  };
}

function setAppState(role: UserRole | null): void {
  mocks.useApp.mockReturnValue({
    currentUser: role
      ? { id: "usr_test", name: "Test User", role, companyId: role === "super_admin" ? null : "cmp_1" }
      : null,
  });
}

function setLibrary(items: GlobalMediaItem[], canManage = true): void {
  mocks.useGlobalMediaLibrary.mockReturnValue({
    items,
    loading: false,
    error: null,
    uploading: false,
    canManage,
    loginBackgroundAssetId: null,
    setAsLoginBackground: mocks.setAsLoginBackground,
    clearLoginBackground: mocks.clearLoginBackground,
    upload: mocks.upload,
    updateMeta: mocks.updateMeta,
    archive: mocks.archive,
    restore: mocks.restore,
    remove: vi.fn(),
    refetch: vi.fn(),
  });
}

function renderPage(): void {
  render(
    <MemoryRouter>
      <MediaCenter />
    </MemoryRouter>,
  );
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("File input not found");
  return input;
}

function openTab(name: RegExp): void {
  fireEvent.mouseDown(screen.getByRole("tab", { name }));
}

function openCategorySection(name: RegExp): void {
  fireEvent.click(screen.getByRole("button", { name }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.archive.mockResolvedValue(undefined);
  mocks.restore.mockResolvedValue(undefined);
  mocks.upload.mockResolvedValue(undefined);
  mocks.updateMeta.mockResolvedValue(undefined);
  mocks.setAsLoginBackground.mockResolvedValue(undefined);
  mocks.clearLoginBackground.mockResolvedValue(undefined);
  mocks.listAssetCategories.mockResolvedValue([
    {
      id: "asset_cat_cleaning_protocols",
      companyId: null,
      name: "Cleaning Protocols",
      slug: "cleaning_protocols",
      description: "Protocol media",
      icon: "clipboard-list",
      sortOrder: 0,
      isSystem: true,
      metadata: {},
      archivedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "asset_cat_services",
      companyId: null,
      name: "Services",
      slug: "services",
      description: "Service media",
      icon: "sparkles",
      sortOrder: 1,
      isSystem: true,
      metadata: {},
      archivedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "asset_cat_website_public",
      companyId: null,
      name: "Website / Public Pages",
      slug: "website_public_pages",
      description: "Public website media",
      icon: "globe",
      sortOrder: 2,
      isSystem: true,
      metadata: {},
      archivedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "asset_cat_general",
      companyId: null,
      name: "General Folder",
      slug: "general",
      description: "General library",
      icon: "folder",
      sortOrder: 3,
      isSystem: true,
      metadata: {},
      archivedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ]);
  mocks.listAssetFolders.mockResolvedValue([]);
  setAppState("super_admin");
  setLibrary([makeItem(makeAsset())]);
});

describe("MediaCenter image category sections", () => {
  it("renders Images as collapsed category sections with expected labels and counts", () => {
    setLibrary([
      makeItem(
        makeAsset({
          id: "asset_protocol",
          title: "Protocol room reference",
          categoryId: "asset_cat_cleaning_protocols",
        }),
      ),
      makeItem(
        makeAsset({ id: "asset_service", title: "Service package hero", categoryId: "asset_cat_services" }),
      ),
      makeItem(
        makeAsset({
          id: "asset_public",
          title: "Public homepage banner",
          categoryId: "asset_cat_website_public",
        }),
      ),
      makeItem(makeAsset({ id: "asset_general", title: "General library image", categoryId: "asset_cat_general" })),
    ]);

    renderPage();
    openTab(/Images/i);

    expect(screen.getByRole("button", { name: /Cleaning protocols.*1 image/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Services.*1 image/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Website \/ Public places.*1 image/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /General folder.*1 image/i })).toBeInTheDocument();

    expect(screen.queryByText("Protocol room reference")).not.toBeInTheDocument();
    expect(screen.queryByText("Service package hero")).not.toBeInTheDocument();
    expect(screen.queryByText("Public homepage banner")).not.toBeInTheDocument();
    expect(screen.queryByText("General library image")).not.toBeInTheDocument();
  });

  it("expanding a category shows only images belonging to that category", () => {
    setLibrary([
      makeItem(
        makeAsset({
          id: "asset_protocol",
          title: "Protocol room reference",
          categoryId: "asset_cat_cleaning_protocols",
        }),
      ),
      makeItem(
        makeAsset({ id: "asset_service", title: "Service package hero", categoryId: "asset_cat_services" }),
      ),
    ]);

    renderPage();
    openTab(/Images/i);
    openCategorySection(/Cleaning protocols/i);

    expect(screen.getByText("Protocol room reference")).toBeInTheDocument();
    expect(screen.queryByText("Service package hero")).not.toBeInTheDocument();
  });

  it("falls back missing and unknown image categories to General folder", () => {
    setLibrary([
      makeItem(makeAsset({ id: "asset_missing", title: "Missing category image", categoryId: null })),
      makeItem(makeAsset({ id: "asset_unknown", title: "Unknown category image", categoryId: "legacy_unknown" })),
    ]);

    renderPage();
    openTab(/Images/i);

    expect(screen.getByRole("button", { name: /General folder.*2 images/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cleaning protocols/i })).not.toBeInTheDocument();

    openCategorySection(/General folder/i);
    expect(screen.getByText("Missing category image")).toBeInTheDocument();
    expect(screen.getByText("Unknown category image")).toBeInTheDocument();
  });

  it("groups archived assets by category while keeping restore behavior intact", () => {
    const archivedService = makeItem(
      makeAsset({
        id: "asset_archived_service",
        title: "Archived service image",
        categoryId: "asset_cat_services",
        archivedAt: "2026-06-15T10:00:00.000Z",
      }),
    );
    setLibrary([archivedService]);

    renderPage();
    openTab(/Archived/i);

    expect(screen.getByRole("button", { name: /Services.*1 asset/i })).toBeInTheDocument();
    expect(screen.queryByText("Archived service image")).not.toBeInTheDocument();

    openCategorySection(/Services/i);
    expect(screen.getByText("Archived service image")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Restore/i }));

    expect(mocks.restore).toHaveBeenCalledTimes(1);
    expect(mocks.restore).toHaveBeenCalledWith(archivedService);
  });

  it("keeps archive behavior working inside expanded category sections", () => {
    const serviceImage = makeItem(
      makeAsset({ id: "asset_service", title: "Service package hero", categoryId: "asset_cat_services" }),
    );
    setLibrary([serviceImage]);

    renderPage();
    openTab(/Images/i);
    openCategorySection(/Services/i);
    fireEvent.click(screen.getByRole("button", { name: /Remove from global library/i }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /Remove from global library/i }));

    expect(mocks.archive).toHaveBeenCalledTimes(1);
    expect(mocks.archive).toHaveBeenCalledWith(serviceImage);
  });

  it("keeps upload category assignment compatible with existing Asset Center categories", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Upload asset" }));
    await waitFor(() => expect(mocks.listAssetCategories).toHaveBeenCalledTimes(1));
    fireEvent.change(fileInput(), {
      target: { files: [new File(["image"], "service.png", { type: "image/png" })] },
    });

    const [categorySelect] = screen.getAllByRole("combobox");
    fireEvent.click(categorySelect);
    fireEvent.click(await screen.findByRole("option", { name: "Services" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Upload/i }));

    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
    expect(mocks.upload.mock.calls[0][1]).toMatchObject({
      categoryId: "asset_cat_services",
    });
  });
});

describe("MediaCenter global asset archive semantics", () => {
  it("uses archive/remove-from-global-library language instead of unsafe hard delete", () => {
    const activeItem = makeItem(makeAsset({ id: "asset_active", title: "Homepage hero" }));
    setLibrary([activeItem]);
    renderPage();

    expect(screen.getByRole("heading", { name: "Media Center" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload asset" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Remove from global library/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete asset/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Delete this asset/i)).not.toBeInTheDocument();
  });

  it("opens a safe archive warning and archives instead of deleting", () => {
    const activeItem = makeItem(makeAsset({ id: "asset_active", title: "Homepage hero" }));
    setLibrary([activeItem]);
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /Remove from global library/i }));

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Archive this asset?")).toBeInTheDocument();
    expect(within(dialog).getByText(/This image may already be used by companies/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/existing usages will continue to display the image/i)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: /Remove from global library/i }));

    expect(mocks.archive).toHaveBeenCalledTimes(1);
    expect(mocks.archive).toHaveBeenCalledWith(activeItem);
  });

  it("excludes archived global assets from active/selectable lists while keeping them visible as archived legacy usage", () => {
    const activePublic = makeItem(makeAsset({ id: "asset_active", title: "Active public hero" }));
    const archivedPublic = makeItem(
      makeAsset({
        id: "asset_archived",
        title: "Archived legacy hero",
        archivedAt: "2026-06-15T10:00:00.000Z",
      }),
    );
    setLibrary([activePublic, archivedPublic]);
    renderPage();

    expect(screen.getByText("Active public hero")).toBeInTheDocument();
    expect(screen.queryByText("Archived legacy hero")).not.toBeInTheDocument();

    openTab(/Website imagery/i);
    expect(screen.getByTestId("website-imagery-panel")).toHaveTextContent("Selectable public images: 1");

    openTab(/Archived/i);
    expect(screen.getByRole("button", { name: /General folder/i })).toBeInTheDocument();
    expect(screen.queryByText("Archived legacy hero")).not.toBeInTheDocument();

    openCategorySection(/General folder/i);
    expect(screen.getByText("Archived legacy hero")).toBeInTheDocument();
    expect(screen.getAllByText("Archived").length).toBeGreaterThanOrEqual(2);
  });

  it("fails closed for Company Admins so they cannot archive global originals", () => {
    setAppState("company_admin");
    setLibrary([makeItem(makeAsset())], false);
    renderPage();

    expect(screen.getByTestId("access-denied")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove from global library/i })).not.toBeInTheDocument();
    expect(mocks.archive).not.toHaveBeenCalled();
  });
});
