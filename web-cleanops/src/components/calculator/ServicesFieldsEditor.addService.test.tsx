import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ServicesFieldsEditor } from "./ServicesFieldsEditor";
import type {
  CalculatorQuestionConfig,
  CalculatorServiceConfig,
} from "@/lib/calculator/calculatorConfigAdmin";

/**
 * Slice GPM-3b — the Add-service dialog is GENERIC-ONLY. The pricing-model dropdown
 * offers only the five generic models, defaults to hourly_by_area, explains that new
 * services are hidden drafts (not public), previews what the model means, and a newly
 * built generic service lands in the default builder group (not behind the legacy
 * toggle). Presentation-only: no public-visibility change, no DB write at render.
 */

function makeQuestion(over: Partial<CalculatorQuestionConfig> = {}): CalculatorQuestionConfig {
  return {
    legacyId: "q_sqm",
    serviceId: "svc-home",
    serviceLegacyId: "svc_home_legacy",
    questionKey: "sqm",
    label: "Boyta (m²)",
    helpText: null,
    inputType: "integer",
    required: true,
    affectsPricing: true,
    sortOrder: 1,
    active: true,
    options: [],
    ...over,
  };
}

function makeService(over: Partial<CalculatorServiceConfig> = {}): CalculatorServiceConfig {
  return {
    id: "svc-home",
    legacyId: "svc_home_legacy",
    serviceKey: "home_cleaning",
    displayName: "Hemstädning",
    description: "Återkommande hemstädning",
    enabled: true,
    comingSoon: false,
    pricingModel: "home_cleaning_recommended_hours",
    sortOrder: 1,
    requiresCleaningPlan: false,
    plansEnabled: false,
    planPricingModel: "hourly_rate_by_plan",
    defaultPlanKey: null,
    baseHourlyRateExclVat: null,
    defaultVatRatePercent: 25,
    questions: [makeQuestion()],
    ...over,
  };
}

const GENERIC_LABELS = ["Hourly by area", "Fixed price per m²", "Unit based", "Fixed package", "Manual quote"];

const LEGACY_LABELS_ABSENT = [
  "Home cleaning — recommended hours",
  "Move-out — fixed price + add-ons",
  "Office — area × frequency",
  "Window — count based (template)",
];

const handlers = {
  onSaveService: vi.fn().mockResolvedValue(undefined),
  onSaveQuestion: vi.fn().mockResolvedValue(undefined),
  onAddQuestion: vi.fn().mockResolvedValue(undefined),
  onAddService: vi.fn().mockResolvedValue(undefined),
  onArchiveService: vi.fn().mockResolvedValue(undefined),
};

function renderEditor(services: CalculatorServiceConfig[]) {
  return render(
    <ServicesFieldsEditor
      services={services}
      companyId="co-uuid"
      companyLegacyId="cmp_x"
      onSaveService={handlers.onSaveService}
      onSaveQuestion={handlers.onSaveQuestion}
      onAddQuestion={handlers.onAddQuestion}
      onAddService={handlers.onAddService}
      onArchiveService={handlers.onArchiveService}
    />,
  );
}

function openAddDialog(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  return screen.getByRole("dialog");
}

beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ServicesFieldsEditor — GPM-3b add-service dialog (generic-only)", () => {
  it("opens with the generic default model (hourly_by_area) preselected", async () => {
    renderEditor([makeService()]);
    const dialog = openAddDialog();
    expect(within(dialog).getByRole("heading", { name: "Add service" })).toBeInTheDocument();
    // Opening the dropdown, the default generic model is the selected option.
    fireEvent.click(within(dialog).getByRole("combobox"));
    const hourly = await screen.findAllByRole("option", { name: "Hourly by area" });
    expect(hourly.some((o) => o.getAttribute("aria-selected") === "true")).toBe(true);
  });

  it("offers only the five generic pricing models — never a legacy/service-named model", async () => {
    renderEditor([makeService()]);
    const dialog = openAddDialog();
    fireEvent.click(within(dialog).getByRole("combobox"));

    for (const label of GENERIC_LABELS) {
      expect((await screen.findAllByRole("option", { name: label })).length).toBeGreaterThan(0);
    }
    for (const label of LEGACY_LABELS_ABSENT) {
      expect(screen.queryByRole("option", { name: label })).not.toBeInTheDocument();
    }
  });

  it("explains new services are hidden drafts that are not public until configured", () => {
    renderEditor([makeService()]);
    const dialog = openAddDialog();
    expect(within(dialog).getByText(/hidden/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/not public/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/before publishing/i)).toBeInTheDocument();
  });

  it("previews what the selected pricing model means", () => {
    renderEditor([makeService()]);
    const dialog = openAddDialog();
    expect(within(dialog).getByText("Primary input")).toBeInTheDocument();
    expect(within(dialog).getByText("Pricing")).toBeInTheDocument();
    expect(within(dialog).getByText("Typical use")).toBeInTheDocument();
    // hourly_by_area preview copy.
    expect(within(dialog).getByText("Estimated hours × plan hourly rate")).toBeInTheDocument();
  });

  it("creates the service on the generic pricing model and never marks it public", () => {
    renderEditor([makeService()]);
    const dialog = openAddDialog();
    fireEvent.change(within(dialog).getByLabelText("Service key"), { target: { value: "office_v2" } });
    fireEvent.change(within(dialog).getByLabelText("Display name"), { target: { value: "Kontor V2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add service" }));

    expect(handlers.onAddService).toHaveBeenCalledWith(
      expect.objectContaining({ serviceKey: "office_v2", displayName: "Kontor V2", pricingModel: "hourly_by_area" }),
    );
    // The dialog never sends enabled/coming_soon — createCalculatorService forces a hidden draft.
    const input = handlers.onAddService.mock.calls[0][0] as Record<string, unknown>;
    expect(input).not.toHaveProperty("enabled");
    expect(input).not.toHaveProperty("comingSoon");
  });

  it("blocks an invalid service key", () => {
    renderEditor([makeService()]);
    const dialog = openAddDialog();
    fireEvent.change(within(dialog).getByLabelText("Service key"), { target: { value: "Invalid Key" } });
    fireEvent.change(within(dialog).getByLabelText("Display name"), { target: { value: "X" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add service" }));

    // Match the validation message specifically (not the field's helper text).
    expect(within(dialog).getByText(/starting with a letter/i)).toBeInTheDocument();
    expect(handlers.onAddService).not.toHaveBeenCalled();
  });

  it("blocks a duplicate service key", () => {
    renderEditor([makeService()]);
    const dialog = openAddDialog();
    fireEvent.change(within(dialog).getByLabelText("Service key"), { target: { value: "home_cleaning" } });
    fireEvent.change(within(dialog).getByLabelText("Display name"), { target: { value: "Dup" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add service" }));

    expect(within(dialog).getByText(/already used by this company/i)).toBeInTheDocument();
    expect(handlers.onAddService).not.toHaveBeenCalled();
  });
});

describe("ServicesFieldsEditor — GPM-3b generic services join the builder group", () => {
  const GENERIC_SVC = makeService({
    id: "svc-generic",
    legacyId: "svc_generic_legacy",
    serviceKey: "office_v2",
    displayName: "Kontor V2",
    pricingModel: "hourly_by_area",
    enabled: false,
    questions: [],
  });

  const MOVE_OUT = makeService({
    id: "svc-move",
    legacyId: "svc_move_legacy",
    serviceKey: "move_out_cleaning",
    displayName: "Flyttstädning",
    pricingModel: "move_out_fixed_plus_addons",
    enabled: true,
    sortOrder: 2,
    questions: [],
  });

  it("shows a newly built generic service in the default view, alongside the Home pilot", () => {
    renderEditor([makeService(), GENERIC_SVC, MOVE_OUT]);
    // Home (pilot) + the admin-built generic service are both visible by default.
    expect(screen.getByRole("button", { name: /Hemstädning/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Kontor V2/i })).toBeInTheDocument();
    // The seeded legacy move-out service stays collapsed behind the toggle.
    expect(screen.queryByText("Flyttstädning")).not.toBeInTheDocument();
  });

  it("keeps the seeded legacy services behind the toggle (revealable, never lost)", () => {
    renderEditor([makeService(), GENERIC_SVC, MOVE_OUT]);
    fireEvent.click(screen.getByRole("button", { name: /legacy \/ default services/i }));
    expect(screen.getByRole("button", { name: /Flyttstädning/i })).toBeInTheDocument();
  });

  it("issues no DB write while rendering or opening the dialog (presentation only)", () => {
    renderEditor([makeService(), GENERIC_SVC, MOVE_OUT]);
    openAddDialog();
    expect(handlers.onAddService).not.toHaveBeenCalled();
    expect(handlers.onSaveService).not.toHaveBeenCalled();
    expect(handlers.onArchiveService).not.toHaveBeenCalled();
  });
});
