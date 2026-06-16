import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { Service, ServiceCategory, ServicePackage, ServicePackageItem } from "@/types";

vi.mock("@/lib/data/supabaseServiceRepository", () => ({
  createServiceInSupabase: vi.fn(),
  updateServiceInSupabase: vi.fn(),
}));

vi.mock("@/lib/data/supabaseServiceCategoryRepository", () => ({
  createServiceCategoryInSupabase: vi.fn(),
  updateServiceCategoryInSupabase: vi.fn(),
}));

vi.mock("@/lib/data/serviceCatalogDirectoryRefresh", () => ({
  bumpServiceCatalogDirectoryRefresh: vi.fn(),
}));

vi.mock("@/lib/store", () => ({
  saveServices: vi.fn(),
  saveServiceCategories: vi.fn(),
}));

import {
  createServiceInSupabase,
  updateServiceInSupabase,
} from "@/lib/data/supabaseServiceRepository";
import {
  createServiceCategoryInSupabase,
  updateServiceCategoryInSupabase,
} from "@/lib/data/supabaseServiceCategoryRepository";
import { bumpServiceCatalogDirectoryRefresh } from "@/lib/data/serviceCatalogDirectoryRefresh";
import { saveServiceCategories, saveServices } from "@/lib/store";
import { useServiceCatalogMutations } from "./use-service-catalog-mutations";

const COMPANY = "cmp_stad";

