import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/hooks/use-checklist-template-read-model", () => ({
  useChecklistTemplateDetailReadModel: vi.fn(),
}));

vi.mock("@/hooks/use-checklist-template-mutations", () => ({
  useChecklistTemplateMutations: vi.fn(),
}));

vi.mock("@/lib/checklistTemplateStore", () => ({
  createItem: vi.fn(),
  createSection: vi.fn(),
  deleteItem: vi.fn(),
  deleteSection: vi.fn(),
  getItems: vi.fn(),
  getSections: vi.fn(),
  reorderItems: vi.fn(),
  reorderSections: vi.fn(),
  updateItem: vi.fn(),
  updateSection: vi.fn(),
}));

import { TemplateBuilder } from "./TemplateBuilder";
import { useChecklistTemplateDetailReadModel } from "@/hooks/use-checklist-template-read-model";
import { useChecklistTemplateMutations, type UseChecklistTemplateMutationsResult } from "@/hooks/use-checklist-template-mutations";
import * as legacyChecklistTemplateStore from "@/lib/checklistTemplateStore";
import type { ChecklistTemplateAggregate } from "@/lib/data/supabaseChecklistTemplateRepository";
import type { ChecklistTemplateDetailReadModelResult } from "@/hooks/use-checklist-template-read-model";
import type { ChecklistTemplateV2 } from "@/types";

const COMPANY = "company-a";
const TEMPLATE_ID = "ctpl_remote_1";

const detailReadModelMock = vi.mocked(useChecklistTemplateDetailReadModel);
const mutationsMock = vi.mocked(useChecklistTemplateMutations);
const legacyStore = vi.mocked(legacyChecklistTemplateStore);

function templateFixture(overrides: Partial<ChecklistTemplateV2> = {}): ChecklistTemplateV2 {
  return {
    id: TEMPLATE_ID,
    companyId: COMPANY,
    scope: "company",
    name: "Prop template ignored for display",
    description: "This prop should not drive detail display.",
    audience: "general",
    categoryIds: [],
    floorPresetIds: [],
    sortOrder: 10,
    isArchived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    schemaVersion: 1,
    ...overrides,
  };
}

