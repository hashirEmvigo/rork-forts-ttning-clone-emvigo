import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { CustomerProtocolDialog } from "./CustomerProtocolDialog";
import { useChecklistTemplateReadModel } from "@/hooks/use-checklist-template-read-model";
import * as legacyChecklistTemplateStore from "@/lib/checklistTemplateStore";
import type { ChecklistTemplateReadModelResult } from "@/hooks/use-checklist-template-read-model";
import type { ChecklistTemplateAggregate } from "@/lib/data/supabaseChecklistTemplateRepository";

const COMPANY = "company-a";

vi.mock("@/hooks/use-checklist-template-read-model", () => ({
  useChecklistTemplateReadModel: vi.fn(),
}));

vi.mock("@/lib/checklistTemplateStore", () => ({
  getActiveTemplates: vi.fn(),
  getGlobalTemplates: vi.fn(),
  createTemplate: vi.fn(),
  copyGlobalTemplateToCompany: vi.fn(),
}));

const readModelMock = vi.mocked(useChecklistTemplateReadModel);
const legacyStore = vi.mocked(legacyChecklistTemplateStore);

function aggregate(
  id: string,
  companyId: string | null,
  name: string,
): ChecklistTemplateAggregate {
  return {
    template: {
      id,
      companyId,
      scope: companyId ? "company" : "global",
      name,
      description: "Read from Supabase only.",
      audience: "b2b",
      categoryIds: ["cat_1"],
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
        id: `${id}_section_1`,
        templateId: id,
        companyId,
        title: "Lobby",
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
        companyId,
        title: "Mop lobby floor",
        description: "Use neutral cleaner.",
        required: true,
        sortOrder: 10,
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

function renderDialog(props?: Partial<React.ComponentProps<typeof CustomerProtocolDialog>>) {
  return render(
    <CustomerProtocolDialog
      open
      onOpenChange={() => {}}
      companyId={COMPANY}
      onSubmit={() => null}
      {...props}
    />,
  );
}

beforeEach(() => {
  localStorage.clear();
  cleanup();
  readModelMock.mockReset();
  Object.values(legacyStore).forEach((mockFn) => mockFn.mockClear());
  mockReadModel();
});

describe("CustomerProtocolDialog — Supabase picker reads", () => {
  it("keeps the picker empty when Supabase returns no templates", () => {
    localStorage.setItem(
      "cleanops.checklistTemplates",
      JSON.stringify([{ id: "ctpl_local", name: "Ignored local template" }]),
    );
    mockReadModel({ aggregates: [], templates: [], active: [], archived: [] });

    renderDialog();

    expect(readModelMock).toHaveBeenCalledWith(COMPANY);
    expect(screen.getByText(/No templates available in Supabase/i)).toBeInTheDocument();
    expect(screen.queryByText("Ignored local template")).not.toBeInTheDocument();
    expect(legacyStore.getActiveTemplates).not.toHaveBeenCalled();
    expect(legacyStore.getGlobalTemplates).not.toHaveBeenCalled();
  });

  it("shows global and company templates from the Supabase aggregate read model", () => {
    const global = aggregate("ctpl_global", null, "Supabase Global Offices");
    const company = aggregate("ctpl_company", COMPANY, "Supabase Company Offices");
    mockReadModel({ aggregates: [global, company] });

    renderDialog({ customerSegment: "b2b" });

    expect(screen.getByText(/Recommended templates/i)).toBeInTheDocument();
    expect(screen.getByText("Supabase Global Offices")).toBeInTheDocument();
    expect(screen.getByText("Supabase Company Offices")).toBeInTheDocument();
  });

  it("opens a read-only preview from the Supabase aggregate", () => {
    const company = aggregate("ctpl_company", COMPANY, "Supabase Company Offices");
    mockReadModel({ aggregates: [company] });

    renderDialog({ customerSegment: "b2b" });
    fireEvent.click(screen.getByRole("button", { name: /^Preview$/i }));

    expect(screen.getAllByText("Supabase Company Offices")[0]).toBeInTheDocument();
    expect(screen.getByText("Lobby")).toBeInTheDocument();
    expect(screen.getByText("Mop lobby floor")).toBeInTheDocument();
    expect(screen.getByText(/Audience:/i)).toBeInTheDocument();
  });

  it("does not read browser storage or call legacy stores during picker render", () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const company = aggregate("ctpl_company", COMPANY, "Supabase Company Offices");
    mockReadModel({ aggregates: [company] });

    renderDialog({ customerSegment: "b2b" });

    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(legacyStore.getActiveTemplates).not.toHaveBeenCalled();
    expect(legacyStore.getGlobalTemplates).not.toHaveBeenCalled();
    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
  });

  it("keeps create/copy actions deferred so they do not write to legacy storage", () => {
    const global = aggregate("ctpl_global", null, "Supabase Global Offices");
    mockReadModel({ aggregates: [global] });
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const onSubmit = vi.fn(() => null);
    const onCopyGlobalToCompany = vi.fn(() => null);

    renderDialog({ customerSegment: "b2b", onSubmit, onCopyGlobalToCompany });

    const copyButton = screen.getByRole("button", { name: /Copy to Company/i });
    const createButton = screen.getByRole("button", { name: /Create protocol/i });

    expect(copyButton).toBeDisabled();
    expect(createButton).toBeDisabled();
    fireEvent.click(copyButton);
    fireEvent.click(createButton);

    expect(onCopyGlobalToCompany).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(legacyStore.createTemplate).not.toHaveBeenCalled();
    expect(legacyStore.copyGlobalTemplateToCompany).not.toHaveBeenCalled();
    setItemSpy.mockRestore();
  });
});