const category: ServiceCategory = {
  id: "svc_cat_1",
  companyId: COMPANY,
  name: "Smoke Category",
  sortOrder: 0,
  status: "active",
  createdBy: "usr_admin",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const service: Service = {
  id: "svc_1",
  companyId: COMPANY,
  categoryId: "svc_cat_1",
  name: "Smoke Service",
  billingType: "fixed",
  serviceBasisType: "billable",
  deductionEligible: false,
  deductionType: "none",
  smsEnabled: false,
  status: "active",
  createdBy: "usr_admin",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function pkgItem(overrides: Partial<ServicePackageItem>): ServicePackageItem {
  return {
    id: "svc_pkg_item",
    name: "Service",
    categoryName: "Cleaning",
    billingType: "fixed",
    serviceBasisType: "billable",
    deductionEligible: false,
    deductionType: "none",
    smsEnabled: false,
    ...overrides,
  };
}

function buildPackage(items: ServicePackageItem[]): ServicePackage {
  return {
    id: "pkg_global_1",
    name: "Starter",
    archived: false,
    items,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const createServiceMock = vi.mocked(createServiceInSupabase);
const updateServiceMock = vi.mocked(updateServiceInSupabase);
const createCategoryMock = vi.mocked(createServiceCategoryInSupabase);
const updateCategoryMock = vi.mocked(updateServiceCategoryInSupabase);
const refreshMock = vi.mocked(bumpServiceCatalogDirectoryRefresh);
const saveServicesMock = vi.mocked(saveServices);
const saveCategoriesMock = vi.mocked(saveServiceCategories);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { wrapper, invalidateSpy };
}

beforeEach(() => {
  vi.clearAllMocks();
  createServiceMock.mockResolvedValue(service);
  updateServiceMock.mockResolvedValue(service);
  createCategoryMock.mockResolvedValue(category);
  updateCategoryMock.mockResolvedValue(category);
});

describe("useServiceCatalogMutations", () => {
  it("creates service categories through Supabase only and refreshes the directory", async () => {
    const { wrapper, invalidateSpy } = createWrapper();
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const sessionGetSpy = vi.spyOn(sessionStorage, "getItem");
    const sessionSetSpy = vi.spyOn(sessionStorage, "setItem");
    const { result } = renderHook(
      () =>
        useServiceCatalogMutations({
          companyId: COMPANY,
          isSuperAdmin: false,
          canManageServices: true,
          currentUserId: "usr_admin",
        }),
      { wrapper },
    );

    await result.current.createServiceCategory({ name: "Smoke Category", sortOrder: 2 });

    expect(createCategoryMock).toHaveBeenCalledWith({
      companyId: COMPANY,
      createdBy: "usr_admin",
      name: "Smoke Category",
      sortOrder: 2,
    });
    expect(updateCategoryMock).not.toHaveBeenCalled();
    expect(saveCategoriesMock).not.toHaveBeenCalled();
    expect(saveServicesMock).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(sessionGetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["service-catalog-directory"] }),
    );
    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
    sessionGetSpy.mockRestore();
    sessionSetSpy.mockRestore();
  });

  it("updates service categories through Supabase only", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () =>
        useServiceCatalogMutations({ companyId: COMPANY, isSuperAdmin: false, canManageServices: true }),
      { wrapper },
    );

    await result.current.updateServiceCategory({
      categoryId: "svc_cat_1",
      patch: { name: "Updated Category" },
    });

    expect(updateCategoryMock).toHaveBeenCalledWith(COMPANY, "svc_cat_1", { name: "Updated Category" });
    expect(createCategoryMock).not.toHaveBeenCalled();
    expect(saveCategoriesMock).not.toHaveBeenCalled();
  });

  it("creates services through Supabase only and preserves the category link", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () =>
        useServiceCatalogMutations({
          companyId: COMPANY,
          isSuperAdmin: false,
          canManageServices: true,
          currentUserId: "usr_admin",
        }),
      { wrapper },
    );

    await result.current.createService({
      categoryId: "svc_cat_1",
      name: "Smoke Service",
      billingType: "fixed",
      serviceBasisType: "billable",
      deductionEligible: false,
      deductionType: "none",
      smsEnabled: false,
    });

    expect(createServiceMock).toHaveBeenCalledWith({
      companyId: COMPANY,
      createdBy: "usr_admin",
      categoryId: "svc_cat_1",
      name: "Smoke Service",
      billingType: "fixed",
      serviceBasisType: "billable",
      deductionEligible: false,
      deductionType: "none",
      smsEnabled: false,
    });
    expect(updateServiceMock).not.toHaveBeenCalled();
    expect(saveServicesMock).not.toHaveBeenCalled();
  });

  it("updates services through Supabase only", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () =>
        useServiceCatalogMutations({ companyId: COMPANY, isSuperAdmin: false, canManageServices: true }),
      { wrapper },
    );

    await result.current.updateService({
      serviceId: "svc_1",
      patch: { name: "Updated Service", categoryId: "svc_cat_2" },
    });

    expect(updateServiceMock).toHaveBeenCalledWith(COMPANY, "svc_1", {
      name: "Updated Service",
      categoryId: "svc_cat_2",
    });
    expect(createServiceMock).not.toHaveBeenCalled();
    expect(saveServicesMock).not.toHaveBeenCalled();
  });

  it("fails closed for company-scoped writes when company context is missing", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () =>
        useServiceCatalogMutations({ companyId: " ", isSuperAdmin: false, canManageServices: true }),
      { wrapper },
    );

    await expect(result.current.createServiceCategory({ name: "Blocked" })).rejects.toThrow(
      /company context/i,
    );

    expect(createCategoryMock).not.toHaveBeenCalled();
    expect(createServiceMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("uses global scope for Super Admin creates", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () =>
        useServiceCatalogMutations({
          companyId: undefined,
          isSuperAdmin: true,
          canManageServices: true,
          currentUserId: "usr_super",
        }),
      { wrapper },
    );

    await result.current.createServiceCategory({ name: "Global Category" });

    expect(createCategoryMock).toHaveBeenCalledWith({
      companyId: null,
      createdBy: "usr_super",
      name: "Global Category",
    });
  });

  it("does not refresh when Supabase write fails", async () => {
    createServiceMock.mockRejectedValueOnce(new Error("supabase failed"));
    const { wrapper, invalidateSpy } = createWrapper();
    const { result } = renderHook(
      () =>
        useServiceCatalogMutations({ companyId: COMPANY, isSuperAdmin: false, canManageServices: true }),
      { wrapper },
    );

    await expect(
      result.current.createService({
        categoryId: null,
        name: "Broken",
        billingType: "fixed",
        serviceBasisType: "billable",
        deductionEligible: false,
        deductionType: "none",
        smsEnabled: false,
      }),
    ).rejects.toThrow("supabase failed");

    expect(refreshMock).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(saveServicesMock).not.toHaveBeenCalled();
  });
});

