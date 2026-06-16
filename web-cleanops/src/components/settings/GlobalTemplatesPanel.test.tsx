import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { GlobalTemplatesPanel } from "./GlobalTemplatesPanel";
import { useGlobalChecklistTemplateReadModel } from "@/hooks/use-checklist-template-read-model";
import * as legacyChecklistTemplateStore from "@/lib/checklistTemplateStore";
import type { ChecklistTemplateReadModelResult } from "@/hooks/use-checklist-template-read-model";
import type { ChecklistTemplateAggregate } from "@/lib/data/supabaseChecklistTemplateRepository";

vi.mock("@/hooks/use-checklist-template-read-model", () => ({
  useGlobalChecklistTemplateReadModel: vi.fn(),
}));

vi.mock("@/lib/checklistTemplateStore", () => ({
  getGlobalTemplates: vi.fn(),
  createGlobalTemplate: vi.fn(),
  updateGlobalTemplate: vi.fn(),
  archiveGlobalTemplate: vi.fn(),
  restoreGlobalTemplate: vi.fn(),
}));

const readModelMock = vi.mocked(useGlobalChecklistTemplateReadModel);
const legacyStore = vi.mocked(legacyChecklistTemplateStore);

function aggregate(
  overrides: Partial<ChecklistTemplateAggregate["template"]> = {},
): ChecklistTemplateAggregate {
  const id = overrides.id ?? "ctpl_global_1";
  return {
    template: {
      id,
      companyId: null,
      scope: "global",
      name: "Supabase Global Cleaning",
      description: "Read from the Supabase global aggregate.",
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
    sections: [
      {
        id: `${id}_section_1`,
        templateId: id,
        companyId: null,
        title: "Reception",
        sortOrder: 10,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    items: [
      {
        id: `${id}_item_1`,
        sectionId: `${id}_section_1`,
        templateId: id,
        companyId: null,
        title: "Disinfect counter",
        required: true,
        sortOrder: 10,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: `${id}_item_2`,
        sectionId: `${id}_section_1`,
        templateId: id,
        companyId: null,
        title: "Empty trash",
        required: false,
        sortOrder: 20,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
}

function mockReadModel(
  partial: Partial<ChecklistTemplateReadModelResult> = {},
): ChecklistTemplateReadModelResult {
  const aggregates = partial.aggregates ?? [];
  const templates = partial.templates ?? aggregates.map((entry) => entry.template);
  const active = partial.active ?? templates.filter((template) => !template.isArchived);
  const archived = partial.archived ?? templates.filter((template) => template.isArchived);
  const result: ChecklistTemplateReadModelResult = {
    aggregates,
    templates,
    active,
    archived,
    counts: {},
    isLoading: false,
    error: null,
    ...partial,
  };
  readModelMock.mockReturnValue(result);
  return result;
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  readModelMock.mockReset();
  Object.values(legacyStore).forEach((mockFn) => mockFn.mockClear());
  mockReadModel();
});

describe("GlobalTemplatesPanel — Supabase read-only cutover", () => {
  it("renders an empty state from empty Supabase globals and ignores browser residue", () => {
    localStorage.setItem(
      "cleanops.checklistTemplates",
      JSON.stringify([{ id: "ctpl_local", name: "Ignored local global" }]),
    );
    mockReadModel({ aggregates: [], templates: [], active: [], archived: [] });

    render(<GlobalTemplatesPanel canManage />);

    expect(readModelMock).toHaveBeenCalled();
    expect(screen.getByText(/No active global templates/i)).toBeInTheDocument();
    expect(screen.queryByText("Ignored local global")).not.toBeInTheDocument();
    expect(legacyStore.getGlobalTemplates).not.toHaveBeenCalled();
  });

  it("renders global list/count data from Supabase aggregates", () => {
    const remote = aggregate();
    mockReadModel({
      aggregates: [remote],
      counts: {
        [remote.template.id]: {
          categories: 1,
          floorPresets: 1,
          sections: 1,
          items: 2,
        },
      },
    });

    render(<GlobalTemplatesPanel canManage />);

    const row = screen.getByText(remote.template.name).closest("li");
    expect(row).not.toBeNull();
    expect(within(row!).getByText("B2B")).toBeInTheDocument();
    expect(within(row!).getByText("1 sections")).toBeInTheDocument();
    expect(within(row!).getByText("2 items")).toBeInTheDocument();
  });

  it("opens a read-only Supabase detail display for global template content", () => {
    const remote = aggregate();
    mockReadModel({ aggregates: [remote] });

    render(<GlobalTemplatesPanel canManage />);
    fireEvent.click(screen.getByRole("button", { name: /View content/i }));

    expect(screen.getByText("Reception")).toBeInTheDocument();
    expect(screen.getByText("Disinfect counter")).toBeInTheDocument();
    expect(screen.getByText("Empty trash")).toBeInTheDocument();
    expect(screen.getByText(/content editing is temporarily disabled/i)).toBeInTheDocument();
    expect(legacyStore.getGlobalTemplates).not.toHaveBeenCalled();
  });

  it("disables deferred mutation actions so they do not write to legacy storage", () => {
    const remote = aggregate();
    mockReadModel({ aggregates: [remote] });
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    render(<GlobalTemplatesPanel canManage />);

    const addButton = screen.getByRole("button", { name: /Add template/i });
    const editButton = screen.getByRole("button", { name: new RegExp(`Edit ${remote.template.name}`) });
    const archiveButton = screen.getByRole("button", { name: new RegExp(`Archive ${remote.template.name}`) });

    expect(addButton).toBeDisabled();
    expect(editButton).toBeDisabled();
    expect(archiveButton).toBeDisabled();
    fireEvent.click(addButton);
    fireEvent.click(editButton);
    fireEvent.click(archiveButton);

    expect(setItemSpy).not.toHaveBeenCalled();
    expect(legacyStore.createGlobalTemplate).not.toHaveBeenCalled();
    expect(legacyStore.updateGlobalTemplate).not.toHaveBeenCalled();
    expect(legacyStore.archiveGlobalTemplate).not.toHaveBeenCalled();
    expect(legacyStore.restoreGlobalTemplate).not.toHaveBeenCalled();
    setItemSpy.mockRestore();
  });
});