function aggregateFixture(overrides: Partial<ChecklistTemplateAggregate> = {}): ChecklistTemplateAggregate {
  const aggregate: ChecklistTemplateAggregate = {
    template: {
      id: TEMPLATE_ID,
      companyId: COMPANY,
      scope: "company",
      name: "Supabase Detail Template",
      description: "Remote detail aggregate only.",
      audience: "b2b",
      categoryIds: ["cat_1"],
      floorPresetIds: ["floor_1", "floor_2"],
      sortOrder: 10,
      isArchived: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      version: 1,
      schemaVersion: 1,
    },
    sections: [
      {
        id: "csec_remote_1",
        templateId: TEMPLATE_ID,
        companyId: COMPANY,
        title: "Reception",
        sortOrder: 10,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "csec_remote_2",
        templateId: TEMPLATE_ID,
        companyId: COMPANY,
        title: "Kitchen",
        sortOrder: 20,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    items: [
      {
        id: "citm_remote_1",
        sectionId: "csec_remote_1",
        templateId: TEMPLATE_ID,
        companyId: COMPANY,
        title: "Disinfect front desk",
        description: "Use approved surface spray.",
        required: true,
        sortOrder: 10,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "citm_remote_2",
        sectionId: "csec_remote_1",
        templateId: TEMPLATE_ID,
        companyId: COMPANY,
        title: "Empty lobby bins",
        required: false,
        sortOrder: 20,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "citm_remote_3",
        sectionId: "csec_remote_2",
        templateId: TEMPLATE_ID,
        companyId: COMPANY,
        title: "Sanitize sink",
        required: true,
        sortOrder: 10,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
  return {
    ...aggregate,
    ...overrides,
    template: { ...aggregate.template, ...overrides.template },
    sections: overrides.sections ?? aggregate.sections,
    items: overrides.items ?? aggregate.items,
  };
}

function mockDetailReadModel(
  partial: Partial<ChecklistTemplateDetailReadModelResult> = {},
): ChecklistTemplateDetailReadModelResult {
  const aggregate = partial.aggregate ?? null;
  const result: ChecklistTemplateDetailReadModelResult = {
    aggregate,
    template: aggregate?.template ?? null,
    counts: aggregate
      ? {
          categories: aggregate.template.categoryIds.length,
          floorPresets: aggregate.template.floorPresetIds.length,
          sections: aggregate.sections.length,
          items: aggregate.items.length,
        }
      : null,
    isLoading: false,
    error: null,
    ...partial,
  };
  detailReadModelMock.mockReturnValue(result);
  return result;
}

function createMutationResult(
  overrides: Partial<UseChecklistTemplateMutationsResult> = {},
): UseChecklistTemplateMutationsResult {
  return {
    createEmptyCompanyTemplate: vi.fn(),
    updateMetadata: vi.fn(),
    updateSectionsAndItems: vi.fn().mockResolvedValue(aggregateFixture()),
    archive: vi.fn(),
    restore: vi.fn(),
    isPending: false,
    error: null,
    ...overrides,
  };
}

function renderBuilder(canManage = true) {
  return render(
    <TemplateBuilder
      companyId={COMPANY}
      template={templateFixture()}
      canManage={canManage}
      onBack={() => {}}
    />,
  );
}

beforeEach(() => {
  cleanup();
  detailReadModelMock.mockReset();
  mutationsMock.mockReset();
  Object.values(legacyStore).forEach((mockFn) => mockFn.mockClear());
  mockDetailReadModel();
  mutationsMock.mockReturnValue(createMutationResult());
});

describe("TemplateBuilder — Supabase content write cutover", () => {
  it("renders detail content from the Supabase aggregate", () => {
    const remote = aggregateFixture();
    mockDetailReadModel({ aggregate: remote });

    renderBuilder();

    expect(detailReadModelMock).toHaveBeenCalledWith(COMPANY, TEMPLATE_ID);
    expect(screen.getByRole("heading", { name: remote.template.name })).toBeInTheDocument();
    expect(screen.getByText("Remote detail aggregate only.")).toBeInTheDocument();
    expect(screen.getByText("Reception")).toBeInTheDocument();
    expect(screen.getByText("Disinfect front desk")).toBeInTheDocument();
    expect(screen.queryByText("Prop template ignored for display")).not.toBeInTheDocument();
  });

  it("shows unavailable state when Supabase detail is missing", () => {
    mockDetailReadModel({ aggregate: null, template: null, counts: null });

    renderBuilder();

    expect(screen.getByRole("heading", { name: "Template unavailable" })).toBeInTheDocument();
    expect(screen.getByText(/No legacy template fallback is available/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit content/i })).toBeDisabled();
  });

  it("adds, edits, removes, and reorders sections in a local draft", () => {
    const remote = aggregateFixture();
    mockDetailReadModel({ aggregate: remote });
    renderBuilder();

    fireEvent.click(screen.getByRole("button", { name: /edit content/i }));
    fireEvent.change(screen.getByLabelText("Section 1 title"), {
      target: { value: "Front reception" },
    });
    fireEvent.click(screen.getByRole("button", { name: /move section kitchen up/i }));
    fireEvent.click(screen.getByRole("button", { name: /add section/i }));
    fireEvent.click(screen.getByRole("button", { name: /remove section front reception/i }));

    expect(screen.getByDisplayValue("Kitchen")).toBeInTheDocument();
    expect(screen.getByDisplayValue("New section")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Front reception")).not.toBeInTheDocument();
    expect(screen.queryByText("Disinfect front desk")).not.toBeInTheDocument();
    expect(screen.getByText(/You have unsaved changes/i)).toBeInTheDocument();
  });

  it("adds, edits, removes, and reorders items within a section draft", () => {
    const remote = aggregateFixture();
    mockDetailReadModel({ aggregate: remote });
    renderBuilder();

    fireEvent.click(screen.getByRole("button", { name: /edit content/i }));
    fireEvent.change(screen.getByLabelText("Item 1 title in Reception"), {
      target: { value: "Disinfect reception desk" },
    });
    fireEvent.change(screen.getByLabelText("Item 1 description in Reception"), {
      target: { value: "Fresh cloth required." },
    });
    fireEvent.click(screen.getByLabelText("Required item Empty lobby bins"));
    fireEvent.click(screen.getByRole("button", { name: /move item empty lobby bins up/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /add item/i })[0]);
    fireEvent.click(screen.getByRole("button", { name: /remove item disinfect reception desk/i }));

    expect(screen.getByDisplayValue("Empty lobby bins")).toBeInTheDocument();
    expect(screen.getByDisplayValue("New checklist item")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Disinfect reception desk")).not.toBeInTheDocument();
    expect(screen.getByText(/You have unsaved changes/i)).toBeInTheDocument();
  });

  it("removing a section also removes child items from the saved aggregate", async () => {
    const remote = aggregateFixture();
    const updateSectionsAndItems = vi.fn().mockResolvedValue(
      aggregateFixture({
        sections: [remote.sections[1]],
        items: [remote.items[2]],
      }),
    );
    mutationsMock.mockReturnValue(createMutationResult({ updateSectionsAndItems }));
    mockDetailReadModel({ aggregate: remote });
    renderBuilder();

    fireEvent.click(screen.getByRole("button", { name: /edit content/i }));
    fireEvent.click(screen.getByRole("button", { name: /remove section reception/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /save changes/i })[0]);

    await waitFor(() => expect(updateSectionsAndItems).toHaveBeenCalledTimes(1));
    const [, sections, items] = updateSectionsAndItems.mock.calls[0];
    expect(sections.map((section) => section.title)).toEqual(["Kitchen"]);
    expect(items.map((item) => item.title)).toEqual(["Sanitize sink"]);
  });

  it("saves the full sections/items aggregate through the Supabase mutation only", async () => {
    const remote = aggregateFixture();
    const updateSectionsAndItems = vi.fn().mockResolvedValue(
      aggregateFixture({
        sections: [{ ...remote.sections[0], title: "Front reception" }, remote.sections[1]],
      }),
    );
    mutationsMock.mockReturnValue(createMutationResult({ updateSectionsAndItems }));
    mockDetailReadModel({ aggregate: remote });
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    renderBuilder();

    fireEvent.click(screen.getByRole("button", { name: /edit content/i }));
    fireEvent.change(screen.getByLabelText("Section 1 title"), {
      target: { value: "Front reception" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: /save changes/i })[0]);

    await waitFor(() => expect(updateSectionsAndItems).toHaveBeenCalledTimes(1));
    const [template, sections, items] = updateSectionsAndItems.mock.calls[0];
    expect(template.id).toBe(TEMPLATE_ID);
    expect(sections[0]).toEqual(expect.objectContaining({ title: "Front reception", sortOrder: 10 }));
    expect(items).toHaveLength(3);
    expect(screen.queryByText(/Editing Supabase template content/i)).not.toBeInTheDocument();
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(legacyStore.updateSection).not.toHaveBeenCalled();
    expect(legacyStore.updateItem).not.toHaveBeenCalled();
    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
  });

  it("keeps the draft open and shows an error when save fails", async () => {
    const remote = aggregateFixture();
    const updateSectionsAndItems = vi.fn().mockRejectedValue(new Error("Supabase rejected content"));
    mutationsMock.mockReturnValue(createMutationResult({ updateSectionsAndItems }));
    mockDetailReadModel({ aggregate: remote });
    renderBuilder();

    fireEvent.click(screen.getByRole("button", { name: /edit content/i }));
    fireEvent.change(screen.getByLabelText("Section 1 title"), {
      target: { value: "Front reception" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: /save changes/i })[0]);

    expect(await screen.findByText("Supabase rejected content")).toBeInTheDocument();
    expect(screen.getByText(/Editing Supabase template content/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Front reception")).toBeInTheDocument();
  });

  it("cancels and reverts draft changes to the last loaded Supabase aggregate", () => {
    const remote = aggregateFixture();
    mockDetailReadModel({ aggregate: remote });
    renderBuilder();

    fireEvent.click(screen.getByRole("button", { name: /edit content/i }));
    fireEvent.change(screen.getByLabelText("Section 1 title"), {
      target: { value: "Front reception" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(screen.queryByDisplayValue("Front reception")).not.toBeInTheDocument();
    expect(screen.getByText("Reception")).toBeInTheDocument();
    expect(screen.queryByText(/Editing Supabase template content/i)).not.toBeInTheDocument();
  });

  it("renders an editable empty state for empty sections/items", () => {
    const remote = aggregateFixture({ sections: [], items: [] });
    mockDetailReadModel({ aggregate: remote });
    renderBuilder();

    expect(screen.getByText("No sections in Supabase")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /edit content/i }));

    expect(screen.getByText("No sections yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /add section/i }));
    expect(screen.getByDisplayValue("New section")).toBeInTheDocument();
  });

  it("fails closed by disabling content editing when company/template scope is not editable", () => {
    const remote = aggregateFixture({
      template: { ...aggregateFixture().template, companyId: null, scope: "global" },
    });
    mockDetailReadModel({ aggregate: remote });
    renderBuilder();

    expect(screen.getByRole("button", { name: /edit content/i })).toBeDisabled();
    expect(screen.getByText(/Only company checklist templates can be edited/i)).toBeInTheDocument();
  });

  it("does not read browser storage or call the legacy checklist template store", () => {
    localStorage.setItem(
      "cleanops.checklistTemplates",
      JSON.stringify([{ id: TEMPLATE_ID, name: "Ignored local template" }]),
    );
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const remote = aggregateFixture();
    mockDetailReadModel({ aggregate: remote });

    renderBuilder();

    expect(screen.queryByText("Ignored local template")).not.toBeInTheDocument();
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(legacyStore.getSections).not.toHaveBeenCalled();
    expect(legacyStore.getItems).not.toHaveBeenCalled();
    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
  });

  it("disables the edit entry point while a Supabase mutation is pending", () => {
    const remote = aggregateFixture();
    mutationsMock.mockReturnValue(createMutationResult({ isPending: true }));
    mockDetailReadModel({ aggregate: remote });
    renderBuilder();

    expect(screen.getByRole("button", { name: /edit content/i })).toBeDisabled();
    expect(screen.queryByText(/Editing Supabase template content/i)).not.toBeInTheDocument();
  });
});
