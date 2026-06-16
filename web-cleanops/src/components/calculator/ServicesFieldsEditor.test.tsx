import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServicesFieldsEditor } from "./ServicesFieldsEditor";
import type {
  CalculatorQuestionConfig,
  CalculatorServiceConfig,
} from "@/lib/calculator/calculatorConfigAdmin";

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
  const requiresCleaningPlan = over.requiresCleaningPlan ?? true;
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
    requiresCleaningPlan,
    plansEnabled: requiresCleaningPlan,
    planPricingModel: "hourly_rate_by_plan",
    defaultPlanKey: null,
    baseHourlyRateExclVat: null,
    defaultVatRatePercent: 25,
    questions: [makeQuestion()],
    ...over,
  };
}

const handlers = {
  onSaveService: vi.fn().mockResolvedValue(undefined),
  onSaveQuestion: vi.fn().mockResolvedValue(undefined),
  onAddQuestion: vi.fn().mockResolvedValue(undefined),
};

function renderEditor(services: CalculatorServiceConfig[] = [makeService()]) {
  return render(
    <ServicesFieldsEditor
      services={services}
      companyId="co-uuid"
      companyLegacyId="cmp_x"
      onSaveService={handlers.onSaveService}
      onSaveQuestion={handlers.onSaveQuestion}
      onAddQuestion={handlers.onAddQuestion}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ServicesFieldsEditor", () => {
  it("renders services and the selected service's questions", () => {
    renderEditor([
      makeService(),
      makeService({
        id: "svc-move",
        legacyId: "svc_move_legacy",
        serviceKey: "move_out_cleaning",
        displayName: "Flyttstädning",
        pricingModel: "move_out_fixed_plus_addons",
        questions: [],
      }),
    ]);

    // "Hemstädning" (the V2 pilot) appears in the list AND the selected-service header.
    expect(screen.getAllByText("Hemstädning").length).toBeGreaterThan(0);
    // Default selection is the pilot service → its question is shown.
    expect(screen.getByText("Boyta (m²)")).toBeInTheDocument();

    // Move-out is a seeded legacy service → revealed only via the legacy toggle (GPM-2a).
    expect(screen.queryByText("Flyttstädning")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /legacy \/ default services/i }));
    expect(screen.getByText("Flyttstädning")).toBeInTheDocument();
  });

  it("edits a question label and saves only safe fields (key + type locked)", async () => {
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog");

    // input_type / question_key are surfaced read-only, never as inputs.
    expect(within(dialog).queryByLabelText("Question key")).not.toBeInTheDocument();
    expect(within(dialog).getByText("sqm")).toBeInTheDocument();
    expect(within(dialog).getByText("integer")).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("Label"), { target: { value: "Bostadsyta (m²)" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(handlers.onSaveQuestion).toHaveBeenCalledTimes(1);
    expect(handlers.onSaveQuestion).toHaveBeenCalledWith(
      "q_sqm",
      expect.objectContaining({ label: "Bostadsyta (m²)" }),
    );
  });

  it("blocks adding a question whose key duplicates an existing one", () => {
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Add question" }));
    const dialog = screen.getByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText("Question key"), { target: { value: "sqm" } });
    fireEvent.change(within(dialog).getByLabelText("Label"), { target: { value: "Dup" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add question" }));

    expect(screen.getByText(/already used by this service/i)).toBeInTheDocument();
    expect(handlers.onAddQuestion).not.toHaveBeenCalled();
  });

  it("adds a valid non-pricing question", () => {
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Add question" }));
    const dialog = screen.getByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText("Question key"), { target: { value: "has_pets" } });
    fireEvent.change(within(dialog).getByLabelText("Label"), { target: { value: "Husdjur?" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add question" }));

    expect(handlers.onAddQuestion).toHaveBeenCalledTimes(1);
    expect(handlers.onAddQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        questionKey: "has_pets",
        inputType: "number",
        affectsPricing: false,
        serviceId: "svc-home",
      }),
    );
  });

  it("requires acknowledging an unsupported pricing-affecting key before adding", () => {
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Add question" }));
    const dialog = screen.getByRole("dialog");

    // `garden_size` is NOT in the engine's supported home-cleaning keys
    // (sqm / frequency / addons / has_pets), so flagging it as pricing-affecting
    // must surface the "no support" warning + require an acknowledgement.
    fireEvent.change(within(dialog).getByLabelText("Question key"), { target: { value: "garden_size" } });
    fireEvent.change(within(dialog).getByLabelText("Label"), { target: { value: "Trädgårdsyta (m²)" } });
    fireEvent.click(within(dialog).getByLabelText("New question affects pricing"));

    // Warning surfaces and the engine has no support → must acknowledge.
    expect(within(dialog).getByText(/no support for this key/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Add question" }));
    expect(screen.getByText(/Confirm the pricing-support warning/i)).toBeInTheDocument();
    expect(handlers.onAddQuestion).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByLabelText("Acknowledge unsupported pricing field"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add question" }));
    expect(handlers.onAddQuestion).toHaveBeenCalledTimes(1);
  });
});