describe("useServiceCatalogMutations · applyPackage (Copy into company)", () => {
  it("creates company-owned categories + services via Supabase only and refreshes", async () => {
    createCategoryMock.mockImplementation(async (input) => ({
      ...category,
      id: `cat_${input.name.toLowerCase()}`,
      name: input.name,
      companyId: input.companyId,
      sortOrder: input.sortOrder ?? 0,
    }));
    createServiceMock.mockImplementation(async (input) => ({
      ...service,
      ...input,
      id: `svc_${input.name}`,
    }));

    const { wrapper, invalidateSpy } = createWrapper();
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const { result } = renderHook(
      () =>
        useServiceCatalogMutations({
          companyId: COMPANY,
          isSuperAdmin: false,
          canManageServices: true,
          currentUserId: "usr_admin",
        }),
      { wrapper },
    );

    const outcome = await result.current.applyPackage({
      pkg: buildPackage([
        pkgItem({ id: "a", name: "Weekly Clean", categoryName: "Recurring" }),
        pkgItem({ id: "b", name: "Window Wash", categoryName: "Windows" }),
      ]),
      existingCompanyCategories: [],
      existingCompanyServices: [],
    });

    expect(outcome).toEqual({ added: 2, categoriesCreated: 2 });

    // Categories are created COMPANY-OWNED (companyId = COMPANY, never global null).
    expect(createCategoryMock).toHaveBeenCalledTimes(2);
    expect(createCategoryMock).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: COMPANY, name: "Recurring", createdBy: "usr_admin" }),
    );
    expect(createCategoryMock).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: COMPANY, name: "Windows" }),
    );

    // Services are company-owned and link to the freshly created category ids.
    expect(createServiceMock).toHaveBeenCalledTimes(2);
    expect(createServiceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY,
        name: "Weekly Clean",
        categoryId: "cat_recurring",
        createdBy: "usr_admin",
      }),
    );
    expect(createServiceMock).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: COMPANY, name: "Window Wash", categoryId: "cat_windows" }),
    );

    // No localStorage authority / mirror fallback.
    expect(saveServicesMock).not.toHaveBeenCalled();
    expect(saveCategoriesMock).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["service-catalog-directory"] }),
    );
    setItemSpy.mockRestore();
  });

  it("reuses an existing company category instead of creating a duplicate", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () =>
        useServiceCatalogMutations({ companyId: COMPANY, isSuperAdmin: false, canManageServices: true }),
      { wrapper },
    );

    const existing: ServiceCategory = { ...category, id: "cat_existing", name: "Cleaning" };
    const outcome = await result.current.applyPackage({
      pkg: buildPackage([pkgItem({ name: "Weekly Clean", categoryName: "  cleaning  " })]),
      existingCompanyCategories: [existing],
      existingCompanyServices: [],
    });

    expect(outcome).toEqual({ added: 1, categoriesCreated: 0 });
    expect(createCategoryMock).not.toHaveBeenCalled();
    expect(createServiceMock).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: COMPANY, categoryId: "cat_existing" }),
    );
  });

  it("fails closed with no writes when the company context is missing", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useServiceCatalogMutations({ companyId: " ", isSuperAdmin: false, canManageServices: true }),
      { wrapper },
    );

    await expect(
      result.current.applyPackage({
        pkg: buildPackage([pkgItem({})]),
        existingCompanyCategories: [],
        existingCompanyServices: [],
      }),
    ).rejects.toThrow(/company context/i);

    expect(createCategoryMock).not.toHaveBeenCalled();
    expect(createServiceMock).not.toHaveBeenCalled();
    expect(saveServicesMock).not.toHaveBeenCalled();
  });

  it("never touches localStorage even when a service create fails mid-copy", async () => {
    createCategoryMock.mockImplementation(async (input) => ({
      ...category,
      id: `cat_${input.name.toLowerCase()}`,
      name: input.name,
      companyId: input.companyId,
    }));
    createServiceMock.mockRejectedValueOnce(new Error("supabase insert failed"));
    const { wrapper } = createWrapper();
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const { result } = renderHook(
      () =>
        useServiceCatalogMutations({ companyId: COMPANY, isSuperAdmin: false, canManageServices: true }),
      { wrapper },
    );

    await expect(
      result.current.applyPackage({
        pkg: buildPackage([pkgItem({ name: "X", categoryName: "Recurring" })]),
        existingCompanyCategories: [],
        existingCompanyServices: [],
      }),
    ).rejects.toThrow("supabase insert failed");

    expect(saveServicesMock).not.toHaveBeenCalled();
    expect(saveCategoriesMock).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    setItemSpy.mockRestore();
  });

  it("blocks the copy with NO writes when it would duplicate an existing company article number", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () =>
        useServiceCatalogMutations({ companyId: COMPANY, isSuperAdmin: false, canManageServices: true }),
      { wrapper },
    );

    const existingService: Service = { ...service, id: "svc_existing", articleNumber: "1001" };

    await expect(
      result.current.applyPackage({
        pkg: buildPackage([
          pkgItem({ id: "a", name: "Weekly Clean", categoryName: "Recurring", articleNumber: "1001" }),
        ]),
        existingCompanyCategories: [],
        existingCompanyServices: [existingService],
      }),
    ).rejects.toThrow(/1001/);

    expect(createCategoryMock).not.toHaveBeenCalled();
    expect(createServiceMock).not.toHaveBeenCalled();
    expect(saveServicesMock).not.toHaveBeenCalled();
  });

  it("blocks the copy when two package items carry the same article number", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () =>
        useServiceCatalogMutations({ companyId: COMPANY, isSuperAdmin: false, canManageServices: true }),
      { wrapper },
    );

    await expect(
      result.current.applyPackage({
        pkg: buildPackage([
          pkgItem({ id: "a", name: "One", categoryName: "Recurring", articleNumber: "2001" }),
          pkgItem({ id: "b", name: "Two", categoryName: "Recurring", articleNumber: "2001" }),
        ]),
        existingCompanyCategories: [],
        existingCompanyServices: [],
      }),
    ).rejects.toThrow(/2001/);

    expect(createServiceMock).not.toHaveBeenCalled();
  });
});
