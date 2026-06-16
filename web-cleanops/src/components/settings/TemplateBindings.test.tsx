import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { TemplateDialog } from "./TemplateDialog";
import { TemplatesPanel } from "./TemplatesPanel";
import { useChecklistTemplateMutations } from "@/hooks/use-checklist-template-mutations";
import { useChecklistTemplateReadModel } from "@/hooks/use-checklist-template-read-model";
import { getActiveChecklistCategories } from "@/lib/checklistCategoryStore";
import { getActiveFloorPresets } from "@/lib/floorPresetStore";
import * as legacyChecklistTemplateStore from "@/lib/checklistTemplateStore";
import type { UseChecklistTemplateMutationsResult } from "@/hooks/use-checklist-template-mutations";
import type { ChecklistTemplateReadModelResult } from "@/hooks/use-checklist-template-read-model";
import type { ChecklistTemplateV2 } from "@/types";

const COMPANY = "company-a";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks/use-checklist-template-read-model", () => ({
  useChecklistTemplateReadModel: vi.fn(),
}));

vi.mock("@/hooks/use-checklist-template-mutations", () => ({
  useChecklistTemplateMutations: vi.fn(),
}));

const readModelMock = vi.mocked(useChecklistTemplateReadModel);
const mutationHookMock = vi.mocked(useChecklistTemplateMutations);

function template(overrides: Partial<ChecklistTemplateV2> = {}): ChecklistTemplateV2 {
  return {
    id: "ctpl_supabase_1",
    companyId: COMPANY,
    scope: "company",
    name: "Daily Supabase Cleaning",
    description: "Read from the template aggregate.",
    audience: "b2b",
    categoryIds: ["cat_room"],
    floorPresetIds: ["floor_office"],
    sortOrder: 10,
    isArchived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    schemaVersion: 1,
    ...overrides,
  };
}

function mockReadModel(
  partial: Partial<ChecklistTemplateReadModelResult> = {},
): ChecklistTemplateReadModelResult {
  const active = partial.active ?? [];
  const archived = partial.archived ?? [];
  const result: ChecklistTemplateReadModelResult = {
    aggregates: [],
    templates: [...active, ...archived],
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

function mockMutations(
  partial: Partial<UseChecklistTemplateMutationsResult> = {},
): UseChecklistTemplateMutationsResult {
  const result: UseChecklistTemplateMutationsResult = {
    createEmptyCompanyTemplate: vi.fn().mockResolvedValue({}),
    updateMetadata: vi.fn().mockResolvedValue({}),
    updateSectionsAndItems: vi.fn().mockResolvedValue({}),
    archive: vi.fn().mockResolvedValue({}),
    restore: vi.fn().mockResolvedValue({}),
    isPending: false,
    error: null,
    ...partial,
  };
  mutationHookMock.mockReturnValue(result);
  return result;
}

beforeEach(() => {
  localStorage.clear();
  cleanup();
  readModelMock.mockReset();
  mutationHookMock.mockReset();
  mockReadModel();
  mockMutations();
});

describe("TemplateDialog — bindings", () => {
  it("lists active categories (grouped) and floor presets", () => {
    const room = getActiveChecklistCategories(COMPANY, "room")[0];
    const preset = getActiveFloorPresets(COMPANY)[0];

    render(
      <TemplateDialog
        open
        onOpenChange={() => {}}
        companyId={COMPANY}
        template={null}
        onSubmit={() => null}
      />,
    );

    expect(screen.getByText("Room categories")).toBeInTheDocument();
    expect(screen.getByText(room.name)).toBeInTheDocument();
    expect(screen.getByText(preset.name)).toBeInTheDocument();
  });

  it("submits the selected category and floor preset ids", () => {
    const room = getActiveChecklistCategories(COMPANY, "room")[0];
    const preset = getActiveFloorPresets(COMPANY)[0];
    const onSubmit = vi.fn(() => null);

    render(
      <TemplateDialog
        open
        onOpenChange={() => {}}
        companyId={COMPANY}
        template={null}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Bound Template" },
    });
    fireEvent.click(screen.getByText(room.name));
    fireEvent.click(screen.getByText(preset.name));
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: "Bound Template",
      description: undefined,
      categoryIds: [room.id],
      floorPresetIds: [preset.id],
    });
  });

  it("pre-selects existing bindings when editing", () => {
    const room = getActiveChecklistCategories(COMPANY, "room")[0];

    render(
      <TemplateDialog
        open
        onOpenChange={() => {}}
        companyId={COMPANY}
        template={{
          name: "Existing",
          description: undefined,
          categoryIds: [room.id],
          floorPresetIds: [],
        }}
        onSubmit={() => null}
      />,
    );

    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });
});

