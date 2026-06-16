import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/data/supabaseChecklistTemplateRepository", () => ({
  supabaseChecklistTemplateRepository: {
    resolveCompanyUuidByLegacyId: vi.fn(),
    createAggregate: vi.fn(),
    updateMetadata: vi.fn(),
    updateSectionsAndItems: vi.fn(),
    archive: vi.fn(),
    restore: vi.fn(),
  },
}));

vi.mock("@/lib/checklistTemplateStore", () => ({
  createTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  archiveTemplate: vi.fn(),
  restoreTemplate: vi.fn(),
  getAllTemplates: vi.fn(),
  getTemplate: vi.fn(),
}));

import { supabaseChecklistTemplateRepository } from "@/lib/data/supabaseChecklistTemplateRepository";
import * as legacyChecklistTemplateStore from "@/lib/checklistTemplateStore";
import { useChecklistTemplateMutations } from "./use-checklist-template-mutations";
import type { ChecklistTemplateAggregate } from "@/lib/data/supabaseChecklistTemplateRepository";
import type { ChecklistItem, ChecklistSection, ChecklistTemplateV2 } from "@/types";

const COMPANY = "company-a";
const COMPANY_UUID = "00000000-0000-4000-8000-000000000001";

const repositoryMock = vi.mocked(supabaseChecklistTemplateRepository);
const legacyStore = vi.mocked(legacyChecklistTemplateStore);

function aggregate(overrides: Partial<ChecklistTemplateV2> = {}): ChecklistTemplateAggregate {
  return {
    template: {
      id: "ctpl_supabase_1",
      companyId: COMPANY,
      scope: "company",
      name: "Supabase Template",
      description: "Saved remotely.",
      audience: "b2b",
      categoryIds: ["cat_1"],
      floorPresetIds: ["floor_1"],
      sortOrder: 10,
      isArchived: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      version: 1,
      schemaVersion: 1,
      ...overrides,
    },
    sections: [],
    items: [],
  };
}

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
  repositoryMock.resolveCompanyUuidByLegacyId.mockReset();
  repositoryMock.createAggregate.mockReset();
  repositoryMock.updateMetadata.mockReset();
  repositoryMock.updateSectionsAndItems.mockReset();
  repositoryMock.archive.mockReset();
  repositoryMock.restore.mockReset();
  repositoryMock.resolveCompanyUuidByLegacyId.mockResolvedValue(COMPANY_UUID);
  repositoryMock.createAggregate.mockResolvedValue(aggregate());
  repositoryMock.updateMetadata.mockResolvedValue(aggregate({ name: "Updated" }));
  repositoryMock.updateSectionsAndItems.mockResolvedValue(aggregate());
  repositoryMock.archive.mockResolvedValue(aggregate({ isArchived: true }));
  repositoryMock.restore.mockResolvedValue(aggregate({ isArchived: false }));
  Object.values(legacyStore).forEach((mockFn) => mockFn.mockClear());
});

describe("useChecklistTemplateMutations", () => {
  it("creates an empty company template through Supabase only and invalidates reads", async () => {
    const { wrapper, invalidateSpy } = createWrapper();
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const { result } = renderHook(() => useChecklistTemplateMutations(COMPANY), { wrapper });

    await result.current.createEmptyCompanyTemplate({
      name: " New Supabase Template ",
      description: " Remote only ",
      audience: "general",
    });

    expect(repositoryMock.resolveCompanyUuidByLegacyId).toHaveBeenCalledWith(COMPANY);
    expect(repositoryMock.createAggregate).toHaveBeenCalledTimes(1);
    const [createdAggregate, params] = repositoryMock.createAggregate.mock.calls[0];
    expect(createdAggregate.template).toEqual(
      expect.objectContaining({
        companyId: COMPANY,
        scope: "company",
        name: "New Supabase Template",
        description: "Remote only",
        audience: "general",
        categoryIds: [],
        floorPresetIds: [],
        isArchived: false,
      }),
    );
    expect(createdAggregate.sections).toEqual([]);
    expect(createdAggregate.items).toEqual([]);
    expect(params).toEqual({ companyUuid: COMPANY_UUID });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(legacyStore.createTemplate).not.toHaveBeenCalled();
    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
  });

  it("updates metadata through Supabase only", async () => {
    const { wrapper } = createWrapper();
    const existing = aggregate().template;
    const { result } = renderHook(() => useChecklistTemplateMutations(COMPANY), { wrapper });

    await result.current.updateMetadata(existing, {
      name: " Renamed ",
      description: " Trimmed ",
      audience: "b2c",
    });

    expect(repositoryMock.updateMetadata).toHaveBeenCalledWith(
      existing.id,
      {
        name: "Renamed",
        description: "Trimmed",
        audience: "b2c",
        categoryIds: existing.categoryIds,
        floorPresetIds: existing.floorPresetIds,
      },
      { companyId: COMPANY, scope: "company", includeArchived: true },
    );
    expect(legacyStore.updateTemplate).not.toHaveBeenCalled();
  });

  it("updates section/item aggregate content through Supabase only", async () => {
    const { wrapper } = createWrapper();
    const existing = aggregate().template;
    const sections: ChecklistSection[] = [
      {
        id: "csec_1",
        templateId: existing.id,
        companyId: COMPANY,
        title: "Reception",
        sortOrder: 10,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const items: ChecklistItem[] = [
      {
        id: "citm_1",
        sectionId: "csec_1",
        templateId: existing.id,
        companyId: COMPANY,
        title: "Wipe desk",
        required: true,
        sortOrder: 10,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const { result } = renderHook(() => useChecklistTemplateMutations(COMPANY), { wrapper });

    await result.current.updateSectionsAndItems(existing, sections, items);

    expect(repositoryMock.updateSectionsAndItems).toHaveBeenCalledWith(
      existing.id,
      sections,
      items,
      { companyId: COMPANY, scope: "company", includeArchived: true },
    );
    expect(repositoryMock.updateMetadata).not.toHaveBeenCalled();
    expect(legacyStore.updateTemplate).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
  });

  it("archives and restores through Supabase only", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useChecklistTemplateMutations(COMPANY), { wrapper });

    await result.current.archive("ctpl_supabase_1");
    await result.current.restore("ctpl_supabase_1");

    expect(repositoryMock.archive).toHaveBeenCalledWith("ctpl_supabase_1", {
      companyId: COMPANY,
      scope: "company",
      includeArchived: true,
    });
    expect(repositoryMock.restore).toHaveBeenCalledWith("ctpl_supabase_1", {
      companyId: COMPANY,
      scope: "company",
      includeArchived: true,
    });
    expect(legacyStore.archiveTemplate).not.toHaveBeenCalled();
    expect(legacyStore.restoreTemplate).not.toHaveBeenCalled();
  });

  it("fails closed when the company UUID cannot be resolved", async () => {
    repositoryMock.resolveCompanyUuidByLegacyId.mockResolvedValue(null);
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useChecklistTemplateMutations(COMPANY), { wrapper });

    await expect(
      result.current.createEmptyCompanyTemplate({ name: "Blocked" }),
    ).rejects.toThrow("Could not resolve this company in Supabase");

    expect(repositoryMock.createAggregate).not.toHaveBeenCalled();
    expect(legacyStore.createTemplate).not.toHaveBeenCalled();
  });
});
