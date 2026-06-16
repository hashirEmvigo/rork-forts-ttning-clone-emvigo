import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/data/supabaseChecklistTemplateRepository", () => ({
  supabaseChecklistTemplateRepository: {
    listCompanyAndGlobal: vi.fn(),
    listGlobal: vi.fn(),
    getByLegacyId: vi.fn(),
  },
}));

vi.mock("@/lib/checklistTemplateStore", () => ({
  getAllTemplates: vi.fn(),
  getTemplate: vi.fn(),
}));

import { supabaseChecklistTemplateRepository } from "@/lib/data/supabaseChecklistTemplateRepository";
import * as legacyChecklistTemplateStore from "@/lib/checklistTemplateStore";
import {
  useChecklistTemplateDetailReadModel,
  useChecklistTemplateReadModel,
  useGlobalChecklistTemplateReadModel,
} from "./use-checklist-template-read-model";
import type { ChecklistTemplateAggregate } from "@/lib/data/supabaseChecklistTemplateRepository";

const COMPANY = "company-a";

const repositoryMock = vi.mocked(supabaseChecklistTemplateRepository);
const legacyStore = vi.mocked(legacyChecklistTemplateStore);

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function aggregate(id = "ctpl_1", companyId: string | null = COMPANY): ChecklistTemplateAggregate {
  return {
    template: {
      id,
      companyId,
      scope: companyId ? "company" : "global",
      name: companyId ? "Supabase Company Template" : "Supabase Global Template",
      description: "Remote aggregate only.",
      audience: "b2b",
      categoryIds: ["cat_1", "cat_2"],
      floorPresetIds: ["floor_1"],
      sortOrder: 10,
      isArchived: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      version: 1,
      schemaVersion: 1,
    },
    sections: [
      {
        id: "csec_1",
        templateId: id,
        companyId,
        title: "Entry",
        sortOrder: 10,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    items: [
      {
        id: "citm_1",
        sectionId: "csec_1",
        templateId: id,
        companyId,
        title: "Mop floor",
        required: true,
        sortOrder: 10,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "citm_2",
        sectionId: "csec_1",
        templateId: id,
        companyId,
        title: "Wipe surfaces",
        required: false,
        sortOrder: 20,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
}

beforeEach(() => {
  repositoryMock.listCompanyAndGlobal.mockReset();
  repositoryMock.listGlobal.mockReset();
  repositoryMock.getByLegacyId.mockReset();
  repositoryMock.listCompanyAndGlobal.mockResolvedValue([]);
  repositoryMock.listGlobal.mockResolvedValue([]);
  repositoryMock.getByLegacyId.mockResolvedValue(null);
  Object.values(legacyStore).forEach((mockFn) => mockFn.mockClear());
});

describe("useChecklistTemplateReadModel", () => {
  it("returns an empty list when Supabase is empty", async () => {
    const { result } = renderHook(() => useChecklistTemplateReadModel(COMPANY), {
      wrapper,
    });

    await waitFor(() => expect(repositoryMock.listCompanyAndGlobal).toHaveBeenCalledWith(
      COMPANY,
      { includeArchived: true },
    ));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.templates).toEqual([]);
    expect(result.current.active).toEqual([]);
    expect(result.current.archived).toEqual([]);
  });

  it("maps Supabase company/global aggregate list/count data", async () => {
    const companyTemplate = aggregate("ctpl_company", COMPANY);
    const globalTemplate = aggregate("ctpl_global", null);
    repositoryMock.listCompanyAndGlobal.mockResolvedValue([companyTemplate, globalTemplate]);

    const { result } = renderHook(() => useChecklistTemplateReadModel(COMPANY), {
      wrapper,
    });

    await waitFor(() => expect(result.current.active).toHaveLength(2));
    expect(result.current.active.map((template) => template.name)).toEqual([
      "Supabase Company Template",
      "Supabase Global Template",
    ]);
    expect(result.current.counts[companyTemplate.template.id]).toEqual({
      categories: 2,
      floorPresets: 1,
      sections: 1,
      items: 2,
    });
  });

  it("does not read browser storage or call the legacy checklist template store", async () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    renderHook(() => useChecklistTemplateReadModel(COMPANY), { wrapper });
    await waitFor(() => expect(repositoryMock.listCompanyAndGlobal).toHaveBeenCalled());

    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(legacyStore.getAllTemplates).not.toHaveBeenCalled();
    expect(legacyStore.getTemplate).not.toHaveBeenCalled();
    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
  });

  it("scopes list reads to company plus global visibility", async () => {
    renderHook(() => useChecklistTemplateReadModel(COMPANY), { wrapper });

    await waitFor(() => expect(repositoryMock.listCompanyAndGlobal).toHaveBeenCalledWith(
      COMPANY,
      { includeArchived: true },
    ));
  });
});

describe("useGlobalChecklistTemplateReadModel", () => {
  it("reads the global template list from Supabase only", async () => {
    const globalTemplate = aggregate("ctpl_global", null);
    repositoryMock.listGlobal.mockResolvedValue([globalTemplate]);

    const { result } = renderHook(() => useGlobalChecklistTemplateReadModel(), {
      wrapper,
    });

    await waitFor(() => expect(result.current.active).toHaveLength(1));
    expect(repositoryMock.listGlobal).toHaveBeenCalledWith({ includeArchived: true });
    expect(result.current.active[0].scope).toBe("global");
  });
});

describe("useChecklistTemplateDetailReadModel", () => {
  it("returns null when a Supabase detail row is missing", async () => {
    const { result } = renderHook(
      () => useChecklistTemplateDetailReadModel(COMPANY, "missing"),
      { wrapper },
    );

    await waitFor(() => expect(repositoryMock.getByLegacyId).toHaveBeenCalledWith("missing", {
      companyId: COMPANY,
      includeArchived: true,
    }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.aggregate).toBeNull();
    expect(result.current.template).toBeNull();
    expect(result.current.counts).toBeNull();
  });
});