describe("TemplatesPanel — Supabase read-model and company write cutover", () => {
  it("renders an empty state from an empty Supabase template list", () => {
    localStorage.setItem(
      "cleanops.checklistTemplates",
      JSON.stringify([template({ name: "Ignored browser template" })]),
    );
    mockReadModel({ active: [], archived: [], templates: [] });

    render(<TemplatesPanel companyId={COMPANY} canManage />);

    expect(readModelMock).toHaveBeenCalledWith(COMPANY);
    expect(screen.getByText(/No active templates/i)).toBeInTheDocument();
    expect(screen.queryByText("Ignored browser template")).not.toBeInTheDocument();
  });

  it("renders template list/count data from the Supabase aggregate read model", () => {
    const supabaseTemplate = template();
    mockReadModel({
      active: [supabaseTemplate],
      templates: [supabaseTemplate],
      counts: {
        [supabaseTemplate.id]: {
          categories: 1,
          floorPresets: 1,
          sections: 4,
          items: 12,
        },
      },
    });

    render(<TemplatesPanel companyId={COMPANY} canManage />);

    const row = screen.getByText(supabaseTemplate.name).closest("li");
    expect(row).not.toBeNull();
    expect(within(row!).getByText("B2B")).toBeInTheDocument();
    expect(within(row!).getByText("4 sections")).toBeInTheDocument();
    expect(within(row!).getByText("12 items")).toBeInTheDocument();
    expect(within(row!).getByText("1 categories")).toBeInTheDocument();
    expect(within(row!).getByText("1 floor presets")).toBeInTheDocument();
  });

  it("keeps content editing disabled while re-enabling approved company metadata actions", () => {
    const supabaseTemplate = template();
    mockReadModel({
      active: [supabaseTemplate],
      templates: [supabaseTemplate],
      counts: { [supabaseTemplate.id]: { categories: 0, floorPresets: 0, sections: 0, items: 0 } },
    });

    render(<TemplatesPanel companyId={COMPANY} canManage />);

    expect(screen.getByRole("button", { name: /Add template/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Edit content/i })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: new RegExp(`Edit ${supabaseTemplate.name}`) }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: new RegExp(`Archive ${supabaseTemplate.name}`) }),
    ).toBeEnabled();
  });

  it("creates an empty company template through the Supabase mutation hook only", async () => {
    mockReadModel({ active: [], archived: [], templates: [] });
    const mutations = mockMutations();
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const createSpy = vi.spyOn(legacyChecklistTemplateStore, "createTemplate");

    render(<TemplatesPanel companyId={COMPANY} canManage />);

    fireEvent.click(screen.getByRole("button", { name: /Add template/i }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Supabase Empty Template" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Created remotely." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));

    await waitFor(() =>
      expect(mutations.createEmptyCompanyTemplate).toHaveBeenCalledWith({
        name: "Supabase Empty Template",
        description: "Created remotely.",
        audience: undefined,
      }),
    );
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
    setItemSpy.mockRestore();
    createSpy.mockRestore();
  });

  it("updates company template metadata through the Supabase mutation hook only", async () => {
    const supabaseTemplate = template();
    mockReadModel({ active: [supabaseTemplate], templates: [supabaseTemplate] });
    const mutations = mockMutations();
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const updateSpy = vi.spyOn(legacyChecklistTemplateStore, "updateTemplate");

    render(<TemplatesPanel companyId={COMPANY} canManage />);

    fireEvent.click(screen.getByRole("button", { name: new RegExp(`Edit ${supabaseTemplate.name}`) }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Renamed Supabase Template" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(mutations.updateMetadata).toHaveBeenCalledWith(supabaseTemplate, {
        name: "Renamed Supabase Template",
        description: supabaseTemplate.description,
        audience: supabaseTemplate.audience,
      }),
    );
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    setItemSpy.mockRestore();
    updateSpy.mockRestore();
  });

  it("archives and restores company templates through the Supabase mutation hook only", async () => {
    const activeTemplate = template();
    const archivedTemplate = template({ id: "ctpl_archived", name: "Archived Supabase", isArchived: true });
    mockReadModel({
      active: [activeTemplate],
      archived: [archivedTemplate],
      templates: [activeTemplate, archivedTemplate],
    });
    const mutations = mockMutations();
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const archiveSpy = vi.spyOn(legacyChecklistTemplateStore, "archiveTemplate");
    const restoreSpy = vi.spyOn(legacyChecklistTemplateStore, "restoreTemplate");

    render(<TemplatesPanel companyId={COMPANY} canManage />);

    fireEvent.click(screen.getByRole("button", { name: new RegExp(`Archive ${activeTemplate.name}`) }));
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(mutations.archive).toHaveBeenCalledWith(activeTemplate.id));

    fireEvent.click(screen.getByLabelText("Show archived templates"));
    fireEvent.click(screen.getByRole("button", { name: /Restore/i }));
    await waitFor(() => expect(mutations.restore).toHaveBeenCalledWith(archivedTemplate.id));

    expect(setItemSpy).not.toHaveBeenCalled();
    expect(archiveSpy).not.toHaveBeenCalled();
    expect(restoreSpy).not.toHaveBeenCalled();
    setItemSpy.mockRestore();
    archiveSpy.mockRestore();
    restoreSpy.mockRestore();
  });

  it("keeps the metadata dialog open and shows an error when create fails", async () => {
    mockReadModel({ active: [], archived: [], templates: [] });
    mockMutations({
      createEmptyCompanyTemplate: vi.fn().mockRejectedValue(new Error("Could not resolve this company in Supabase.")),
    });

    render(<TemplatesPanel companyId={COMPANY} canManage />);

    fireEvent.click(screen.getByRole("button", { name: /Add template/i }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Blocked" } });
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));

    expect(await screen.findByText("Could not resolve this company in Supabase.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does not add UI rows from empty Supabase until a create succeeds and read model reloads", async () => {
    mockReadModel({ active: [], archived: [], templates: [] });
    const mutations = mockMutations();

    render(<TemplatesPanel companyId={COMPANY} canManage />);

    fireEvent.click(screen.getByRole("button", { name: /Add template/i }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Pending Template" } });
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));

    await waitFor(() => expect(mutations.createEmptyCompanyTemplate).toHaveBeenCalled());
    expect(screen.getByText(/No active templates/i)).toBeInTheDocument();
    expect(screen.queryByText("Pending Template")).not.toBeInTheDocument();
  });

  it("hides management actions for read-only users", () => {
    const supabaseTemplate = template();
    mockReadModel({ active: [supabaseTemplate], templates: [supabaseTemplate] });

    render(<TemplatesPanel companyId={COMPANY} canManage={false} />);

    expect(screen.queryByRole("button", { name: /Add template/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: new RegExp(`Edit ${supabaseTemplate.name}`) }),
    ).not.toBeInTheDocument();
  });
});
